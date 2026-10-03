package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/DiheMoe/heyteago-diy/internal/domain"
	"github.com/DiheMoe/heyteago-diy/internal/usecase"
)

type fakeSigner struct{}

func (fakeSigner) SignImageDIY(_ context.Context, _ string) (string, error) { return "h", nil }
func (fakeSigner) SignTrade(_ context.Context, _, _, _ string) (string, error) {
	return "trade-sign", nil
}

type fakeGateway struct {
	lastUpload usecase.StickerUpload
	lastDraft  usecase.DraftSave
	lastSms    usecase.LoginSms
	lastLogin  usecase.PhoneLogin
	loginToken string
	loginErr   error
}

func (f *fakeGateway) UploadSticker(_ context.Context, req usecase.StickerUpload) (domain.Result, error) {
	f.lastUpload = req
	return domain.Result{Code: 0, Data: json.RawMessage(`{"id":1}`)}, nil
}

func (f *fakeGateway) SaveDraft(_ context.Context, req usecase.DraftSave) (domain.Result, error) {
	f.lastDraft = req
	return domain.Result{Code: 0, Data: json.RawMessage(`{}`)}, nil
}

func (f *fakeGateway) UserInfo(_ context.Context, token string) (domain.User, error) {
	if token != "file-token" && token != "given-token" && token != "login-token" {
		return domain.User{}, &usecase.BusinessError{Code: 401, Message: "登录态失效"}
	}
	return domain.User{UserMainID: 7, Name: "测试"}, nil
}

func (f *fakeGateway) SendLoginSms(_ context.Context, req usecase.LoginSms) error {
	f.lastSms = req
	return nil
}

func (f *fakeGateway) LoginByPhone(_ context.Context, req usecase.PhoneLogin) (string, error) {
	f.lastLogin = req
	if f.loginErr != nil {
		return "", f.loginErr
	}
	return f.loginToken, nil
}

func newTestServer(gw *fakeGateway) http.Handler {
	stickers := usecase.NewStickerService(fakeSigner{}, gw)
	users := usecase.NewUserService(gw)
	auth := usecase.NewAuthService(gw)
	return NewServer(stickers, users, auth).Handler()
}

func multipartBody(t *testing.T, fields map[string]string, fileField, fileName string, file []byte) (string, *bytes.Buffer) {
	t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	for k, v := range fields {
		if err := w.WriteField(k, v); err != nil {
			t.Fatal(err)
		}
	}
	if fileField != "" {
		part, err := w.CreateFormFile(fileField, fileName)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(file); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return w.FormDataContentType(), &body
}

func TestUploadMissingToken(t *testing.T) {
	gw := &fakeGateway{}
	srv := httptest.NewServer(newTestServer(gw))
	defer srv.Close()

	ctype, body := multipartBody(t, map[string]string{"userMainId": "42"}, "file", "cup.png", []byte("img"))
	resp, err := http.Post(srv.URL+"/api/upload", ctype, body)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestUploadProvidedTokenWins(t *testing.T) {
	gw := &fakeGateway{}
	srv := httptest.NewServer(newTestServer(gw))
	defer srv.Close()

	ctype, body := multipartBody(t, map[string]string{"userMainId": "42", "token": "given-token"}, "file", "cup.png", []byte("img"))
	resp, err := http.Post(srv.URL+"/api/upload", ctype, body)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if gw.lastUpload.Token != "given-token" {
		t.Fatalf("token = %q", gw.lastUpload.Token)
	}
}

func TestUploadMissingUserMainID(t *testing.T) {
	gw := &fakeGateway{}
	srv := httptest.NewServer(newTestServer(gw))
	defer srv.Close()

	ctype, body := multipartBody(t, map[string]string{"token": "given-token"}, "file", "cup.png", []byte("img"))
	resp, err := http.Post(srv.URL+"/api/upload", ctype, body)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestUploadMissingFile(t *testing.T) {
	gw := &fakeGateway{}
	srv := httptest.NewServer(newTestServer(gw))
	defer srv.Close()

	ctype, body := multipartBody(t, map[string]string{"userMainId": "42"}, "", "", nil)
	resp, err := http.Post(srv.URL+"/api/upload", ctype, body)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestSaveDraftOK(t *testing.T) {
	gw := &fakeGateway{}
	srv := httptest.NewServer(newTestServer(gw))
	defer srv.Close()

	ctype, body := multipartBody(t, map[string]string{"token": "given-token"}, "file", "cup.png", []byte("img"))
	resp, err := http.Post(srv.URL+"/api/draft/save", ctype, body)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d, body = %s", resp.StatusCode, raw)
	}
	if gw.lastDraft.Token != "given-token" {
		t.Fatalf("draft token = %q", gw.lastDraft.Token)
	}
}

func TestUserEndpoint(t *testing.T) {
	gw := &fakeGateway{}
	srv := httptest.NewServer(newTestServer(gw))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/user?token=file-token")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var out struct {
		User domain.User `json:"user"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.User.UserMainID != 7 {
		t.Fatalf("user = %+v", out.User)
	}
}

func TestUserEndpointBearer(t *testing.T) {
	gw := &fakeGateway{}
	srv := httptest.NewServer(newTestServer(gw))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/user", nil)
	req.Header.Set("Authorization", "Bearer given-token")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
}

// 服务端不存储也不下发 token：该端点不得存在。
func TestLocalAppTokenGone(t *testing.T) {
	gw := &fakeGateway{}
	srv := httptest.NewServer(newTestServer(gw))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/local-app-token")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
}

func TestHealth(t *testing.T) {
	gw := &fakeGateway{}
	srv := httptest.NewServer(newTestServer(gw))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
}

func postJSON(t *testing.T, url, body string) *http.Response {
	t.Helper()
	resp, err := http.Post(url, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func TestLoginSmsOK(t *testing.T) {
	gw := &fakeGateway{}
	srv := httptest.NewServer(newTestServer(gw))
	defer srv.Close()

	resp := postJSON(t, srv.URL+"/api/login/sms", `{"phone":"13800138000"}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d, body = %s", resp.StatusCode, raw)
	}
	if gw.lastSms.Mobile != "13800138000" {
		t.Fatalf("sms mobile = %q", gw.lastSms.Mobile)
	}
}

// 滑块 ticket/randstr 原样透传给网关（4005021 要求人机验证后的重试路径）。
func TestLoginSmsWithCaptcha(t *testing.T) {
	gw := &fakeGateway{}
	srv := httptest.NewServer(newTestServer(gw))
	defer srv.Close()

	resp := postJSON(t, srv.URL+"/api/login/sms", `{"phone":"13800138000","ticket":"cap-t","randstr":"cap-r"}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d, body = %s", resp.StatusCode, raw)
	}
	if gw.lastSms != (usecase.LoginSms{Mobile: "13800138000", Ticket: "cap-t", Randstr: "cap-r"}) {
		t.Fatalf("sms req = %+v", gw.lastSms)
	}
}

func TestLoginSmsInvalidPhone(t *testing.T) {
	gw := &fakeGateway{}
	srv := httptest.NewServer(newTestServer(gw))
	defer srv.Close()

	resp := postJSON(t, srv.URL+"/api/login/sms", `{"phone":"abc"}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	if gw.lastSms.Mobile != "" {
		t.Fatalf("gateway called despite invalid phone: %q", gw.lastSms.Mobile)
	}
}

func TestLoginOK(t *testing.T) {
	gw := &fakeGateway{loginToken: "login-token"}
	srv := httptest.NewServer(newTestServer(gw))
	defer srv.Close()

	resp := postJSON(t, srv.URL+"/api/login", `{"phone":"13800138000","code":"123456","ticket":"t123"}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d, body = %s", resp.StatusCode, raw)
	}
	var out struct {
		Token string      `json:"token"`
		User  domain.User `json:"user"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.Token != "login-token" || out.User.UserMainID != 7 {
		t.Fatalf("out = %+v", out)
	}
	if gw.lastLogin != (usecase.PhoneLogin{Phone: "13800138000", Code: "123456", Ticket: "t123"}) {
		t.Fatalf("login req = %+v", gw.lastLogin)
	}
}

func TestLoginMissingFields(t *testing.T) {
	gw := &fakeGateway{}
	srv := httptest.NewServer(newTestServer(gw))
	defer srv.Close()

	resp := postJSON(t, srv.URL+"/api/login", `{"phone":"13800138000"}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestLoginBadJSON(t *testing.T) {
	gw := &fakeGateway{}
	srv := httptest.NewServer(newTestServer(gw))
	defer srv.Close()

	resp := postJSON(t, srv.URL+"/api/login", `not json`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}
