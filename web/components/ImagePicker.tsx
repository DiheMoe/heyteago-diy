"use client";

// 图片选择：点击、拖拽或粘贴导入原图；卡片底部工具行承载空白画布与帮助入口。
import { useEffect, useRef, useState } from "react";

interface Props {
  fileName: string | null;
  onPick(file: File): void;
  onError(text: string): void;
}

export function ImagePicker({ fileName, onPick, onError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

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

  return (
    <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="p-4 pb-3">
        <h2 className="mb-2.5 text-sm font-semibold text-neutral-800">原图</h2>
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            accept(e.dataTransfer.files[0]);
          }}
          className={`flex h-24 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed text-xs transition-colors ${
            dragging ? "border-neutral-500 bg-neutral-100" : "border-neutral-300 bg-neutral-50 hover:bg-neutral-100"
          }`}
        >
          {fileName ? `已选择：${fileName}（点击更换）` : "点击选择、拖拽或粘贴（Ctrl+V）图片"}
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
    </section>
  );
}
