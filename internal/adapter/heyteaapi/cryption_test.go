package heyteaapi

import "testing"

// 已知答案向量由 openssl 生成（AES-128-CBC + PKCS7，key 23290CFFBB5D39B8 / iv HEYTEA1A2B3C4D5E）。
func TestEncryptMobileKnownAnswers(t *testing.T) {
	cases := map[string]string{
		"13800138000": "0tqoQY+tzIB3DGk10ct8sw==",
		"19912345678": "hCa/cmlfnGRNLXPIRjFJwA==",
	}
	for plain, want := range cases {
		got, err := EncryptMobile(plain)
		if err != nil {
			t.Fatalf("EncryptMobile(%q): %v", plain, err)
		}
		if got != want {
			t.Errorf("EncryptMobile(%q) = %q, want %q", plain, got, want)
		}
	}
}
