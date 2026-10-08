// 提交（发布前的导出查重 / 发布 / 存草稿）的状态与互斥。
// 与渲染状态完全分离：渲染随时可能开始或结束，但在途标记只有提交自己能结束。
// 待确认的发布记下导出它的文档，只在文档没变时有效：画布改了，确认框就不再显示，
// 确认也不会发出请求（发出去的图一定和导出时的画面一致）。
// 账号会话重置（换 token、登录、退出登录、登录过期）时 accountChanged 被调用（页面把 useAccount 的通知接到这里），
// 待确认的发布与发布前正在导出的产物一并作废；已发出的上传、存草稿照常完成。
import { createStore } from "@/shared/store";

export type SubmitKind = "prepare" | "upload" | "draft";

// 待确认的发布：导出与查重在点击「发布杯贴」时完成，确认态只发请求
export interface PendingUpload {
  blob: Blob;
  hash: string;
  duplicate: boolean; // 与上次成功发布的产物完全相同
  uncertain: boolean; // 这张图有过一次结果未知的发布（可能已经生效），重试前要提醒
  sizeBytes: number;
  // 导出它的编辑文档（内容一变就换新对象，按引用比较）
  doc: unknown;
}

export interface SubmissionState {
  submitting: SubmitKind | null;
  pending: PendingUpload | null;
}

// validPending：仍然有效的待确认发布（导出后文档没变），否则 null
export function validPending(state: SubmissionState, doc: unknown): PendingUpload | null {
  return state.pending && state.pending.doc === doc ? state.pending : null;
}

export type Submission = ReturnType<typeof createSubmission>;

// 结果未知的产物指纹也存在本机：刷新页面后再发同一张图仍会提醒。只留最近的 MAX_MAYBE_PUBLISHED 个
const MAYBE_PUBLISHED_KEY = "heyteago-diy:maybe-published";
const MAX_MAYBE_PUBLISHED = 20;

function loadMaybePublished(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(MAYBE_PUBLISHED_KEY) ?? "[]");
    // 本机存储可能被改过：只认 SHA-1 十六进制指纹
    return Array.isArray(raw) ? raw.filter((h): h is string => typeof h === "string" && /^[0-9a-f]{40}$/.test(h)) : [];
  } catch {
    // 没有 localStorage（服务端渲染、隐私模式）或内容不是 JSON
    return [];
  }
}

function saveMaybePublished(hashes: Set<string>) {
  try {
    localStorage.setItem(MAYBE_PUBLISHED_KEY, JSON.stringify([...hashes]));
  } catch {
    // localStorage 不可用时只在本页记住
  }
}

// createSubmission 返回提交控制器，状态经 getState/subscribe 读取（每次变更都通知）。
// 方法不依赖 this，可以直接作为回调传出去。
// currentDoc() 返回当前的编辑文档，在导出开始与完成、确认发布时取用。
export function createSubmission() {
  const store = createStore<SubmissionState, Partial<SubmissionState>>((s, patch) => ({ ...s, ...patch }), {
    submitting: null,
    pending: null,
  });
  const state = store.getState;
  const set = store.dispatch;
  // 账号会话版本：每次 accountChanged 递增。导出期间版本变了说明产物已过期，不进确认态
  let account = 0;
  let lastHash: string | null = null;
  // 发布结果未知的产物指纹（按记下的先后）：请求可能已到喜茶，再发同一张图可能重复发布；成功发布后移除
  const maybePublished = new Set(loadMaybePublished().slice(-MAX_MAYBE_PUBLISHED));
  const markMaybePublished = (hash: string) => {
    maybePublished.delete(hash);
    maybePublished.add(hash);
    for (const oldest of maybePublished) {
      if (maybePublished.size <= MAX_MAYBE_PUBLISHED) break;
      maybePublished.delete(oldest);
    }
    saveMaybePublished(maybePublished);
  };

  // 单飞：已有提交在途时忽略新的（返回 undefined）；结束时无论成败都释放
  const run = async <T>(kind: SubmitKind, task: () => Promise<T>): Promise<T | undefined> => {
    if (state().submitting) return undefined;
    set({ submitting: kind });
    try {
      return await task();
    } finally {
      set({ submitting: null });
    }
  };

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    // 用户取消确认
    cancel() {
      if (state().pending) set({ pending: null });
    },
    // 账号会话重置：作废待确认的发布与导出中的产物
    accountChanged() {
      account++;
      if (state().pending) set({ pending: null });
    },
    // 发布第一步：导出并查重，进入确认态（不发请求）。
    // 返回 true = 已进入确认态；false = 导出期间画布或账号有改动，产物作废；undefined = 已有提交在途
    requestUpload(exportImage: () => Promise<Blob>, hash: (b: Blob) => Promise<string>, currentDoc: () => unknown) {
      return run("prepare", async () => {
        const doc = currentDoc();
        const accountAtStart = account;
        const blob = await exportImage();
        const h = await hash(blob);
        if (doc !== currentDoc() || accountAtStart !== account) return false;
        set({
          pending: {
            blob,
            hash: h,
            duplicate: h === lastHash,
            uncertain: maybePublished.has(h),
            sizeBytes: blob.size,
            doc,
          },
        });
        return true;
      });
    },
    // 发布第二步：上传待确认的产物；成功后记下指纹供下次查重，失败保留确认态便于重试。
    // 没有有效的待确认发布（已取消、画布改了或换了账号）时不发请求，返回 undefined。
    // isRejected 判定失败是否确定没有发布；否则结果未知，这张图记为可能已发布并标出警告
    confirmUpload<T>(
      upload: (blob: Blob) => Promise<T>,
      isRejected: (err: unknown) => boolean,
      currentDoc: () => unknown,
    ) {
      const pending = validPending(state(), currentDoc());
      if (!pending) return Promise.resolve(undefined);
      return run("upload", async () => {
        try {
          const res = await upload(pending.blob);
          lastHash = pending.hash;
          if (maybePublished.delete(pending.hash)) saveMaybePublished(maybePublished);
          if (state().pending === pending) set({ pending: null });
          return res;
        } catch (err) {
          if (!isRejected(err)) {
            markMaybePublished(pending.hash);
            if (state().pending === pending) set({ pending: { ...pending, uncertain: true } });
          }
          throw err;
        }
      });
    },
    saveDraft<T>(exportImage: () => Promise<Blob>, save: (blob: Blob) => Promise<T>) {
      return run("draft", async () => save(await exportImage()));
    },
  };
}
