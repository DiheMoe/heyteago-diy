import { describe, expect, it } from "vitest";
import { stickerFileName } from "./download";

describe("下载文件名", () => {
  it("带本地日期和时间，多次下载不重名", () => {
    expect(stickerFileName(new Date(2026, 9, 8, 9, 5, 3))).toBe("heytea-cup-20261008-090503.png");
    expect(stickerFileName(new Date(2026, 11, 31, 23, 59, 59))).toBe("heytea-cup-20261231-235959.png");
  });
});
