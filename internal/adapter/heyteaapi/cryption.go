package heyteaapi

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
)

// 喜茶 App 端手机号加密参数：固定 key/iv，AES-128-CBC + PKCS7，输出 base64。
var (
	mobileKey = []byte("23290CFFBB5D39B8")
	mobileIV  = []byte("HEYTEA1A2B3C4D5E")
)

// EncryptMobile 按官方 App 的方式加密手机号（短信/登录接口的 mobile、phone 字段）。
func EncryptMobile(plain string) (string, error) {
	block, err := aes.NewCipher(mobileKey)
	if err != nil {
		return "", err
	}
	data := pkcs7Pad([]byte(plain), block.BlockSize())
	out := make([]byte, len(data))
	cipher.NewCBCEncrypter(block, mobileIV).CryptBlocks(out, data)
	return base64.StdEncoding.EncodeToString(out), nil
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
