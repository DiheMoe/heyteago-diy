// Package heyteaapi 是喜茶 App 通道（app-go.heytea.com）的 HTTP 客户端。
// 请求形状与官方 App 抓包一致：精简 4 头、multipart 表单、URL 携带 sign/t/hash。
package heyteaapi

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strconv"
	"time"

	"heyteago-diy/internal/domain"
	"heyteago-diy/internal/usecase"
)

const (
	defaultBaseURL = "https://app-go.heytea.com"
	// clientVersion 对应官方 APK 的 versionCode。
	clientVersion = "163"
	// signSalt 是 App 端 timestampSign 的固定盐：sign = md5(salt + userMainId + 毫秒时间戳)。
	signSalt = "r5YWPjgSGAT2dbOJzwiDBK"
)

type Client struct {
	http    *http.Client
	baseURL string // 可被测试覆盖
}

func New() *Client {
	return &Client{
		http:    &http.Client{Timeout: 30 * time.Second},
		baseURL: defaultBaseURL,
	}
}

func (c *Client) UploadSticker(ctx context.Context, req usecase.StickerUpload) (domain.Result, error) {
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	if err := writeFilePart(w, req.FileName, req.ContentType, req.File); err != nil {
		return domain.Result{}, err
	}
	// width/height 是画布尺寸；aiNos 为 AI 生图编号（手传图为空串）；
	// deviceType 官方取值为 PHONE/PAD。
	fields := map[string]string{
		"width":      strconv.Itoa(req.Width),
		"height":     strconv.Itoa(req.Height),
		"aiNos":      "",
		"deviceType": "PHONE",
	}
	for k, v := range fields {
		if err := w.WriteField(k, v); err != nil {
			return domain.Result{}, err
		}
	}
	if err := w.Close(); err != nil {
		return domain.Result{}, err
	}

	ts := time.Now().UnixMilli()
	sign := timestampSign(req.UserMainID, ts)
	url := fmt.Sprintf("%s/api/service-cps/user/diy?sign=%s&t=%d&hash=%s",
		c.baseURL, sign, ts, req.Hash)

	return c.post(ctx, url, &body, w.FormDataContentType(), req.Token)
}

func (c *Client) SaveDraft(ctx context.Context, req usecase.DraftSave) (domain.Result, error) {
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	if err := writeFilePart(w, req.FileName, req.ContentType, req.File); err != nil {
		return domain.Result{}, err
	}
	if err := w.WriteField("aiNos", ""); err != nil {
		return domain.Result{}, err
	}
	if err := w.Close(); err != nil {
		return domain.Result{}, err
	}

	url := fmt.Sprintf("%s/api/service-cps/user/draft?hash=%s", c.baseURL, req.Hash)
	return c.post(ctx, url, &body, w.FormDataContentType(), req.Token)
}

func (c *Client) UserInfo(ctx context.Context, token string) (domain.User, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		c.baseURL+"/api/service-member/vip/user/info", nil)
	if err != nil {
		return domain.User{}, err
	}
	setHeaders(req, "", token)

	resp, err := c.http.Do(req)
	if err != nil {
		return domain.User{}, fmt.Errorf("请求喜茶失败: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return domain.User{}, fmt.Errorf("读取喜茶响应失败: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return domain.User{}, fmt.Errorf("喜茶返回 HTTP %d: %.200s", resp.StatusCode, raw)
	}

	var env struct {
		Code    int             `json:"code"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return domain.User{}, fmt.Errorf("喜茶响应解析失败: %.200s", raw)
	}
	if env.Code != 0 {
		return domain.User{}, &usecase.BusinessError{Code: env.Code, Message: env.Message}
	}
	var user domain.User
	if err := json.Unmarshal(env.Data, &user); err != nil {
		return domain.User{}, fmt.Errorf("用户信息解析失败: %w", err)
	}
	return user, nil
}

func (c *Client) post(ctx context.Context, url string, body *bytes.Buffer, contentType, token string) (domain.Result, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, body)
	if err != nil {
		return domain.Result{}, err
	}
	setHeaders(req, contentType, token)

	resp, err := c.http.Do(req)
	if err != nil {
		return domain.Result{}, fmt.Errorf("请求喜茶失败: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return domain.Result{}, fmt.Errorf("读取喜茶响应失败: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return domain.Result{}, fmt.Errorf("喜茶返回 HTTP %d: %.200s", resp.StatusCode, raw)
	}

	var res domain.Result
	if err := json.Unmarshal(raw, &res); err != nil {
		return domain.Result{}, fmt.Errorf("喜茶响应解析失败: %.200s", raw)
	}
	return res, nil
}

// setHeaders 与官方 App 保持一致：除 multipart 的 Content-Type 外只有 3 个头。
func setHeaders(req *http.Request, contentType, token string) {
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	// 置空值使 net/http 不写默认的 Go-http-client UA（key 存在但值为空时跳过写出）。
	req.Header.Set("User-Agent", "")
	req.Header.Set("X-client-version", clientVersion)
	req.Header.Set("X-client", "app")
	req.Header.Set("Authorization", "Bearer "+token)
}

// writeFilePart 显式构造 file 表单项，保证 filename 与 Content-Type 与官方请求一致。
func writeFilePart(w *multipart.Writer, filename, contentType string, data []byte) error {
	if filename == "" {
		filename = "cup.png"
	}
	if contentType == "" {
		contentType = "image/png"
	}
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, filename))
	header.Set("Content-Type", contentType)
	part, err := w.CreatePart(header)
	if err != nil {
		return err
	}
	_, err = part.Write(data)
	return err
}

func timestampSign(userMainID string, ts int64) string {
	sum := md5.Sum([]byte(signSalt + userMainID + strconv.FormatInt(ts, 10)))
	return hex.EncodeToString(sum[:])
}
