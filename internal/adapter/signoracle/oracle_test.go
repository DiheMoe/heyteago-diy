package signoracle

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// 真实拉起 unidbg oracle 的集成测试：默认跳过，HEYTEA_TEST_ORACLE=1 时启用。
// 冷启动约 30–40s，签名一次 < 1s。
func TestOracleIntegration(t *testing.T) {
	if os.Getenv("HEYTEA_TEST_ORACLE") != "1" {
		t.Skip("set HEYTEA_TEST_ORACLE=1 to run")
	}
	// go test 的 cwd 是包目录，回到仓库根找 bin/ 资产。
	root := filepath.Join("..", "..", "..")
	cfg := DefaultConfig()
	cfg.JarPath = filepath.Join(root, cfg.JarPath)
	cfg.SoPath = filepath.Join(root, cfg.SoPath)
	cfg.ReadyTimeout = 90 * time.Second
	o := New(cfg)
	defer o.Close()

	// 对空内容的 sha256 签名；只验证协议往返，不关心签名值。
	sig, err := o.SignImageDIY(context.Background(),
		"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
	if err != nil {
		t.Fatalf("SignImageDIY: %v", err)
	}
	if sig == "" {
		t.Fatal("empty signature")
	}
	t.Logf("signature length = %d", len(sig))

	// 第二次签名复用同一进程。
	if _, err := o.SignImageDIY(context.Background(),
		"2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae"); err != nil {
		t.Fatalf("second sign: %v", err)
	}
}
