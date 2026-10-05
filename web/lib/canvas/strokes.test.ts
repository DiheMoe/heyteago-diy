import { describe, expect, it } from "vitest";
import { widthFor } from "./strokes";

describe("widthFor 压感映射", () => {
  it("无压感记录时恒为 size", () => {
    expect(widthFor(12)).toBe(12);
  });
  it("鼠标/触摸 pressure=0.5 恰好 1x", () => {
    expect(widthFor(12, 0.5)).toBe(12);
  });
  it("轻压变细、重压变粗，钳制在 0.2x–2x", () => {
    expect(widthFor(10, 0.1)).toBe(2); // 0.1*2=0.2x
    expect(widthFor(10, 1)).toBe(20); // 1*2=2x
    expect(widthFor(10, 0)).toBe(2); // 钳制下限
  });
});
