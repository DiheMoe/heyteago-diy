"use client";

// token 管理：手动粘贴 / 查询用户。token 只保存在浏览器侧，服务端不存储。
// 勾选"记住"后以明文存 localStorage——界面上如实标注，不暗示加密。
import { useState } from "react";
import { fetchUser, type User } from "@/lib/api";

interface Props {
  token: string;
  remember: boolean;
  user: User | null;
  busy: boolean;
  onTokenChange(token: string, remember: boolean): void;
  onUserChange(user: User | null): void;
  onStatus(kind: "info" | "error" | "success", text: string): void;
}

export function TokenPanel({ token, remember, user, busy, onTokenChange, onUserChange, onStatus }: Props) {
  const [loadingUser, setLoadingUser] = useState(false);

  const queryUser = async () => {
    setLoadingUser(true);
    try {
      onUserChange(await fetchUser(token || undefined));
      onStatus("success", "用户信息查询成功");
    } catch (err) {
      onUserChange(null);
      onStatus("error", err instanceof Error ? err.message : "查询用户失败");
    } finally {
      setLoadingUser(false);
    }
  };

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-neutral-800">账号 Token</h2>
      <textarea
        className="w-full rounded-lg border border-neutral-300 p-2 font-mono text-xs focus:border-neutral-500 focus:outline-none"
        rows={3}
        placeholder="粘贴 App 通道 token（抓包获取，见下方常见问题）"
        value={token}
        onChange={(e) => onTokenChange(e.target.value.trim(), remember)}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={queryUser}
          disabled={loadingUser || busy}
          className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {loadingUser ? "查询中…" : "查询用户"}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-neutral-600">
          <input
            type="checkbox"
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
          <p className="text-xs text-neutral-600">未登录 —— 填入 token 后点击「查询用户」确认身份</p>
        )}
      </div>
    </section>
  );
}
