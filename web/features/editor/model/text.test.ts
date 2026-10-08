import { describe, expect, it } from "vitest";
import {
  dragTextHandle,
  hitText,
  LINE_HEIGHT,
  textBoxSize,
  textLines,
  type TextHandleDrag,
  type TextObj,
} from "./text";

function text(partial: Partial<TextObj>): TextObj {
  return { id: 1, content: "茶", x: 100, y: 100, size: 40, angle: 0, weight: 700, ...partial };
}

// 测量替身：每个字宽一个字号（与中文字体相近）
const measure = (t: TextObj) => textBoxSize(textLines(t.content).map((line) => line.length * t.size), t.size);

describe("多行文字框", () => {
  it("按换行拆行，空行也算一行", () => {
    expect(textLines("喜茶")).toEqual(["喜茶"]);
    expect(textLines("喜\n\n茶")).toEqual(["喜", "", "茶"]);
  });

  it("宽为最长一行；高为一行字号加其余各行的行距", () => {
    expect(textBoxSize([80], 40)).toEqual({ w: 80, h: 40 });
    expect(textBoxSize([80, 120, 40], 40)).toEqual({ w: 120, h: 40 + 2 * 40 * LINE_HEIGHT });
  });
});

describe("hitText", () => {
  it("按文字框命中：长文字两端也能点中，框外不中", () => {
    // 10 个字、字号 40：框宽 400，中心 (300,100)；框外余量 8
    const long = text({ content: "喜茶喜茶喜茶喜茶喜茶", x: 300 });
    expect(hitText([long], { x: 490, y: 100 }, measure)?.id).toBe(1);
    expect(hitText([long], { x: 110, y: 110 }, measure)?.id).toBe(1);
    expect(hitText([long], { x: 520, y: 100 }, measure)).toBeNull();
    expect(hitText([long], { x: 300, y: 135 }, measure)).toBeNull();
  });

  it("旋转后的文字按旋转后的框命中", () => {
    // 顺时针 90°：框变成竖的
    const t = text({ content: "喜茶喜茶喜茶喜茶喜茶", x: 300, y: 300, angle: 90 });
    expect(hitText([t], { x: 300, y: 490 }, measure)?.id).toBe(1);
    expect(hitText([t], { x: 490, y: 300 }, measure)).toBeNull();
  });

  it("多行文字按整个文字框命中", () => {
    // 3 行、字号 40：框高 40 + 2 × 50 = 140
    const t = text({ content: "喜\n茶\n店", y: 300 });
    expect(hitText([t], { x: 100, y: 370 }, measure)?.id).toBe(1);
    expect(hitText([t], { x: 100, y: 380 }, measure)).toBeNull();
  });

  it("重叠时取最上层（后放置的）", () => {
    const below = text({ id: 1 });
    const above = text({ id: 2, x: 110 });
    expect(hitText([below, above], { x: 105, y: 100 }, measure)?.id).toBe(2);
  });

  it("空文字和单个小字按最小尺寸命中", () => {
    const blank = text({ content: "", size: 12 });
    expect(hitText([blank], { x: 120, y: 120 }, measure)?.id).toBe(1);
    expect(hitText([blank], { x: 130, y: 100 }, measure)).toBeNull();
  });
});

describe("dragTextHandle", () => {
  // 中心 (100,100)、字号 48 的文字，在某个手柄上按下时的快照（默认右下角 (148,124)）
  const snap = (kind: TextHandleDrag["kind"], start = { x: 148, y: 124 }, angle = 0): TextHandleDrag => ({
    kind,
    start,
    size: 48,
    angle,
  });

  it("角手柄等比缩放：字号按指针到中心的距离与按下时之比变化，不受拖动中已变化的实时字号影响", () => {
    for (const liveSize of [48, 100, 30]) {
      expect(dragTextHandle(snap("scale"), text({ size: liveSize }), { x: 196, y: 148 })).toEqual({ size: 96 });
    }
    expect(dragTextHandle(snap("scale"), text({}), { x: 124, y: 112 })).toEqual({ size: 24 });
  });

  it("只看到中心的距离：拖到对角同样放大", () => {
    expect(dragTextHandle(snap("scale"), text({}), { x: 4, y: 52 })).toEqual({ size: 96 });
  });

  it("字号钳制在 12–240", () => {
    expect(dragTextHandle(snap("scale"), text({}), { x: 1000, y: 1000 })).toEqual({ size: 240 });
    expect(dragTextHandle(snap("scale"), text({}), { x: 101, y: 100 })).toEqual({ size: 12 });
  });

  it("旋转手柄：按指针绕中心转过的角度旋转，结果归一到 [-180, 180]", () => {
    // 从 (148,76) 绕中心顺时针转 90° 到 (124,148)
    expect(dragTextHandle(snap("rotate", { x: 148, y: 76 }), text({}), { x: 124, y: 148 })).toEqual({ angle: 90 });
    expect(dragTextHandle(snap("rotate", { x: 148, y: 76 }, 135), text({}), { x: 124, y: 148 })).toEqual({
      angle: -135,
    });
  });
});
