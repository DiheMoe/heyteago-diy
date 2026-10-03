package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"heyteago-diy/internal/domain"
)

type fakeSigner struct {
	calls int
	err   error
}

func (f *fakeSigner) SignImageDIY(_ context.Context, _ string) (string, error) {
	f.calls++
	if f.err != nil {
		return "", f.err
	}
	return "hash-value", nil
}

type fakeGateway struct {
	uploads   []StickerUpload
	uploadRes []domain.Result // 按调用顺序返回
	user      domain.User
	userErr   error
}

func (f *fakeGateway) UploadSticker(_ context.Context, req StickerUpload) (domain.Result, error) {
	f.uploads = append(f.uploads, req)
	res := f.uploadRes[min(len(f.uploads), len(f.uploadRes))-1]
	return res, nil
}

func (f *fakeGateway) SaveDraft(_ context.Context, _ DraftSave) (domain.Result, error) {
	return domain.Result{Code: 0}, nil
}

func (f *fakeGateway) UserInfo(_ context.Context, _ string) (domain.User, error) {
	return f.user, f.userErr
}

func okResult() domain.Result {
	return domain.Result{Code: 0, Data: json.RawMessage(`{"id":1}`)}
}

func validUpload() StickerUpload {
	return StickerUpload{Token: "t", UserMainID: "42", File: []byte("png-bytes")}
}

func TestUploadSuccess(t *testing.T) {
	signer := &fakeSigner{}
	gw := &fakeGateway{uploadRes: []domain.Result{okResult()}}
	svc := NewStickerService(signer, gw)

	out, err := svc.Upload(context.Background(), validUpload())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.Message != "上传成功" {
		t.Fatalf("message = %q", out.Message)
	}
	if signer.calls != 1 || len(gw.uploads) != 1 {
		t.Fatalf("signer.calls=%d uploads=%d, want 1/1", signer.calls, len(gw.uploads))
	}
	if gw.uploads[0].Hash != "hash-value" {
		t.Fatalf("hash not propagated: %q", gw.uploads[0].Hash)
	}
	if gw.uploads[0].Width != domain.CupWidth || gw.uploads[0].Height != domain.CupHeight {
		t.Fatalf("default canvas size not applied: %dx%d", gw.uploads[0].Width, gw.uploads[0].Height)
	}
}

func TestUploadResignsOnceOnRetryableCode(t *testing.T) {
	signer := &fakeSigner{}
	gw := &fakeGateway{uploadRes: []domain.Result{
		{Code: 401, Message: "签名失效"},
		okResult(),
	}}
	svc := NewStickerService(signer, gw)

	if _, err := svc.Upload(context.Background(), validUpload()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if signer.calls != 2 || len(gw.uploads) != 2 {
		t.Fatalf("signer.calls=%d uploads=%d, want 2/2", signer.calls, len(gw.uploads))
	}
}

func TestUploadResignsOnAllRetryableCodes(t *testing.T) {
	for _, code := range []int{401, 1002, 401011} {
		signer := &fakeSigner{}
		gw := &fakeGateway{uploadRes: []domain.Result{{Code: code}, okResult()}}
		svc := NewStickerService(signer, gw)
		if _, err := svc.Upload(context.Background(), validUpload()); err != nil {
			t.Fatalf("code %d: unexpected error: %v", code, err)
		}
		if signer.calls != 2 {
			t.Fatalf("code %d: signer.calls=%d, want 2", code, signer.calls)
		}
	}
}

func TestUploadDoesNotRetryTwice(t *testing.T) {
	signer := &fakeSigner{}
	gw := &fakeGateway{uploadRes: []domain.Result{{Code: 401, Message: "仍失效"}, {Code: 401, Message: "仍失效"}}}
	svc := NewStickerService(signer, gw)

	_, err := svc.Upload(context.Background(), validUpload())
	var be *BusinessError
	if !errors.As(err, &be) || be.Code != 401 {
		t.Fatalf("err = %v, want BusinessError 401", err)
	}
	if signer.calls != 2 || len(gw.uploads) != 2 {
		t.Fatalf("signer.calls=%d uploads=%d, want 2/2", signer.calls, len(gw.uploads))
	}
}

func TestUploadNonRetryableCodeNotRetried(t *testing.T) {
	signer := &fakeSigner{}
	gw := &fakeGateway{uploadRes: []domain.Result{{Code: 555710012, Message: "签名错误"}}}
	svc := NewStickerService(signer, gw)

	_, err := svc.Upload(context.Background(), validUpload())
	var be *BusinessError
	if !errors.As(err, &be) || be.Code != 555710012 {
		t.Fatalf("err = %v, want BusinessError 555710012", err)
	}
	if signer.calls != 1 || len(gw.uploads) != 1 {
		t.Fatalf("signer.calls=%d uploads=%d, want 1/1", signer.calls, len(gw.uploads))
	}
}

func TestUploadValidation(t *testing.T) {
	svc := NewStickerService(&fakeSigner{}, &fakeGateway{uploadRes: []domain.Result{okResult()}})

	cases := []struct {
		name string
		in   StickerUpload
		want error
	}{
		{"missing token", StickerUpload{UserMainID: "1", File: []byte("x")}, ErrMissingToken},
		{"missing userMainId", StickerUpload{Token: "t", File: []byte("x")}, ErrMissingUserMainID},
		{"missing file", StickerUpload{Token: "t", UserMainID: "1"}, ErrMissingFile},
		{"file too large", StickerUpload{Token: "t", UserMainID: "1", File: make([]byte, domain.MaxUploadBytes+1)}, ErrFileTooLarge},
	}
	for _, c := range cases {
		if _, err := svc.Upload(context.Background(), c.in); !errors.Is(err, c.want) {
			t.Errorf("%s: err = %v, want %v", c.name, err, c.want)
		}
	}
}

func TestUploadSignErrorWrapped(t *testing.T) {
	signer := &fakeSigner{err: errors.New("oracle down")}
	gw := &fakeGateway{uploadRes: []domain.Result{okResult()}}
	svc := NewStickerService(signer, gw)

	_, err := svc.Upload(context.Background(), validUpload())
	var se *SignError
	if !errors.As(err, &se) {
		t.Fatalf("err = %v, want SignError", err)
	}
	if len(gw.uploads) != 0 {
		t.Fatalf("gateway called despite sign failure")
	}
}

func TestSaveDraftSuccess(t *testing.T) {
	signer := &fakeSigner{}
	gw := &fakeGateway{}
	svc := NewStickerService(signer, gw)

	out, err := svc.SaveDraft(context.Background(), DraftSave{Token: "t", File: []byte("x")})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.Message != "草稿保存成功" {
		t.Fatalf("message = %q", out.Message)
	}
}
