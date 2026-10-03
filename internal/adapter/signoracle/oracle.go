// Package signoracle 用长驻 java 进程封装签名 oracle（unidbg 模拟执行 libheyteago.so）。
// 协议：启动打印 "READY"；stdin 每行一个 sha256 hex，stdout 回 "RESULT:{json}"，
// json.errorCode==0 时 data 字段即上传签名。
// unidbg 非线程安全，所有请求经互斥锁串行；进程崩溃后下一次请求惰性重启。
package signoracle

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
	JarPath      string
	SoPath       string
	JavaBin      string
	Env          string // oracle 的环境名（prod / test），传给 setEnv
	ReadyTimeout time.Duration
	SignTimeout  time.Duration
}

func DefaultConfig() Config {
	return Config{
		JarPath:      "bin/sign-oracle.jar",
		SoPath:       "bin/libheyteago.so",
		JavaBin:      "java",
		Env:          "prod",
		ReadyTimeout: 60 * time.Second,
		SignTimeout:  30 * time.Second,
	}
}

type Oracle struct {
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

func New(cfg Config) *Oracle {
	return &Oracle{cfg: cfg}
}

func (o *Oracle) SignImageDIY(ctx context.Context, sha256Hex string) (string, error) {
	o.mu.Lock()
	defer o.mu.Unlock()

	if err := o.ensureReadyLocked(ctx); err != nil {
		return "", err
	}

	if _, err := io.WriteString(o.stdin, sha256Hex+"\n"); err != nil {
		o.resetLocked()
		return "", fmt.Errorf("写入签名请求失败: %w", err)
	}

	timer := time.NewTimer(o.cfg.SignTimeout)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			// 协议没有请求关联标识，迟到的 RESULT 无法与后续请求区分，
			// 只能重启 oracle 保证状态干净。
			o.resetLocked()
			return "", ctx.Err()
		case <-timer.C:
			o.resetLocked()
			return "", errors.New("签名超时")
		case l := <-o.lines:
			if l.err != nil {
				o.resetLocked()
				return "", fmt.Errorf("签名 oracle 已退出: %w", l.err)
			}
			if sig, ok, err := parseResult(l.text); ok {
				if err != nil {
					return "", err
				}
				return sig, nil
			}
			log.Printf("[sign] oracle 输出（非结果行）: %.200s", l.text)
		}
	}
}

// ensureReadyLocked 懒启动 oracle 并等待 READY。
func (o *Oracle) ensureReadyLocked(ctx context.Context) error {
	if o.cmd != nil {
		return nil
	}
	if o.cfg.JarPath == "" || o.cfg.SoPath == "" {
		return errors.New("未配置签名 oracle 的 jar/so 路径")
	}

	ctx2, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx2, o.cfg.JavaBin, "-jar", o.cfg.JarPath, o.cfg.SoPath, o.cfg.Env)
	cmd.Stderr = os.Stderr // oracle 自身日志直通 stderr（unidbg 输出较多）
	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return fmt.Errorf("建立 oracle stdin 失败: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return fmt.Errorf("建立 oracle stdout 失败: %w", err)
	}
	if err := cmd.Start(); err != nil {
		cancel()
		return fmt.Errorf("启动签名 oracle 失败: %w", err)
	}

	lines := make(chan line, 16)
	go readLines(cmd, stdout, lines)

	o.cmd = cmd
	o.stdin = stdin
	o.lines = lines
	o.cancel = cancel

	timer := time.NewTimer(o.cfg.ReadyTimeout)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			o.resetLocked()
			return ctx.Err()
		case <-timer.C:
			o.resetLocked()
			return errors.New("签名 oracle 启动超时")
		case l := <-lines:
			if l.err != nil {
				o.resetLocked()
				return fmt.Errorf("签名 oracle 启动失败: %w", l.err)
			}
			if len(l.text) >= 5 && l.text[:5] == "READY" {
				log.Printf("[sign] 签名 oracle 就绪")
				return nil
			}
			log.Printf("[sign] oracle 输出: %.200s", l.text)
		}
	}
}

// resetLocked 杀掉进程并清空状态，下次调用重新拉起。
func (o *Oracle) resetLocked() {
	if o.cancel != nil {
		o.cancel()
	}
	o.cmd = nil
	o.stdin = nil
	o.lines = nil
	o.cancel = nil
}

// Close 在服务退出时终止 oracle 进程。
func (o *Oracle) Close() {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.resetLocked()
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

type oracleResult struct {
	ErrorCode int    `json:"errorCode"`
	Message   string `json:"message"`
	Data      string `json:"data"`
}

// parseResult 解析 RESULT 行；ok=false 表示该行不是结果行。
func parseResult(text string) (sig string, ok bool, err error) {
	const prefix = "RESULT:"
	if len(text) < len(prefix) || text[:len(prefix)] != prefix {
		return "", false, nil
	}
	var res oracleResult
	if err := json.Unmarshal([]byte(text[len(prefix):]), &res); err != nil {
		return "", true, fmt.Errorf("签名结果解析失败: %.200s", text[len(prefix):])
	}
	if res.ErrorCode != 0 || res.Data == "" {
		return "", true, fmt.Errorf("oracle 返回 errorCode=%d: %s", res.ErrorCode, res.Message)
	}
	return res.Data, true, nil
}
