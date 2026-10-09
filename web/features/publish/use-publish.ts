// 发布接线：操作区的点击交给提交控制器，并给出状态文案。
// 规则在 submission.ts（单飞、待确认发布的有效性、结果未知）与 action-availability.ts（按钮可用性）；
// 被单飞挡下的重复提交返回 undefined，不给提示。
import { useRef } from "react";
import { isRequestRejected, isSessionExpired, saveDraft, uploadSticker } from "@/shared/api";
import { CUP_HEIGHT, CUP_WIDTH } from "@/shared/constants";
import { errorText } from "@/shared/errors";
import { useStore } from "@/shared/use-store";
import type { Account } from "@/features/account/use-account";
import type { EditorCanvas } from "@/features/editor/canvas/use-editor-canvas";
import type { EditorDoc, EditorStore } from "@/features/editor/model/document";
import { actionAvailability } from "./action-availability";
import type { ActionBarProps, Status } from "./ActionBar";
import { downloadBlob, stickerFileName, useCanShareImages } from "./download";
import { sha1Hex } from "./dup-guard";
import { validPending, type Submission } from "./submission";

interface Options {
  store: EditorStore;
  canvas: EditorCanvas;
  account: Account;
  submission: Submission;
  // 写入页面的状态行
  report(status: Status): void;
}

// 返回操作区除状态行以外的全部属性
export function usePublish({ store, canvas, account, submission, report }: Options): Omit<ActionBarProps, "status"> {
  const state = useStore(submission, (s) => s);
  const doc = useStore(store, (s) => s.doc);
  const shareSupported = useCanShareImages();
  // 最近一次为分享导出的成品，画布没变时直接复用
  const shared = useRef<{ doc: EditorDoc; file: File } | null>(null);
  const { token, user } = account;
  const currentDoc = () => store.getState().doc;
  const reportError = (text: string) => report({ kind: "error", text });
  // 喜茶判定登录态失效：退出登录（账号卡片同时提示重新登录）
  const reportFailure = (err: unknown, otherwise: string) => {
    if (!isSessionExpired(err)) return reportError(otherwise);
    account.expire();
    reportError("登录已过期，请重新登录后再试");
  };

  // 直接上传第一步：导出并查重，进入确认态（不发请求）
  const requestUpload = async () => {
    try {
      const entered = await submission.requestUpload(() => canvas.exportImage(), sha1Hex, currentDoc);
      if (entered === false) report({ kind: "info", text: "导出期间画布或账号有改动，请重新点击「发布杯贴」" });
    } catch (err) {
      reportError(errorText(err));
    }
  };

  // 直接上传第二步：确认后发出请求
  const confirmUpload = async () => {
    // 发布按钮只在已确认用户时可用，这里只为收窄类型
    if (!user) return;
    const opts = { token, userMainId: user.user_main_id, width: CUP_WIDTH, height: CUP_HEIGHT };
    try {
      const res = await submission.confirmUpload((blob) => uploadSticker(blob, opts), isRequestRejected, currentDoc);
      if (res) report({ kind: "success", text: `${res.message || "发布成功"}，去喜茶小程序查看吧` });
    } catch (err) {
      // 明确被拒的照常提示；其余失败请求可能已到喜茶，提醒先去确认，避免重试重复发布
      reportFailure(
        err,
        isRequestRejected(err)
          ? errorText(err)
          : `发布结果未知（${errorText(err)}）：可能已经发布成功，请先到喜茶小程序确认`,
      );
    }
  };

  const saveAsDraft = async () => {
    try {
      const res = await submission.saveDraft(() => canvas.exportImage(), (blob) => saveDraft(blob, token));
      if (res) report({ kind: "success", text: `${res.message || "草稿保存成功"}，可在喜茶小程序的画布里继续编辑` });
    } catch (err) {
      reportFailure(err, errorText(err));
    }
  };

  // 本地下载、分享不受上传大小上限约束
  const download = async () => {
    try {
      downloadBlob(await canvas.exportImage(Infinity), stickerFileName(new Date()));
    } catch (err) {
      reportError(errorText(err));
    }
  };

  // 系统分享（手机上可存到相册）。浏览器要求分享紧跟点击，导出耗时过长被拒时，
  // 导出结果留着，再点一次就能立即分享
  const share = async () => {
    const at = currentDoc();
    try {
      let file = shared.current?.doc === at ? shared.current.file : null;
      if (!file) {
        file = new File([await canvas.exportImage(Infinity)], stickerFileName(new Date()), { type: "image/png" });
        shared.current = { doc: at, file };
      }
      await navigator.share({ files: [file] });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return; // 用户关掉了分享面板
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        report({ kind: "info", text: "浏览器要求点击后立即分享，请再点一次「分享 / 存到相册」" });
        return;
      }
      reportError(errorText(err));
    }
  };

  const signedIn = user !== null;
  const actions = actionAvailability({
    ready: canvas.ready,
    submitting: state.submitting !== null,
    signedIn,
  });
  return {
    canSubmit: actions.submit,
    canDownload: actions.download,
    canShare: shareSupported,
    signedIn,
    submitting: state.submitting,
    pendingUpload: validPending(state, doc),
    onRequestUpload: requestUpload,
    onConfirmUpload: confirmUpload,
    onCancelUpload: submission.cancel,
    onSaveDraft: saveAsDraft,
    onDownload: download,
    onShare: share,
  };
}
