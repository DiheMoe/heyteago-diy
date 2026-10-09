// 笔画绘制原语：实时分段绘制与整条重放共用同一条曲线（逐段中点贝塞尔）。
import { BACKGROUND_COLOR } from "@/shared/constants";
import type { Stroke, StrokePoint } from "../model/stroke";
import { ctx2d } from "./context";

export interface StrokeLayers {
  ink: HTMLCanvasElement;
  erase: HTMLCanvasElement;
}

// widthFor 把压感映射为粗细系数：轻压 0.2x 到重压 2x；无压感恒为 size。
// 鼠标/触摸的 pressure 恒为 0.5 → 恰好 1x，开关误开也不变形。
export function widthFor(size: number, p?: number): number {
  return p === undefined ? size : size * Math.min(2, Math.max(0.2, p * 2));
}

// strokeTargets 返回一条笔画的作用层清单（实时绘制与重放共用）：
// brush 只画 ink 黑色笔迹（喜茶审核只放行黑与底色，不给选色）；
// eraser 画 erase 掩码（喜茶底色）并从 ink 抠除笔迹。
// destination-out 只读 alpha，color 任意。
export function strokeTargets(
  layers: StrokeLayers,
  tool: "brush" | "eraser",
): Array<{ canvas: HTMLCanvasElement; color: string; comp: GlobalCompositeOperation }> {
  if (tool === "eraser") {
    return [
      { canvas: layers.erase, color: BACKGROUND_COLOR, comp: "source-over" },
      { canvas: layers.ink, color: "#000", comp: "destination-out" },
    ];
  }
  return [{ canvas: layers.ink, color: "#000", comp: "source-over" }];
}

// drawStroke 把一条笔画描到图层（目标层清单见 strokeTargets）。
export function drawStroke(layers: StrokeLayers, s: Stroke) {
  for (const t of strokeTargets(layers, s.tool)) {
    const ctx = ctx2d(t.canvas);
    ctx.globalCompositeOperation = t.comp;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = t.color;
    strokePath(ctx, s.points, s.size);
    ctx.globalCompositeOperation = "source-over";
  }
}

// strokePath 描一条完整笔画（重放用）：逐段中点贝塞尔，宽度逐段随压感变化。
function strokePath(ctx: CanvasRenderingContext2D, points: StrokePoint[], size: number) {
  if (points.length === 0) return;
  const first = points[0];
  ctx.lineWidth = widthFor(size, first.p);
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  ctx.lineTo(first.x + 0.01, first.y + 0.01); // 单点成圆点
  ctx.stroke();
  if (points.length === 1) return;

  let prev = first;
  let lastMid: StrokePoint | null = null;
  for (let i = 1; i < points.length; i++) {
    const curr = points[i];
    ctx.lineWidth = widthFor(size, curr.p);
    lastMid = drawSegment(ctx, prev, curr, lastMid);
    prev = curr;
  }
  // 收尾：延伸到末尾采样点
  ctx.lineWidth = widthFor(size, prev.p);
  drawSegment(ctx, prev, prev, lastMid);
}

// drawSegment 增量描一段（实时绘制用）：从上段中点经上一点到本段中点，
// 与 strokePath 是同一条曲线的分段版本（避免每个 move 事件重描整条路径的 O(n²)）。
// 返回本段中点供下一段接续。
export function drawSegment(
  ctx: CanvasRenderingContext2D,
  prev: StrokePoint,
  curr: StrokePoint,
  lastMid: StrokePoint | null,
): StrokePoint {
  const mid = { x: (prev.x + curr.x) / 2, y: (prev.y + curr.y) / 2 };
  ctx.beginPath();
  ctx.moveTo(lastMid ? lastMid.x : prev.x, lastMid ? lastMid.y : prev.y);
  ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y);
  ctx.stroke();
  return mid;
}

// replayStrokes 清空 ink/erase 后按序重放全部笔画（撤销用）。
export function replayStrokes(layers: StrokeLayers, strokes: readonly Stroke[]) {
  for (const c of [layers.ink, layers.erase]) {
    ctx2d(c).clearRect(0, 0, c.width, c.height);
  }
  for (const s of strokes) drawStroke(layers, s);
}
