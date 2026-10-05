package heyteaapi

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/DiheMoe/heyteago-diy/internal/usecase"
)

func newTestClient(t *testing.T, handler http.HandlerFunc) (*Client, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	c := New(noopSigner{}, noopTransport{})
	c.baseURL = srv.URL
	return c, srv
}

// noopSigner 满足 usecase.Signer；上传/用户链路不触碰签名，仅登录链路测试用真 fake。
type noopSigner struct{}

func (noopSigner) SignImageDIY(_ context.Context, _ string) (string, error) { return "", nil }
func (noopSigner) SignTrade(_ context.Context, _, _, _ string) (string, error) {
	return "", nil
}

// noopTransport 满足 usecase.SecureTransport；上传/用户链路不触碰安全传输，仅登录链路测试用真 fake。
type noopTransport struct{}

func (noopTransport) Session(_ context.Context) (usecase.SecureSession, error) {
	return noopSession{}, nil
}

type noopSession struct{}

func (noopSession) Ticket() string { return "" }
func (noopSession) Encrypt(_ string, body json.RawMessage) (json.RawMessage, error) {
	return body, nil
}
func (noopSession) Decrypt(_ string) (json.RawMessage, error) { return nil, nil }

// 断言上传请求与官方 App 抓包形状一致：路径、query、4 个头、表单字段。
func TestUploadStickerRequestShape(t *testing.T) {
	var got struct {
		path    string
		query   map[string]string
		headers http.Header
		fields  map[string]string
		file    string
		ctype   string
	}
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		got.path = r.URL.Path
		got.query = map[string]string{}
		for k := range r.URL.Query() {
			got.query[k] = r.URL.Query().Get(k)
		}
		got.headers = r.Header.Clone()

		mediaType, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || !strings.HasPrefix(mediaType, "multipart/") {
			t.Errorf("Content-Type not multipart: %v", r.Header.Get("Content-Type"))
			return
		}
		mr := multipart.NewReader(r.Body, params["boundary"])
		got.fields = map[string]string{}
		for {
			part, err := mr.NextPart()
			if err != nil {
				break
			}
			data, _ := io.ReadAll(part)
			if part.FormName() == "file" {
				got.file = string(data)
				got.ctype = part.Header.Get("Content-Type")
			} else {
				got.fields[part.FormName()] = string(data)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"message":"ok","data":{"id":7}}`))
	})

	res, err := c.UploadSticker(context.Background(), usecase.StickerUpload{
		Token:       "tok",
		UserMainID:  "192728475",
		Hash:        "signed-hash",
		FileName:    "cup.png",
		ContentType: "image/png",
		File:        []byte("PNGDATA"),
		Width:       596,
		Height:      832,
	})
	if err != nil {
		t.Fatalf("UploadSticker error: %v", err)
	}
	if res.Code != 0 {
		t.Fatalf("res.Code = %d", res.Code)
	}

	if got.path != "/api/service-cps/user/diy" {
		t.Errorf("path = %q", got.path)
	}
	if got.query["hash"] != "signed-hash" {
		t.Errorf("hash query = %q", got.query["hash"])
	}
	ts, err := strconv.ParseInt(got.query["t"], 10, 64)
	if err != nil || ts <= 0 {
		t.Errorf("t query = %q", got.query["t"])
	}
	wantSign := md5.Sum([]byte(signSalt + "192728475" + got.query["t"]))
	if got.query["sign"] != hex.EncodeToString(wantSign[:]) {
		t.Errorf("sign = %q, want md5(salt+uid+t)", got.query["sign"])
	}

	// 官方抓包只有 4 个头：Content-Type / X-client-version / X-client / Authorization。
	if got.headers.Get("Authorization") != "Bearer tok" {
		t.Errorf("Authorization = %q", got.headers.Get("Authorization"))
	}
	if got.headers.Get("X-client") != "app" || got.headers.Get("X-client-version") != "163" {
		t.Errorf("client headers = %q %q", got.headers.Get("X-client"), got.headers.Get("X-client-version"))
	}
	for _, h := range []string{"Referer", "User-Agent", "Origin"} {
		if got.headers.Get(h) != "" {
			t.Errorf("unexpected header %s: %q", h, got.headers.Get(h))
		}
	}

	if got.file != "PNGDATA" || got.ctype != "image/png" {
		t.Errorf("file part = %q (%q)", got.file, got.ctype)
	}
	wantFields := map[string]string{"width": "596", "height": "832", "aiNos": "", "deviceType": "PHONE"}
	for k, v := range wantFields {
		if gotV, ok := got.fields[k]; !ok || gotV != v {
			t.Errorf("field %s = %q (present=%v), want %q", k, gotV, ok, v)
		}
	}
}

func TestSaveDraftRequestShape(t *testing.T) {
	var gotPath, gotQuery string
	var fieldNames []string
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		_, params, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
		mr := multipart.NewReader(r.Body, params["boundary"])
		for {
			part, err := mr.NextPart()
			if err != nil {
				break
			}
			fieldNames = append(fieldNames, part.FormName())
		}
		_, _ = w.Write([]byte(`{"code":0,"message":"ok","data":{}}`))
	})

	_, err := c.SaveDraft(context.Background(), usecase.DraftSave{
		Token: "tok",
		Hash:  "h123",
		File:  []byte("x"),
	})
	if err != nil {
		t.Fatalf("SaveDraft error: %v", err)
	}
	if gotPath != "/api/service-cps/user/draft" {
		t.Errorf("path = %q", gotPath)
	}
	if gotQuery != "hash=h123" {
		t.Errorf("query = %q, want only hash", gotQuery)
	}
	// 草稿表单只有 file + aiNos
	if len(fieldNames) != 2 {
		t.Errorf("fields = %v, want [file aiNos]", fieldNames)
	}
}

func TestUserInfoParsesData(t *testing.T) {
	var gotAuth string
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		if r.URL.Path != "/api/service-member/vip/user/info" {
			t.Errorf("path = %q", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code":    0,
			"message": "ok",
			"data":    map[string]any{"user_main_id": 192728475, "name": "大猫儿"},
		})
	})

	user, err := c.UserInfo(context.Background(), "tok")
	if err != nil {
		t.Fatalf("UserInfo error: %v", err)
	}
	if gotAuth != "Bearer tok" {
		t.Errorf("Authorization = %q", gotAuth)
	}
	if user.UserMainID != 192728475 || user.Name != "大猫儿" {
		t.Errorf("user = %+v", user)
	}
}

func TestBusinessCodeSurfaces(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"code":401,"message":"登录态失效","data":null}`))
	})
	_, err := c.UserInfo(context.Background(), "tok")
	var be *usecase.BusinessError
	if err == nil || !strings.Contains(err.Error(), "登录态失效") {
		t.Fatalf("err = %v", err)
	}
	if e, ok := err.(*usecase.BusinessError); ok {
		be = e
	}
	if be == nil || be.Code != 401 {
		t.Fatalf("err = %v, want BusinessError 401", err)
	}
}

func TestHTTPErrorSurfaces(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("bad gateway"))
	})
	_, err := c.UserInfo(context.Background(), "tok")
	if err == nil || !strings.Contains(err.Error(), "502") {
		t.Fatalf("err = %v, want HTTP 502 mention", err)
	}
}
