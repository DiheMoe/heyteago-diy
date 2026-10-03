package secureticket

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func newTestSource(script string) *Source {
	cfg := DefaultConfig()
	cfg.PythonBin = "sh"
	cfg.ScriptPath = "testdata/" + script
	cfg.SoPath = "test-sdk-core.so"
	cfg.ReadyTimeout = 5 * time.Second
	cfg.ReqTimeout = 5 * time.Second
	return New(cfg)
}

// 正常取票：READY 握手、非 JSON 行跳过、HEYTEA_SDK_SO 经环境变量透传给助手。
func TestTicketOK(t *testing.T) {
	s := newTestSource("helper.sh")
	defer s.Close()

	ticket, err := s.Ticket(context.Background())
	if err != nil {
		t.Fatalf("Ticket: %v", err)
	}
	if ticket != "test-sdk-core.so" {
		t.Fatalf("ticket = %q, want HEYTEA_SDK_SO 透传值", ticket)
	}

	// 第二次取票复用同一进程。
	if _, err := s.Ticket(context.Background()); err != nil {
		t.Fatalf("second Ticket: %v", err)
	}
}

// error 行报错但不杀进程，下一次请求同一进程恢复正常。
func TestTicketErrorLineKeepsProcess(t *testing.T) {
	s := newTestSource("error_once.sh")
	defer s.Close()

	_, err := s.Ticket(context.Background())
	if err == nil || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("err = %v, want 助手 error 行内容", err)
	}

	ticket, err := s.Ticket(context.Background())
	if err != nil {
		t.Fatalf("error 行后 Ticket: %v", err)
	}
	if ticket != "recovered-ticket" {
		t.Fatalf("ticket = %q, want recovered-ticket（进程未被重启）", ticket)
	}
}

// 进程回复后退出：下一次请求失败并 reset，再下一次惰性重启成功。
func TestTicketRestartAfterExit(t *testing.T) {
	s := newTestSource("exit_after_reply.sh")
	defer s.Close()

	ticket, err := s.Ticket(context.Background())
	if err != nil || ticket != "once" {
		t.Fatalf("first Ticket = %q, %v", ticket, err)
	}

	// 进程已退出，这次请求触发 reset（写失败或读到 EOF）。
	if _, err := s.Ticket(context.Background()); err == nil {
		t.Fatal("进程退出后的请求应报错")
	}

	ticket, err = s.Ticket(context.Background())
	if err != nil || ticket != "once" {
		t.Fatalf("重启后 Ticket = %q, %v", ticket, err)
	}
}

// 助手不回复时按 ReqTimeout 超时。
func TestTicketTimeout(t *testing.T) {
	s := newTestSource("silent.sh")
	defer s.Close()
	s.cfg.ReqTimeout = 300 * time.Millisecond

	_, err := s.Ticket(context.Background())
	if err == nil || !strings.Contains(err.Error(), "超时") {
		t.Fatalf("err = %v, want 超时", err)
	}
}

// ENCRYPT 与 TICKET 复用同一进程与串行队列，响应 body 原样返回给调用方。
func TestEncryptOK(t *testing.T) {
	s := newTestSource("helper.sh")
	defer s.Close()

	out, err := s.Encrypt(context.Background(), "/api/x", json.RawMessage(`{"a":1}`))
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if string(out) != `{"a":1}` {
		t.Fatalf("Encrypt = %s, want 透传回显", out)
	}

	// 同进程继续取票不受影响。
	if _, err := s.Ticket(context.Background()); err != nil {
		t.Fatalf("Encrypt 后 Ticket: %v", err)
	}
}

// DECRYPT 把 blob 透给助手，返回解析后的 data 字段。
func TestDecryptOK(t *testing.T) {
	s := newTestSource("helper.sh")
	defer s.Close()

	out, err := s.Decrypt(context.Background(), "YmxvYg==")
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if string(out) != `{"plain":"YmxvYg=="}` {
		t.Fatalf("Decrypt = %s", out)
	}
}
