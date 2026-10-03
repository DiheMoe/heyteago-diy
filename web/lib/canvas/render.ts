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

  const scale =
    options.fit === "cover"
      ? Math.max(CUP_WIDTH / image.width, CUP_HEIGHT / image.height)
      : Math.min(CUP_WIDTH / image.width, CUP_HEIGHT / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  ctx.drawImage(image, (CUP_WIDTH - drawWidth) / 2, (CUP_HEIGHT - drawHeight) / 2, drawWidth, drawHeight);

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

// 画笔编辑后的画布导出：不做量化（避免破坏笔触），PNG 优先、超限退 JPEG；
// 底色开启时先合成到底色上（橡皮擦的透明孔洞变回底色）。
export async function exportEditedCanvas(
  canvas: HTMLCanvasElement,
  background: string | null,
): Promise<Blob> {
  const source = background ? compositeOver(canvas, background) : canvas;
  const png = await canvasToBlob(source, "image/png");
  if (png && png.size <= MAX_UPLOAD_BYTES) return png;
  for (let quality = 0.95; quality >= 0.3; quality -= 0.05) {
    const blob = await canvasToBlob(source, "image/jpeg", quality);
    if (blob && blob.size <= MAX_UPLOAD_BYTES) return blob;
  }
  if (png) return png;
  throw new Error("无法导出图片");
}

function compositeOver(canvas: HTMLCanvasElement, background: string): HTMLCanvasElement {
  const composited = document.createElement("canvas");
  composited.width = canvas.width;
  composited.height = canvas.height;
  const ctx = composited.getContext("2d");
  if (!ctx) return canvas;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, composited.width, composited.height);
  ctx.drawImage(canvas, 0, 0);
  return composited;
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
