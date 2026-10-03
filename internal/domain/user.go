package domain

// User 是喜茶会员信息中本工具用到的字段（App 通道 /api/service-member/vip/user/info）。
type User struct {
	UserMainID int64  `json:"user_main_id"`
	Name       string `json:"name"`
}
