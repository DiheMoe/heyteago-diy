import { afterEach, describe, expect, it, vi } from "vitest";
import { sha1Hex } from "./dup-guard";

// FIPS 180-1 / RFC 3174 公开测试向量：空串、单块、56 字节跨块边界、多长大块。
const VECTORS: Array<[string, string]> = [
  ["", "da39a3ee5e6b4b0d3255bfef95601890afd80709"],
  ["abc", "a9993e364706816aba3e25717850c26c9cd0d89d"],
  ["abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", "84983e441c3bd26ebaae4aa1f95129e5e54670f1"],
  ["a".repeat(1_000_000), "34aa973cd4c4daa4f61eeb2bdbad27316534016f"],
];

describe("sha1Hex", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("matches published SHA-1 vectors via crypto.subtle", async () => {
    for (const [input, expected] of VECTORS) {
      expect(await sha1Hex(new Blob([input]))).toBe(expected);
    }
  });

  it("falls back to the pure TS implementation when subtle is unavailable", async () => {
    vi.stubGlobal("crypto", undefined);
    for (const [input, expected] of VECTORS) {
      expect(await sha1Hex(new Blob([input]))).toBe(expected);
    }
  });
});
