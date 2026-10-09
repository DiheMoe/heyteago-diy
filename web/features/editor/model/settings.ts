// 底图的输入：原图、色调参数与取景，决定底图怎么画，都是纯数据。
import { CUP_HEIGHT, CUP_WIDTH } from "@/shared/constants";

// 成品只能是黑色加喜茶底色，所以只有两种二值化方式
export type ToneMode = "binary" | "dots";
export type FitMode = "contain" | "cover";
export type DotPattern = "circle" | "diamond" | "cross" | "grid";

export interface ToneSettings {
  toneMode: ToneMode;
  threshold: number;
  density: number;
  pattern: DotPattern;
}

// 黑白二值的明暗分界滑块：范围与步长。导入时自动选出的分界也对齐到这里
export const BINARY_THRESHOLD = { min: 60, max: 220, step: 5 } as const;

export function snapBinaryThreshold(value: number): number {
  const { min, max, step } = BINARY_THRESHOLD;
  return Math.min(max, Math.max(min, Math.round(value / step) * step));
}

// 取景：fit 决定原图怎样放进画布；rotate 为顺时针角度（90° 步进）；
// offsetX/offsetY 为画布坐标系的位移，钳制在 offsetBounds 内
export interface View {
  fit: FitMode;
  rotate: number;
  offsetX: number;
  offsetY: number;
}

// 底图的全部输入。撤销/重做按整份快照还原
export interface BaseSettings {
  image: HTMLImageElement | null;
  imageName: string | null;
  tone: ToneSettings;
  view: View;
}

const sameFields = <T extends object>(a: T, b: T) => (Object.keys(a) as Array<keyof T>).every((k) => a[k] === b[k]);

export const sameSettings = (a: BaseSettings, b: BaseSettings): boolean =>
  a.image === b.image && a.imageName === b.imageName && sameFields(a.tone, b.tone) && sameFields(a.view, b.view);

// rotatedSize 返回旋转后图像的逻辑尺寸（90/270 时宽高互换）。
export function rotatedSize(image: { width: number; height: number }, rotate: number): { w: number; h: number } {
  return rotate % 180 !== 0 ? { w: image.height, h: image.width } : { w: image.width, h: image.height };
}

// drawScale 是原图画到画布上的缩放：按 fit 放进 596×832（cover 填满、contain 完整显示）
export function drawScale(image: { width: number; height: number }, view: View): number {
  const { w, h } = rotatedSize(image, view.rotate);
  return view.fit === "cover" ? Math.max(CUP_WIDTH / w, CUP_HEIGHT / h) : Math.min(CUP_WIDTH / w, CUP_HEIGHT / h);
}

// offsetBounds 是取景位移的合法范围：原图比画布大的方向平移不留白边（不超过溢出量一半），
// 比画布小的方向不推出画布。
export function offsetBounds(image: { width: number; height: number }, view: View): { maxX: number; maxY: number } {
  const { w, h } = rotatedSize(image, view.rotate);
  const scale = drawScale(image, view);
  return {
    maxX: Math.abs((w * scale - CUP_WIDTH) / 2),
    maxY: Math.abs((h * scale - CUP_HEIGHT) / 2),
  };
}
