"use client";

// 弹窗：原生模态 <dialog>——打开时焦点进入、页面其余部分不可操作（Tab 出不去），
// Esc、点背板、点关闭都走原生 close，关闭后浏览器把焦点还给打开前的元素。内容超高可滚动。
import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  title: string;
  // 弹窗关闭后调用（由父组件卸载弹窗）
  onClose(): void;
  children: ReactNode;
}

export function Modal({ title, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    ref.current!.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      // 点到弹窗框外（背板）关闭：背板上的点击落在 dialog 元素本身
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
      className="m-auto max-h-[80vh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-xl bg-white p-4 shadow-xl backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    >
      <div className="mb-3 flex items-center">
        <h2 className="text-sm font-semibold text-neutral-800">{title}</h2>
        <button
          type="button"
          onClick={() => ref.current!.close()}
          aria-label="关闭"
          className="ml-auto rounded-md px-2 py-0.5 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
        >
          ✕
        </button>
      </div>
      {children}
    </dialog>
  );
}
