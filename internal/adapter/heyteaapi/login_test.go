package heyteaapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/DiheMoe/heyteago-diy/internal/adapter/appsecure"
	"github.com/DiheMoe/heyteago-diy/internal/usecase"
)

type fakeTradeSigner struct {
	calls []string
	sig   string
	err   error
}

func (f *fakeTradeSigner) SignImageDIY(_ context.Context, _ string) (string, error) {
	return "", nil
}

func (f *fakeTradeSigner) SignTrade(_ context.Context, biz, path, ts string) (string, error) {
	f.calls = append(f.calls, biz+"|"+path+"|"+ts)
	if f.err != nil {
		return "", f.err
	}
	return f.sig, nil
}

// fakeTransport 模拟 Secure-Transmission：Encrypt 包成 base64 密文信封
// （handler 可解码还原后断言原始字段），Decrypt 对称解 base64。
type fakeTransport struct {
	ticket   string
	err      error
	encErr   error
	encPaths []string
}

func (f *fakeTransport) Ticket(_ context.Context) (string, error) {
	if f.err != nil {
		return "", f.err
	}
	return f.ticket, nil
}

func (f *fakeTransport) Encrypt(_ context.Context, path string, body json.RawMessage) (json.RawMessage, error) {
	f.encPaths = append(f.encPaths, path)
	if f.encErr != nil {
		return nil, f.encErr
	}
	return json.Marshal(map[string]string{
		"secure_encrypted_c_data": base64.StdEncoding.EncodeToString(body),
	})
}

func (f *fakeTransport) Decrypt(_ context.Context, blob string) (json.RawMessage, error) {
	return base64.StdEncoding.DecodeString(blob)
}

func newLoginTestClient(t *testing.T, signer usecase.Signer, transport usecase.SecureTransport, handler http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	c := New(signer, transport)
	c.baseURL = srv.URL
	return c
}

// decodeBody 解开 fakeTransport 的密文信封，返回原始请求体。
func decodeBody(t *testing.T, r *http.Request) map[string]any {
	t.Helper()
	raw, _ := io.ReadAll(r.Body)
	var env map[string]any
	if err := json.Unmarshal(raw, &env); err != nil {
		t.Fatalf("请求体非 JSON: %v", err)
	}
	blob, _ := env["secure_encrypted_c_data"].(string)
	if blob == "" {
		t.Fatalf("请求体缺少 secure_encrypted_c_data: %s", raw)
	}
	plain, err := base64.StdEncoding.DecodeString(blob)
	if err != nil {
		t.Fatalf("密文信封解码失败: %v", err)
	}
	var body map[string]any
	if err := json.Unmarshal(plain, &body); err != nil {
		t.Fatalf("明文解析失败: %v", err)
	}
	return body
}

// 断言短信请求与官方 App 一致：路径、登录链路头组、加密手机号与固定字段；
// body 经 Secure-Transmission 加密后以密文信封发出。
func TestSendLoginSmsRequestShape(t *testing.T) {
	transport := &fakeTransport{ticket: "st-123"}
	var got struct {
		path    string
		headers http.Header
		body    map[string]any
	}
	c := newLoginTestClient(t, noopSigner{}, transport, func(w http.ResponseWriter, r *http.Request) {
		got.path = r.URL.Path
		got.headers = r.Header.Clone()
		got.body = decodeBody(t, r)
		_, _ = w.Write([]byte(`{"code":0,"message":"ok","data":{}}`))
	})

	if err := c.SendLoginSms(context.Background(), "13800138000"); err != nil {
		t.Fatalf("SendLoginSms error: %v", err)
	}

	if len(transport.encPaths) != 1 || transport.encPaths[0] != got.path {
		t.Errorf("encPaths = %v, want [短信路径]", transport.encPaths)
	}

	if got.headers.Get("Cookie") != "HeyteaSecureTransmissionTicket=st-123" {
		t.Errorf("Cookie = %q, want HeyteaSecureTransmissionTicket=st-123", got.headers.Get("Cookie"))
	}

	if got.path != "/api/service-member/openapi/vip/user/sms/verifiyCode/send" {
		t.Errorf("path = %q", got.path)
	}
	if got.body["mobile"] != "0tqoQY+tzIB3DGk10ct8sw==" {
		t.Errorf("mobile = %v, want AES 加密值", got.body["mobile"])
	}
	wantFields := map[string]any{"client": "app", "brandId": "1000001", "zone": "86", "cryptoLevel": float64(2), "ticketFrom": "min"}
	for k, v := range wantFields {
		if got.body[k] != v {
			t.Errorf("body[%s] = %v, want %v", k, got.body[k], v)
		}
	}

	wantHeaders := map[string]string{
		"Accept":           "application/prs.heytea.v1+json",
		"Content-Type":     "application/json",
		"Accept-Language":  "zh-CN",
		"Client":           "2",
		"Gmt-Zone":         "+08:00",
		"Region":           "1",
		"X-Region-Id":      "10",
		"X-Version":        "164",
		"Version":          "164",
		"Client-Version":   "164",
		"X-Client-Version": "164",
		"X-Client":         "app",
		"Current-Page":     "/pages/login/login_app/index",
		// 网关强制校验（缺省实测返回 missing_tenant_version）
		"Heytea-Secure-Transmission-Tenant":  "heyteago-android",
		"Heytea-Secure-Transmission-Version": "2",
	}
	for k, v := range wantHeaders {
		if got.headers.Get(k) != v {
			t.Errorf("header %s = %q, want %q", k, got.headers.Get(k), v)
		}
	}
	if !strings.HasPrefix(got.headers.Get("User-Agent"), "Mozilla/5.0 (Linux; Android 13;") {
		t.Errorf("User-Agent = %q", got.headers.Get("User-Agent"))
	}
	// 短信请求不带反滥用 4 头。
	for _, h := range []string{"biz", "url", "timeStamp", "hmacStr"} {
		if got.headers.Get(h) != "" {
			t.Errorf("unexpected header %s: %q", h, got.headers.Get(h))
		}
	}
}

func TestSendLoginSmsBusinessError(t *testing.T) {
	c := newLoginTestClient(t, noopSigner{}, &fakeTransport{ticket: "st-123"}, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"code":610015,"message":"发送太频繁","data":null}`))
	})
	err := c.SendLoginSms(context.Background(), "13800138000")
	be, ok := err.(*usecase.BusinessError)
	if !ok || be.Code != 610015 {
		t.Fatalf("err = %v, want BusinessError 610015", err)
	}
}

// 登录成功：token 埋在 data 的嵌套层里；反滥用 4 头与 body 关键字段要与官方一致。
func TestLoginByPhoneOK(t *testing.T) {
	signer := &fakeTradeSigner{sig: "hmac-abc"}
	var got struct {
		path    string
		headers http.Header
		body    map[string]any
	}
	c := newLoginTestClient(t, signer, &fakeTransport{ticket: "st-123"}, func(w http.ResponseWriter, r *http.Request) {
		got.path = r.URL.Path
		got.headers = r.Header.Clone()
		got.body = decodeBody(t, r)
		_, _ = w.Write([]byte(`{"code":0,"message":"ok","data":{"user":{"token":"tok-123"}}}`))
	})

	token, err := c.LoginByPhone(context.Background(), usecase.PhoneLogin{
		Phone: "13800138000", Code: "123456", Ticket: "t123",
	})
	if err != nil {
		t.Fatalf("LoginByPhone error: %v", err)
	}
	if token != "tok-123" {
		t.Fatalf("token = %q", token)
	}

	if got.headers.Get("Cookie") != "HeyteaSecureTransmissionTicket=st-123" {
		t.Errorf("Cookie = %q, want HeyteaSecureTransmissionTicket=st-123", got.headers.Get("Cookie"))
	}

	if got.path != "/api/service-login/openapi/vip/user/login_v1" {
		t.Errorf("path = %q", got.path)
	}
	// 反滥用 4 头：url/timeStamp 必须与 signer 入参一致，hmacStr 用签名值。
	if len(signer.calls) != 1 {
		t.Fatalf("signer.calls = %v", signer.calls)
	}
	call := signer.calls[0]
	if !strings.HasPrefix(call, "user|/api/service-login/openapi/vip/user/login_v1|") {
		t.Errorf("signer call = %q", call)
	}
	ts := strings.TrimPrefix(call, "user|/api/service-login/openapi/vip/user/login_v1|")
	if got.headers.Get("biz") != "user" || got.headers.Get("url") != got.path {
		t.Errorf("biz/url = %q %q", got.headers.Get("biz"), got.headers.Get("url"))
	}
	if got.headers.Get("timeStamp") != ts {
		t.Errorf("timeStamp = %q, want signer ts %q", got.headers.Get("timeStamp"), ts)
	}
	if got.headers.Get("hmacStr") != "hmac-abc" {
		t.Errorf("hmacStr = %q", got.headers.Get("hmacStr"))
	}

	if got.body["phone"] != "0tqoQY+tzIB3DGk10ct8sw==" {
		t.Errorf("phone = %v, want AES 加密值", got.body["phone"])
	}
	if v, present := got.body["email"]; !present || v != nil {
		t.Errorf("email = %v (present=%v), want 显式 null", v, present)
	}
	wantFields := map[string]any{
		"channel": "A", "client": "app", "loginType": "APP_CODE", "brand": "1000001",
		"smsCode": "123456", "zone": "86", "cryptoLevel": float64(2),
		"ticket": "t123", "ticketFrom": "min", "verifyTicket": "",
	}
	for k, v := range wantFields {
		if got.body[k] != v {
			t.Errorf("body[%s] = %v, want %v", k, got.body[k], v)
		}
	}
	if dev, ok := got.body["deviceId"].(string); !ok || len(dev) != 36 {
		t.Errorf("deviceId = %v, want UUID 形状", got.body["deviceId"])
	}
}

// 第一条路径 code!=0（即使 data 里有 token 也不算成功），回退到 pms 路径成功。
func TestLoginByPhoneFallback(t *testing.T) {
	signer := &fakeTradeSigner{sig: "hmac-abc"}
	var paths []string
	c := newLoginTestClient(t, signer, &fakeTransport{ticket: "st-123"}, func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		if strings.Contains(r.URL.Path, "service-login-pms") {
			_, _ = w.Write([]byte(`{"code":0,"message":"ok","data":{"token":"tok-pms"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"code":401,"message":"验证码错误","data":{"token":"tok-decoy"}}`))
	})

	token, err := c.LoginByPhone(context.Background(), usecase.PhoneLogin{
		Phone: "13800138000", Code: "123456", Ticket: "t123",
	})
	if err != nil {
		t.Fatalf("LoginByPhone error: %v", err)
	}
	if token != "tok-pms" {
		t.Fatalf("token = %q", token)
	}
	if len(paths) != 2 || !strings.Contains(paths[1], "service-login-pms") {
		t.Fatalf("paths = %v", paths)
	}
	if len(signer.calls) != 2 {
		t.Fatalf("signer.calls = %v, want 每条路径各签一次", signer.calls)
	}
}

// 两条路径都失败时返回最后一次的错误（BusinessError）。
func TestLoginByPhoneBothFail(t *testing.T) {
	signer := &fakeTradeSigner{sig: "hmac-abc"}
	c := newLoginTestClient(t, signer, &fakeTransport{ticket: "st-123"}, func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "service-login-pms") {
			_, _ = w.Write([]byte(`{"code":401,"message":"验证码已过期","data":null}`))
			return
		}
		_, _ = w.Write([]byte(`{"code":500,"message":"系统繁忙","data":null}`))
	})

	_, err := c.LoginByPhone(context.Background(), usecase.PhoneLogin{
		Phone: "13800138000", Code: "123456", Ticket: "t123",
	})
	be, ok := err.(*usecase.BusinessError)
	if !ok || be.Code != 401 {
		t.Fatalf("err = %v, want 最后一次的 BusinessError 401", err)
	}
}

func TestLoginByPhoneSignError(t *testing.T) {
	signer := &fakeTradeSigner{err: context.DeadlineExceeded}
	called := false
	c := newLoginTestClient(t, signer, &fakeTransport{ticket: "st-123"}, func(w http.ResponseWriter, r *http.Request) {
		called = true
	})

	_, err := c.LoginByPhone(context.Background(), usecase.PhoneLogin{
		Phone: "13800138000", Code: "123456", Ticket: "t123",
	})
	var se *usecase.SignError
	if !errors.As(err, &se) {
		t.Fatalf("err = %v, want SignError", err)
	}
	if called {
		t.Fatal("签名失败时不应发出 HTTP 请求")
	}
}

// 取 Secure-Transmission ticket 失败时直接报错，不发 HTTP（含"喜茶"字样，httpapi 映射 502）。
func TestSendLoginSmsTicketError(t *testing.T) {
	called := false
	c := newLoginTestClient(t, noopSigner{}, &fakeTransport{err: context.DeadlineExceeded}, func(w http.ResponseWriter, r *http.Request) {
		called = true
	})

	err := c.SendLoginSms(context.Background(), "13800138000")
	if err == nil || !strings.Contains(err.Error(), "获取喜茶安全传输 ticket 失败") {
		t.Fatalf("err = %v, want 获取喜茶安全传输 ticket 失败", err)
	}
	if called {
		t.Fatal("取 ticket 失败时不应发出 HTTP 请求")
	}
}

// 请求体加密失败时直接报错，不发 HTTP。
func TestSendLoginSmsEncryptError(t *testing.T) {
	called := false
	c := newLoginTestClient(t, noopSigner{}, &fakeTransport{ticket: "st-123", encErr: context.DeadlineExceeded}, func(w http.ResponseWriter, r *http.Request) {
		called = true
	})

	err := c.SendLoginSms(context.Background(), "13800138000")
	if err == nil || !strings.Contains(err.Error(), "喜茶安全传输加密请求体失败") {
		t.Fatalf("err = %v, want 喜茶安全传输加密请求体失败", err)
	}
	if called {
		t.Fatal("加密失败时不应发出 HTTP 请求")
	}
}

// 成功响应的 data 是 secure_encrypted_s_data 密文信封时，解密后再取 token。
func TestLoginByPhoneEncryptedResponse(t *testing.T) {
	signer := &fakeTradeSigner{sig: "hmac-abc"}
	blob := base64.StdEncoding.EncodeToString([]byte(`{"user":{"token":"tok-enc"}}`))
	c := newLoginTestClient(t, signer, &fakeTransport{ticket: "st-123"}, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"code":0,"message":"ok","data":{"secure_encrypted_s_data":"` + blob + `"}}`))
	})

	token, err := c.LoginByPhone(context.Background(), usecase.PhoneLogin{
		Phone: "13800138000", Code: "123456", Ticket: "t123",
	})
	if err != nil {
		t.Fatalf("LoginByPhone error: %v", err)
	}
	if token != "tok-enc" {
		t.Fatalf("token = %q, want 解密后的 tok-enc", token)
	}
}

// 真实网关探针：加密请求体穿透网关到达业务层（非法手机号返回业务错误码而非
// HTTP 400 invalid_payload），证明 Secure-Transmission 加解密链路端到端可用。
// 仅需网络。
func TestLiveSendLoginSms(t *testing.T) {
	if os.Getenv("HEYTEA_TEST_LIVE") != "1" {
		t.Skip("set HEYTEA_TEST_LIVE=1 to run")
	}
	src := appsecure.New(appsecure.DefaultConfig())
	defer src.Close()

	c := New(noopSigner{}, src)
	err := c.SendLoginSms(context.Background(), "123")
	var be *usecase.BusinessError
	if !errors.As(err, &be) {
		t.Fatalf("err = %v, want BusinessError（加密链路穿透网关到达业务层）", err)
	}
	t.Logf("网关业务响应: code=%d message=%s", be.Code, be.Message)
}
