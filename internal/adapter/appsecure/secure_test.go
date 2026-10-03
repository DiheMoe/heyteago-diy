package appsecure

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func mustHex(t *testing.T, h string) []byte {
	t.Helper()
	b, err := hex.DecodeString(h)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// 已知答案：由 App 官方实现产生的密文信封（IV‖密文‖tag）。证明 Go 的
// AES-128-GCM 密钥(session_key[:16])/IV(前 12 字节)/AAD("heyteago-android_2")/
// 分块与 .so 完全一致。
func TestDecryptRealSoBlob(t *testing.T) {
	sk := mustHex(t, "27e048e47cc1df68a042c283ae3ce66643a6e508179fe94e1bcd6d88f8ec4ff5")
	raw := mustHex(t, "1303ac156f4b22430c6bbe3313e60321b989786275acd9b488c1c0f53d70e109239b88114cf444fec690c03bc25af5ce3b1afbd674")

	s := New(DefaultConfig())
	s.sessionKey = sk
	plain, err := s.openLocked(raw)
	if err != nil {
		t.Fatalf("openLocked: %v", err)
	}
	if got := string(plain); got != `{"hello":"world","n":123}` {
		t.Fatalf("decrypt = %q", got)
	}
}

func TestSealOpenRoundTrip(t *testing.T) {
	s := New(DefaultConfig())
	s.sessionKey = mustHex(t, "27e048e47cc1df68a042c283ae3ce66643a6e508179fe94e1bcd6d88f8ec4ff5")
	msg := []byte(`{"phone":"enc","code":"123456"}`)
	b64, err := s.sealLocked(msg)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.openLocked(raw)
	if err != nil {
		t.Fatalf("openLocked: %v", err)
	}
	if !bytes.Equal(got, msg) {
		t.Fatalf("round trip = %q", got)
	}
}

// 握手签名的确定性向量（公式已与 .so 逐字节核对，key=内嵌公钥坐标）。
func TestSignPrepareVector(t *testing.T) {
	s := New(DefaultConfig())
	clientPub := mustHex(t, "040104070a0d101316191c1f2225282b2e3134373a3d404346494c4f5255585b5e6164676a6d707376797c7f8285888b8e9194979a9da0a3a6a9acafb2b5b8bbbe")
	crand := mustHex(t, "02070c11161b20252a2f34393e43484d52575c61666b70757a7f84898e93989d")
	want := "8875684ac578e91fd8acc822b38bf099416f7de204782931e5caa4f376057e65"
	if got := hex.EncodeToString(s.signPrepare(clientPub, crand)); got != want {
		t.Fatalf("signPrepare = %s, want %s", got, want)
	}
}

func TestDeriveSessionKeyVector(t *testing.T) {
	shared := mustHex(t, "030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dc")
	crand := mustHex(t, "02070c11161b20252a2f34393e43484d52575c61666b70757a7f84898e93989d")
	srand := mustHex(t, "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")
	want := "154ae899de852f63936da4d9951410474c156f2e75a6ec1dc504f44ce4a5aec9"
	if got := hex.EncodeToString(deriveSessionKey(shared, crand, srand)); got != want {
		t.Fatalf("deriveSessionKey = %s, want %s", got, want)
	}
}

// 端到端（本地假服务端）：Go 完整跑 tenant-config→prepare→handshake→finish。
// 假服务端持有与客户端 cfg.ServerPubKey 配对的静态私钥，用 ECDH 独立推出同一会话密钥，
// 从而验证签名/密钥派生/加密三者在真实网络形态下自洽；encryptType==0 路由明文直通。
func TestHandshakeAndEncryptAgainstFakeServer(t *testing.T) {
	srv := newFakeGateway(t)
	defer srv.Close()

	cfg := DefaultConfig()
	cfg.Host = srv.URL
	cfg.ServerPubKey = srv.pub.Bytes()
	s := New(cfg)

	enc, err := s.Encrypt(context.Background(), "/api/x/sms", json.RawMessage(`{"a":1}`))
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	var env map[string]string
	if err := json.Unmarshal(enc, &env); err != nil || env["secure_encrypted_c_data"] == "" {
		t.Fatalf("加密路由应产出密文信封, got %s", enc)
	}
	if got := srv.decrypt(t, env["secure_encrypted_c_data"]); got != `{"a":1}` {
		t.Fatalf("服务端解密 = %q", got)
	}

	plain, err := s.Encrypt(context.Background(), "/api/plain", json.RawMessage(`{"b":2}`))
	if err != nil {
		t.Fatalf("Encrypt plain: %v", err)
	}
	if string(plain) != `{"b":2}` {
		t.Fatalf("明文路由应原样返回, got %s", plain)
	}

	tk, err := s.Ticket(context.Background())
	if err != nil || tk != "tkt-123" {
		t.Fatalf("Ticket = %q, err=%v", tk, err)
	}
	if srv.handshakes != 1 {
		t.Fatalf("应复用会话，仅握手 1 次，实际 %d", srv.handshakes)
	}
}

// fakeGateway 模拟喜茶网关的 Secure-Transmission 服务端。
type fakeGateway struct {
	*httptest.Server
	priv       *ecdh.PrivateKey
	pub        *ecdh.PublicKey
	sessionKey []byte
	handshakes int
}

func newFakeGateway(t *testing.T) *fakeGateway {
	t.Helper()
	priv, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	g := &fakeGateway{priv: priv, pub: priv.PublicKey()}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/_secure-transmission/tenant-config", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"encryptFallback": false, "configVersion": 1})
	})
	mux.HandleFunc("/api/_secure-transmission/handshake", func(w http.ResponseWriter, r *http.Request) {
		g.handshakes++
		var req struct {
			ClientPublicKey string `json:"client_public_key"`
			ClientRandom    string `json:"client_random"`
			Signature       string `json:"signature"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		clientPub, _ := base64.StdEncoding.DecodeString(req.ClientPublicKey)
		clientRandom, _ := base64.StdEncoding.DecodeString(req.ClientRandom)
		cpub, err := ecdh.P256().NewPublicKey(clientPub)
		if err != nil {
			http.Error(w, "bad client pub", 400)
			return
		}
		shared, _ := g.priv.ECDH(cpub) // 服务端侧 ECDH，得同一 X 坐标
		serverRandom := make([]byte, 32)
		_, _ = io.ReadFull(rand.Reader, serverRandom)
		g.sessionKey = deriveSessionKey(shared, clientRandom, serverRandom)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"server_random": base64.RawURLEncoding.EncodeToString(serverRandom),
			"ticket":        "tkt-123",
			"expires_at":    1 << 40,
			"route_rules": []map[string]any{
				{"domain": hostOnly(g.URL), "url": "/api/plain", "encryptType": 0},
			},
		})
	})
	g.Server = httptest.NewServer(mux)
	return g
}

func (g *fakeGateway) decrypt(t *testing.T, b64 string) string {
	t.Helper()
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		t.Fatal(err)
	}
	block, _ := aes.NewCipher(g.sessionKey[:16])
	gcm, _ := cipher.NewGCM(block)
	aad := []byte("heyteago-android_2")
	pt, err := gcm.Open(nil, raw[:12], raw[12:], aad)
	if err != nil {
		t.Fatalf("server decrypt: %v", err)
	}
	return string(pt)
}
