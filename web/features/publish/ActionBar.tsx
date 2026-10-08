"use client";

// 操作区：存为喜茶草稿（主操作，App 内可继续编辑）/ 发布杯贴（次操作，两步确认）/ 下载 PNG。
// 下载只导出本地画布，不需要登录；草稿与发布需要登录。
// 发布会立即生效，确认态在点击「发布杯贴」导出产物后给出；
// 与上次上传完全相同的提示并入确认态，不再单独弹窗打断。
// 发布途中编辑画布会收起确认态，主按钮继续显示「发布中…」，进度提示不丢。
// 发布结果未知（超时、断网、上游异常）时确认态保留并醒目提醒先去小程序确认，重试按钮改为「确认未发布，重新发布」。
import { MAX_UPLOAD_BYTES } from "@/shared/constants";
import type { PendingUpload, SubmitKind } from "@/features/publish/submission";

export interface Status {
  kind: "info" | "error" | "success";
  text: string;
}

export interface ActionBarProps {
  canSubmit: boolean;
  canDownload: boolean;
  signedIn: boolean;
  submitting: SubmitKind | null;
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
  canDownload,
  signedIn,
  submitting,
  status,
  pendingUpload,
  onRequestUpload,
  onConfirmUpload,
  onCancelUpload,
  onSaveDraft,
  onDownload,
}: ActionBarProps) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      {pendingUpload ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          {pendingUpload.uncertain && (
            <p className="mb-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs font-medium text-red-700">
              上次发布这张图时网络异常，结果未知，可能已经生效。请先到喜茶小程序确认，确认没发布成功再重试，否则会重复发布。
            </p>
          )}
          <p className="text-xs font-medium text-amber-900">
            发布会立即生效到你的喜茶账号，日常更推荐「存为喜茶草稿」。
          </p>
          <p className="mt-1 text-xs text-amber-700">
            导出大小 {Math.round(pendingUpload.sizeBytes / 1024)}KB / 上限 {MAX_UPLOAD_BYTES / 1024}KB
          </p>
          {pendingUpload.duplicate && (
            <p className="mt-1 text-xs text-amber-700">注意：这张图片与上次上传的完全相同。</p>
          )}
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={onConfirmUpload}
              disabled={submitting !== null}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm text-white hover:bg-amber-500 disabled:opacity-40"
            >
              {submitting === "upload" ? "发布中…" : pendingUpload.uncertain ? "确认未发布，重新发布" : "确认发布"}
            </button>
            <button
              type="button"
              onClick={onCancelUpload}
              disabled={submitting !== null}
              className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-40"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onSaveDraft}
              disabled={!canSubmit}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-40"
            >
              {submitting === "draft" ? "保存中…" : "存为喜茶草稿"}
            </button>
            <button
              type="button"
              onClick={onRequestUpload}
              disabled={!canSubmit}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-40"
            >
              {submitting === "prepare" ? "准备中…" : submitting === "upload" ? "发布中…" : "发布杯贴"}
            </button>
            <button
              type="button"
              onClick={onDownload}
              disabled={!canDownload}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-40"
            >
              下载 PNG
            </button>
          </div>
          <ul className="mt-2 space-y-0.5 text-xs text-neutral-500">
            <li>存为喜茶草稿：会替换喜茶里现有的草稿，可在小程序里继续编辑</li>
            <li>发布杯贴：立即生效，每天最多发布 10 张（存草稿不计）</li>
            <li>成品要求：黑色 + 喜茶底色，不能大于 200KB</li>
            {!signedIn && <li>登录后可存草稿或发布；下载无需登录</li>}
          </ul>
        </>
      )}
      {status?.kind === "success" ? (
        <div
          role="status"
          className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800"
        >
          <span aria-hidden className="font-bold">
            ✓
          </span>
          <p>{status.text}</p>
        </div>
      ) : (
        status && (
          <p
            role={status.kind === "error" ? "alert" : "status"}
            className={`mt-2 text-xs ${status.kind === "error" ? "text-red-600" : "text-neutral-500"}`}
          >
            {status.text}
          </p>
        )
      )}
    </section>
  );
}
