package usecase

import (
	"context"
	"errors"
	"testing"

	"github.com/DiheMoe/heyteago-diy/internal/domain"
)

func TestLoginSuccess(t *testing.T) {
	gw := &fakeGateway{loginToken: "tok", user: domain.User{UserMainID: 7, Name: "测试"}}
	svc := NewAuthService(gw)

	out, err := svc.Login(context.Background(), "13800138000", "123456", "captcha-ticket")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.Token != "tok" || out.User.UserMainID != 7 {
		t.Fatalf("out = %+v", out)
	}
}

// 误导性上游码 500010005（字面"请升级APP"）在登录语境下翻译为可操作的提示，code 保留。
func TestLoginTranslatesMisleadingCode(t *testing.T) {
	gw := &fakeGateway{loginErr: &BusinessError{Code: 500010005, Message: "请升级APP至最新版本进行操作"}}
	svc := NewAuthService(gw)

	_, err := svc.Login(context.Background(), "13800138000", "123456", "captcha-ticket")
	var be *BusinessError
	if !errors.As(err, &be) {
		t.Fatalf("err = %v, want BusinessError", err)
	}
	if be.Code != 500010005 {
		t.Fatalf("code = %d, want 原样保留 500010005", be.Code)
	}
	if be.Message != "人机验证未通过或已失效，请重试" {
		t.Fatalf("message = %q, want 翻译后的提示", be.Message)
	}
}

// 未在翻译表里的业务码原样透传（如 400017 验证码已过期，文案本就准确）。
func TestLoginKeepsOtherBusinessErrors(t *testing.T) {
	gw := &fakeGateway{loginErr: &BusinessError{Code: 400017, Message: "【手机号绑定】验证码已过期！"}}
	svc := NewAuthService(gw)

	_, err := svc.Login(context.Background(), "13800138000", "123456", "captcha-ticket")
	var be *BusinessError
	if !errors.As(err, &be) || be.Code != 400017 || be.Message != "【手机号绑定】验证码已过期！" {
		t.Fatalf("err = %v, want 原样透传的 400017", err)
	}
}

// 非 BusinessError（如 SignError、网络错误）不参与翻译。
func TestLoginKeepsNonBusinessError(t *testing.T) {
	gw := &fakeGateway{loginErr: &SignError{Err: errors.New("oracle down")}}
	svc := NewAuthService(gw)

	_, err := svc.Login(context.Background(), "13800138000", "123456", "captcha-ticket")
	var se *SignError
	if !errors.As(err, &se) {
		t.Fatalf("err = %v, want SignError 原样透传", err)
	}
}

func TestLoginValidation(t *testing.T) {
	svc := NewAuthService(&fakeGateway{loginToken: "tok"})

	if _, err := svc.Login(context.Background(), "123", "123456", "t"); !errors.Is(err, ErrInvalidPhone) {
		t.Fatalf("err = %v, want ErrInvalidPhone", err)
	}
	if _, err := svc.Login(context.Background(), "13800138000", "", "t"); !errors.Is(err, ErrMissingSmsCode) {
		t.Fatalf("err = %v, want ErrMissingSmsCode", err)
	}
	if _, err := svc.Login(context.Background(), "13800138000", "123456", ""); !errors.Is(err, ErrMissingTicket) {
		t.Fatalf("err = %v, want ErrMissingTicket", err)
	}
}

func TestSendLoginSmsValidation(t *testing.T) {
	svc := NewAuthService(&fakeGateway{})
	if err := svc.SendLoginSms(context.Background(), LoginSms{Mobile: "abc"}); !errors.Is(err, ErrInvalidPhone) {
		t.Fatalf("err = %v, want ErrInvalidPhone", err)
	}
}
