import { useEffect, useEffectEvent, useRef, useState } from "react";
import { fetchUser, isRequestRejected, type User } from "@/shared/api";
import { createLatestOnly } from "./latest-only";

const TOKEN_STORAGE_KEY = "heyteago-diy:token";

// 账号卡片上的提示：登录失效、暂时无法验证登录状态
export interface AccountNotice {
  text: string;
  // 暂时无法验证（网络或喜茶服务异常）时提供重试
  retry: boolean;
}

export interface Account {
  token: string;
  // 在本机保持登录：确认过的 token 以明文存 localStorage
  remember: boolean;
  // 已确认的用户；只有 token、还没确认（或确认失败）时为 null
  user: User | null;
  notice: AccountNotice | null;
  // 手动粘贴 token：开始新的账号会话（用户需重新确认），本机保存的 token 随之清除
  setToken(token: string): void;
  // 只决定确认过的 token 是否存在本机，不影响当前登录
  setRemember(on: boolean): void;
  // 短信登录成功：直接采用登录接口返回的用户
  signIn(token: string, user: User): void;
  signOut(): void;
  // 喜茶判定登录态失效（发布、存草稿时）：退出登录并提示
  expire(): void;
  // 确认当前 token 对应的用户。返回 null 表示期间账号已变、结果作废。
  // 失败时：token 被拒 → 退出登录并提示失效；网络或服务异常 → 保留 token，提示可重试；随后抛出
  queryUser(): Promise<User | null>;
}

interface Options {
  // 账号会话重置时调用：换 token、登录、退出登录、登录失效；切换「在本机保持登录」不算
  onAccountChange(): void;
}

const EXPIRED: AccountNotice = { text: "登录已失效，请重新登录", retry: false };
const UNAVAILABLE: AccountNotice = { text: "暂时无法验证登录状态（网络或喜茶服务异常）", retry: true };

function saveToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // localStorage 不可用（隐私模式等）时只是不保持登录
  }
}

// 账号状态的唯一负责人：token、保持登录开关、用户、提示，以及本机存储的读写。
// token 只保存在浏览器侧；保持登录时以明文存 localStorage。
export function useAccount({ onAccountChange }: Options): Account {
  const [token, setTokenState] = useState("");
  const [remember, setRememberState] = useState(true);
  // 异步确认完成时按最新的开关决定是否写入本机
  const rememberNow = useRef(true);
  const [user, setUser] = useState<User | null>(null);
  const [notice, setNotice] = useState<AccountNotice | null>(null);
  // 恢复、手动确认共用：账号变化或新确认发起后，迟到的旧结果（无论成败）作废，防止串号
  const [queries] = useState(createLatestOnly);

  // 结束当前账号会话：作废在途确认，清掉用户与本机保存的 token
  const reset = (next: string, nextNotice: AccountNotice | null) => {
    queries.invalidate();
    setTokenState(next);
    setUser(null);
    setNotice(nextNotice);
    saveToken(null);
    onAccountChange();
  };

  const verify = async (t: string): Promise<User | null> => {
    setNotice(null);
    try {
      const u = await queries.run(() => fetchUser(t));
      if (!u) return null;
      setUser(u);
      if (rememberNow.current) saveToken(t);
      return u;
    } catch (err) {
      if (isRequestRejected(err)) reset("", EXPIRED);
      else setNotice(UNAVAILABLE);
      throw err;
    }
  };

  const restore = useEffectEvent((saved: string) => {
    verify(saved).catch(() => {
      // 失败原因已写进 notice
    });
  });

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      return; // localStorage 不可用（隐私模式等）
    }
    if (!saved) return;
    // 挂载后从 localStorage 恢复 token：SSR 期间没有 localStorage，
    // 必须放在 effect 里同步外部存储，此处同步 setState 不可避免。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTokenState(saved);
    restore(saved);
  }, []);

  return {
    token,
    remember,
    user,
    notice,
    setToken: (next) => reset(next, null),
    setRemember(on) {
      rememberNow.current = on;
      setRememberState(on);
      saveToken(on && user ? token : null);
    },
    signIn(next, signedInUser) {
      reset(next, null);
      setUser(signedInUser);
      if (rememberNow.current) saveToken(next);
    },
    signOut: () => reset("", null),
    expire: () => reset("", EXPIRED),
    queryUser: () => verify(token),
  };
}
