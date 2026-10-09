package usecase

import (
	"errors"
	"fmt"
)

// 入参校验错误，transport 层映射为 400。
var (
	ErrMissingToken      = errors.New("缺少授权 token")
	ErrMissingUserMainID = errors.New("缺少 userMainId")
	ErrMissingFile       = errors.New("缺少文件")
	ErrFileTooLarge      = errors.New("文件超过大小上限")
	ErrInvalidPhone      = errors.New("手机号格式不正确")
	ErrMissingSmsCode    = errors.New("缺少短信验证码")
	ErrMissingTicket     = errors.New("缺少人机验证 ticket")
)

// 与喜茶通信失败，transport 层映射为 502：响应里只给这两句简短说明，具体原因写服务端日志。
var (
	ErrUpstreamUnreachable = errors.New("连接喜茶超时或中断")
	ErrUpstreamBadResponse = errors.New("喜茶服务暂时异常")
)

// BusinessError 表示喜茶上游返回了非 0 业务码。
type BusinessError struct {
	Code    int
	Message string
}

func (e *BusinessError) Error() string {
	return fmt.Sprintf("上游业务错误 code=%d: %s", e.Code, e.Message)
}

// SignError 表示本地签名失败，transport 层映射为 502。
type SignError struct {
	Err error
}

func (e *SignError) Error() string { return "签名失败：" + e.Err.Error() }
func (e *SignError) Unwrap() error { return e.Err }
