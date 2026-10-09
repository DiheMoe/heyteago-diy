import { describe, expect, it } from "vitest";
import {
  applyBinaryThreshold,
  applyDotMatrix,
  luminanceHistogram,
  otsuThreshold,
  paintBackground,
  type Pixels,
} from "./pixels";

function makePixels(width: number, height: number, rgba: [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data.set(rgba, i);
  }
  return { data, width, height };
}

describe("applyBinaryThreshold", () => {
  it("dark pixels go black, bright pixels go white", () => {
    const img = makePixels(2, 1, [0, 0, 0, 255]);
    img.data.set([255, 255, 255, 255], 4);
    applyBinaryThreshold(img, 170);
    expect(Array.from(img.data.slice(0, 3))).toEqual([0, 0, 0]);
    expect(Array.from(img.data.slice(4, 7))).toEqual([255, 255, 255]);
  });
  it("keeps alpha untouched", () => {
    const img = makePixels(1, 1, [10, 10, 10, 128]);
    applyBinaryThreshold(img, 170);
    expect(img.data[3]).toBe(128);
  });
});

describe("applyDotMatrix", () => {
  it("block darker than threshold becomes fully black", () => {
    const img = makePixels(6, 6, [30, 30, 30, 255]);
    applyDotMatrix(img, 6, 170, "circle");
    expect(Array.from(img.data.slice(0, 3))).toEqual([0, 0, 0]);
    expect(new Set(img.data.filter((_, i) => i % 4 === 0))).toEqual(new Set([0]));
  });
  it("bright block keeps some white and some black", () => {
    const img = makePixels(6, 6, [128, 128, 128, 255]);
    applyDotMatrix(img, 6, 170, "circle");
    const grays = img.data.filter((_, i) => i % 4 === 0);
    expect(grays.some((v) => v === 255)).toBe(true);
    expect(grays.some((v) => v === 0)).toBe(true);
  });
  it("all four patterns produce valid output", () => {
    for (const pattern of ["circle", "diamond", "cross", "grid"] as const) {
      const img = makePixels(8, 8, [100, 120, 140, 255]);
      applyDotMatrix(img, 4, 170, pattern);
      expect(img.data.length).toBe(8 * 8 * 4);
    }
  });
});

describe("paintBackground", () => {
  it("白色换成喜茶底色，黑色不变，透明度不动", () => {
    const img = { data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]), width: 2, height: 1 };
    paintBackground(img);
    expect(Array.from(img.data)).toEqual([0xee, 0xee, 0xee, 255, 0, 0, 0, 255]);
  });
});

// 直方图：每个 [亮度, 像素数] 一档，其余为 0
function histogram(...bins: Array<[number, number]>): Uint32Array {
  const hist = new Uint32Array(256);
  for (const [value, count] of bins) hist[value] = count;
  return hist;
}

describe("luminanceHistogram", () => {
  it("按亮度（加权灰度）统计每档的像素数", () => {
    const img = makePixels(3, 1, [255, 255, 255, 255]);
    img.data.set([0, 0, 0, 255], 4);
    img.data.set([100, 100, 100, 255], 8);
    const hist = luminanceHistogram(img);
    expect([hist[0], hist[100], hist[255]]).toEqual([1, 1, 1]);
    expect(hist.reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe("otsuThreshold", () => {
  it("两团亮度之间分界；中间没有像素时取空档的正中", () => {
    // 暗类为亮度 <= t 的像素：t 落在 [200, 229] 都把两团分开，取正中
    expect(otsuThreshold(histogram([200, 500], [230, 500]))).toBe(214.5);
  });

  it("两团大小不同时仍分在两团之间", () => {
    const t = otsuThreshold(histogram([40, 900], [41, 300], [180, 100], [182, 400]))!;
    expect(t).toBeGreaterThanOrEqual(41);
    expect(t).toBeLessThan(180);
  });

  it("只有一种亮度时没有分界", () => {
    expect(otsuThreshold(histogram([128, 1000]))).toBeNull();
    expect(otsuThreshold(new Uint32Array(256))).toBeNull();
  });
});
