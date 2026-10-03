// Package domain 承载杯贴工具的纯领域类型与规则，不依赖任何外层。
package domain

import "encoding/json"

// 喜茶杯贴画布规格，来自官方 App 内嵌代码。
const (
	CupWidth  = 596
	CupHeight = 832

	// MaxUploadBytes 是服务端对上传文件的兜底上限。
	// 前端渲染管线会把产物压到 200KB 以内，这里仅防越界请求。
	MaxUploadBytes = 2 << 20
)

// Result 是喜茶 App 通道业务响应的统一形状（code/message/data）。
type Result struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}
