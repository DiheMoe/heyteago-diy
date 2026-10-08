// 文字层绘制与测量。多行文字每行居中，整块的中心在文字的锚点上。
import { LINE_HEIGHT, textBoxSize, textLines, type TextObj } from "../model/text";
import { ctx2d } from "./context";

const FONT_STACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

function fontOf(size: number, weight: number): string {
  return `${weight} ${size}px ${FONT_STACK}`;
}

// renderTexts 把全部文字对象重绘到文字层（selectedId 的对象带虚线框提示选中）。
export function renderTexts(canvas: HTMLCanvasElement, texts: TextObj[], selectedId: number | null) {
  const ctx = ctx2d(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const t of texts) drawText(ctx, t, t.id === selectedId);
}

function drawText(ctx: CanvasRenderingContext2D, t: TextObj, selected: boolean) {
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate((t.angle * Math.PI) / 180);
  ctx.font = fontOf(t.size, t.weight);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#000";
  const lines = textLines(t.content);
  // 第 i 行的中线相对整块中心的纵向位置
  const lineY = (i: number) => (i - (lines.length - 1) / 2) * t.size * LINE_HEIGHT;
  lines.forEach((line, i) => ctx.fillText(line, 0, lineY(i)));
  // 特粗（>=800）：多数系统 sans 字体到 700 封顶，用同色细描边做合成加粗，
  // 保证任何环境都与粗体有可见差异
  if (t.weight >= 800) {
    ctx.strokeStyle = "#000";
    ctx.lineWidth = Math.max(1, t.size / 24);
    ctx.lineJoin = "round";
    lines.forEach((line, i) => ctx.strokeText(line, 0, lineY(i)));
  }
  if (selected) {
    const { w, h } = textBoxSize(lines.map((line) => ctx.measureText(line).width), t.size);
    ctx.strokeStyle = "#666";
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.strokeRect(-w / 2 - 6, -h / 2 - 4, w + 12, h + 8);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

// measureTextObj 用共享离屏 ctx 量文字框尺寸（命中、手柄、操作条位置依赖它）。
let measureCanvas: HTMLCanvasElement | null = null;
export function measureTextObj(t: TextObj): { w: number; h: number } {
  if (!measureCanvas) {
    measureCanvas = document.createElement("canvas");
    measureCanvas.width = 1;
    measureCanvas.height = 1;
  }
  const ctx = ctx2d(measureCanvas);
  ctx.font = fontOf(t.size, t.weight);
  return textBoxSize(
    textLines(t.content).map((line) => ctx.measureText(line).width),
    t.size,
  );
}
