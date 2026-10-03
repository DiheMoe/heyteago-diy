// Package httpapi 对外暴露 JSON API。只用 net/http 标准库（Go 1.22 方法路由）。
// token 不落日志；multipart 请求体按领域上限截断。
package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/DiheMoe/heyteago-diy/internal/domain"
	"github.com/DiheMoe/heyteago-diy/internal/usecase"
)

type Server struct {
	stickers *usecase.StickerService
	users    *usecase.UserService
	auth     *usecase.AuthService
}

func NewServer(stickers *usecase.StickerService, users *usecase.UserService, auth *usecase.AuthService) *Server {
	return &Server{stickers: stickers, users: users, auth: auth}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/upload", s.handleUpload)
	mux.HandleFunc("POST /api/draft/save", s.handleSaveDraft)
	mux.HandleFunc("GET /api/user", s.handleUser)
	mux.HandleFunc("POST /api/login/sms", s.handleLoginSms)
	mux.HandleFunc("POST /api/login", s.handleLogin)
	mux.HandleFunc("GET /api/health", s.handleHealth)
	return logRequests(mux)
}

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	file, header, err := parseFilePart(r)
	if err != nil {
		writeError(w, err)
		return
	}

	form := r.MultipartForm.Value
	out, err := s.stickers.Upload(r.Context(), usecase.StickerUpload{
		Token:       firstValue(form, "token"),
		UserMainID:  firstValue(form, "userMainId"),
		FileName:    header.Filename,
		ContentType: header.Header.Get("Content-Type"),
		File:        file,
		Width:       parseIntOr(firstValue(form, "width"), domain.CupWidth),
		Height:      parseIntOr(firstValue(form, "height"), domain.CupHeight),
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleSaveDraft(w http.ResponseWriter, r *http.Request) {
	file, header, err := parseFilePart(r)
	if err != nil {
		writeError(w, err)
		return
	}

	out, err := s.stickers.SaveDraft(r.Context(), usecase.DraftSave{
		Token:       firstValue(r.MultipartForm.Value, "token"),
		FileName:    header.Filename,
		ContentType: header.Header.Get("Content-Type"),
		File:        file,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleUser(w http.ResponseWriter, r *http.Request) {
	provided := r.URL.Query().Get("token")
	if auth := r.Header.Get("Authorization"); auth != "" {
		provided = strings.TrimPrefix(auth, "Bearer ")
	}
	user, err := s.users.UserInfo(r.Context(), provided)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleLoginSms(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Phone   string `json:"phone"`
		Ticket  string `json:"ticket"`
		Randstr string `json:"randstr"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, err)
		return
	}
	err := s.auth.SendLoginSms(r.Context(), usecase.LoginSms{
		Mobile:  in.Phone,
		Ticket:  in.Ticket,
		Randstr: in.Randstr,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Phone  string `json:"phone"`
		Code   string `json:"code"`
		Ticket string `json:"ticket"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, err)
		return
	}
	out, err := s.auth.Login(r.Context(), in.Phone, in.Code, in.Ticket)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// errBadJSON 表示请求体不是合法 JSON，映射为 400。
var errBadJSON = errors.New("请求体不是合法的 JSON")

// decodeJSON 解析 JSON 请求体；登录类端点字段少，请求体限 4KB。
func decodeJSON(r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 4<<10)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		return errBadJSON
	}
	return nil
}

// parseFilePart 解析 multipart 表单并取出 file 字段的全部字节。
// 请求体上限 = 领域上限 + 1MiB 表单开销，超限直接拒绝。
func parseFilePart(r *http.Request) ([]byte, *multipart.FileHeader, error) {
	r.Body = http.MaxBytesReader(nil, r.Body, domain.MaxUploadBytes+(1<<20))
	if err := r.ParseMultipartForm(domain.MaxUploadBytes); err != nil {
		return nil, nil, errors.New("请求体解析失败（可能超过大小上限）")
	}
	f, header, err := r.FormFile("file")
	if err != nil {
		return nil, nil, usecase.ErrMissingFile
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil || len(data) == 0 {
		return nil, nil, usecase.ErrMissingFile
	}
	return data, header, nil
}

func firstValue(values map[string][]string, key string) string {
	if v := values[key]; len(v) > 0 {
		return v[0]
	}
	return ""
}

func parseIntOr(s string, fallback int) int {
	if n, err := strconv.Atoi(s); err == nil && n > 0 {
		return n
	}
	return fallback
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	body := map[string]any{"message": err.Error()}

	var be *usecase.BusinessError
	var se *usecase.SignError
	switch {
	case errors.Is(err, usecase.ErrMissingToken),
		errors.Is(err, usecase.ErrMissingUserMainID),
		errors.Is(err, usecase.ErrMissingFile),
		errors.Is(err, usecase.ErrFileTooLarge),
		errors.Is(err, usecase.ErrInvalidPhone),
		errors.Is(err, usecase.ErrMissingSmsCode),
		errors.Is(err, usecase.ErrMissingTicket),
		errors.Is(err, errBadJSON):
		status = http.StatusBadRequest
	case errors.As(err, &be):
		status = http.StatusBadRequest
		body["message"] = be.Message
		body["code"] = be.Code
	case errors.As(err, &se):
		status = http.StatusBadGateway
	default:
		if strings.Contains(err.Error(), "喜茶") {
			status = http.StatusBadGateway
		}
	}
	writeJSON(w, status, body)
}

// logRequests 记录方法与路径，绝不记录 body 与 token。
func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rw, r)
		log.Printf("[http] %s %s -> %d (%s)", r.Method, r.URL.Path, rw.status, time.Since(start).Round(time.Millisecond))
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}
