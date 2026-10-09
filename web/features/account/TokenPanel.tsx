"use client";

// 手机号 + 短信验证码登录；手动粘贴 token 的通道保留在折叠块中。已登录时收成一行，可复制 token（先提醒风险）。
// token 只保存在浏览器侧，服务端不存储。
// 默认在本机保持登录，以明文存 localStorage——界面上如实标注，不暗示加密。
//
// 滑块在点击「登录」时触发（ticket 一次性，随当次尝试消耗）；
// 登录失败只需重新滑块再点登录，短信未过期不必重发。
// 短信/登录/查用户的反馈内联在本面板：全局状态条在 ActionBar，
// 离本面板较远，发送回执放那里容易被忽略。
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { loginByPhone, requestLoginSms } from "@/shared/api";
import { errorText } from "@/shared/errors";
import { HEYTEA_CAPTCHA_APP_ID, runCaptcha } from "./captcha";
import { SignedInCard } from "./SignedInCard";
import { loginWithCaptcha, maskPhone, normalizePhone, sendLoginSms, type SmsLoginDeps } from "./sms-login";
import type { Account } from "./use-account";

// 发送成功后的重发冷却：防连点透支短信每日上限
const SMS_COOLDOWN_SECONDS = 60;
// 粘贴 token 后停止输入这么久就自动确认一次
const VERIFY_DELAY_MS = 600;

const smsLoginDeps: SmsLoginDeps = {
  runCaptcha: () => runCaptcha(HEYTEA_CAPTCHA_APP_ID),
  requestLoginSms,
  loginByPhone,
};

interface Feedback {
  kind: "error" | "success";
  text: string;
}

interface Props {
  account: Account;
}

export function TokenPanel({ account }: Props) {
  const { token, remember, user, notice } = account;
  const [verifying, setVerifying] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [loggingIn, setLoggingIn] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // 每次手动改动 token 递增，用来触发延迟确认
  const [pasted, setPasted] = useState(0);
  const codeInputRef = useRef<HTMLInputElement | null>(null);

  // 冷却倒计时逐秒递减；换号不清零——冷却约束的是发送频率，不是某个号码
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // 确认失败的原因由 account.notice 展示
  const verify = async () => {
    setVerifying(true);
    setFeedback(null);
    try {
      await account.queryUser();
    } catch {
      // 原因已写进 account.notice
    } finally {
      setVerifying(false);
    }
  };

  const verifyPasted = useEffectEvent(() => {
    if (token) void verify();
  });

  useEffect(() => {
    if (pasted === 0) return;
    const timer = setTimeout(verifyPasted, VERIFY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pasted]);

  const sendSms = async () => {
    setSending(true);
    setFeedback(null);
    try {
      await sendLoginSms(smsLoginDeps, phone);
      setSent(true);
      // 重发后旧验证码大概率已失效，清空避免误提交
      setCode("");
      setCooldown(SMS_COOLDOWN_SECONDS);
      setFeedback({ kind: "success", text: `验证码已发送至 ${maskPhone(phone)}，请查收` });
      codeInputRef.current?.focus();
    } catch (err) {
      setFeedback({ kind: "error", text: errorText(err, "验证码发送失败") });
    } finally {
      setSending(false);
    }
  };

  const login = async () => {
    setLoggingIn(true);
    setFeedback(null);
    try {
      const result = await loginWithCaptcha(smsLoginDeps, phone, code.trim());
      account.signIn(result.token, result.user);
      setCode("");
    } catch (err) {
      // 失败只消耗当次滑块 ticket：保留手机号与验证码，再点登录重新滑块即可
      setFeedback({ kind: "error", text: errorText(err, "登录失败") });
    } finally {
      setLoggingIn(false);
    }
  };

  const sendLabel = sending
    ? "发送中…"
    : cooldown > 0
      ? `${cooldown}s 后可重发`
      : sent
        ? "重新获取"
        : "发送验证码";

  const rememberToggle = (
    <label className="flex items-center gap-1.5 text-xs text-neutral-600">
      <input
        type="checkbox"
        className="accent-neutral-900"
        checked={remember}
        onChange={(e) => account.setRemember(e.target.checked)}
      />
      在本机保持登录（token 明文保存在本浏览器）
    </label>
  );

  if (user) {
    return (
      <SignedInCard user={user} token={account.token} onSignOut={account.signOut} rememberToggle={rememberToggle} />
    );
  }

  const message = feedback ?? (notice && { kind: "error" as const, text: notice.text });
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-neutral-800">账号登录</h2>
      <div className="flex gap-2">
        <input
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          className="w-full min-w-0 flex-1 rounded-lg border border-neutral-300 p-2 text-base focus:border-neutral-500 focus:outline-none sm:text-xs"
          placeholder="手机号"
          aria-label="手机号"
          value={phone}
          onChange={(e) => {
            setPhone(normalizePhone(e.target.value));
            // 换号后原号码的发送回执不再适用
            setSent(false);
            setFeedback(null);
          }}
        />
        <button
          type="button"
          onClick={sendSms}
          disabled={sending || loggingIn || cooldown > 0}
          className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
        >
          {sendLabel}
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          ref={codeInputRef}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="w-full min-w-0 flex-1 rounded-lg border border-neutral-300 p-2 text-base focus:border-neutral-500 focus:outline-none sm:text-xs"
          placeholder="短信验证码"
          aria-label="短信验证码"
          value={code}
          onChange={(e) => setCode(e.target.value.trim())}
          onKeyDown={(e) => {
            if (e.key === "Enter" && phone && code && !loggingIn) void login();
          }}
        />
        <button
          type="button"
          onClick={login}
          disabled={!phone || !code || loggingIn || sending}
          className="shrink-0 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {loggingIn ? "登录中…" : "登录"}
        </button>
      </div>
      <div className="mt-2">{rememberToggle}</div>
      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`mt-2 text-xs ${message.kind === "error" ? "text-red-600" : "text-emerald-600"}`}
        >
          {message.text}
          {!feedback && notice?.retry && (
            <button
              type="button"
              onClick={verify}
              disabled={verifying}
              className="ml-2 rounded border border-red-300 px-2 py-0.5 text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {verifying ? "重试中…" : "重试"}
            </button>
          )}
        </p>
      )}
      <p className="mt-2 text-xs text-neutral-500">短信每天有发送上限，请勿频繁获取；在这里登录会让手机上的喜茶 GO App 下线</p>
      <details className="mt-3">
        <summary className="cursor-pointer select-none text-xs text-neutral-500 hover:text-neutral-700">
          手动粘贴 token（抓包获取）
        </summary>
        <textarea
          className="mt-2 w-full rounded-lg border border-neutral-300 p-2 font-mono text-xs focus:border-neutral-500 focus:outline-none"
          rows={3}
          placeholder="粘贴 App 通道 token（粘贴后自动验证）"
          aria-label="手动粘贴的 token"
          value={token}
          onChange={(e) => {
            account.setToken(e.target.value.trim());
            setPasted((n) => n + 1);
          }}
        />
        <button
          type="button"
          onClick={verify}
          disabled={!token || verifying}
          className="mt-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
        >
          {verifying ? "验证中…" : "验证 token"}
        </button>
      </details>
    </section>
  );
}
