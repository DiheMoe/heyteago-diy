"use client";

// 已登录时的账号卡片：用户名、复制 token、退出登录、保持登录开关。
// 复制 token：token 就是喜茶的登录凭证，复制前先讲清风险、确认后才复制；
// 浏览器不允许自动复制（剪贴板接口要求 HTTPS 或 localhost，或用户拒绝了权限）时，显示出来供手动复制。
import { useEffect, useState, type ReactNode } from "react";
import type { User } from "@/shared/api";

type CopyStep = "idle" | "confirm" | "copied" | "manual";

// 复制成功后按钮显示「已复制」的时长
const COPIED_MS = 2000;

interface Props {
  user: User;
  token: string;
  onSignOut(): void;
  rememberToggle: ReactNode;
}

const cardButton = "shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50";

export function SignedInCard({ user, token, onSignOut, rememberToggle }: Props) {
  const [step, setStep] = useState<CopyStep>("idle");

  useEffect(() => {
    if (step !== "copied") return;
    const timer = setTimeout(() => setStep("idle"), COPIED_MS);
    return () => clearTimeout(timer);
  }, [step]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setStep("copied");
    } catch {
      setStep("manual");
    }
  };

  return (
    <section className="rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm text-neutral-800">
          <span className="mr-1 text-emerald-600">✓</span>已登录：<span className="font-medium">{user.name}</span>
        </p>
        {/* 定宽：「复制 token」与「✓ 已复制」切换时按钮不跳动 */}
        <button type="button" onClick={() => setStep("confirm")} className={`min-w-[5.5rem] ${cardButton}`}>
          {step === "copied" ? "✓ 已复制" : "复制 token"}
        </button>
        <button type="button" onClick={onSignOut} className={cardButton}>
          退出登录
        </button>
      </div>
      <div className="mt-1">{rememberToggle}</div>
      <span role="status" className="sr-only">
        {step === "copied" ? "token 已复制到剪贴板" : ""}
      </span>
      {(step === "confirm" || step === "manual") && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed">
          <p className="font-medium text-amber-900">请勿把 token 分享给任何人</p>
          <p className="mt-1 text-amber-800">
            token 等同于你的喜茶登录凭证：拿到它的人不需要验证码，就能用你的账号存草稿、发布杯贴。
          </p>
          {step === "confirm" ? (
            <div className="mt-2.5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStep("idle")}
                className="rounded-md border border-amber-300 bg-white px-3 py-1 text-amber-900 hover:bg-amber-100"
              >
                取消
              </button>
              <button
                type="button"
                onClick={copy}
                className="rounded-md bg-neutral-900 px-3 py-1 text-white hover:bg-neutral-700"
              >
                我了解，复制
              </button>
            </div>
          ) : (
            <>
              <p className="mt-2 text-amber-800">浏览器不允许这个页面自动复制（例如不是 HTTPS 访问），请手动复制：</p>
              {/* 手机上字号 16px：iOS 聚焦小于 16px 的输入框会放大页面 */}
              <input
                readOnly
                autoFocus
                value={token}
                aria-label="token"
                onFocus={(e) => e.currentTarget.select()}
                className="mt-1 w-full rounded border border-amber-300 bg-white px-2 py-1 font-mono text-base sm:text-xs"
              />
              <div className="mt-2.5 flex justify-end">
                <button
                  type="button"
                  onClick={() => setStep("idle")}
                  className="rounded-md border border-amber-300 bg-white px-3 py-1 text-amber-900 hover:bg-amber-100"
                >
                  完成
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
