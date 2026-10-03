// 纯像素运算：只依赖 {data,width,height} 结构，不触碰 DOM，可单测。
// ImageData 本身满足该结构，渲染管线直接传入 ImageData。

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type DotPattern = "circle" | "diamond" | "cross" | "grid";

export function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function luminance(data: Uint8ClampedArray, index: number): number {
  return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  const expanded =
    normalized.length === 3
      ? normalized.split("").map((c) => c + c).join("")
      : normalized;
  const value = Number.parseInt(expanded, 16);
  if (Number.isNaN(value) || normalized.length < 3) {
    return { r: 238, g: 238, b: 238 };
  }
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
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

// 底色替换：半透明像素按 alpha 合成到底色上；r/g/b 均 >= tolerance 的近白像素直接换成底色。
export function applyBackground(img: Pixels, bgHex: string, tolerance = 248): void {
  const { r, g, b } = hexToRgb(bgHex);
  const t = clampByte(Math.round(tolerance));
  const { data } = img;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 255) {
      const a = alpha / 255;
      data[i] = Math.round(data[i] * a + r * (1 - a));
      data[i + 1] = Math.round(data[i + 1] * a + g * (1 - a));
      data[i + 2] = Math.round(data[i + 2] * a + b * (1 - a));
      data[i + 3] = 255;
    } else if (data[i] >= t && data[i + 1] >= t && data[i + 2] >= t) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  }
}

// 颜色量化：把 rgb 通道按 step 取整，用于压缩 PNG 体积。
export function quantizeColors(data: Uint8ClampedArray, step: number): void {
  const divisor = step <= 0 ? 1 : step;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, Math.round(data[i] / divisor) * divisor);
    data[i + 1] = Math.min(255, Math.round(data[i + 1] / divisor) * divisor);
    data[i + 2] = Math.min(255, Math.round(data[i + 2] / divisor) * divisor);
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
