"use client";

// 工具栏：移动取景/画笔/橡皮擦/文字、粗细、撤销重做。
// 移动工具不涉及笔触，粗细仅在画笔或橡皮擦时可用；笔触固定为黑色（审核约束）。
import type { Tool } from "../model/document";

interface Props {
  tool: Tool;
  size: number;
  canUndo: boolean;
  canRedo: boolean;
  // 压感开关（手写笔粗细随压力变化）
  pressureSensitive: boolean;
  // 直线模式：每次点按从上一笔终点连直线
  lineMode: boolean;
  onToolChange(tool: Tool): void;
  onSizeChange(size: number): void;
  onUndo(): void;
  onRedo(): void;
  onTogglePressure(v: boolean): void;
  onToggleLineMode(v: boolean): void;
}

export function BrushControls({
  tool,
  size,
  canUndo,
  canRedo,
  pressureSensitive,
  lineMode,
  onToolChange,
  onSizeChange,
  onUndo,
  onRedo,
  onTogglePressure,
  onToggleLineMode,
}: Props) {
  const strokeTool = tool === "brush" || tool === "eraser";
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-neutral-800">画笔编辑</h2>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {(
            [
              ["move", "移动"],
              ["brush", "画笔"],
              ["eraser", "橡皮擦"],
              ["text", "文字"],
            ] as Array<[Tool, string]>
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => onToolChange(t)}
              aria-pressed={tool === t}
              className={`rounded-md px-2.5 py-1 text-xs ${
                tool === t ? "bg-neutral-900 text-white" : "border border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="range"
          aria-label="笔触粗细"
          min={2}
          max={80}
          value={size}
          disabled={!strokeTool}
          onChange={(e) => onSizeChange(Number(e.target.value))}
          className="w-28 accent-neutral-900 disabled:opacity-40"
        />
        <span className="w-8 font-mono text-xs text-neutral-700">{size}px</span>
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          title="撤销一步（Ctrl/Cmd+Z）"
          className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50 disabled:opacity-40"
        >
          撤销
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          title="重做一步（Ctrl/Cmd+Shift+Z）"
          className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50 disabled:opacity-40"
        >
          重做
        </button>
        <label className="flex items-center gap-1 text-xs text-neutral-600">
          <input
            type="checkbox"
            className="accent-neutral-900"
            checked={pressureSensitive}
            onChange={(e) => onTogglePressure(e.target.checked)}
          />
          压感
        </label>
        <label
          className="flex items-center gap-1 text-xs text-neutral-600"
          title="每次点按都从上一笔终点连一条直线（同 Shift+点击）"
        >
          <input
            type="checkbox"
            className="accent-neutral-900"
            checked={lineMode}
            onChange={(e) => onToggleLineMode(e.target.checked)}
          />
          直线
        </label>
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        笔触固定为黑色；橡皮擦不影响文字。「文字」点画布输入，拖四角缩放、拖上方圆点旋转、Del 删除
      </p>
    </section>
  );
}
