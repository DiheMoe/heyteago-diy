import { describe, expect, it } from "vitest";
import { hitText, type TextObj } from "./texts";

function text(partial: Partial<TextObj>): TextObj {
  return { id: 1, content: "茶", x: 100, y: 100, size: 40, angle: 0, weight: 700, ...partial };
}

describe("hitText", () => {
  it("命中半径内取最近的对象", () => {
    const near = text({ id: 1, x: 110 });
    const far = text({ id: 2, x: 300 });
    // 距 near 更近（半径 max(24, 40*1.2)=48 内），且比 far 近
    expect(hitText([near, far], 125, 100)?.id).toBe(1);
  });

  it("半径外返回 null；命中半径随字号放宽", () => {
    const small = text({ id: 1, size: 10 }); // 半径 24
    expect(hitText([small], 130, 100)).toBeNull();
    const big = text({ id: 2, size: 100 }); // 半径 120
    expect(hitText([big], 200, 100)?.id).toBe(2);
  });
});
