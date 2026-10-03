import { describe, expect, it } from "vitest";
import {
  applyBackground,
  applyBinaryThreshold,
  applyDotMatrix,
  hexToRgb,
  quantizeColors,
  type Pixels,
} from "./pixels";

function makePixels(width: number, height: number, rgba: [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data.set(rgba, i);
  }
  return { data, width, height };
}

describe("hexToRgb", () => {
  it("parses 6-digit hex", () => {
    expect(hexToRgb("#EEEEEE")).toEqual({ r: 238, g: 238, b: 238 });
    expect(hexToRgb("#FF0000")).toEqual({ r: 255, g: 0, b: 0 });
  });
  it("parses 3-digit hex", () => {
    expect(hexToRgb("#F00")).toEqual({ r: 255, g: 0, b: 0 });
  });
  it("falls back to #EEEEEE on garbage", () => {
    expect(hexToRgb("zz")).toEqual({ r: 238, g: 238, b: 238 });
  });
});

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

describe("applyBackground", () => {
  it("replaces near-white pixels with the background color", () => {
    const img = makePixels(1, 1, [255, 255, 255, 255]);
    applyBackground(img, "#EEEEEE", 248);
    expect(Array.from(img.data)).toEqual([238, 238, 238, 255]);
  });
  it("composites transparent pixels over the background", () => {
    const img = makePixels(1, 1, [0, 0, 0, 0]);
    applyBackground(img, "#EEEEEE", 248);
    expect(Array.from(img.data)).toEqual([238, 238, 238, 255]);
  });
  it("leaves dark opaque pixels alone", () => {
    const img = makePixels(1, 1, [10, 20, 30, 255]);
    applyBackground(img, "#EEEEEE", 248);
    expect(Array.from(img.data)).toEqual([10, 20, 30, 255]);
  });
  it("half-alpha blends toward the background", () => {
    const img = makePixels(1, 1, [0, 0, 0, 128]);
    applyBackground(img, "#EEEEEE", 248);
    // 0*(128/255) + 238*(1-128/255) ≈ 119
    expect(img.data[0]).toBe(119);
    expect(img.data[3]).toBe(255);
  });
});

describe("quantizeColors", () => {
  it("rounds channels to multiples of step", () => {
    const data = new Uint8ClampedArray([100, 150, 200, 255]);
    quantizeColors(data, 32);
    expect(Array.from(data)).toEqual([96, 160, 192, 255]);
  });
  it("step 0 is a no-op", () => {
    const data = new Uint8ClampedArray([100, 150, 200, 255]);
    quantizeColors(data, 0);
    expect(Array.from(data)).toEqual([100, 150, 200, 255]);
  });
});
