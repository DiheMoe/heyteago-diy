import { expect, test, type Editor } from "./fixtures";

// 重做与撤销后的重放按点列整条重画，抗锯齿边缘与实时分段绘制可能差几个像素
async function expectInkNear(editor: Editor, expected: number) {
  await expect.poll(async () => Math.abs((await editor.pixelCount("ink")) - expected)).toBeLessThan(expected * 0.02);
}

test.describe("笔画", () => {
  test.beforeEach(async ({ editor }) => {
    await editor.open();
    await editor.newBlankCanvas();
    await editor.tool("画笔");
  });

  test("画笔撤销后清空，重做后恢复", async ({ editor }) => {
    await editor.drag({ x: 100, y: 100 }, { x: 300, y: 100 });
    const drawn = await editor.pixelCount("ink");
    expect(drawn).toBeGreaterThan(0);

    await editor.undo();
    await expect.poll(() => editor.pixelCount("ink")).toBe(0);
    await editor.redo();
    await expectInkNear(editor, drawn);
  });

  test("橡皮擦撤销后墨迹和擦除层复原", async ({ editor }) => {
    await editor.drag({ x: 100, y: 100 }, { x: 300, y: 100 });
    const drawn = await editor.pixelCount("ink");

    await editor.tool("橡皮擦");
    await editor.drag({ x: 200, y: 60 }, { x: 200, y: 140 });
    expect(await editor.pixelCount("ink")).toBeLessThan(drawn);
    expect(await editor.pixelCount("erase")).toBeGreaterThan(0);

    await editor.undo();
    await expect.poll(() => editor.pixelCount("erase")).toBe(0);
    await expectInkNear(editor, drawn);
  });

  test("画到一半切换工具：这一笔仍按画笔画完，整笔一步撤销", async ({ page, editor }) => {
    const start = await editor.toPage(100, 100);
    const middle = await editor.toPage(100, 200);
    const end = await editor.toPage(100, 300);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(middle.x, middle.y, { steps: 4 });
    await page.keyboard.press("t");
    await page.mouse.move(end.x, end.y, { steps: 4 });
    await page.mouse.up();
    // 整条竖线 100→300 的纵向重心在 200 附近；切换后若停画，重心会落在 150 附近
    const drawn = await editor.pixels("ink");
    expect(Math.abs((drawn.centerY ?? 0) - 200)).toBeLessThan(5);

    await editor.undo();
    await expect.poll(() => editor.pixelCount("ink")).toBe(0);
    await editor.redo();
    await expectInkNear(editor, drawn.count);
  });

  test("画到一半撤销上一笔：这一笔完整保留，画布与重放结果一致", async ({ page, editor }) => {
    await editor.drag({ x: 100, y: 100 }, { x: 300, y: 100 });
    const first = await editor.pixelCount("ink");

    const start = await editor.toPage(100, 300);
    const middle = await editor.toPage(200, 300);
    const end = await editor.toPage(300, 300);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(middle.x, middle.y, { steps: 4 });
    await editor.undo();
    await page.mouse.move(end.x, end.y, { steps: 4 });
    await page.mouse.up();
    // 第一笔已撤销，画布上只剩同样长的第二笔
    const drawn = await editor.pixels("ink");
    expect(Math.abs(drawn.count - first)).toBeLessThan(first * 0.02);
    expect(Math.abs((drawn.centerY ?? 0) - 300)).toBeLessThan(3);

    await editor.undo();
    await expect.poll(() => editor.pixelCount("ink")).toBe(0);
    await editor.redo();
    await expectInkNear(editor, drawn.count);
  });

  test("Shift+点击从上一笔终点画直线，撤销后回退", async ({ editor }) => {
    await editor.drag({ x: 100, y: 100 }, { x: 300, y: 100 });
    const drawn = await editor.pixelCount("ink");

    await editor.click(300, 400, ["Shift"]);
    expect(await editor.pixelCount("ink")).toBeGreaterThan(drawn * 1.5);

    await editor.undo();
    await expectInkNear(editor, drawn);
  });
});
