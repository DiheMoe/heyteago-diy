// 贴文字图层：文字对象渲染与命中检测。文字始终是对象（可重调大小/角度/内容），
// 仅在导出时随图层合成栅格化。
export interface TextObj {
  id: number;
  content: string;
  x: number; // 画布坐标（中心锚点）
  y: number;
  size: number; // 字号（画布像素）
  angle: number; // 顺时针角度
}

const FONT_STACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

function fontOf(size: number): string {
  return `bold ${size}px ${FONT_STACK}`;
}

// renderTexts 把全部文字对象重绘到文字层（selectedId 的对象带虚线框提示选中）。
export function renderTexts(
  canvas: HTMLCanvasElement | null,
  texts: TextObj[],
  selectedId: number | null,
) {
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const t of texts) drawText(ctx, t, t.id === selectedId);
}

function drawText(ctx: CanvasRenderingContext2D, t: TextObj, selected: boolean) {
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate((t.angle * Math.PI) / 180);
  ctx.font = fontOf(t.size);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#000";
  ctx.fillText(t.content, 0, 0);
  if (selected) {
    const w = ctx.measureText(t.content).width;
    ctx.strokeStyle = "#666";
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.strokeRect(-w / 2 - 6, -t.size / 2 - 4, w + 12, t.size + 8);
    ctx.setLineDash([]);
  }
  ctx.restore();
}

// hitText 返回距 (x,y) 最近且在其命中半径内的文字；命中半径随字号放宽。
export function hitText(texts: TextObj[], x: number, y: number): TextObj | null {
  let best: TextObj | null = null;
  let bestDist = Infinity;
  for (const t of texts) {
    const r = Math.max(24, t.size * 1.2);
    const d = Math.hypot(x - t.x, y - t.y);
    if (d <= r && d < bestDist) {
      best = t;
      bestDist = d;
    }
  }
  return best;
}
