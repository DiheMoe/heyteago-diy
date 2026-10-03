"use client";

// 画笔工具栏：画笔/橡皮擦、颜色、粗细、撤销。
import type { Tool } from "./PreviewCanvas";

interface Props {
  tool: Tool;
  color: string;
  size: number;
  canUndo: boolean;
  onToolChange(tool: Tool): void;
  onColorChange(color: string): void;
  onSizeChange(size: number): void;
  onUndo(): void;
}

export function BrushControls({ tool, color, size, canUndo, onToolChange, onColorChange, onSizeChange, onUndo }: Props) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-neutral-800">画笔编辑</h2>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {(
            [
              ["brush", "画笔"],
              ["eraser", "橡皮擦"],
            ] as Array<[Tool, string]>
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => onToolChange(t)}
              className={`rounded-md px-2.5 py-1 text-xs ${
                tool === t ? "bg-neutral-900 text-white" : "border border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="color"
          aria-label="画笔颜色"
          value={color}
          disabled={tool === "eraser"}
          onChange={(e) => onColorChange(e.target.value)}
          className="h-7 w-10 cursor-pointer rounded border border-neutral-300 disabled:opacity-40"
        />
        <input
          type="range"
          min={2}
          max={80}
          value={size}
          onChange={(e) => onSizeChange(Number(e.target.value))}
          className="w-28"
        />
        <span className="w-8 font-mono text-xs text-neutral-700">{size}px</span>
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50 disabled:opacity-40"
        >
          撤销
        </button>
      </div>
      <p className="mt-2 text-xs text-neutral-400">调整左侧参数会重新渲染，并清除画笔修改</p>
    </section>
  );
}
