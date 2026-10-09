// 底图渲染：原图 → 取景 → 压平到白底 → 二值或点阵 → 白色换成喜茶底色。
// 底图只有黑和喜茶底色两种颜色（见 shared/constants 的 BACKGROUND_GRAY）。
import { applyBinaryThreshold, applyDotMatrix, luminanceHistogram, otsuThreshold, paintBackground } from "./pixels";
import { CUP_HEIGHT, CUP_WIDTH } from "@/shared/constants";
import { drawScale, type ToneSettings, type View } from "../model/settings";
import { ctx2d } from "./context";
import { canvasToBlob } from "./encode";
import { decodeImage } from "./image-source";

// 导入的原图短边超过它就缩成工作副本：任何适配方式、旋转下，画布上每个像素都还对应至少 2 个原图像素，
// 二值化够细；超大照片也不会拖慢渲染、撑大内存和自动保存
const MAX_WORKING_SHORT_SIDE = 2 * CUP_HEIGHT;

// createBlankImage 生成 596×832 纯白底图：进渲染管线后二值化仍全白，底色替换后就是杯底色。
export function createBlankImage(): Promise<HTMLImageElement> {
  const canvas = document.createElement("canvas");
  canvas.width = CUP_WIDTH;
  canvas.height = CUP_HEIGHT;
  const ctx = ctx2d(canvas);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, CUP_WIDTH, CUP_HEIGHT);
  return decodeImage(canvasToBlob(canvas, "image/png"));
}

// importImage 解码用户选的图片；短边超过 MAX_WORKING_SHORT_SIDE 时换成缩小的工作副本。
export async function importImage(file: File): Promise<HTMLImageElement> {
  const image = await decodeImage(file);
  const scale = MAX_WORKING_SHORT_SIDE / Math.min(image.width, image.height);
  if (scale >= 1) return image;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const ctx = ctx2d(canvas);
  // 先铺白底：JPEG 没有透明通道，而底图渲染本来就会把透明压平到白底上
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return decodeImage(canvasToBlob(canvas, "image/jpeg", 0.92));
}

// 按取景把原图画到 596×832 坐标系：平移到中心+offset → 旋转 → 缩放
function drawFramed(ctx: CanvasRenderingContext2D, image: HTMLImageElement, view: View) {
  const scale = drawScale(image, view);
  ctx.save();
  ctx.translate(CUP_WIDTH / 2 + view.offsetX, CUP_HEIGHT / 2 + view.offsetY);
  ctx.rotate((view.rotate * Math.PI) / 180);
  ctx.drawImage(
    image,
    (-image.width * scale) / 2,
    (-image.height * scale) / 2,
    image.width * scale,
    image.height * scale,
  );
  ctx.restore();
}

// autoThreshold 按取景后画面的亮度，用大津法选黑白二值的明暗分界（亮度 >= 它的变白）；
// 画面只有一种亮度时返回 undefined。按 1/4 尺寸统计，足够准也快
export function autoThreshold(image: HTMLImageElement, view: View): number | undefined {
  const canvas = document.createElement("canvas");
  canvas.width = CUP_WIDTH / 4;
  canvas.height = CUP_HEIGHT / 4;
  const ctx = ctx2d(canvas);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(1 / 4, 1 / 4);
  drawFramed(ctx, image, view);
  const t = otsuThreshold(luminanceHistogram(ctx.getImageData(0, 0, canvas.width, canvas.height)));
  // 大津法的暗类是亮度 <= t，二值化的分界是变白的最低亮度
  return t === null ? undefined : t + 1;
}

// 取景后、二值化之前的画面，按原图和取景（引用）缓存：只调色调时不必重新缩放原图、从画布读回像素
let framed: { image: HTMLImageElement; view: View; pixels: ImageData } | null = null;

// 先铺白底再按取景画原图（透明和半透明像素压平到白底上，二值化才能覆盖每个像素）
function framedPixels(image: HTMLImageElement, view: View): ImageData {
  if (framed?.image === image && framed.view === view) return framed.pixels;
  const canvas = document.createElement("canvas");
  canvas.width = CUP_WIDTH;
  canvas.height = CUP_HEIGHT;
  // 画完立刻读回像素：用软件画布，省掉 GPU 回读
  const ctx = ctx2d(canvas, { willReadFrequently: true });
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, CUP_WIDTH, CUP_HEIGHT);
  drawFramed(ctx, image, view);
  const pixels = ctx.getImageData(0, 0, CUP_WIDTH, CUP_HEIGHT);
  framed = { image, view, pixels };
  return pixels;
}

// renderBase 把原图按当前设置渲染成 596×832 的底图像素：取景，再二值化并把白色换成底色。
export function renderBase(image: HTMLImageElement, tone: ToneSettings, view: View): ImageData {
  const imageData = new ImageData(new Uint8ClampedArray(framedPixels(image, view).data), CUP_WIDTH, CUP_HEIGHT);
  if (tone.toneMode === "binary") {
    applyBinaryThreshold(imageData, tone.threshold);
  } else {
    applyDotMatrix(imageData, tone.density, tone.threshold, tone.pattern);
  }
  paintBackground(imageData);
  return imageData;
}
