package heyteaapi

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/DiheMoe/heyteago-diy/internal/usecase"
)

const (
	// smsPath 官方拼写就是 verifiyCode。
	smsPath      = "/api/service-member/openapi/vip/user/sms/verifiyCode/send"
	loginPath    = "/api/service-login/openapi/vip/user/login_v1"
	loginPmsPath = "/api/service-login-pms/openapi/vip/user/login_v1"
	brandID      = "1000001"
	// loginClientVersion 是登录链路各版本头（喜茶GO 4.6.0，versionCode 164），
	// 与上传链路的 163 各自独立，互不影响。
	loginClientVersion = "164"
)

// SendLoginSms 发送登录短信验证码。Ticket/Randstr 同时非空时随请求发出
// （上游返回 4005021 要求人机验证后的重试），否则不带这两个字段。
func (c *Client) SendLoginSms(ctx context.Context, in usecase.LoginSms) error {
	enc, err := EncryptMobile(in.Mobile)
	if err != nil {
		return err
	}
	body := map[string]any{
		"client":      "app",
		"brandId":     brandID,
		"mobile":      enc,
		"zone":        "86",
		"cryptoLevel": 2,
		"ticketFrom":  "min",
	}
	if in.Ticket != "" && in.Randstr != "" {
		body["ticket"] = in.Ticket
		body["randstr"] = in.Randstr
	}
	_, err = c.postJSON(ctx, smsPath, body, nil)
	return err
}

// LoginByPhone 用短信验证码换 token：依次尝试 login_v1 与 login_v1_pms 两条路径，
// 每条路径单独计算反滥用签名 hmacStr；两条都失败时返回最后一次的错误。
func (c *Client) LoginByPhone(ctx context.Context, in usecase.PhoneLogin) (string, error) {
	encPhone, err := EncryptMobile(in.Phone)
	if err != nil {
		return "", err
	}
	deviceID, err := randomUUID()
	if err != nil {
		return "", err
	}

	var lastErr error
	for _, path := range []string{loginPath, loginPmsPath} {
		ts := strconv.FormatInt(time.Now().UnixMilli(), 10)
		hmacStr, err := c.signer.SignTrade(ctx, "user", path, ts)
		if err != nil {
			return "", &usecase.SignError{Err: err}
		}
		data, err := c.postJSON(ctx, path, map[string]any{
			"channel":      "A",
			"client":       "app",
			"loginType":    "APP_CODE",
			"brand":        brandID,
			"phone":        encPhone,
			"email":        nil,
			"smsCode":      in.Code,
			"zone":         "86",
			"cryptoLevel":  2,
			"ticket":       in.Ticket,
			"ticketFrom":   "min",
			"verifyTicket": "",
			"deviceId":     deviceID,
		}, map[string]string{
			"biz":       "user",
			"url":       path,
			"timeStamp": ts,
			"hmacStr":   hmacStr,
		})
		if err != nil {
			lastErr = err
			continue
		}
		// 必须 code==0（postJSON 已保证）且响应 data 里摸得到 token 才算成功。
		if token := findToken(data); token != "" {
			return token, nil
		}
		lastErr = fmt.Errorf("登录响应中未找到 token: %.200s", data)
	}
	return "", lastErr
}

// postJSON 发送登录链路的 JSON POST 并按 {code,message,data} 信封解析；
// code!=0 返回 BusinessError。extra 是追加的请求头（登录的反滥用 4 头）。
func (c *Client) postJSON(ctx context.Context, path string, body any, extra map[string]string) (json.RawMessage, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	// 网关对短信/登录路由强制密文请求体（明文实测报 invalid_payload）。
	// 一次请求的加密、ticket Cookie 与响应解密共用同一份会话快照：
	// 请求途中会话续期会造成 ticket/密钥错配（实测解密失败）。
	sess, err := c.transport.Session(ctx)
	if err != nil {
		return nil, fmt.Errorf("%w: 获取安全传输会话失败: %w", usecase.ErrUpstreamBadResponse, err)
	}
	raw, err = sess.Encrypt(path, raw)
	if err != nil {
		return nil, fmt.Errorf("%w: 安全传输加密请求体失败: %w", usecase.ErrUpstreamBadResponse, err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	setLoginHeaders(req)
	for k, v := range extra {
		req.Header.Set(k, v)
	}
	// 网关在登录/短信路径强制校验的 ticket Cookie（缺省实测返回 missing_ticket）
	req.Header.Set("Cookie", "HeyteaSecureTransmissionTicket="+sess.Ticket())

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", usecase.ErrUpstreamUnreachable, err)
	}
	defer resp.Body.Close()

	respRaw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, fmt.Errorf("%w: 读取响应失败: %w", usecase.ErrUpstreamUnreachable, err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: HTTP %d: %.200s", usecase.ErrUpstreamBadResponse, resp.StatusCode, respRaw)
	}

	var env struct {
		Code    int             `json:"code"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(respRaw, &env); err != nil {
		return nil, fmt.Errorf("%w: 响应解析失败: %.200s", usecase.ErrUpstreamBadResponse, respRaw)
	}
	if env.Code != 0 {
		return nil, &usecase.BusinessError{Code: env.Code, Message: env.Message}
	}
	// 加密路由的成功响应 data 可能是密文信封，用同一会话快照解密后再取业务字段。
	var sdata struct {
		Blob string `json:"secure_encrypted_s_data"`
	}
	if err := json.Unmarshal(env.Data, &sdata); err == nil && sdata.Blob != "" {
		plain, err := sess.Decrypt(sdata.Blob)
		if err != nil {
			return nil, fmt.Errorf("%w: 安全传输解密响应失败: %w", usecase.ErrUpstreamBadResponse, err)
		}
		return plain, nil
	}
	return env.Data, nil
}

// setLoginHeaders 是登录/短信链路的请求头，与上传链路的精简 4 头（setHeaders）不同：
// 形状参照喜茶GO 4.6.0 登录页抓包。
func setLoginHeaders(req *http.Request) {
	req.Header.Set("User-Agent", "Mozilla/5.0 (Linux; Android 13; 2410DPN6CC Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36")
	req.Header.Set("Accept", "application/prs.heytea.v1+json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept-Language", "zh-CN")
	req.Header.Set("Client", "2")
	req.Header.Set("GMT-Zone", "+08:00")
	req.Header.Set("Region", "1")
	req.Header.Set("X-Region-Id", "10")
	req.Header.Set("X-version", loginClientVersion)
	req.Header.Set("version", loginClientVersion)
	req.Header.Set("client-version", loginClientVersion)
	req.Header.Set("X-client-version", loginClientVersion)
	req.Header.Set("X-client", "app")
	req.Header.Set("current-page", "/pages/login/login_app/index")
	// 网关在登录/短信路径强制校验的静态头（实测缺省返回 missing_tenant_version）；
	// 常量级标识，与 Secure-Transmission 握手无关
	req.Header.Set("Heytea-Secure-Transmission-Tenant", "heyteago-android")
	req.Header.Set("Heytea-Secure-Transmission-Version", "2")
}

// findToken 在响应 data 的任意嵌套层找 "token" 字符串（只下钻对象，与官方响应结构一致）。
func findToken(data json.RawMessage) string {
	var v any
	if err := json.Unmarshal(data, &v); err != nil {
		return ""
	}
	return grabToken(v)
}

func grabToken(v any) string {
	m, ok := v.(map[string]any)
	if !ok {
		return ""
	}
	if t, ok := m["token"].(string); ok && t != "" {
		return t
	}
	for _, sub := range m {
		if t := grabToken(sub); t != "" {
			return t
		}
	}
	return ""
}

// randomUUID 生成 RFC 4122 v4 UUID（login body 的 deviceId 字段）。
func randomUUID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}
