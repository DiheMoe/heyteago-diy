"use client";

// 图片选择：点击或拖拽导入原图。
import { useRef, useState } from "react";

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

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-neutral-800">原图</h2>
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
        {fileName ? `已选择：${fileName}（点击更换）` : "点击选择或拖拽图片到此处"}
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
    </section>
  );
}
