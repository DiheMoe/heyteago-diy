package usecase

import (
	"context"

	"heyteago-diy/internal/domain"
)

// UserService 查询当前 token 对应的喜茶会员信息。
type UserService struct {
	gateway StickerGateway
}

func NewUserService(gateway StickerGateway) *UserService {
	return &UserService{gateway: gateway}
}

func (s *UserService) UserInfo(ctx context.Context, token string) (domain.User, error) {
	if token == "" {
		return domain.User{}, ErrMissingToken
	}
	return s.gateway.UserInfo(ctx, token)
}
