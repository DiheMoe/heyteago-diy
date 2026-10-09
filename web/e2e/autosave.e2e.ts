import { expect, test, type Editor } from "./fixtures";

const PROMPT = "继续上次的编辑吗？";

// 撤销、重做和恢复时笔画按点列整条重画，抗锯齿边缘与实时分段绘制可能差几个像素
async function expectInkNear(editor: Editor, expected: number) {
  await expect.poll(async () => Math.abs((await editor.pixelCount("ink")) - expected)).toBeLessThan(expected * 0.02);
}

test.describe("自动保存", () => {
  test.beforeEach(async ({ editor }) => {
    await editor.open();
    await editor.newBlankCanvas();
  });

  test("画完刷新后可以恢复：笔画和文字都回来，笔画可以撤销", async ({ page, editor }) => {
    // 步骤多（画、放文字、等自动保存、刷新、恢复、撤销），WebKit 满载并行时会超过默认时限
    test.slow();
    await editor.drag({ x: 100, y: 100 }, { x: 300, y: 200 });
    await editor.tool("文字");
    await editor.placeText(298, 600, "喜茶");
    // 换到画笔即取消选中，文字层上不再画选中框
    await editor.tool("画笔");
    const ink = await editor.pixelCount("ink");
    const text = await editor.pixelCount("text");
    await expect.poll(() => editor.savedDraft()).toEqual({ strokes: 1, texts: 1, imageType: "image/png" });

    await page.reload();
    await expect(page.getByText(PROMPT)).toBeVisible();
    await editor.button("继续编辑").click();
    await expect(page.getByText(PROMPT)).toBeHidden();
    await expect.poll(() => editor.pixelCount("text")).toBe(text);
    await expectInkNear(editor, ink);
    await expect(page.getByText("已选择：空白画布")).toBeVisible();

    await editor.undo();
    await expect.poll(() => editor.pixelCount("ink")).toBe(0);
    expect(await editor.pixelCount("text")).toBe(text);
  });

  test("丢弃后记录删除，再刷新不再提示", async ({ page, editor }) => {
    await editor.drag({ x: 100, y: 100 }, { x: 300, y: 200 });
    await expect.poll(() => editor.savedDraft()).toMatchObject({ strokes: 1, texts: 0 });

    await page.reload();
    await editor.button("丢弃").click();
    await expect(page.getByText(PROMPT)).toBeHidden();
    await expect.poll(() => editor.savedDraft()).toBeNull();
    expect(await editor.pixelCount("ink")).toBe(0);

    await page.reload();
    await expect(page.getByText("无画布")).toBeVisible();
    // 读取本机记录是异步的：留出时间，确认提示确实不会出现
    await page.waitForTimeout(500);
    await expect(page.getByText(PROMPT)).toBeHidden();
  });

  test("空白画布上什么都没画：不保存、不提示恢复", async ({ page, editor }) => {
    await editor.drag({ x: 100, y: 100 }, { x: 300, y: 200 });
    await expect.poll(() => editor.savedDraft()).not.toBeNull();
    await editor.undo();
    await expect.poll(() => editor.savedDraft()).toBeNull();

    await page.reload();
    await expect(page.getByText("无画布")).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.getByText(PROMPT)).toBeHidden();
  });
});
