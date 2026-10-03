// Package appsign 实现喜茶GO App 的本地签名：calDIYSign（杯贴上传 hash）与
// calTradeAndMemberSign（登录反滥用）。两者均为标准算法 + App 内置常量，不读设备信息。
// 常量与算法取自 App 内嵌实现；App 升级若签名失效，核对下列常量与本包测试向量。
package appsign

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"strconv"
	"strings"
	"time"
)

// 上传签名：AES-128-CBC + PKCS7，iv 固定；仅 env 恰为 "prod" 时用生产 key，其余一律用测试 key。
var (
	diyKeyProd = []byte("2lJuL8jdH03oNIq5")
	diyKeyTest = []byte("AN1wedUvOJblfD8Z")
	diyIV      = []byte("HEYTEA6H7J8K9M0N")
)

// 反滥用签名：HMAC-SHA256，key 在 .so 内是 base64 文本、用前解码；
// 不在表中的 env（含 prod）一律回落生产 key——与上传签名的 env 规则不对称，照搬原逻辑。
var (
	tradeKeyProd = mustDecodeBase64("qk6EZ2tLOQNunx5imqbgMYvDAqeR0txxet5Si6rEKsw=")
	tradeKeys    = map[string][]byte{
		"dev":      mustDecodeBase64("15W8QP2wkV/zTqrfl61V/5DD+J0WGPC4EQGzOMHPg+s="),
		"pre":      mustDecodeBase64("QiaynLD6Wjp5+mVJ1AovOpi8YU+3NCq3K9xv4wYnoKQ="),
		"go-test1": mustDecodeBase64("abYxweg3431cCspWbjgtHXNxvExSxO4u2KL7J0sECTE="),
		"go-test4": mustDecodeBase64("abYxweg3431cCspWbjgtHXNxvExSxO4u2KL7J0sECTE="),
	}
)

// Signer 实现 usecase.Signer。纯计算、无可变状态，可并发调用。
type Signer struct {
	env string           // App 调 setEnv 的入参，生产为 "prod"（区分大小写）
	now func() time.Time // 测试注入固定时钟
}

func New(env string) *Signer {
	return &Signer{env: env, now: time.Now}
}

// SignImageDIY 对应 calDIYSign(fileHash)：AES-CBC(fileHash + "#" + 毫秒时间戳) 的小写 hex。
// 时间戳加密在密文尾部，所以每次结果不同，服务端据此判断签名是否过期。
func (s *Signer) SignImageDIY(_ context.Context, sha256Hex string) (string, error) {
	key := diyKeyTest
	if s.env == "prod" {
		key = diyKeyProd
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	plain := sha256Hex + "#" + strconv.FormatInt(s.now().UnixMilli(), 10)
	data := pkcs7Pad([]byte(plain), block.BlockSize())
	out := make([]byte, len(data))
	cipher.NewCBCEncrypter(block, diyIV).CryptBlocks(out, data)
	return hex.EncodeToString(out), nil
}

// SignTrade 对应 calTradeAndMemberSign(biz, path, timestamp)：
// HMAC-SHA256("biz:<biz>,url:<path>,timeStamp:<timestamp>") 的标准 base64；
// path 只去掉一个前导 "/"，query/host 原样参与签名。
func (s *Signer) SignTrade(_ context.Context, biz, path, timestamp string) (string, error) {
	key, ok := tradeKeys[s.env]
	if !ok {
		key = tradeKeyProd
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte("biz:" + biz + ",url:" + strings.TrimPrefix(path, "/") + ",timeStamp:" + timestamp))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil)), nil
}

func pkcs7Pad(data []byte, blockSize int) []byte {
	n := blockSize - len(data)%blockSize
	out := make([]byte, len(data)+n)
	copy(out, data)
	for i := len(data); i < len(out); i++ {
		out[i] = byte(n)
	}
	return out
}

func mustDecodeBase64(s string) []byte {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		panic(err)
	}
	return b
}
