import { expect, test } from "./fixtures";

test.describe("文字", () => {
  test.beforeEach(async ({ editor }) => {
    await editor.open();
    await editor.newBlankCanvas();
    await editor.tool("文字");
  });

  test("删除文字后撤销能恢复", async ({ page, editor }) => {
    await editor.placeText(298, 300, "喜茶");
    expect(await editor.pixelCount("text")).toBeGreaterThan(0);

    await editor.click(298, 300);
    await page.keyboard.press("Delete");
    await expect.poll(() => editor.pixelCount("text")).toBe(0);

    await editor.undo();
    await expect.poll(() => editor.pixelCount("text")).toBeGreaterThan(0);
  });

  test("拖动后撤销回到原位且文字仍在，重做回到新位置", async ({ editor }) => {
    await editor.placeText(298, 300, "喜茶");
    await editor.drag({ x: 298, y: 300 }, { x: 298, y: 500 });
    await expect.poll(async () => (await editor.pixels("text")).centerY).toBeGreaterThan(480);

    await editor.undo();
    await expect.poll(async () => (await editor.pixels("text")).centerY).toBeLessThan(320);
    expect(await editor.pixelCount("text")).toBeGreaterThan(0);

    await editor.redo();
    await expect.poll(async () => (await editor.pixels("text")).centerY).toBeGreaterThan(480);
  });

  test("拖动右下角手柄等比放大，手柄跟着指针；一次撤销回到原字号", async ({ page, editor }) => {
    await editor.placeText(298, 300, "喜茶");
    expect(await editor.textSize()).toBe(48);

    // 沿中心到右下角手柄的方向往外拖
    const nw = await editor.handleCenter("nw");
    const start = await editor.handleCenter("se");
    const center = { x: (nw.x + start.x) / 2, y: (nw.y + start.y) / 2 };
    const len = Math.hypot(start.x - center.x, start.y - center.y);
    const dir = { x: (start.x - center.x) / len, y: (start.y - center.y) / len };
    const sizes: number[] = [];
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(start.x + dir.x * 5 * i, start.y + dir.y * 5 * i);
      sizes.push(await editor.textSize());
    }
    await page.mouse.up();

    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(sizes[7]).toBeGreaterThan(48);
    const end = await editor.handleCenter("se");
    expect(Math.hypot(end.x - (start.x + dir.x * 40), end.y - (start.y + dir.y * 40))).toBeLessThan(3);

    await editor.undo();
    await expect.poll(() => editor.textSize()).toBe(48);
  });

  test("拖动上方的旋转手柄转 90°：横排变竖排，一次撤销复原", async ({ page, editor }) => {
    await editor.placeText(298, 400, "喜茶喜茶");
    const wide = (await editor.inkBounds("text"))!;
    expect(wide.right - wide.left).toBeGreaterThan(wide.bottom - wide.top);

    // 绕文字中心把手柄从正上方拖到正右方
    const nw = await editor.handleCenter("nw");
    const se = await editor.handleCenter("se");
    const center = { x: (nw.x + se.x) / 2, y: (nw.y + se.y) / 2 };
    const start = await editor.handleCenter("rotate");
    const r = center.y - start.y;
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      const a = (Math.PI / 2) * (i / 6);
      await page.mouse.move(center.x + r * Math.sin(a), center.y - r * Math.cos(a));
    }
    await page.mouse.up();

    await expect
      .poll(async () => {
        const b = (await editor.inkBounds("text"))!;
        return b.bottom - b.top > b.right - b.left;
      })
      .toBe(true);
    await editor.undo();
    await expect.poll(async () => (await editor.inkBounds("text"))?.right).toBe(wide.right);
  });

  test("点长文字的末端也能选中并拖动它，不会在那里放新文字", async ({ page, editor }) => {
    await editor.placeText(298, 300, "喜茶喜茶喜茶喜茶");
    // 先取消选中：点空白处放下一段空文字，再按 Esc 放弃它
    await editor.click(298, 700);
    await page.keyboard.press("Escape");
    await expect(editor.textInput()).toBeHidden();

    await editor.drag({ x: 458, y: 300 }, { x: 458, y: 500 });
    await expect(editor.textInput()).toBeHidden();
    await expect.poll(async () => (await editor.pixels("text")).centerY).toBeGreaterThan(480);
  });

  test("选中后用操作条改字重、删除，各算一步撤销", async ({ editor }) => {
    await editor.placeText(298, 300, "喜茶");
    const bold = await editor.pixelCount("text");

    await editor.button("常规").click();
    await expect.poll(() => editor.pixelCount("text")).toBeLessThan(bold);
    await editor.button("删除").click();
    await expect.poll(() => editor.pixelCount("text")).toBe(0);

    // 撤销删除：文字回来（不再选中，没有选中框）；再撤销一步：回到粗体，笔画更多
    await editor.undo();
    await expect.poll(() => editor.pixelCount("text")).toBeGreaterThan(0);
    const regular = await editor.pixelCount("text");
    await editor.undo();
    await expect.poll(() => editor.pixelCount("text")).toBeGreaterThan(regular);
  });

  test("回车换行：多行文字显示为多行，导出的成品也是", async ({ editor }) => {
    // 换到画笔即取消选中，文字层上不再画选中框，量到的就是字形本身
    await editor.placeText(298, 400, "喜茶");
    await editor.tool("画笔");
    const single = (await editor.inkBounds("text"))!;
    await editor.undo();

    await editor.tool("文字");
    await editor.placeText(298, 400, "喜\n茶");
    await editor.tool("画笔");
    const multi = (await editor.inkBounds("text"))!;
    // 两行：高度至少是单行的 1.8 倍，宽度只有一个字
    expect(multi.bottom - multi.top).toBeGreaterThan((single.bottom - single.top) * 1.8);
    expect(multi.right - multi.left).toBeLessThan((single.right - single.left) * 0.7);

    const { width, rgba } = await editor.decodePng(await editor.download());
    const inkRows = new Set<number>();
    for (let i = 0; i < rgba.length; i += 4) if (rgba[i] < 128) inkRows.add(Math.floor(i / 4 / width));
    expect(Math.max(...inkRows) - Math.min(...inkRows)).toBeGreaterThan((single.bottom - single.top) * 1.8);
  });

  test("文字靠近画布边缘时，输入框和操作条仍在画布内", async ({ page, editor }) => {
    const canvas = (await page.locator("canvas").last().boundingBox())!;
    const inside = (box: { x: number; y: number; width: number; height: number }) =>
      box.x >= canvas.x - 1 &&
      box.y >= canvas.y - 1 &&
      box.x + box.width <= canvas.x + canvas.width + 1 &&
      box.y + box.height <= canvas.y + canvas.height + 1;

    await editor.click(10, 8);
    await expect(editor.textInput()).toBeVisible();
    expect(inside((await editor.textInput().boundingBox())!)).toBe(true);
    await page.keyboard.type("喜茶");
    await editor.button("完成").click();
    expect(inside((await editor.button("删除").boundingBox())!)).toBe(true);

    await editor.click(590, 826);
    await expect(editor.textInput()).toBeVisible();
    expect(inside((await editor.textInput().boundingBox())!)).toBe(true);
  });

  test("双击修改内容和字重，一次撤销一起回退", async ({ page, editor }) => {
    await editor.placeText(298, 600, "喜茶");
    const before = await editor.pixelCount("text");

    await editor.dblclick(298, 600);
    await expect(editor.textInput()).toHaveValue("喜茶");
    await editor.button("特粗").click();
    // 点字重按钮不抢输入框的焦点，可以接着打字
    await expect(editor.textInput()).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type("店");
    await editor.button("完成").click();
    await expect.poll(() => editor.pixelCount("text")).not.toBe(before);

    await editor.undo();
    await expect.poll(() => editor.pixelCount("text")).toBe(before);
    await editor.dblclick(298, 600);
    await expect(editor.textInput()).toHaveValue("喜茶");
  });

  test("清空内容等于删除，撤销恢复内容", async ({ page, editor }) => {
    await editor.placeText(298, 300, "喜茶");

    await editor.dblclick(298, 300);
    await expect(editor.textInput()).toHaveValue("喜茶");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect.poll(() => editor.pixelCount("text")).toBe(0);

    await editor.undo();
    await expect.poll(() => editor.pixelCount("text")).toBeGreaterThan(0);
    await editor.dblclick(298, 300);
    await expect(editor.textInput()).toHaveValue("喜茶");
  });

  test("双击空白处放置并输入：撤销一次即清空", async ({ page, editor }) => {
    await editor.dblclick(298, 300);
    await expect(editor.textInput()).toBeVisible();
    await page.keyboard.type("喜茶");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(editor.textInput()).toBeHidden();

    await editor.undo();
    await expect.poll(() => editor.pixelCount("text")).toBe(0);
    expect(await editor.history()).toEqual({ undo: false, redo: true });
  });

  test("编辑空文字时点别处：只结束编辑、不留文字；再点才放新文字，撤销一次即清空", async ({ editor }) => {
    await editor.dblclick(150, 200);
    await expect(editor.textInput()).toBeVisible();
    await editor.click(400, 500);
    await expect(editor.textInput()).toBeHidden();
    expect(await editor.history()).toEqual({ undo: false, redo: false });

    await editor.placeText(400, 500, "茶");

    await editor.undo();
    await expect.poll(() => editor.pixelCount("text")).toBe(0);
    expect(await editor.history()).toEqual({ undo: false, redo: true });
  });

  test("放置后拖动再按 Esc：没有可撤销的步骤", async ({ page, editor }) => {
    await editor.drag({ x: 200, y: 200 }, { x: 300, y: 300 });
    await expect(editor.textInput()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(editor.textInput()).toBeHidden();
    expect(await editor.history()).toEqual({ undo: false, redo: false });
  });
});

test("手柄拖拽没收到抬起（指针捕获失败）：之后悬停经过手柄不再缩放文字", async ({ page, editor }) => {
  await editor.open();
  await editor.newBlankCanvas();
  await editor.tool("文字");
  await editor.placeText(298, 400, "喜茶");
  const before = await editor.textSize();

  await page.evaluate(() => {
    const handle = document.querySelector<HTMLElement>('[data-text-handle="se"]')!;
    const r = handle.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const send = (target: EventTarget, type: string, dy: number, buttons: number) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 9,
          pointerType: "mouse",
          isPrimary: true,
          clientX: x,
          clientY: y + dy,
          buttons,
        }),
      );
    // 合成指针没有对应的真实指针，setPointerCapture 会失败；抬起落在页面别处，手柄收不到
    send(handle, "pointerdown", 0, 1);
    send(document.body, "pointerup", 40, 0);
    // 之后没按任何键、只是经过手柄的移动
    send(handle, "pointermove", 80, 0);
  });

  expect(await editor.textSize()).toBe(before);
});
