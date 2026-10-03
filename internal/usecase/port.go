// Package usecase 编排业务流程，并定义外层（adapter）必须实现的端口接口。
package usecase

import (
	"context"
	"encoding/json"

	"github.com/DiheMoe/heyteago-diy/internal/domain"
)

// Signer 为图片内容计算喜茶上传签名（hash 参数）。
// sha256Hex 是文件字节的 sha256 十六进制串，与官方 App 调 JNI 时的入参一致。
type Signer interface {
	SignImageDIY(ctx context.Context, sha256Hex string) (string, error)
	// SignTrade 计算反滥用签名 hmacStr：calTradeAndMemberSign(biz, path, timestamp)，
	// 登录链路每个请求单独计算（timestamp 参与签名）。
	SignTrade(ctx context.Context, biz, path, timestamp string) (string, error)
}

// SecureTransport 提供登录链路的 Secure-Transmission 能力。
// 网关在短信/登录路由强制校验 ticket Cookie（缺省报 missing_ticket）与
// 密文请求体（明文报 invalid_payload）；实现侧进程内复用会话，调用方不做缓存。
type SecureTransport interface {
	// Ticket 现取一个 ticket，用作 Cookie HeyteaSecureTransmissionTicket。
	Ticket(ctx context.Context) (string, error)
	// Encrypt 按握手时下发的路由规则加密请求体，返回可直接 POST 的 JSON
	// （密文信封 {"secure_encrypted_c_data":...} 或明文原样，由路由规则决定）。
	Encrypt(ctx context.Context, path string, body json.RawMessage) (json.RawMessage, error)
	// Decrypt 解密响应 data 里的 secure_encrypted_s_data 密文。
	Decrypt(ctx context.Context, blob string) (json.RawMessage, error)
}

// StickerGateway 是喜茶 App 通道的出网端口。
type StickerGateway interface {
	UploadSticker(ctx context.Context, req StickerUpload) (domain.Result, error)
	SaveDraft(ctx context.Context, req DraftSave) (domain.Result, error)
	UserInfo(ctx context.Context, token string) (domain.User, error)
	SendLoginSms(ctx context.Context, mobile string) error
	LoginByPhone(ctx context.Context, req PhoneLogin) (string, error)
}

// StickerUpload 是一次正式上传所需的全部入参；Hash 由用例签名后填入。
type StickerUpload struct {
	Token       string
	UserMainID  string
	Hash        string
	FileName    string
	ContentType string
	File        []byte
	Width       int
	Height      int
}

// DraftSave 是保存草稿的入参（草稿链路不需要 userMainId 与 sign/t 参数）。
type DraftSave struct {
	Token       string
	Hash        string
	FileName    string
	ContentType string
	File        []byte
}

// PhoneLogin 是手机号 + 短信验证码登录的入参。
// 手机号传明文，AES 加密在 adapter 内完成；Ticket 是腾讯滑块验证的 ticket。
type PhoneLogin struct {
	Phone  string
	Code   string
	Ticket string
}

// UploadOutput 是上传/草稿成功后的返回，透传上游 data。
type UploadOutput struct {
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

// AuthOutput 是登录成功的返回：token 即 Authorization: Bearer 的值。
type AuthOutput struct {
	Token string      `json:"token"`
	User  domain.User `json:"user"`
}
