// Package appsecure 实现喜茶 Secure-Transmission 安全传输（登录链路请求体加密）。
// 协议为标准 ECDH-P256 + HMAC-SHA256 派生 + AES-128-GCM，常量取自 App 内嵌实现：
//
//	握手 prepare：临时 P-256 密钥对 + 32 字节 client_random；
//	  signature = HMAC-SHA256(key=SHA256(serverX‖serverY), msg=clientPub65‖client_random)
//	POST /handshake 得 server_random / ticket / route_rules；
//	finish：session_key = HMAC-SHA256(key=ECDH(ephPriv,serverPub).X, msg=client_random‖server_random)
//	encode：命中 encryptType==0 路由则明文直通，否则
//	  AES-128-GCM(key=session_key[:16], iv=12 随机字节, aad="<tenant>_<version>")；
//	  密文体 = base64(iv‖ciphertext‖tag) 包进 {"secure_encrypted_c_data":...}
//
// 会话在进程内复用，ticket 到期前自动重新握手；互斥锁只保护握手/续期，
// 业务请求通过 Session 取会话快照（ticket/密钥/路由规则一致）后无锁使用。
package appsecure

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/DiheMoe/heyteago-diy/internal/usecase"
)

// 喜茶网关的 P-256 服务端公钥（App 内嵌，用于握手 ECDH 与签名）。
var serverPubUncompressed = append([]byte{0x04},
	append(
		hexMust("162ceeb164bbb1a47cfeec71883bb1442218250861befa47008544d33521167d"),
		hexMust("efb931f916ca701f6905e61da42c4d446e511f78ea0db8c02a114530acf5bde3")...,
	)...)

type Config struct {
	Host    string // 业务域，默认 https://app-go.heytea.com
	Tenant  string // Secure-Transmission 租户，默认 heyteago-android
	Version int    // 协议版本，默认 2
	Client  string // X-client，默认 app
	Timeout time.Duration
	// ServerPubKey 覆盖内嵌服务端公钥（65 字节未压缩 0x04‖X‖Y）；
	// 为空则用内嵌值。App 轮换密钥或测试自建服务端时使用。
	ServerPubKey []byte
}

func DefaultConfig() Config {
	return Config{
		Host:    "https://app-go.heytea.com",
		Tenant:  "heyteago-android",
		Version: 2,
		Client:  "app",
		Timeout: 15 * time.Second,
	}
}

// Source 实现 usecase.SecureTransport。
type Source struct {
	cfg            Config
	curve          ecdh.Curve
	serverPub      *ecdh.PublicKey
	serverPubBytes []byte // 65 字节未压缩
	aad            []byte
	domain         string
	httpClient     *http.Client

	mu         sync.Mutex
	sessionKey []byte // 32 字节；[:16] 为 AES-128-GCM 密钥
	ticket     string
	expiresAt  int64           // 秒级 Unix 时间
	plaintext  map[string]bool // encryptType==0 的 url（当前 domain），命中则明文直通
}

func New(cfg Config) *Source {
	pubBytes := cfg.ServerPubKey
	if len(pubBytes) == 0 {
		pubBytes = serverPubUncompressed
	}
	pub, err := ecdh.P256().NewPublicKey(pubBytes)
	if err != nil {
		panic(fmt.Sprintf("appsecure: 服务端公钥非法: %v", err))
	}
	return &Source{
		cfg:            cfg,
		curve:          ecdh.P256(),
		serverPub:      pub,
		serverPubBytes: pubBytes,
		aad:            []byte(cfg.Tenant + "_" + strconv.Itoa(cfg.Version)),
		domain:         hostOnly(cfg.Host),
		httpClient:     &http.Client{Timeout: cfg.Timeout},
	}
}

// Session 取当前会话快照（实现 usecase.SecureSession）：快照内的 ticket、
// 加解密钥与路由规则来自同一次握手，请求途中续期不影响已取出的快照。
func (s *Source) Session(ctx context.Context) (usecase.SecureSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureSessionLocked(ctx); err != nil {
		return nil, err
	}
	return &session{
		key:       s.sessionKey,
		ticket:    s.ticket,
		plaintext: s.plaintext,
		aad:       s.aad,
	}, nil
}

// Close 无长驻资源，空实现（满足调用方 defer Close 习惯）。
func (s *Source) Close() {}

// session 是一次请求的会话快照：字段在握手时定型，只读、无锁、可并发使用。
type session struct {
	key       []byte // 32 字节；[:16] 为 AES-128-GCM 密钥
	ticket    string
	plaintext map[string]bool // encryptType==0 的 url，命中则明文直通
	aad       []byte
}

func (s *session) Ticket() string { return s.ticket }

// Encrypt 按路由规则加密请求体：命中 encryptType==0 的 url 原样返回明文，
// 否则 AES-128-GCM 加密并包成密文信封。
func (s *session) Encrypt(path string, body json.RawMessage) (json.RawMessage, error) {
	if s.plaintext[path] {
		return body, nil
	}
	blob, err := s.seal(body)
	if err != nil {
		return nil, err
	}
	return json.Marshal(map[string]string{"secure_encrypted_c_data": blob})
}

// Decrypt 解密响应里的 secure_encrypted_s_data 密文。
func (s *session) Decrypt(blob string) (json.RawMessage, error) {
	raw, err := base64.StdEncoding.DecodeString(pad(blob))
	if err != nil {
		return nil, fmt.Errorf("密文 base64 解析失败: %w", err)
	}
	plain, err := s.open(raw)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(plain), nil
}

// --- 会话管理 ---

func (s *Source) ensureSessionLocked(ctx context.Context) error {
	if s.sessionKey != nil && time.Now().Unix() < s.expiresAt-60 {
		return nil
	}
	return s.handshakeLocked(ctx)
}

func (s *Source) handshakeLocked(ctx context.Context) error {
	// 1) 拉取租户配置（当前仅用于与官方流程一致，加密判定走 route_rules）。
	if _, err := s.getJSON(ctx, "/api/_secure-transmission/tenant-config"); err != nil {
		return fmt.Errorf("拉取 tenant-config 失败: %w", err)
	}

	// 2) prepare：生成临时密钥对与签名。
	ephPriv, err := s.curve.GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	clientPub := ephPriv.PublicKey().Bytes() // 65 字节 0x04‖X‖Y
	clientRandom := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, clientRandom); err != nil {
		return err
	}
	signature := s.signPrepare(clientPub, clientRandom)

	post, _ := json.Marshal(map[string]string{
		"client_public_key": base64.StdEncoding.EncodeToString(clientPub),
		"client_random":     base64.StdEncoding.EncodeToString(clientRandom),
		"signature":         base64.StdEncoding.EncodeToString(signature),
	})
	respRaw, err := s.postJSON(ctx, "/api/_secure-transmission/handshake", post)
	if err != nil {
		return fmt.Errorf("握手请求失败: %w", err)
	}
	var resp struct {
		ServerRandom string `json:"server_random"`
		Ticket       string `json:"ticket"`
		ExpiresAt    int64  `json:"expires_at"`
		RouteRules   []struct {
			Domain      string `json:"domain"`
			URL         string `json:"url"`
			EncryptType int    `json:"encryptType"`
		} `json:"route_rules"`
	}
	if err := json.Unmarshal(respRaw, &resp); err != nil {
		return fmt.Errorf("握手响应解析失败: %.200s", respRaw)
	}
	serverRandom, err := decodeB64URL(resp.ServerRandom)
	if err != nil {
		return fmt.Errorf("server_random 解析失败: %w", err)
	}

	// 3) finish：ECDH + HMAC 派生会话密钥。
	shared, err := ephPriv.ECDH(s.serverPub) // P-256 返回共享点 X 坐标（32 字节）
	if err != nil {
		return fmt.Errorf("ECDH 失败: %w", err)
	}
	s.sessionKey = deriveSessionKey(shared, clientRandom, serverRandom)
	s.ticket = resp.Ticket
	s.expiresAt = resp.ExpiresAt
	s.plaintext = map[string]bool{}
	for _, r := range resp.RouteRules {
		if r.EncryptType == 0 && r.Domain == s.domain {
			s.plaintext[r.URL] = true
		}
	}
	return nil
}

// signPrepare 计算握手签名：HMAC-SHA256(key=SHA256(serverX‖serverY), msg=clientPub65‖clientRandom)。
func (s *Source) signPrepare(clientPub, clientRandom []byte) []byte {
	sigKey := sha256.Sum256(s.serverPubBytes[1:])
	mac := hmac.New(sha256.New, sigKey[:])
	mac.Write(clientPub)
	mac.Write(clientRandom)
	return mac.Sum(nil)
}

// deriveSessionKey 计算会话密钥：HMAC-SHA256(key=ECDH 共享点 X, msg=clientRandom‖serverRandom)。
func deriveSessionKey(sharedX, clientRandom, serverRandom []byte) []byte {
	mac := hmac.New(sha256.New, sharedX)
	mac.Write(clientRandom)
	mac.Write(serverRandom)
	return mac.Sum(nil)
}

// --- AES-128-GCM 封装/解封（会话快照上的纯计算） ---

func (s *session) seal(plain []byte) (string, error) {
	gcm, err := s.gcm()
	if err != nil {
		return "", err
	}
	iv := make([]byte, gcm.NonceSize()) // 12 字节
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		return "", err
	}
	ct := gcm.Seal(nil, iv, plain, s.aad) // 返回 ciphertext‖tag
	return base64.StdEncoding.EncodeToString(append(iv, ct...)), nil
}

func (s *session) open(blob []byte) ([]byte, error) {
	gcm, err := s.gcm()
	if err != nil {
		return nil, err
	}
	ns := gcm.NonceSize()
	if len(blob) < ns+16 {
		return nil, fmt.Errorf("密文过短: %d 字节", len(blob))
	}
	return gcm.Open(nil, blob[:ns], blob[ns:], s.aad)
}

func (s *session) gcm() (cipher.AEAD, error) {
	block, err := aes.NewCipher(s.key[:16]) // AES-128
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// --- HTTP 辅助 ---

func (s *Source) secureHeaders(req *http.Request) {
	req.Header.Set("Heytea-Secure-Transmission-Tenant", s.cfg.Tenant)
	req.Header.Set("Heytea-Secure-Transmission-Version", strconv.Itoa(s.cfg.Version))
	req.Header.Set("X-client", s.cfg.Client)
}

func (s *Source) getJSON(ctx context.Context, path string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.cfg.Host+path, nil)
	if err != nil {
		return nil, err
	}
	s.secureHeaders(req)
	return s.do(req)
}

func (s *Source) postJSON(ctx context.Context, path string, body []byte) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.Host+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	s.secureHeaders(req)
	req.Header.Set("Content-Type", "application/json")
	return s.do(req)
}

func (s *Source) do(req *http.Request) ([]byte, error) {
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d: %.200s", resp.StatusCode, raw)
	}
	return raw, nil
}

// --- 小工具 ---

func hostOnly(host string) string {
	h := host
	if i := strings.Index(h, "://"); i >= 0 {
		h = h[i+3:]
	}
	return strings.SplitN(h, "/", 2)[0]
}

func decodeB64URL(s string) ([]byte, error) {
	s = strings.ReplaceAll(strings.ReplaceAll(s, "-", "+"), "_", "/")
	return base64.StdEncoding.DecodeString(pad(s))
}

func pad(s string) string {
	if m := len(s) % 4; m != 0 {
		return s + strings.Repeat("=", 4-m)
	}
	return s
}

func hexMust(h string) []byte {
	b := make([]byte, len(h)/2)
	for i := 0; i < len(b); i++ {
		var v int
		for j := 0; j < 2; j++ {
			c := h[i*2+j]
			switch {
			case c >= '0' && c <= '9':
				v = v<<4 | int(c-'0')
			case c >= 'a' && c <= 'f':
				v = v<<4 | int(c-'a'+10)
			default:
				panic("bad hex")
			}
		}
		b[i] = byte(v)
	}
	return b
}
