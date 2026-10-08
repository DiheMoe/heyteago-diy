// 画布指针工具：把一次拖拽（按下 → 移动 → 抬起）翻译成编辑动作。
// 画笔与橡皮擦驱动笔画层实时绘制，抬起时提交；移动工具平移取景（一次拖动算一步撤销）；
// 文字工具放置、选中、拖动文字；浏览时什么也不做。
// 一次拖拽归按下时的工具与压感开关，中途切换工具或开关不影响它。
import type { StrokeLayer } from "../canvas/stroke-layer";
import { strokeAnchor, strokeSize, type EditorStore } from "../model/document";
import type { StrokePoint } from "../model/stroke";
import { hitText, type MeasureText } from "../model/text";
import type { Point } from "./gestures";

export interface PointerSample extends Point {
  // PointerEvent.pressure（0–1）
  pressure: number;
}

type Drag =
  | { kind: "stroke"; pressure: boolean }
  | { kind: "move"; last: Point; key: symbol }
  | { kind: "text"; last: Point };

export interface PointerTools {
  // 按下；开始了一次拖拽时返回 true，之后的 move/up 属于这次拖拽
  down(at: PointerSample, shiftKey: boolean): boolean;
  // at 是指针当前位置；samples 是自上次移动以来的全部采样（浏览器合并的事件，没有时只有 at），画笔逐点绘制
  move(at: PointerSample, samples: readonly PointerSample[]): void;
  up(): void;
  // 中止拖拽：进行中的笔画只丢弃，不提交
  cancel(): void;
}

// 压感开启时记录每点压力（重放保真），关闭时省略（恒粗）
const toStrokePoint = (s: PointerSample, pressure: boolean): StrokePoint =>
  pressure ? { x: s.x, y: s.y, p: s.pressure } : { x: s.x, y: s.y };

// measure 量文字框尺寸，文字工具按它判断按下时点中了哪段文字
export function createPointerTools(store: EditorStore, strokes: () => StrokeLayer, measure: MeasureText): PointerTools {
  const { dispatch } = store;
  let drag: Drag | null = null;

  return {
    down(at, shiftKey) {
      const s = store.getState();
      const point = { x: at.x, y: at.y };
      if (s.tool === "browse") return false;
      if (s.tool === "move") {
        drag = { kind: "move", last: point, key: Symbol("平移") };
        return true;
      }
      if (s.tool === "text") {
        dispatch({ type: "textPointerDown", point, hitId: hitText(s.doc.texts, point, measure)?.id ?? null });
        drag = { kind: "text", last: point };
        return true;
      }
      const first = toStrokePoint(at, s.pressure);
      // Shift+点击或直线模式：从上一笔终点画直线段（写字/描边高频动作）
      const anchor = strokeAnchor(s);
      if ((shiftKey || s.lineMode) && anchor) {
        const stroke = { tool: s.tool, size: strokeSize(s), points: [anchor, first] };
        strokes().paint(stroke);
        dispatch({ type: "commitStroke", stroke });
        return false;
      }
      strokes().begin(s.tool, strokeSize(s), first);
      drag = { kind: "stroke", pressure: s.pressure };
      return true;
    },

    move(at, samples) {
      if (!drag) return;
      if (drag.kind === "stroke") {
        const { pressure } = drag;
        strokes().extend(samples.map((sample) => toStrokePoint(sample, pressure)));
        return;
      }
      const dx = at.x - drag.last.x;
      const dy = at.y - drag.last.y;
      drag.last = { x: at.x, y: at.y };
      dispatch(drag.kind === "move" ? { type: "panView", dx, dy, key: drag.key } : { type: "textDragBy", dx, dy });
    },

    up() {
      const done = drag;
      drag = null;
      if (done?.kind !== "stroke") return;
      const stroke = strokes().end();
      if (stroke) dispatch({ type: "commitStroke", stroke });
    },

    cancel() {
      const dropped = drag;
      drag = null;
      if (dropped?.kind === "stroke") strokes().cancel();
    },
  };
}
