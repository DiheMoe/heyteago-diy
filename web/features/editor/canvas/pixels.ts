// 纯像素运算：只依赖 {data,width,height} 结构，不触碰 DOM，可单测。
// ImageData 本身满足该结构，渲染管线直接传入 ImageData。

import { BACKGROUND_GRAY } from "@/shared/constants";
import type { DotPattern } from "../model/settings";

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function luminance(data: Uint8ClampedArray, index: number): number {
  return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
}

// 二值化：亮度 >= 阈值的像素变白，其余变黑（alpha 不动）。
export function applyBinaryThreshold(img: Pixels, threshold = 170): void {
  const limit = clampByte(Math.round(threshold));
  const { data } = img;
  for (let i = 0; i < data.length; i += 4) {
    const value = luminance(data, i) >= limit ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = value;
  }
}

// 点阵化：按 blockSize 分块，块内平均亮度映射为白像素数量，
// 按图案顺序点亮，模拟网点印刷效果。亮度低于阈值（过暗）整块涂黑。
export function applyDotMatrix(
  img: Pixels,
  density = 6,
  threshold = 170,
  pattern: DotPattern = "circle",
): void {
  const blockSize = Math.max(2, Math.min(32, Math.round(density)));
  const limit = clampByte(Math.round(threshold));
  const { data, width, height } = img;

  for (let y = 0; y < height; y += blockSize) {
    const blockHeight = Math.min(blockSize, height - y);
    for (let x = 0; x < width; x += blockSize) {
      const blockWidth = Math.min(blockSize, width - x);
      const pixelCount = blockWidth * blockHeight;
      if (!pixelCount) continue;

      let graySum = 0;
      for (let oy = 0; oy < blockHeight; oy++) {
        for (let ox = 0; ox < blockWidth; ox++) {
          graySum += luminance(data, ((y + oy) * width + (x + ox)) * 4);
        }
      }
      const gray = graySum / pixelCount;

      if (255 - gray >= limit) {
        fillBlock(data, width, x, y, blockWidth, blockHeight, 0);
        continue;
      }

      const whitePixels = Math.round(clamp01(gray / 255) * pixelCount);
      const order = dotPatternOrder(blockWidth, blockHeight, pattern);
      for (let i = 0; i < pixelCount; i++) {
        const local = order[i];
        const idx = ((y + Math.floor(local / blockWidth)) * width + (x + (local % blockWidth))) * 4;
        const value = i < whitePixels ? 255 : 0;
        data[idx] = data[idx + 1] = data[idx + 2] = value;
      }
    }
  }
}

function fillBlock(
  data: Uint8ClampedArray,
  width: number,
  startX: number,
  startY: number,
  blockWidth: number,
  blockHeight: number,
  value: number,
): void {
  for (let oy = 0; oy < blockHeight; oy++) {
    for (let ox = 0; ox < blockWidth; ox++) {
      const idx = ((startY + oy) * width + (startX + ox)) * 4;
      data[idx] = data[idx + 1] = data[idx + 2] = value;
    }
  }
}

// 亮度直方图：256 档，每档的像素数
export function luminanceHistogram(img: Pixels): Uint32Array {
  const hist = new Uint32Array(256);
  const { data } = img;
  for (let i = 0; i < data.length; i += 4) hist[clampByte(Math.round(luminance(data, i)))]++;
  return hist;
}

// 大津法：把像素按亮度分成暗（<= t）、亮（> t）两类，取两类间方差最大的 t。
// 多个 t 一样好（两团亮度之间没有像素）时取它们的正中；只有一种亮度、分不出两类时返回 null。
export function otsuThreshold(hist: ArrayLike<number>): number | null {
  let total = 0;
  let sumAll = 0;
  for (let v = 0; v < 256; v++) {
    total += hist[v];
    sumAll += v * hist[v];
  }
  let darkCount = 0;
  let darkSum = 0;
  let best = 0;
  let first = -1;
  let last = -1;
  for (let t = 0; t < 255; t++) {
    darkCount += hist[t];
    darkSum += t * hist[t];
    const lightCount = total - darkCount;
    if (darkCount === 0 || lightCount === 0) continue;
    const diff = darkSum / darkCount - (sumAll - darkSum) / lightCount;
    const between = darkCount * lightCount * diff * diff;
    if (first < 0 || between > best * (1 + 1e-9)) {
      best = between;
      first = last = t;
    } else if (between >= best * (1 - 1e-9)) {
      last = t;
    }
  }
  return first < 0 ? null : (first + last) / 2;
}

// 二值底图上色：白色换成喜茶底色，黑色不变（输入的每个像素都已是 0 或 255）
export function paintBackground(img: Pixels): void {
  const { data } = img;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === 255) data[i] = data[i + 1] = data[i + 2] = BACKGROUND_GRAY;
  }
}

const patternCache = new Map<string, Uint16Array>();

// 块内像素点亮顺序：返回索引序列，靠前的先变白。
function dotPatternOrder(width: number, height: number, pattern: DotPattern): Uint16Array {
  const key = `${pattern}:${width}x${height}`;
  const cached = patternCache.get(key);
  if (cached) return cached;

  const builder =
    pattern === "diamond"
      ? buildDiamond
      : pattern === "cross"
        ? buildCross
        : pattern === "grid"
          ? buildGrid
          : buildCircle;
  const order = builder(width, height);
  patternCache.set(key, order);
  return order;
}

function toOrder(entries: Array<{ index: number }>): Uint16Array {
  const order = new Uint16Array(entries.length);
  entries.forEach((entry, i) => {
    order[i] = entry.index;
  });
  return order;
}

// 圆形网点：离圆心近的先点亮，同距按极角排序。
function buildCircle(width: number, height: number): Uint16Array {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const entries = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      entries.push({ index: y * width + x, dist: dx * dx + dy * dy, angle: Math.atan2(dy, dx) });
    }
  }
  entries.sort((a, b) => (a.dist === b.dist ? a.angle - b.angle : a.dist - b.dist));
  return toOrder(entries);
}

// 菱形网点：曼哈顿距离近的先点亮。
function buildDiamond(width: number, height: number): Uint16Array {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const entries = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      entries.push({
        index: y * width + x,
        priority: Math.abs(x - cx) + Math.abs(y - cy),
        angle: Math.atan2(y - cy, x - cx),
      });
    }
  }
  entries.sort((a, b) => (a.priority === b.priority ? a.angle - b.angle : a.priority - b.priority));
  return toOrder(entries);
}

// 十字网点：切比雪夫距离分层，同层先点轴向（|dx-dy| 大）位置。
function buildCross(width: number, height: number): Uint16Array {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const entries = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      entries.push({ index: y * width + x, radius: Math.max(dx, dy), axisBias: Math.abs(dx - dy) });
    }
  }
  entries.sort((a, b) => (a.radius === b.radius ? b.axisBias - a.axisBias : a.radius - b.radius));
  return toOrder(entries);
}

// 方格网点：切比雪夫距离逐层外扩，同层按极角排序。
function buildGrid(width: number, height: number): Uint16Array {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const entries = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      entries.push({
        index: y * width + x,
        radius: Math.max(Math.abs(x - cx), Math.abs(y - cy)),
        angle: Math.atan2(y - cy, x - cx),
      });
    }
  }
  entries.sort((a, b) => (a.radius === b.radius ? a.angle - b.angle : a.radius - b.radius));
  return toOrder(entries);
}
