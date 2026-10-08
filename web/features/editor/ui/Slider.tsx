"use client";

import { useId, useRef } from "react";

interface Props {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  // 数值的显示文本
  format?(value: number): string;
  // 滑块左右两端的含义
  ends?: [string, string];
  disabled?: boolean;
  // key 标识一次调节（拖动一次、点一下轨道、按一次方向键），同一次调节的改动共用同一个 key
  onChange(value: number, key: symbol): void;
}

// 带标签和数值显示的滑块
export function Slider({ label, min, max, step = 1, value, format = String, ends, disabled = false, onChange }: Props) {
  const id = useId();
  // 当前这次调节的 key。浏览器在一次调节结束（松开、按完键）时触发原生 change 事件，
  // React 的 onChange 对应的是 input 事件，所以单独监听 change 来结束这次调节。
  const adjustment = useRef<symbol | null>(null);
  const listenAdjustmentEnd = (input: HTMLInputElement | null) => {
    if (!input) return;
    const end = () => {
      adjustment.current = null;
    };
    input.addEventListener("change", end);
    return () => input.removeEventListener("change", end);
  };

  return (
    <div className="mt-3 flex items-center gap-2">
      <label htmlFor={id} className="w-20 text-xs text-neutral-500">
        {label}
      </label>
      <div className="flex flex-1 flex-col">
        <input
          id={id}
          ref={listenAdjustmentEnd}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value), (adjustment.current ??= Symbol(label)))}
          className="accent-neutral-900 disabled:opacity-40"
        />
        {ends && (
          <div aria-hidden className="flex justify-between text-[11px] leading-none text-neutral-500">
            <span>{ends[0]}</span>
            <span>{ends[1]}</span>
          </div>
        )}
      </div>
      <span className="w-10 text-right font-mono text-xs text-neutral-700">{format(value)}</span>
    </div>
  );
}
