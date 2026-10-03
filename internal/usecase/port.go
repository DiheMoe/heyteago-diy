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
}

// StickerGateway 是喜茶 App 通道的出网端口。
type StickerGateway interface {
	UploadSticker(ctx context.Context, req StickerUpload) (domain.Result, error)
	SaveDraft(ctx context.Context, req DraftSave) (domain.Result, error)
	UserInfo(ctx context.Context, token string) (domain.User, error)
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

// UploadOutput 是上传/草稿成功后的返回，透传上游 data。
type UploadOutput struct {
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}
