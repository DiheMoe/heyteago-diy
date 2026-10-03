"use client";

// 操作区：存为草稿（主操作，App 内可继续编辑）/ 上传杯贴（次操作，两步确认）/ 下载 PNG。
// 直接上传立即生效，确认态在点击「上传杯贴」导出产物后给出；
// 与上次上传完全相同的提示并入确认态，不再单独弹窗打断。
export interface Status {
  kind: "info" | "error" | "success";
  text: string;
}

export interface PendingUpload {
  duplicate: boolean;
}

interface Props {
  canSubmit: boolean;
  busy: "render" | "upload" | "draft" | null;
  status: Status | null;
  pendingUpload: PendingUpload | null;
  onRequestUpload(): void;
  onConfirmUpload(): void;
  onCancelUpload(): void;
  onSaveDraft(): void;
  onDownload(): void;
}

export function ActionBar({
  canSubmit,
  busy,
  status,
  pendingUpload,
  onRequestUpload,
  onConfirmUpload,
  onCancelUpload,
  onSaveDraft,
  onDownload,
}: Props) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      {pendingUpload ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-900">
            直接上传会立即发布到你的喜茶账号，日常更推荐「存为草稿」。
          </p>
          {pendingUpload.duplicate && (
            <p className="mt-1 text-xs text-amber-700">注意：这张图片与上次上传的完全相同。</p>
          )}
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={onConfirmUpload}
              disabled={busy !== null}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm text-white hover:bg-amber-500 disabled:opacity-40"
            >
              {busy === "upload" ? "上传中…" : "确认直接上传"}
            </button>
            <button
              type="button"
              onClick={onCancelUpload}
              disabled={busy !== null}
              className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-40"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={!canSubmit || busy !== null}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            {busy === "draft" ? "保存中…" : "存为草稿"}
          </button>
          <button
            type="button"
            onClick={onRequestUpload}
            disabled={!canSubmit || busy !== null}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-40"
          >
            {busy === "upload" ? "准备中…" : "上传杯贴"}
          </button>
          <button
            type="button"
            onClick={onDownload}
            disabled={!canSubmit || busy !== null}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-40"
          >
            下载 PNG
          </button>
        </div>
      )}
      {busy === "render" && <p className="mt-2 text-xs text-neutral-400">渲染中…</p>}
      {status && (
        <p
          className={`mt-2 text-xs ${
            status.kind === "error"
              ? "text-red-600"
              : status.kind === "success"
                ? "text-emerald-600"
                : "text-neutral-500"
          }`}
        >
          {status.text}
        </p>
      )}
    </section>
  );
}
