// 合成导出：底图减去橡皮擦掩码、无选中框的文字层、画笔笔迹，叠在喜茶底色上，用浏览器编码成 PNG。
import { BACKGROUND_COLOR, CUP_HEIGHT, CUP_WIDTH, MAX_UPLOAD_BYTES } from "@/shared/constants";
import type { TextObj } from "../model/text";
import { ctx2d } from "./context";
import { canvasToBlob } from "./encode";
import { renderTexts } from "./text-layer";

export interface ExportSource {
  base: HTMLCanvasElement;
  erase: HTMLCanvasElement;
  ink: HTMLCanvasElement;
  texts: TextObj[];
}

function offscreen(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CUP_WIDTH;
  canvas.height = CUP_HEIGHT;
  return canvas;
}

// maxBytes 缺省为上传上限，成品超过时抛错提示；本地下载传 Infinity（本地文件不受上传约束）
export async function exportImage(src: ExportSource, maxBytes = MAX_UPLOAD_BYTES): Promise<Blob> {
  // 选中虚线框是编辑器装饰，不进导出：文字层按无选中态另画一张离屏画布
  const text = offscreen();
  renderTexts(text, src.texts, null);
  // 掩码只抠底图、不抠穿底色：擦除区在导出里是底色，而不是透明
  const cut = offscreen();
  const cutCtx = ctx2d(cut);
  cutCtx.drawImage(src.base, 0, 0);
  cutCtx.globalCompositeOperation = "destination-out";
  cutCtx.drawImage(src.erase, 0, 0);

  const composed = offscreen();
  const ctx = ctx2d(composed);
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, CUP_WIDTH, CUP_HEIGHT);
  ctx.drawImage(cut, 0, 0);
  ctx.drawImage(text, 0, 0);
  ctx.drawImage(src.ink, 0, 0);

  const png = canvasToBlob(composed, "image/png");
  if (png.size > maxBytes) {
    throw new Error(
      `成品 ${Math.ceil(png.size / 1024)}KB，不能大于 ${maxBytes / 1024}KB：请减少画面细节（细碎的笔画、密集的网点）后重试`,
    );
  }
  return png;
}
