// 渲染管线（浏览器侧）：原图 → 画布适配 → 色调处理 → 底色合成 → 压缩导出。
import {
  applyBackground,
  applyBinaryThreshold,
  applyDotMatrix,
  quantizeColors,
  type DotPattern,
} from "./pixels";
import { CUP_HEIGHT, CUP_WIDTH, MAX_UPLOAD_BYTES } from "./constants";

export type ToneMode = "binary" | "dots" | "original";
export type FitMode = "contain" | "cover";

export interface RenderOptions {
  toneMode: ToneMode;
  threshold: number;
  density: number;
  pattern: DotPattern;
  fit: FitMode;
  // null = 关闭底色替换
  background: string | null;
  whiteTolerance: number;
  // true = 只允许 PNG（量化阶梯压不进上限就报错），false = PNG 之后可退 JPEG
  forcePng: boolean;
  // 取景：rotate 为顺时针角度（90° 步进）；offsetX/offsetY 为画布坐标系的位移
  rotate: number;
  offsetX: number;
  offsetY: number;
}

// rotatedSize 返回旋转后图像的逻辑尺寸（90/270 时宽高互换）。
function rotatedSize(image: HTMLImageElement, rotate: number): { w: number; h: number } {
  return rotate % 180 !== 0
    ? { w: image.height, h: image.width }
    : { w: image.width, h: image.height };
}

// offsetBounds 是取景位移的合法范围：cover 平移不留白边（不超过溢出量一半），
// contain 图像不推出画布。
export function offsetBounds(image: HTMLImageElement, fit: FitMode, rotate: number): { maxX: number; maxY: number } {
  const { w, h } = rotatedSize(image, rotate);
  const scale =
    fit === "cover" ? Math.max(CUP_WIDTH / w, CUP_HEIGHT / h) : Math.min(CUP_WIDTH / w, CUP_HEIGHT / h);
  return {
    maxX: Math.abs((w * scale - CUP_WIDTH) / 2),
    maxY: Math.abs((h * scale - CUP_HEIGHT) / 2),
  };
}

export function readFileAsImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("图片加载失败"));
      image.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error("无法读取图片"));
    reader.readAsDataURL(file);
  });
}

// 把原图按当前设置渲染到 596×832 画布并导出压缩后的 Blob。
// 取景变换顺序：平移到（中心+offset）→ 旋转 → 按旋转后的逻辑尺寸缩放绘制。
// 返回的 Blob 同时作为预览与画笔编辑的基底。
export async function renderSticker(
  image: HTMLImageElement,
  options: RenderOptions,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = CUP_WIDTH;
  canvas.height = CUP_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器不支持 Canvas");

  const { w, h } = rotatedSize(image, options.rotate);
  const scale =
    options.fit === "cover" ? Math.max(CUP_WIDTH / w, CUP_HEIGHT / h) : Math.min(CUP_WIDTH / w, CUP_HEIGHT / h);
  ctx.save();
  ctx.translate(CUP_WIDTH / 2 + options.offsetX, CUP_HEIGHT / 2 + options.offsetY);
  ctx.rotate((options.rotate * Math.PI) / 180);
  ctx.drawImage(
    image,
    (-image.width * scale) / 2,
    (-image.height * scale) / 2,
    image.width * scale,
    image.height * scale,
  );
  ctx.restore();

  const imageData = ctx.getImageData(0, 0, CUP_WIDTH, CUP_HEIGHT);
  if (options.toneMode === "binary") {
    applyBinaryThreshold(imageData, options.threshold);
  } else if (options.toneMode === "dots") {
    applyDotMatrix(imageData, options.density, options.threshold, options.pattern);
  }
  if (options.background) {
    applyBackground(imageData, options.background, options.whiteTolerance);
  }
  ctx.putImageData(imageData, 0, 0);

  return compressPngFirst(ctx, imageData, MAX_UPLOAD_BYTES, options.forcePng);
}

// 分层画布：base=渲染基底，erase=擦除掩码（alpha 即形状），ink=画笔笔迹。
export interface LayeredCanvas {
  base: HTMLCanvasElement;
  erase: HTMLCanvasElement;
  ink: HTMLCanvasElement;
}

// 画笔编辑后的分层画布导出：不做量化（避免破坏笔触）。
// 合成：先单独抠出基底（base 减擦除掩码），再盖到底色上、最后叠笔触——
// 掩码只抠基底，不能抠穿底色（否则擦除区在导出里是透明而不是底色）。
// forcePng 是用户对输出格式的选择：PNG 超过 maxBytes 时报错而不是静默退 JPEG。
// maxBytes 默认对齐上传上限；本地下载传 Infinity（不受上传约束，始终导出 PNG）。
export async function exportEditedCanvas(
  layers: LayeredCanvas,
  background: string | null,
  forcePng: boolean,
  maxBytes = MAX_UPLOAD_BYTES,
): Promise<Blob> {
  const w = layers.base.width;
  const h = layers.base.height;

  const cut = document.createElement("canvas");
  cut.width = w;
  cut.height = h;
  const cutCtx = cut.getContext("2d");
  if (!cutCtx) throw new Error("当前浏览器不支持 Canvas");
  cutCtx.drawImage(layers.base, 0, 0);
  cutCtx.globalCompositeOperation = "destination-out";
  cutCtx.drawImage(layers.erase, 0, 0);

  const composited = document.createElement("canvas");
  composited.width = w;
  composited.height = h;
  const ctx = composited.getContext("2d");
  if (!ctx) throw new Error("当前浏览器不支持 Canvas");
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(cut, 0, 0);
  ctx.drawImage(layers.ink, 0, 0);

  const png = await canvasToBlob(composited, "image/png");
  if (png && png.size <= maxBytes) return png;
  if (forcePng) {
    throw new Error(`编辑后 PNG 超过 ${Math.round(maxBytes / 1024)}KB 上限，请减少画笔修改或简化原图`);
  }
  for (let quality = 0.95; quality >= 0.3; quality -= 0.05) {
    const blob = await canvasToBlob(composited, "image/jpeg", quality);
    if (blob && blob.size <= maxBytes) return blob;
  }
  if (png) return png;
  throw new Error("无法导出图片");
}

// PNG 量化阶梯（步进 0→192）压不进上限时，forcePng 报错，否则恢复像素退 JPEG 阶梯。
async function compressPngFirst(
  ctx: CanvasRenderingContext2D,
  base: ImageData,
  maxBytes: number,
  forcePng: boolean,
): Promise<Blob> {
  const quantizeSteps = [0, 8, 16, 24, 32, 40, 48, 64, 80, 96, 112, 128, 160, 192];
  let smallest: Blob | null = null;
  for (const step of quantizeSteps) {
    const working = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
    if (step > 0) quantizeColors(working.data, step);
    ctx.putImageData(working, 0, 0);
    const blob = await canvasToBlob(ctx.canvas, "image/png");
    if (!blob) continue;
    smallest = blob;
    if (blob.size <= maxBytes) return blob;
  }
  ctx.putImageData(base, 0, 0);

  if (forcePng) {
    throw new Error(`PNG 压缩后仍超过 ${Math.round(maxBytes / 1024)}KB`);
  }
  for (let quality = 0.95; quality >= 0.3; quality -= 0.05) {
    const blob = await canvasToBlob(ctx.canvas, "image/jpeg", quality);
    if (blob && blob.size <= maxBytes) return blob;
    if (blob) smallest = blob;
  }
  if (smallest) return smallest;
  throw new Error("无法导出图片");
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
