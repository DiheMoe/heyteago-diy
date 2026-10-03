// Package secureticket 用长驻 Python 助手进程封装 Secure-Transmission
// （tools/secure-ticket/secure_ticket.py，内部经 unicorn 模拟执行 libsdk_core.so）。
// 协议：启动打印 "READY"；stdin 每行一条命令，stdout 回一行 JSON——
//
//	TICKET                     -> {"ticket":"..."}
//	ENCRYPT <path> <json-body> -> {"body":{...}}（按握手路由规则加密，不加密路由原样返回）
//	DECRYPT <blob>             -> {"data":{...}}
//
// 失败统一回 {"error":"..."}（error 行不代表进程死亡，不重启）。
// 会话在助手进程内复用并临期自动续握手，因此调用方每次请求现取即可，无需缓存。
// unicorn 非线程安全，所有请求经互斥锁串行；协议没有请求关联标识，
// 超时/取消/进程退出后只能重启助手保证状态干净。
package secureticket

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"sync"
	"time"
)

type Config struct {
	PythonBin    string
	ScriptPath   string
	SoPath       string // libsdk_core.so，经 HEYTEA_SDK_SO 传给助手
	ReadyTimeout time.Duration
	ReqTimeout   time.Duration
}

func DefaultConfig() Config {
	return Config{
		PythonBin:    "python3",
		ScriptPath:   "tools/secure-ticket/secure_ticket.py",
		SoPath:       "bin/libsdk_core.so",
		ReadyTimeout: 60 * time.Second,
		// 首次请求与续期含握手网络往返，超时给足。
		ReqTimeout: 30 * time.Second,
	}
}

type Source struct {
	cfg Config

	// mu 同时充当串行队列：行协议同一时刻只允许一个未决请求。
	mu     sync.Mutex
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	lines  chan line
	cancel context.CancelFunc
}

// line 是 reader 协程的输出；err 非空表示进程侧终结（EOF 或退出）。
type line struct {
	text string
	err  error
}

func New(cfg Config) *Source {
	return &Source{cfg: cfg}
}

// Ticket 从助手现取一个 Secure-Transmission ticket。
func (s *Source) Ticket(ctx context.Context) (string, error) {
	raw, err := s.call(ctx, "TICKET")
	if err != nil {
		return "", err
	}
	var res struct {
		Ticket string `json:"ticket"`
	}
	if err := json.Unmarshal([]byte(raw), &res); err != nil || res.Ticket == "" {
		return "", fmt.Errorf("ticket 助手返回缺少 ticket 字段: %.200s", raw)
	}
	return res.Ticket, nil
}

// Encrypt 按握手路由规则加密请求体，返回可直接 POST 的 JSON
// （密文信封 {"secure_encrypted_c_data":...}；路由不要求加密时原样返回明文）。
func (s *Source) Encrypt(ctx context.Context, path string, body json.RawMessage) (json.RawMessage, error) {
	raw, err := s.call(ctx, "ENCRYPT "+path+" "+string(body))
	if err != nil {
		return nil, err
	}
	var res struct {
		Body json.RawMessage `json:"body"`
	}
	if err := json.Unmarshal([]byte(raw), &res); err != nil || len(res.Body) == 0 {
		return nil, fmt.Errorf("ticket 助手返回缺少 body 字段: %.200s", raw)
	}
	return res.Body, nil
}

// Decrypt 解密响应 data 里的 secure_encrypted_s_data 密文。
func (s *Source) Decrypt(ctx context.Context, blob string) (json.RawMessage, error) {
	raw, err := s.call(ctx, "DECRYPT "+blob)
	if err != nil {
		return nil, err
	}
	var res struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal([]byte(raw), &res); err != nil || len(res.Data) == 0 {
		return nil, fmt.Errorf("ticket 助手返回缺少 data 字段: %.200s", raw)
	}
	return res.Data, nil
}

// call 写入一条命令并等待响应：跳过非 JSON 行、把 {"error":...} 转为 error，
// 返回成功响应行的原始 JSON，业务字段由调用方解析。
func (s *Source) call(ctx context.Context, req string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.ensureReadyLocked(ctx); err != nil {
		return "", err
	}

	if _, err := io.WriteString(s.stdin, req+"\n"); err != nil {
		s.resetLocked()
		return "", fmt.Errorf("写入助手请求失败: %w", err)
	}

	timer := time.NewTimer(s.cfg.ReqTimeout)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			s.resetLocked()
			return "", ctx.Err()
		case <-timer.C:
			s.resetLocked()
			return "", errors.New("等待 ticket 助手响应超时")
		case l := <-s.lines:
			if l.err != nil {
				s.resetLocked()
				return "", fmt.Errorf("ticket 助手已退出: %w", l.err)
			}
			var res struct {
				Error string `json:"error"`
			}
			if err := json.Unmarshal([]byte(l.text), &res); err != nil {
				log.Printf("[ticket] 助手输出（非 JSON 行）: %.200s", l.text)
				continue
			}
			if res.Error != "" {
				return "", fmt.Errorf("ticket 助手: %s", res.Error)
			}
			return l.text, nil
		}
	}
}

// ensureReadyLocked 懒启动助手并等待 READY。
func (s *Source) ensureReadyLocked(ctx context.Context) error {
	if s.cmd != nil {
		return nil
	}
	if s.cfg.PythonBin == "" || s.cfg.ScriptPath == "" || s.cfg.SoPath == "" {
		return errors.New("未配置 ticket 助手的 python/脚本/so 路径")
	}

	ctx2, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx2, s.cfg.PythonBin, s.cfg.ScriptPath)
	// 助手默认找自身 lib/ 目录下的 so，部署时由这里显式指定。
	cmd.Env = append(os.Environ(), "HEYTEA_SDK_SO="+s.cfg.SoPath)
	cmd.Stderr = os.Stderr
	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return fmt.Errorf("建立 ticket 助手 stdin 失败: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return fmt.Errorf("建立 ticket 助手 stdout 失败: %w", err)
	}
	if err := cmd.Start(); err != nil {
		cancel()
		return fmt.Errorf("启动 ticket 助手失败: %w", err)
	}

	lines := make(chan line, 16)
	go readLines(cmd, stdout, lines)

	s.cmd = cmd
	s.stdin = stdin
	s.lines = lines
	s.cancel = cancel

	timer := time.NewTimer(s.cfg.ReadyTimeout)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			s.resetLocked()
			return ctx.Err()
		case <-timer.C:
			s.resetLocked()
			return errors.New("ticket 助手启动超时")
		case l := <-lines:
			if l.err != nil {
				s.resetLocked()
				return fmt.Errorf("ticket 助手启动失败: %w", l.err)
			}
			if len(l.text) >= 5 && l.text[:5] == "READY" {
				log.Printf("[ticket] ticket 助手就绪")
				return nil
			}
			log.Printf("[ticket] 助手输出: %.200s", l.text)
		}
	}
}

// resetLocked 杀掉进程并清空状态，下次调用重新拉起。
func (s *Source) resetLocked() {
	if s.cancel != nil {
		s.cancel()
	}
	s.cmd = nil
	s.stdin = nil
	s.lines = nil
	s.cancel = nil
}

// Close 在服务退出时终止助手进程。
func (s *Source) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.resetLocked()
}

func readLines(cmd *exec.Cmd, stdout io.Reader, out chan<- line) {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for scanner.Scan() {
		out <- line{text: scanner.Text()}
	}
	// 读完后 Wait 回收子进程，避免 zombie；进程被 resetLocked 杀掉时同样走到这里。
	waitErr := cmd.Wait()
	if err := scanner.Err(); err != nil {
		out <- line{err: err}
	} else if waitErr != nil {
		out <- line{err: waitErr}
	} else {
		out <- line{err: io.EOF}
	}
	close(out)
}
