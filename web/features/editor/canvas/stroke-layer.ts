// 笔画层：独占墨迹层与擦除层，创建时按已提交的笔画列表整体重放（不假设画布是空的）。
// 实时笔画边拖边画（分段增量绘制，不重描整条路径），结束时交出点列由调用方提交；
// sync 让画布跟上已提交的笔画列表。不变量：sync 之后，画布像素等于按笔画列表重放、
// 再叠上进行中的实时笔画的结果；实时笔画提交后排在列表最后，所以提交后就等于按列表重放。
// 实时画过的笔画提交后不能再画一遍：同一条抗锯齿笔画画两次，边缘透明度会叠加。
import type { Stroke, StrokePoint } from "../model/stroke";
import { ctx2d } from "./context";
import { drawSegment, drawStroke, replayStrokes, strokeTargets, widthFor, type StrokeLayers } from "./strokes";

export type StrokeSyncPlan = { kind: "none" } | { kind: "append"; strokes: Stroke[] } | { kind: "replay" };

// planStrokeSync 决定画布怎样跟上新的笔画列表：与已画的相同 → 不动；
// 在已画的列表后追加 → 只补画追加的（刚实时画过的跳过）；其余情况（撤销、清空）→ 全量重放
export function planStrokeSync(
  painted: readonly Stroke[],
  next: readonly Stroke[],
  live: ReadonlySet<Stroke>,
): StrokeSyncPlan {
  const appended = next.length >= painted.length && painted.every((s, i) => next[i] === s);
  if (!appended) return { kind: "replay" };
  const strokes = next.slice(painted.length).filter((s) => !live.has(s));
  return strokes.length ? { kind: "append", strokes } : { kind: "none" };
}

export interface StrokeLayer {
  // 开始一条实时笔画（points 已按压感开关带上或省略压力值）
  begin(tool: Stroke["tool"], size: number, point: StrokePoint): void;
  extend(points: StrokePoint[]): void;
  // 结束实时笔画，返回点列；没有进行中的笔画时返回 null
  end(): Stroke | null;
  // 丢弃进行中的笔画：按已提交的笔画重画
  cancel(): void;
  // 直接画一条完整笔画（Shift+点击直线），提交后同样不会重画
  paint(stroke: Stroke): void;
  sync(strokes: readonly Stroke[]): void;
}

interface LiveStroke {
  tool: Stroke["tool"];
  size: number;
  points: StrokePoint[];
  segPrev: StrokePoint;
  segMid: StrokePoint | null;
}

export function createStrokeLayer(layers: StrokeLayers, strokes: readonly Stroke[]): StrokeLayer {
  replayStrokes(layers, strokes);
  let painted = strokes;
  let live: LiveStroke | null = null;
  // 已经画在画布上、但还没被 sync 计入 painted 的笔画
  const paintedLive = new Set<Stroke>();

  // 按笔画的目标层逐层配置上下文后绘制；画完把合成模式复位，不影响其他绘制
  const onTargets = (l: LiveStroke, draw: (ctx: CanvasRenderingContext2D) => void) => {
    for (const t of strokeTargets(layers, l.tool)) {
      const ctx = ctx2d(t.canvas);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalCompositeOperation = t.comp;
      ctx.strokeStyle = t.color;
      draw(ctx);
      ctx.globalCompositeOperation = "source-over";
    }
  };

  const dot = (l: LiveStroke, point: StrokePoint) =>
    onTargets(l, (ctx) => {
      ctx.lineWidth = widthFor(l.size, point.p);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x + 0.01, point.y + 0.01); // 单点也能画出圆点
      ctx.stroke();
    });

  const segmentTo = (l: LiveStroke, point: StrokePoint) => {
    // 各图层共用本段的旧中点（否则第二层起会拿到第一层更新后的中点，轨迹分叉）
    const lastMid = l.segMid;
    let nextMid: StrokePoint | null = null;
    onTargets(l, (ctx) => {
      ctx.lineWidth = widthFor(l.size, point.p);
      nextMid = drawSegment(ctx, l.segPrev, point, lastMid);
    });
    l.segMid = nextMid;
    l.segPrev = point;
  };

  // 按原样重画实时笔画到目前为止的部分（与 begin、extend 画出的完全相同），分段状态随之复位
  const repaint = (l: LiveStroke) => {
    const [first, ...rest] = l.points;
    l.segPrev = first;
    l.segMid = null;
    dot(l, first);
    for (const point of rest) segmentTo(l, point);
  };

  return {
    begin(tool, size, point) {
      live = { tool, size, points: [point], segPrev: point, segMid: null };
      dot(live, point);
    },

    extend(points) {
      const l = live;
      if (!l) return;
      for (const point of points) {
        l.points.push(point);
        segmentTo(l, point);
      }
    },

    end() {
      const l = live;
      if (!l) return null;
      live = null;
      // 收尾：把曲线延伸到最后一个采样点
      if (l.points.length > 1) {
        const lastPoint = l.points[l.points.length - 1];
        onTargets(l, (ctx) => {
          ctx.lineWidth = widthFor(l.size, lastPoint.p);
          drawSegment(ctx, lastPoint, lastPoint, l.segMid);
        });
      }
      const stroke: Stroke = { tool: l.tool, size: l.size, points: l.points };
      paintedLive.add(stroke);
      return stroke;
    },

    cancel() {
      if (!live) return;
      live = null;
      replayStrokes(layers, painted);
    },

    paint(stroke) {
      drawStroke(layers, stroke);
      paintedLive.add(stroke);
    },

    sync(strokes) {
      const plan = planStrokeSync(painted, strokes, paintedLive);
      // 实时笔画进行中还要改动已提交的笔画（撤销、重做、新建画布）：整体重放，
      // 再把实时笔画按原样补画在最上面——重放会清掉它，追加的笔画也应该在它下面
      if (plan.kind === "replay" || (live && plan.kind === "append")) {
        replayStrokes(layers, strokes);
        paintedLive.clear();
        if (live) repaint(live);
      } else {
        if (plan.kind === "append") for (const s of plan.strokes) drawStroke(layers, s);
        for (const s of strokes.slice(painted.length)) paintedLive.delete(s);
      }
      painted = strokes;
    },
  };
}
