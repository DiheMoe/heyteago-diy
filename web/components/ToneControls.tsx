"use client";

// 色调与适配参数。所有改动立即触发重新渲染（并丢弃画笔修改）。
import type { DotPattern } from "@/lib/canvas/pixels";
import type { FitMode, ToneMode } from "@/lib/canvas/render";

export interface ToneSettings {
  toneMode: ToneMode;
  threshold: number;
  density: number;
  pattern: DotPattern;
  fit: FitMode;
  forcePng: boolean;
}

interface Props {
  value: ToneSettings;
  onChange(next: ToneSettings): void;
}

const PATTERNS: Array<{ value: DotPattern; label: string }> = [
  { value: "circle", label: "圆形" },
  { value: "diamond", label: "菱形" },
  { value: "cross", label: "十字" },
  { value: "grid", label: "网格" },
];

export function ToneControls({ value, onChange }: Props) {
  const set = <K extends keyof ToneSettings>(key: K, v: ToneSettings[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-neutral-800">色彩模式</h2>

      <div className="flex gap-2">
        {(
          [
            ["binary", "黑白二值"],
            ["dots", "黑白点阵"],
            ["original", "原图彩色"],
          ] as Array<[ToneMode, string]>
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            onClick={() => set("toneMode", mode)}
            className={`rounded-lg px-3 py-1.5 text-xs ${
              value.toneMode === mode
                ? "bg-neutral-900 text-white"
                : "border border-neutral-300 hover:bg-neutral-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {value.toneMode !== "original" && (
        <Slider
          label={value.toneMode === "binary" ? "黑白阈值" : "点阵暗度阈值"}
          min={value.toneMode === "binary" ? 60 : 40}
          max={220}
          step={5}
          value={value.threshold}
          onChange={(v) => set("threshold", v)}
        />
      )}
      {value.toneMode === "dots" && (
        <>
          <Slider label="点阵密度" min={2} max={24} value={value.density} onChange={(v) => set("density", v)} />
          <div className="mt-3 flex items-center gap-2">
            <span className="w-20 text-xs text-neutral-500">网点形状</span>
            <div className="flex gap-1.5">
              {PATTERNS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => set("pattern", p.value)}
                  className={`rounded-md px-2.5 py-1 text-xs ${
                    value.pattern === p.value
                      ? "bg-neutral-900 text-white"
                      : "border border-neutral-300 hover:bg-neutral-50"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="mt-3 flex items-center gap-2">
        <span className="w-20 text-xs text-neutral-500">适配方式</span>
        <div className="flex gap-1.5">
          {(
            [
              ["cover", "裁剪填满"],
              ["contain", "完整包含"],
            ] as Array<[FitMode, string]>
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => set("fit", mode)}
              className={`rounded-md px-2.5 py-1 text-xs ${
                value.fit === mode
                  ? "bg-neutral-900 text-white"
                  : "border border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <label className="mt-3 flex items-center gap-1.5 text-xs text-neutral-600">
        <input type="checkbox" checked={value.forcePng} onChange={(e) => set("forcePng", e.target.checked)} />
        强制 PNG（压不进 200KB 时报错而不是转 JPEG）
      </label>
    </section>
  );
}

function Slider({ label, min, max, step = 1, value, onChange }: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange(v: number): void;
}) {
  return (
    <div className="mt-3 flex items-center gap-2">
      <span className="w-20 text-xs text-neutral-500">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      <span className="w-8 text-right font-mono text-xs text-neutral-700">{value}</span>
    </div>
  );
}
