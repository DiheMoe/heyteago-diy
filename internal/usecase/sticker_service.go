package usecase

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"heyteago-diy/internal/domain"
)

// StickerService 承载杯贴上传与草稿保存。
type StickerService struct {
	signer  Signer
	gateway StickerGateway
}

func NewStickerService(signer Signer, gateway StickerGateway) *StickerService {
	return &StickerService{signer: signer, gateway: gateway}
}

// Upload 正式上传杯贴：校验 → sha256 → 本地签名 → 网关直传。
// 上游返回 401/1002/401011 时按官方客户端逻辑重签重发一次。
func (s *StickerService) Upload(ctx context.Context, in StickerUpload) (UploadOutput, error) {
	if in.Token == "" {
		return UploadOutput{}, ErrMissingToken
	}
	if in.UserMainID == "" {
		return UploadOutput{}, ErrMissingUserMainID
	}
	if err := validateFile(in.File); err != nil {
		return UploadOutput{}, err
	}
	if in.Width <= 0 {
		in.Width = domain.CupWidth
	}
	if in.Height <= 0 {
		in.Height = domain.CupHeight
	}

	res, err := s.signAndCall(ctx, in.File, func(hash string) (domain.Result, error) {
		in.Hash = hash
		return s.gateway.UploadSticker(ctx, in)
	})
	if err != nil {
		return UploadOutput{}, err
	}
	return UploadOutput{Message: "上传成功", Data: res.Data}, nil
}

// SaveDraft 保存杯贴草稿（官方 App 进画布时会拉取该草稿继续编辑）。
func (s *StickerService) SaveDraft(ctx context.Context, in DraftSave) (UploadOutput, error) {
	if in.Token == "" {
		return UploadOutput{}, ErrMissingToken
	}
	if err := validateFile(in.File); err != nil {
		return UploadOutput{}, err
	}

	res, err := s.signAndCall(ctx, in.File, func(hash string) (domain.Result, error) {
		in.Hash = hash
		return s.gateway.SaveDraft(ctx, in)
	})
	if err != nil {
		return UploadOutput{}, err
	}
	return UploadOutput{Message: "草稿保存成功", Data: res.Data}, nil
}

// signAndCall 签名并调用网关；命中需重签的业务码时重签一次再调。
func (s *StickerService) signAndCall(
	ctx context.Context,
	file []byte,
	call func(hash string) (domain.Result, error),
) (domain.Result, error) {
	sum := sha256.Sum256(file)
	sha256Hex := hex.EncodeToString(sum[:])

	for attempt := 0; attempt < 2; attempt++ {
		hash, err := s.signer.SignImageDIY(ctx, sha256Hex)
		if err != nil {
			return domain.Result{}, &SignError{Err: err}
		}
		res, err := call(hash)
		if err != nil {
			return domain.Result{}, err
		}
		if res.Code == 0 {
			return res, nil
		}
		if attempt == 0 && needsResign(res.Code) {
			continue
		}
		return domain.Result{}, &BusinessError{Code: res.Code, Message: res.Message}
	}
	panic("unreachable")
}

// needsResign 对应官方客户端的重签策略：签名被视为过期/无效时重签重发。
func needsResign(code int) bool {
	switch code {
	case 401, 1002, 401011:
		return true
	}
	return false
}

func validateFile(file []byte) error {
	if len(file) == 0 {
		return ErrMissingFile
	}
	if len(file) > domain.MaxUploadBytes {
		return fmt.Errorf("%w（%d 字节）", ErrFileTooLarge, domain.MaxUploadBytes)
	}
	return nil
}
