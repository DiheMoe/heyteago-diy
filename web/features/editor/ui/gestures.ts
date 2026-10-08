// 预览画布的指针换算与双指手势判定（纯函数）。
import { CUP_HEIGHT, CUP_WIDTH } from "@/shared/constants";

export interface Point {
  x: number;
  y: number;
}

// 画布在页面上的实际矩形（getBoundingClientRect，含 CSS zoom 缩放）
interface ShownRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// 页面坐标 → 画布坐标：按画布实际显示的矩形换算，视图缩放后仍落在同一画布坐标
export function toCanvasPoint(e: { clientX: number; clientY: number }, rect: ShownRect): Point {
  return {
    x: ((e.clientX - rect.left) / rect.width) * CUP_WIDTH,
    y: ((e.clientY - rect.top) / rect.height) * CUP_HEIGHT,
  };
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// 双指手势：第二指落下时记下两指位置（页面坐标）与时间
export interface TwoFingerGesture {
  a: Point; // 先落下的手指
  b: Point;
  startT: number;
  // 任一指移动超过阈值：之后一直按捏合、拖动处理，抬起时也不再算轻点
  moved: boolean;
}

// 任一指移动超过这么多页面像素才算捏合或拖动，手指抖动不触发
const MOVE_THRESHOLD_PX = 8;
// 两指都没移动且在这么多毫秒内抬起才算轻点
const TAP_MAX_MS = 400;

const distance = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);

// 两指移到 a、b 时：是否已算移动、两指距离与落下时之比（捏合倍数）、两指中点
export function twoFingerUpdate(
  g: TwoFingerGesture,
  a: Point,
  b: Point,
): { moved: boolean; ratio: number; mid: Point } {
  const moved = g.moved || distance(a, g.a) > MOVE_THRESHOLD_PX || distance(b, g.b) > MOVE_THRESHOLD_PX;
  return { moved, ratio: distance(a, b) / Math.max(distance(g.a, g.b), 1), mid: midpoint(a, b) };
}

export function isTwoFingerTap(g: TwoFingerGesture, endT: number): boolean {
  return !g.moved && endT - g.startT < TAP_MAX_MS;
}
