"use client";

import { useEffect, useState } from "react";
import { Faq } from "@/shared/Faq";
import { Modal } from "@/shared/Modal";
import { useStore } from "@/shared/use-store";
import { TokenPanel } from "@/features/account/TokenPanel";
import { useAccount } from "@/features/account/use-account";
import { RestorePrompt } from "@/features/autosave/RestorePrompt";
import { useAutosave } from "@/features/autosave/use-autosave";
import { useEditorCanvas } from "@/features/editor/canvas/use-editor-canvas";
import {
  canRedo,
  canUndo,
  createEditorStore,
  hasContent,
  hasDrawing,
  strokeSize,
} from "@/features/editor/model/document";
import { BrushControls } from "@/features/editor/ui/BrushControls";
import { FramingControls } from "@/features/editor/ui/FramingControls";
import { ImagePicker } from "@/features/editor/ui/ImagePicker";
import { useShortcuts } from "@/features/editor/ui/shortcuts";
import { useCoarsePointer } from "@/features/editor/ui/use-coarse-pointer";
import { ShortcutsHelp } from "@/features/editor/ui/ShortcutsHelp";
import { ToneControls } from "@/features/editor/ui/ToneControls";
import { Viewport } from "@/features/editor/ui/Viewport";
import { ActionBar, type Status } from "@/features/publish/ActionBar";
import { createSubmission } from "@/features/publish/submission";
import { usePublish } from "@/features/publish/use-publish";

export default function Page() {
  // 编辑器状态的唯一负责人：画布外壳订阅它绘制，发布用它判断待确认的产物是否过期
  const [store] = useState(createEditorStore);
  // 提交（导出查重、发布、存草稿）的状态；换账号时由 useAccount 通知它作废待确认的发布
  const [submission] = useState(createSubmission);
  const [status, setStatus] = useState<Status | null>(null);
  // 常见问题/快捷键默认收起，经原图卡片旁的按钮展开
  const [faqOpen, setFaqOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const reportError = (text: string) => setStatus({ kind: "error", text });

  const canvas = useEditorCanvas(store, reportError);
  const autosave = useAutosave(store, reportError);
  const account = useAccount({ onAccountChange: submission.accountChanged });
  const publish = usePublish({ store, canvas, account, submission, report: setStatus });
  useShortcuts(store, faqOpen || shortcutsOpen);
  const coarse = useCoarsePointer();
  // 触屏默认「浏览」：单指在预览上滑动是滚动页面，选了工具画布才接管触摸
  useEffect(() => {
    if (coarse) store.dispatch({ type: "setTool", tool: "browse" });
  }, [coarse, store]);

  const doc = useStore(store, (s) => s.doc);
  const tool = useStore(store, (s) => s.tool);
  const size = useStore(store, strokeSize);
  const pressure = useStore(store, (s) => s.pressure);
  const lineMode = useStore(store, (s) => s.lineMode);
  const undoable = useStore(store, canUndo);
  const redoable = useStore(store, canRedo);
  const drawn = useStore(store, hasDrawing);
  const content = useStore(store, hasContent);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 lg:py-8">
      <header className="mb-6">
        <h1 className="text-xl font-bold text-neutral-900">喜茶杯贴 DIY</h1>
        <p className="mt-1 text-xs text-neutral-500">把照片或手绘做成喜茶杯贴，存为草稿或发布到你的喜茶账号</p>
      </header>

      {autosave.savedAt !== null && (
        <RestorePrompt savedAt={autosave.savedAt} onRestore={autosave.restore} onDiscard={autosave.discard} />
      )}

      {/* 区块顺序：账号 → 原图 → 预览 → 取景 → 色彩 → 画笔 → 操作。
          预览吸附：桌面端固定在左列并 sticky；移动端排在原图之后、sticky 在顶部（限高避免占满视口） */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="lg:col-start-2">
          <TokenPanel account={account} />
        </div>
        <div className="lg:col-start-2">
          <ImagePicker
            fileName={doc.imageName}
            importing={canvas.importing}
            onPick={canvas.loadImage}
            onError={reportError}
            onBlank={canvas.newBlank}
            confirmBlank={content}
            faqOpen={faqOpen}
            shortcutsOpen={shortcutsOpen}
            onToggleFaq={() => setFaqOpen((v) => !v)}
            onToggleShortcuts={() => setShortcutsOpen((v) => !v)}
          />
        </div>
        <div className="sticky top-2 z-10 lg:col-start-1 lg:row-span-7 lg:row-start-1 lg:self-start lg:top-4">
          <Viewport store={store} canvas={canvas} />
        </div>
        <div className="lg:col-start-2">
          <FramingControls
            view={doc.view}
            hasImage={doc.image !== null}
            hasDrawing={drawn}
            onFit={(fit) => store.dispatch({ type: "setFit", fit })}
            onRotate={() => store.dispatch({ type: "rotateView" })}
          />
        </div>
        <div className="lg:col-start-2">
          <ToneControls value={doc.tone} onChange={(tone, key) => store.dispatch({ type: "setTone", tone, key })} />
        </div>
        <div className="lg:col-start-2">
          <BrushControls
            tool={tool}
            size={size}
            canUndo={undoable}
            canRedo={redoable}
            pressureSensitive={pressure}
            lineMode={lineMode}
            // 触屏上再点一次已选的工具回到浏览
            onToolChange={(next) =>
              store.dispatch({ type: "setTool", tool: coarse && next === tool ? "browse" : next })
            }
            onSizeChange={(v) => store.dispatch({ type: "setStrokeSize", size: v })}
            onUndo={() => store.dispatch({ type: "undo" })}
            onRedo={() => store.dispatch({ type: "redo" })}
            onTogglePressure={(on) => store.dispatch({ type: "setPressure", on })}
            onToggleLineMode={(on) => store.dispatch({ type: "setLineMode", on })}
          />
        </div>
        <div className="lg:col-start-2">
          <ActionBar {...publish} status={status} />
        </div>
        {shortcutsOpen && (
          <Modal title="快捷键与手势" onClose={() => setShortcutsOpen(false)}>
            <ShortcutsHelp />
          </Modal>
        )}
        {faqOpen && (
          <Modal title="常见问题" onClose={() => setFaqOpen(false)}>
            <Faq />
          </Modal>
        )}
      </div>

      <footer className="mt-10 text-center text-xs text-neutral-500">
        仅供学习测试使用 · 开源地址{" "}
        <a
          href="https://github.com/DiheMoe/heyteago-diy"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-dotted hover:text-neutral-600"
        >
          DiheMoe/heyteago-diy
        </a>{" "}
        · 接口思路参考{" "}
        <a
          href="https://github.com/FuQuan233/HeyTea_AutoUpload"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-dotted hover:text-neutral-600"
        >
          FuQuan233/HeyTea_AutoUpload
        </a>
      </footer>
    </main>
  );
}
