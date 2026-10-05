package appsecure

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

// 真实打喜茶网关的集成测试：默认跳过，HEYTEA_TEST_LIVE=1 时启用。
// 验证纯 Go 握手被服务端接受，且服务端能解开我方 AES-128-GCM 密文请求体
// （返回业务错误而非 invalid_payload/missing_ticket，即证明加密与真机一致）。
// 不发送任何短信：请求体故意缺少 mobile，服务端解密后在业务层即拒绝。
func TestLiveHandshakeAndEncrypt(t *testing.T) {
	if os.Getenv("HEYTEA_TEST_LIVE") != "1" {
		t.Skip("set HEYTEA_TEST_LIVE=1 to run against the live gateway")
	}
	s := New(DefaultConfig())
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	sess, err := s.Session(ctx)
	if err != nil {
		t.Fatalf("握手失败: %v", err)
	}
	ticket := sess.Ticket()
	if ticket == "" {
		t.Fatal("ticket 为空")
	}
	t.Logf("握手成功，ticket=%.12s… 明文路由数=%d", ticket, len(s.plaintext))

	const smsPath = "/api/service-member/openapi/vip/user/sms/verifiyCode/send"
	// 故意不带 mobile：若服务端成功解密，会在业务层因缺字段报错（非 invalid_payload）。
	body, _ := json.Marshal(map[string]any{"client": "app", "brandId": "1000001", "zone": "86"})
	enc, err := sess.Encrypt(smsPath, body)
	if err != nil {
		t.Fatalf("加密失败: %v", err)
	}
	var env map[string]string
	if err := json.Unmarshal(enc, &env); err != nil || env["secure_encrypted_c_data"] == "" {
		t.Fatalf("sms 路由应加密, got %s", enc)
	}

	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, DefaultConfig().Host+smsPath, bytes.NewReader(enc))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Heytea-Secure-Transmission-Tenant", "heyteago-android")
	req.Header.Set("Heytea-Secure-Transmission-Version", "2")
	req.Header.Set("X-client", "app")
	req.Header.Set("Cookie", "HeyteaSecureTransmissionTicket="+ticket)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("请求失败: %v", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	t.Logf("sms resp HTTP %d: %.400s", resp.StatusCode, raw)

	lower := strings.ToLower(string(raw))
	for _, bad := range []string{"invalid_payload", "missing_ticket", "decrypt", "secure"} {
		if strings.Contains(lower, bad) {
			t.Fatalf("服务端未能解开我方密文（命中 %q）——加密层不一致", bad)
		}
	}
	t.Log("服务端已成功解密我方请求体（业务层响应，非加密错误）——纯 Go Secure-Transmission 生效")
}
