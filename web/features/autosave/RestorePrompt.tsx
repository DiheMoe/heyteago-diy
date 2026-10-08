"use client";

interface Props {
  savedAt: number;
  onRestore(): void;
  onDiscard(): void;
}

const SAVED_TIME = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

// 打开页面时找到上次自动保存的编辑：继续编辑或丢弃
export function RestorePrompt({ savedAt, onRestore, onDiscard }: Props) {
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-sm"
    >
      <p className="text-sm text-neutral-800">继续上次的编辑吗？</p>
      <span className="text-xs text-neutral-500">{SAVED_TIME.format(savedAt)} 自动保存</span>
      <div className="ml-auto flex gap-2">
        <button
          type="button"
          onClick={onRestore}
          className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs text-white hover:bg-neutral-700"
        >
          继续编辑
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
        >
          丢弃
        </button>
      </div>
    </div>
  );
}
