"use client";

// 手机号 + 短信验证码登录；手动粘贴 token 的通道保留在折叠块中。
// token 只保存在浏览器侧，服务端不存储。
// 勾选"记住"后以明文存 localStorage——界面上如实标注，不暗示加密。
//
// 滑块在点击「登录」时触发（ticket 一次性，随当次尝试消耗）；
// 登录失败只需重新滑块再点登录，短信未过期不必重发。
// 短信/登录/查用户的反馈内联在本面板：全局状态条在 ActionBar，
// 离本面板较远，发送回执放那里容易被忽略。
import { useEffect, useRef, useState } from "react";
import { loginByPhone, requestLoginSms, type User } from "@/lib/api";
import { HEYTEA_CAPTCHA_APP_ID, runCaptcha } from "@/lib/captcha";
import { loginWithCaptcha, maskPhone, sendLoginSms, type SmsLoginDeps } from "@/lib/sms-login";

// 发送成功后的重发冷却：防连点透支短信每日上限
const SMS_COOLDOWN_SECONDS = 60;

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
  token: string;
  remember: boolean;
  user: User | null;
  // 统一账号查询入口（自动恢复与手动查询共用失效机制；null = 结果已过期）
  fetchUserGuarded(token: string): Promise<User | null>;
  onTokenChange(token: string, remember: boolean): void;
  onUserChange(user: User | null): void;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function TokenPanel({ token, remember, user, fetchUserGuarded, onTokenChange, onUserChange }: Props) {
  const [loadingUser, setLoadingUser] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [loggingIn, setLoggingIn] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  // 查询结果失效由父组件的统一机制保证（fetchUserGuarded 返回 null 即过期）

  // 冷却倒计时逐秒递减；换号不清零——冷却约束的是发送频率，不是某个号码
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const queryUser = async () => {
    setLoadingUser(true);
    setFeedback(null);
    try {
      const next = await fetchUserGuarded(token);
      if (!next) return; // 返回途中 token 已切换，结果已被统一机制丢弃
      onUserChange(next);
      setFeedback({ kind: "success", text: "用户信息查询成功" });
    } catch (err) {
      onUserChange(null);
      setFeedback({ kind: "error", text: errorText(err, "查询用户失败") });
    } finally {
      // 无论结果是否过期，本次查询都已结束（按钮点击时会被 disabled 挡住并发，
      // 过期场景没有新查询接管 loading 状态）
      setLoadingUser(false);
    }
  };

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
      onTokenChange(result.token, remember);
      onUserChange(result.user);
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

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-neutral-800">账号登录</h2>
      <div className="flex gap-2">
        <input
          type="tel"
          inputMode="numeric"
          maxLength={11}
          className="w-full min-w-0 flex-1 rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-500 focus:outline-none"
          placeholder="手机号"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value.trim());
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
          maxLength={6}
          className="w-full min-w-0 flex-1 rounded-lg border border-neutral-300 p-2 text-xs focus:border-neutral-500 focus:outline-none"
          placeholder="短信验证码"
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
      {feedback && (
        <p className={`mt-2 text-xs ${feedback.kind === "error" ? "text-red-600" : "text-emerald-600"}`}>
          {feedback.text}
        </p>
      )}
      <p className="mt-2 text-xs text-neutral-400">
        短信每日有发送上限，请勿频繁获取；登录会使手机上的喜茶 GO App 下线（单端会话）
      </p>
      <details className="mt-3">
        <summary className="cursor-pointer select-none text-xs text-neutral-500 hover:text-neutral-700">
          手动粘贴 token（抓包获取）
        </summary>
        <textarea
          className="mt-2 w-full rounded-lg border border-neutral-300 p-2 font-mono text-xs focus:border-neutral-500 focus:outline-none"
          rows={3}
          placeholder="粘贴 App 通道 token（抓包获取，见下方常见问题）"
          value={token}
          onChange={(e) => onTokenChange(e.target.value.trim(), remember)}
        />
      </details>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={queryUser}
          disabled={loadingUser}
          className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {loadingUser ? "查询中…" : "查询用户"}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-neutral-600">
          <input
            type="checkbox"
            className="accent-neutral-900"
            checked={remember}
            onChange={(e) => onTokenChange(token, e.target.checked)}
          />
          记住 token（明文保存在本机浏览器）
        </label>
      </div>
      <div className="mt-3">
        {user ? (
          <div className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white">
              ✓
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-emerald-900">已登录：{user.name}</p>
              <p className="text-xs text-emerald-700">ID {user.user_main_id} · 可以存草稿或上传</p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-neutral-600">未登录</p>
        )}
      </div>
    </section>
  );
}
