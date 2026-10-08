import { describe, expect, it } from "vitest";
import { parseSavedDraft, serializeDraft, type SavedDraft } from "./saved-draft";

const draft = (): SavedDraft => ({
  savedAt: 1_760_000_000_000,
  image: new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
  imageName: "a.png",
  tone: { toneMode: "dots", threshold: 120, density: 8, pattern: "diamond" },
  view: { fit: "contain", rotate: 270, offsetX: -12.5, offsetY: 40 },
  strokes: [
    { tool: "brush", size: 12, points: [{ x: 1, y: 2 }] },
    { tool: "eraser", size: 40, points: [{ x: 3, y: 4, p: 0.5 }, { x: 5, y: 6, p: 1 }] },
  ],
  texts: [{ id: 3, content: "喜\n茶", x: 100, y: 200, size: 48, angle: -45, weight: 900 }],
});

const stored = async () => (await serializeDraft(draft())) as Record<string, unknown>;

// 在合法的存储记录上改一处（path 指向要改的字段），用来逐项检查校验
async function tamper(path: Array<string | number>, value: unknown): Promise<unknown> {
  const record = structuredClone(await stored()) as Record<string | number, unknown>;
  let target = record;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string | number, unknown>;
  target[path[path.length - 1]] = value;
  return record;
}

describe("自动保存记录", () => {
  it("原图存成字节和类型（WebKit 的无痕会话里 IndexedDB 存不了 Blob），读出时还原成同样的 Blob", async () => {
    const record = await stored();
    expect(record.image).toBeUndefined();
    expect(record).toMatchObject({ imageType: "image/png" });
    expect(record.imageBytes).toBeInstanceOf(ArrayBuffer);

    const parsed = parseSavedDraft(record)!;
    const { image, ...rest } = draft();
    expect(parsed).toMatchObject(rest);
    expect(parsed.image.type).toBe("image/png");
    expect(new Uint8Array(await parsed.image.arrayBuffer())).toEqual(new Uint8Array(await image.arrayBuffer()));
  });

  it("不是对象、缺字段时丢弃", async () => {
    expect(parseSavedDraft(undefined)).toBeNull();
    expect(parseSavedDraft("draft")).toBeNull();
    const missing = await stored();
    delete missing.texts;
    expect(parseSavedDraft(missing)).toBeNull();
  });

  it.each([
    ["保存时间", ["savedAt"], "昨天"],
    ["原图内容", ["imageBytes"], "data:image/png;base64,"],
    ["原图类型", ["imageType"], "text/html"],
    ["原图名", ["imageName"], 42],
    ["色彩模式", ["tone", "toneMode"], "color"],
    ["阈值", ["tone", "threshold"], 300],
    ["网点大小", ["tone", "density"], 0],
    ["网点形状", ["tone", "pattern"], "star"],
    ["适配方式", ["view", "fit"], "stretch"],
    ["旋转角度", ["view", "rotate"], 45],
    ["位移", ["view", "offsetX"], Number.NaN],
    ["笔画工具", ["strokes", 0, "tool"], "spray"],
    ["笔画粗细", ["strokes", 0, "size"], 500],
    ["笔画点列为空", ["strokes", 0, "points"], []],
    ["点坐标", ["strokes", 1, "points", 0, "x"], "1"],
    ["压力", ["strokes", 1, "points", 0, "p"], 2],
    ["文字 id", ["texts", 0, "id"], 1.5],
    ["文字内容", ["texts", 0, "content"], null],
    ["字号", ["texts", 0, "size"], 4],
    ["角度", ["texts", 0, "angle"], Infinity],
    ["字重", ["texts", 0, "weight"], 950],
  ] as Array<[string, Array<string | number>, unknown]>)("%s不合法时整条丢弃", async (_name, path, value) => {
    expect(parseSavedDraft(await tamper(path, value))).toBeNull();
  });

  it("文字 id 重复时丢弃", async () => {
    const record = await stored();
    const texts = record.texts as unknown[];
    texts.push({ ...(texts[0] as object) });
    expect(parseSavedDraft(record)).toBeNull();
  });

  it("只读出认识的字段", async () => {
    const record = await stored();
    const parsed = parseSavedDraft({ ...record, extra: true, tone: { ...(record.tone as object), hue: 3 } })!;
    expect(Object.keys(parsed).sort()).toEqual(["image", "imageName", "savedAt", "strokes", "texts", "tone", "view"]);
    expect(parsed.tone).toEqual(draft().tone);
  });
});
