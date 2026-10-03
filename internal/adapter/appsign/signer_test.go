package appsign

import (
	"context"
	"testing"
	"time"
)

// 已知答案向量取自 App 官方实现（固定时钟采样，.so 内按 微秒/1000 取毫秒）。

func TestSignImageDIYKnownAnswers(t *testing.T) {
	const (
		emptySHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
		fooSHA   = "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae"
		testKey  = "a95fb7b1b07c2ce2d68dd5eaaafb7e3b41c0ec89b5b400742b0a308491407f1b3b8611ba6656ba95ab08a2c82478d337de5ebc2a5a2be672f20b51e0907fbe128c4106e641c534564b8e4a8aa1e3832d"
	)
	cases := []struct {
		name   string
		env    string
		micros int64
		hash   string
		want   string
	}{
		{"prod", "prod", 1759480000123456, emptySHA,
			"233497cb178eedb3554490c71d0d47ee8f79aeb081d37a3011499c428fdc52b145ab0884cd2c67e7598675dce96dad68873efd124d1339ce325772013c816e48f84920d26be12d27a79e8bd4c0129e5a"},
		{"毫秒截断而非四舍五入", "prod", 1759480000123999, fooSHA,
			"4ba108fb04591a43963084149ba993fd4852eeaad56394785a16735616a4b4e95e71d0fbe0cea402be9a8d34d0ec7c030bc4d0cf15011327467d49b945c1e280e864145f3bddcb677b4dd5a030271acb"},
		{"非 prod 用测试 key", "dev", 1759480000123456, emptySHA, testKey},
		{"env 区分大小写", "PROD", 1759480000123456, emptySHA, testKey},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := New(c.env)
			s.now = func() time.Time { return time.UnixMicro(c.micros) }
			got, err := s.SignImageDIY(context.Background(), c.hash)
			if err != nil {
				t.Fatalf("SignImageDIY: %v", err)
			}
			if got != c.want {
				t.Errorf("SignImageDIY(env=%q, %q) = %s, want %s", c.env, c.hash, got, c.want)
			}
		})
	}
}

func TestSignTradeKnownAnswers(t *testing.T) {
	const (
		ts       = "1759480000123"
		login    = "/api/service-login/openapi/vip/user/login_v1"
		loginPms = "/api/service-login-pms/openapi/vip/user/login_v1"
		prodSig  = "2KL+8DVP1fNeF60+Jb8GAaOCDPZndoU46aaDkXnWGpk="
		goTest   = "hZOpX0SFIIiw0jXgTytoGovpu3BxyQHRpmT0yO3kf+0="
	)
	cases := []struct {
		name string
		env  string
		path string
		want string
	}{
		{"prod login_v1", "prod", login, prodSig},
		{"prod login_v1_pms", "prod", loginPms, "v+KBR2ItEO4DhnMbQ59zcdSaG7T/tEP52IIirG3jJpI="},
		{"无前导 / 与有 / 等价", "prod", login[1:], prodSig},
		{"只去掉一个前导 /", "prod", "//api/x", "rKIM8znhELEutFbH9MGQaDS9jqfdEBcLGwhblLmwmSU="},
		{"dev", "dev", login, "OFcjf8lqW0FUMQq7UBZkpWdYjLHI11cLWWqZL23oeOw="},
		{"pre", "pre", login, "DswRyeUDUuqyTu5JRwHbwX4o0ULHHf5l3Tj7TCHubxU="},
		{"go-test1", "go-test1", login, goTest},
		{"go-test4 与 go-test1 同 key", "go-test4", login, goTest},
		{"未知 env 回落生产 key", "test", login, prodSig},
		{"大小写不同也回落生产 key", "PROD", login, prodSig},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := New(c.env).SignTrade(context.Background(), "user", c.path, ts)
			if err != nil {
				t.Fatalf("SignTrade: %v", err)
			}
			if got != c.want {
				t.Errorf("SignTrade(env=%q, %q) = %s, want %s", c.env, c.path, got, c.want)
			}
		})
	}
}
