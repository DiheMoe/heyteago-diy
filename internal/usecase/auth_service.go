package usecase

import (
	"context"
	"errors"
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

func (s *AuthService) SendLoginSms(ctx context.Context, in LoginSms) error {
	if !phonePattern.MatchString(in.Mobile) {
		return ErrInvalidPhone
	}
	return s.gateway.SendLoginSms(ctx, in)
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
		return AuthOutput{}, translateLoginError(err)
	}
	user, err := s.gateway.UserInfo(ctx, token)
	if err != nil {
		return AuthOutput{}, err
	}
	return AuthOutput{Token: token, User: user}, nil
}

// misleadingLoginCodes 的上游文案对用户有误导：500010005 字面是"请升级APP至最新版本"，
// 实测出现在反滥用校验（人机 ticket / 签名）未通过时，与 App 版本无关。
// 登录语境下替换为可操作的提示，业务码原样保留（httpapi 会把 code 一并发给前端）。
var misleadingLoginCodes = map[int]string{
	500010005: "人机验证未通过或已失效，请重试",
}

func translateLoginError(err error) error {
	var be *BusinessError
	if !errors.As(err, &be) {
		return err
	}
	if hint, ok := misleadingLoginCodes[be.Code]; ok {
		return &BusinessError{Code: be.Code, Message: hint}
	}
	return err
}
