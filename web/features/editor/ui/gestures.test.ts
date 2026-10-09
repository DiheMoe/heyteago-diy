import { describe, expect, it } from "vitest";
import { isTwoFingerTap, midpoint, toCanvasPoint, twoFingerUpdate, type TwoFingerGesture } from "./gestures";

// 两指相距 200 页面像素落下
const start = (moved = false): TwoFingerGesture => ({
  a: { x: 100, y: 300 },
  b: { x: 300, y: 300 },
  startT: 1000,
  moved,
});

describe("toCanvasPoint", () => {
  it("按画布在页面上的实际矩形换算，缩放后仍落在同一画布坐标", () => {
    expect(toCanvasPoint({ clientX: 349, clientY: 516 }, { left: 51, top: 100, width: 596, height: 832 })).toEqual({ x: 298, y: 416 });
    expect(toCanvasPoint({ clientX: 646, clientY: 932 }, { left: 50, top: 100, width: 1192, height: 1664 })).toEqual({ x: 298, y: 416 });
  });
});

describe("双指手势", () => {
  it("两指各自移动都不超过 8 个页面像素：不算移动", () => {
    expect(twoFingerUpdate(start(), { x: 94, y: 300 }, { x: 306, y: 303 }).moved).toBe(false);
  });

  it("任一指移动超过阈值即算移动：只动一指、两指反向捏合（中点不动）都算", () => {
    expect(twoFingerUpdate(start(), { x: 100, y: 300 }, { x: 310, y: 300 }).moved).toBe(true);
    expect(twoFingerUpdate(start(), { x: 80, y: 300 }, { x: 320, y: 300 }).moved).toBe(true);
  });

  it("一旦算作移动，之后回到原位也仍算移动", () => {
    expect(twoFingerUpdate(start(true), { x: 100, y: 300 }, { x: 300, y: 300 }).moved).toBe(true);
  });

  it("捏合倍数是两指距离之比，中点取两指平均", () => {
    const u = twoFingerUpdate(start(), { x: 50, y: 300 }, { x: 450, y: 300 });
    expect(u.ratio).toBe(2);
    expect(u.mid).toEqual({ x: 250, y: 300 });
  });

  it("没有移动且 400ms 内抬起才算轻点", () => {
    expect(isTwoFingerTap(start(), 1399)).toBe(true);
    expect(isTwoFingerTap(start(), 1400)).toBe(false);
    expect(isTwoFingerTap(start(true), 1100)).toBe(false);
  });

  it("中点取两指坐标的平均", () => {
    expect(midpoint({ x: 0, y: 10 }, { x: 100, y: 30 })).toEqual({ x: 50, y: 20 });
  });
});
