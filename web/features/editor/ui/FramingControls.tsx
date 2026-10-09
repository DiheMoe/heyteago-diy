"use client";

// 取景：原图怎样放进杯贴画布。适配方式可以在选原图之前选好；旋转需要原图。
// 取景只动底图，笔画和文字在各自的图层上，不跟着移动。
import type { FitMode, View } from "../model/settings";

interface Props {
  view: View;
  hasImage: boolean;
  // 画布上有笔画或文字
  hasDrawing: boolean;
  onFit(fit: FitMode): void;
  // 顺时针旋转 90°
  onRotate(): void;
}

const FITS: Array<[FitMode, string]> = [
  ["cover", "裁剪填满"],
  ["contain", "完整包含"],
];

export function FramingControls({ view, hasImage, hasDrawing, onFit, onRotate }: Props) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-neutral-800">取景</h2>

      <div className="flex items-center gap-2">
        <span className="w-20 text-xs text-neutral-500">适配方式</span>
        <div className="flex items-center gap-1.5">
          {FITS.map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => onFit(mode)}
              aria-pressed={view.fit === mode}
              className={`rounded-md px-2.5 py-1 text-xs ${
                view.fit === mode ? "bg-neutral-900 text-white" : "border border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={onRotate}
            disabled={!hasImage}
            title="顺时针旋转 90°"
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50 disabled:opacity-40"
          >
            旋转
          </button>
          {/* 当前角度放在按钮外的定宽位置：按钮宽度不随角度变化 */}
          <span className="w-9 text-xs tabular-nums text-neutral-500">{view.rotate > 0 ? `${view.rotate}°` : ""}</span>
        </div>
      </div>

      <p className="mt-3 text-xs text-neutral-500">调整位置：选「移动」工具后拖动预览。</p>
      {hasDrawing && <p className="mt-1 text-xs text-neutral-500">画笔和文字固定在画布上，不随原图移动</p>}
    </section>
  );
}
