package usecase

import (
	"context"
	"regexp"
)

// 大陆手机号：1 开头共 11 位数字。
var phonePattern = regexp.MustCompile(`^1\d{10}$`)

// AuthService 承载手机号 + 短信验证码登录。
type AuthService struct {
	gateway StickerGateway
}

func NewAuthService(gateway StickerGateway) *AuthService {
	return &AuthService{gateway: gateway}
}

func (s *AuthService) SendLoginSms(ctx context.Context, phone string) error {
	if !phonePattern.MatchString(phone) {
		return ErrInvalidPhone
	}
	return s.gateway.SendLoginSms(ctx, phone)
}

// Login 用短信验证码换 token，并查回用户信息（上传链路需要 user_main_id，
// 查不到则整体报错）。
func (s *AuthService) Login(ctx context.Context, phone, code, ticket string) (AuthOutput, error) {
	if !phonePattern.MatchString(phone) {
		return AuthOutput{}, ErrInvalidPhone
	}
	if code == "" {
		return AuthOutput{}, ErrMissingSmsCode
	}
	if ticket == "" {
		return AuthOutput{}, ErrMissingTicket
	}

	token, err := s.gateway.LoginByPhone(ctx, PhoneLogin{Phone: phone, Code: code, Ticket: ticket})
	if err != nil {
		return AuthOutput{}, err
	}
	user, err := s.gateway.UserInfo(ctx, token)
	if err != nil {
		return AuthOutput{}, err
	}
	return AuthOutput{Token: token, User: user}, nil
}
