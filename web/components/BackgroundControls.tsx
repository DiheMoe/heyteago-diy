"use client";

// 喜茶官方画布底色替换：近白与透明像素换成 #EEEEEE，杯贴观感与官方一致。
export interface BackgroundSettings {
  enabled: boolean;
  color: string;
  tolerance: number;
}

interface Props {
  value: BackgroundSettings;
  onChange(next: BackgroundSettings): void;
}

export function BackgroundControls({ value, onChange }: Props) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-neutral-800">底色</h2>
      <label className="flex items-center gap-1.5 text-xs text-neutral-700">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
        />
        替换近白/透明区域为喜茶底色
      </label>
      {value.enabled && (
        <>
          <div className="mt-3 flex items-center gap-2">
            <span className="w-20 text-xs text-neutral-500">底色</span>
            <input
              type="color"
              aria-label="底色"
              value={value.color}
              onChange={(e) => onChange({ ...value, color: e.target.value.toUpperCase() })}
              className="h-7 w-10 cursor-pointer rounded border border-neutral-300"
            />
            <span className="font-mono text-xs text-neutral-600">{value.color}</span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="w-20 text-xs text-neutral-500">近白阈值</span>
            <input
              type="range"
              min={230}
              max={255}
              value={value.tolerance}
              onChange={(e) => onChange({ ...value, tolerance: Number(e.target.value) })}
              className="flex-1"
            />
            <span className="w-8 text-right font-mono text-xs text-neutral-700">{value.tolerance}</span>
          </div>
          <p className="mt-2 text-xs text-neutral-400">r/g/b 均 ≥ 阈值的像素会被当作白色替换</p>
        </>
      )}
    </section>
  );
}
