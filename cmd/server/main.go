// 组合根：读取环境配置，装配各层，启动 HTTP 服务。
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/DiheMoe/heyteago-diy/internal/adapter/heyteaapi"
	"github.com/DiheMoe/heyteago-diy/internal/adapter/secureticket"
	"github.com/DiheMoe/heyteago-diy/internal/adapter/signoracle"
	"github.com/DiheMoe/heyteago-diy/internal/transport/httpapi"
	"github.com/DiheMoe/heyteago-diy/internal/usecase"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	port := envOr("PORT", "8790")

	oracleCfg := signoracle.DefaultConfig()
	oracleCfg.JarPath = envOr("HEYTEA_SIGN_JAR", oracleCfg.JarPath)
	oracleCfg.SoPath = envOr("HEYTEA_SIGN_SO", oracleCfg.SoPath)
	oracleCfg.JavaBin = envOr("HEYTEA_SIGN_JAVA", oracleCfg.JavaBin)
	oracleCfg.Env = envOr("HEYTEA_SIGN_ENV", oracleCfg.Env)
	oracle := signoracle.New(oracleCfg)
	defer oracle.Close()

	ticketCfg := secureticket.DefaultConfig()
	ticketCfg.PythonBin = envOr("HEYTEA_SECURE_PYTHON", ticketCfg.PythonBin)
	ticketCfg.ScriptPath = envOr("HEYTEA_SECURE_SCRIPT", ticketCfg.ScriptPath)
	ticketCfg.SoPath = envOr("HEYTEA_SDK_SO", ticketCfg.SoPath)
	transport := secureticket.New(ticketCfg)
	defer transport.Close()

	gateway := heyteaapi.New(oracle, transport)
	stickers := usecase.NewStickerService(oracle, gateway)
	users := usecase.NewUserService(gateway)
	auth := usecase.NewAuthService(gateway)

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           httpapi.NewServer(stickers, users, auth).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		// 上传链路与签名 oracle 往返可能耗时数十秒，不写总超时，
		// 依赖 ctx 与各环节自身的超时控制。
	}

	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
		<-sig
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()

	log.Printf("[main] heyteago-diy 服务监听 :%s", port)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
