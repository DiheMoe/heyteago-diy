"use client";

// 工具栏：移动取景/画笔/橡皮擦、颜色、粗细、撤销。
// 移动工具不涉及笔触，颜色/粗细仅在画笔或橡皮擦时可用。
import type { Tool } from "./PreviewCanvas";

interface Props {
  tool: Tool;
  size: number;
  canUndo: boolean;
  canRedo: boolean;
  // 压感开关（手写笔粗细随压力变化）
  pressureSensitive: boolean;
  // 贴文字面板：当前生效的内容/大小/角度（选中对象优先，否则为新放置默认值）
  textContent: string;
  textSize: number;
  textAngle: number;
  textSelected: boolean;
  onToolChange(tool: Tool): void;
  onSizeChange(size: number): void;
  onUndo(): void;
  onRedo(): void;
  onTogglePressure(v: boolean): void;
  onTextContent(v: string): void;
  onTextSize(v: number): void;
  onTextAngle(v: number): void;
  onDeleteText(): void;
}

export function BrushControls({
  tool,
  size,
  canUndo,
  canRedo,
  pressureSensitive,
  textContent,
  textSize,
  textAngle,
  textSelected,
  onToolChange,
  onSizeChange,
  onUndo,
  onRedo,
  onTogglePressure,
  onTextContent,
  onTextSize,
  onTextAngle,
  onDeleteText,
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
          title="撤销一笔（Ctrl/Cmd+Z）"
          className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50 disabled:opacity-40"
        >
          撤销
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          title="重做一笔（Ctrl/Cmd+Shift+Z）"
          className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50 disabled:opacity-40"
        >
          重做
        </button>
        <label className="flex items-center gap-1 text-xs text-neutral-600">
          <input              type="checkbox"              className="accent-neutral-900"
            checked={pressureSensitive}
            onChange={(e) => onTogglePressure(e.target.checked)}
          />
          压感
        </label>
      </div>
      {tool === "text" && (
        <div className="mt-3 space-y-2 border-t border-neutral-100 pt-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={textContent}
              maxLength={20}
              onChange={(e) => onTextContent(e.target.value)}
              placeholder="输入文字"
              className="w-full min-w-0 flex-1 rounded-lg border border-neutral-300 px-2 py-1.5 text-xs focus:border-neutral-500 focus:outline-none"
            />
            {textSelected && (
              <button
                type="button"
                onClick={onDeleteText}
                className="shrink-0 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50"
              >
                删除
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="w-10 text-xs text-neutral-500">大小</span>
            <input
              type="range"
              min={12}
              max={120}
              value={textSize}
              onChange={(e) => onTextSize(Number(e.target.value))}
              className="flex-1 accent-neutral-900"
            />
            <span className="w-10 text-right font-mono text-xs text-neutral-700">{textSize}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-10 text-xs text-neutral-500">角度</span>
            <input
              type="range"
              min={-180}
              max={180}
              step={5}
              value={textAngle}
              onChange={(e) => onTextAngle(Number(e.target.value))}
              className="flex-1 accent-neutral-900"
            />
            <span className="w-10 text-right font-mono text-xs text-neutral-700">{textAngle}°</span>
          </div>
          <p className="text-xs text-neutral-400">点画布放置文字；点击文字选中后可调整，拖动移动位置</p>
        </div>
      )}
      <p className="mt-2 text-xs text-neutral-400">笔触固定为黑色（审核只放行黑与底色）；「移动」拖动调整取景</p>
    </section>
  );
}
