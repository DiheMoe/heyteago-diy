"use client";

// 色调参数；改动后立即重绘底图，笔画和文字不受影响。
import { BINARY_THRESHOLD, type DotPattern, type ToneMode, type ToneSettings } from "../model/settings";
import { Slider } from "./Slider";

interface Props {
  value: ToneSettings;
  // 滑块的改动带 key（见 Slider）；按钮的改动不带
  onChange(next: ToneSettings, key?: symbol): void;
}

const PATTERNS: Array<{ value: DotPattern; label: string }> = [
  { value: "circle", label: "圆形" },
  { value: "diamond", label: "菱形" },
  { value: "cross", label: "十字" },
  { value: "grid", label: "网格" },
];

export function ToneControls({ value, onChange }: Props) {
  const set = <K extends keyof ToneSettings>(field: K, v: ToneSettings[K], key?: symbol) =>
    onChange({ ...value, [field]: v }, key);

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-neutral-800">色彩模式</h2>

      <div className="flex gap-2">
        {(
          [
            ["binary", "黑白二值"],
            ["dots", "黑白点阵"],
          ] as Array<[ToneMode, string]>
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            onClick={() => set("toneMode", mode)}
            aria-pressed={value.toneMode === mode}
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

      {/* 两种模式都是往右更黑：二值化时阈值越高越黑；点阵时阈值越高、整块涂黑的越少，滑块反着映射 */}
      <Slider
        label="明暗分界"
        min={value.toneMode === "binary" ? BINARY_THRESHOLD.min : 40}
        max={BINARY_THRESHOLD.max}
        step={BINARY_THRESHOLD.step}
        value={value.toneMode === "binary" ? value.threshold : 260 - value.threshold}
        ends={["更白", "更黑"]}
        onChange={(v, key) => set("threshold", value.toneMode === "binary" ? v : 260 - v, key)}
      />
      {value.toneMode === "dots" && (
        <>
          <Slider
            label="网点大小"
            min={2}
            max={24}
            value={value.density}
            ends={["更细", "更粗"]}
            onChange={(v, key) => set("density", v, key)}
          />
          <div className="mt-3 flex items-center gap-2">
            <span className="w-20 text-xs text-neutral-500">网点形状</span>
            <div className="flex gap-1.5">
              {PATTERNS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => set("pattern", p.value)}
                  aria-pressed={value.pattern === p.value}
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

    </section>
  );
}
