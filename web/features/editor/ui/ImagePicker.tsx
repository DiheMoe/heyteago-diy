"use client";

// 图片选择：点击、拖拽（拖到页面任何位置）或粘贴导入原图；卡片底部工具行承载空白画布与帮助入口。
import { useEffect, useRef, useState } from "react";

interface Props {
  fileName: string | null;
  // 正在读取导入的图片
  importing: boolean;
  onPick(file: File): void;
  onError(text: string): void;
  onBlank(): void;
  // 新建空白画布会清掉画布上的内容，先确认
  confirmBlank: boolean;
  faqOpen: boolean;
  shortcutsOpen: boolean;
  onToggleFaq(): void;
  onToggleShortcuts(): void;
}

export function ImagePicker({
  fileName,
  importing,
  onPick,
  onError,
  onBlank,
  confirmBlank,
  faqOpen,
  shortcutsOpen,
  onToggleFaq,
  onToggleShortcuts,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const accept = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onError("请选择图片文件");
      return;
    }
    onPick(file);
  };

  // 全局粘贴导入（截图场景）；文本输入框内的粘贴不拦截（如粘贴 token）
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (file) accept(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  // 文件拖到页面任何位置都按选图处理；不拦的话浏览器会直接打开文件、离开页面
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(false);
      accept(e.dataTransfer?.files[0]);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  });

  const utilBtn = "rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700";
  const utilBtnActive = "rounded-md px-2 py-1 text-xs text-neutral-800 bg-neutral-100";

  return (
    <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="p-4 pb-3">
        <h2 className="mb-2.5 text-sm font-semibold text-neutral-800">原图</h2>
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            inputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          className={`flex h-14 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed text-xs transition-colors ${
            dragging ? "border-neutral-500 bg-neutral-100" : "border-neutral-300 bg-neutral-50 hover:bg-neutral-100"
          }`}
        >
          {importing ? "读取中…" : fileName ? `已选择：${fileName}（点击更换）` : "点击选择、拖拽或粘贴图片"}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            accept(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      <div className="flex items-center border-t border-neutral-100 px-2 py-1">
        {confirming ? (
          <div className="flex items-center gap-1.5 px-2 text-xs">
            <span className="text-neutral-700">清空当前画布？</span>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onBlank();
              }}
              className="rounded-md bg-red-600 px-2 py-1 text-white hover:bg-red-500"
            >
              清空
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-50"
            >
              取消
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => (confirmBlank ? setConfirming(true) : onBlank())} className={utilBtn}>
            新建空白画布
          </button>
        )}
        <div className="ml-auto flex items-center">
          <button type="button" onClick={onToggleFaq} className={faqOpen ? utilBtnActive : utilBtn}>
            常见问题
          </button>
          <button type="button" onClick={onToggleShortcuts} className={shortcutsOpen ? utilBtnActive : utilBtn}>
            快捷键
          </button>
        </div>
      </div>
    </section>
  );
}
