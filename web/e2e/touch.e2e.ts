import type { Page } from "@playwright/test";
import { expect, test, type Point } from "./fixtures";

// 多点触控、手写笔事件靠 Chromium 的 CDP 模拟（Playwright 自带的 touchscreen 只能单指轻点）
const MULTI_TOUCH_NEEDS_CDP = "多点触控、手写笔事件只能在 Chromium 上模拟";

test("文字工具下双指轻点：撤销上一步，重做记录保留", async ({ page, editor, browserName }) => {
  test.skip(browserName !== "chromium", MULTI_TOUCH_NEEDS_CDP);
  await editor.open();
  await editor.newBlankCanvas();
  // 窄屏下工具栏可能被吸顶的预览挡住，用快捷键切到文字工具
  await page.keyboard.press("t");
  await editor.placeText(298, 200, "喜茶");
  await editor.placeText(298, 600, "奶茶");
  await editor.undo();
  await expect.poll(() => editor.history()).toEqual({ undo: true, redo: true });

  await editor.twoFingerTap({ x: 150, y: 420 }, { x: 450, y: 420 });
  await expect.poll(() => editor.pixelCount("text")).toBe(0);
  expect(await editor.history()).toEqual({ undo: false, redo: true });

  await editor.redo();
  await editor.redo();
  await expect.poll(() => editor.history()).toEqual({ undo: true, redo: false });
  expect(await editor.pixelCount("text")).toBeGreaterThan(0);
});

test("画笔画到一半第二指落下：这一笔作废，双指拖动平移视图，不提交也不撤销", async ({ page, editor, browserName }) => {
  test.skip(browserName !== "chromium", MULTI_TOUCH_NEEDS_CDP);
  await editor.open();
  await editor.newBlankCanvas();
  await page.keyboard.press("b");
  // 放大到画布超出预览区，双指拖动才有可滚动的余量
  for (let i = 0; i < 3; i++) await editor.button("放大").click();
  const shown = await editor.visibleInk();
  const a = { x: shown.x + shown.width * 0.3, y: shown.y + shown.height * 0.5 };
  const b = { x: shown.x + shown.width * 0.7, y: shown.y + shown.height * 0.7 };
  expect(await editor.inkAt(a)).toBe(true);
  expect(await editor.inkAt(b)).toBe(true);
  const before = await editor.viewScroll();

  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove", points: Array<{ x: number; y: number; id: number }>) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  await touch("touchStart", [{ ...a, id: 1 }]);
  await touch("touchMove", [{ x: a.x + 30, y: a.y, id: 1 }]);
  await expect.poll(() => editor.pixelCount("ink")).toBeGreaterThan(0);

  await touch("touchStart", [
    { x: a.x + 30, y: a.y, id: 1 },
    { ...b, id: 2 },
  ]);
  await expect.poll(() => editor.pixelCount("ink")).toBe(0);
  for (let step = 1; step <= 4; step++) {
    await touch("touchMove", [
      { x: a.x + 30 - step * 20, y: a.y - step * 20, id: 1 },
      { x: b.x - step * 20, y: b.y - step * 20, id: 2 },
    ]);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();

  // 两指向左上拖动：视图向右下滚动（哪个方向有溢出就滚哪个方向）
  const after = await editor.viewScroll();
  expect(after.left + after.top).toBeGreaterThan(before.left + before.top);
  expect(await editor.pixelCount("ink")).toBe(0);
  expect(await editor.history()).toEqual({ undo: false, redo: false });
});

test("触屏：手指点选文字，用操作条的删除按钮删掉；手柄的点击范围是 32px", async ({ page, editor }) => {
  await editor.open();
  await editor.newBlankCanvas();
  await page.keyboard.press("t");
  await editor.placeText(298, 400, "喜茶");
  // 换工具再换回来即取消选中
  await page.keyboard.press("b");
  await page.keyboard.press("t");
  await expect(editor.button("删除")).toBeHidden();

  const p = await editor.toPage(298, 400);
  await page.touchscreen.tap(p.x, p.y);
  const handle = (await page.locator('[data-text-handle="se"]').boundingBox())!;
  expect(Math.round(handle.width)).toBe(32);
  await editor.button("删除").tap();
  await expect.poll(() => editor.pixelCount("text")).toBe(0);
});

test("触屏：开启「直线」后，点按从上一笔终点连一条直线", async ({ page, editor }) => {
  await editor.open();
  await editor.newBlankCanvas();
  await page.keyboard.press("b");
  await page.getByRole("checkbox", { name: "直线" }).check();

  const a = await editor.toPage(100, 200);
  const b = await editor.toPage(500, 600);
  await page.touchscreen.tap(a.x, a.y);
  await expect.poll(() => editor.pixelCount("ink")).toBeGreaterThan(0);
  await page.touchscreen.tap(b.x, b.y);

  // 两点之间的中点有墨迹：画的是连线，不只是两个点
  await expect.poll(async () => (await editor.inkBounds("ink"))?.bottom).toBeGreaterThan(590);
  const mid = await editor.page.locator("canvas").last().evaluate((el) => {
    const [, , , alpha] = (el as HTMLCanvasElement).getContext("2d")!.getImageData(300, 400, 1, 1).data;
    return alpha;
  });
  expect(mid).toBeGreaterThan(0);
  expect(await editor.history()).toEqual({ undo: true, redo: false });
});

// CDP 触摸事件：Playwright 自带的 touchscreen 只支持单指轻点
async function touchSession(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: "touchStart" | "touchMove" | "touchEnd", points: Point[]) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })),
    });
  return { cdp, send };
}

test("触屏默认浏览：在预览上单指滑动是滚动页面、不画；选了画笔才画；再点一次画笔回到浏览", async ({ page, editor, browserName }) => {
  test.skip(browserName !== "chromium", MULTI_TOUCH_NEEDS_CDP);
  await editor.open();
  await editor.newBlankCanvas();
  await expect(page.getByText("浏览中：单指滑动页面")).toBeVisible();
  const center = await editor.toPage(298, 500);
  const before = await page.evaluate(() => window.scrollY);
  const { cdp, send } = await touchSession(page);
  const swipe = async () => {
    await send("touchStart", [center]);
    for (let i = 1; i <= 6; i++) await send("touchMove", [{ x: center.x, y: center.y - 25 * i }]);
    await send("touchEnd", []);
  };
  await swipe();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
  expect(await editor.pixelCount("ink")).toBe(0);

  await editor.button("画笔").tap();
  await expect(page.getByText("浏览中：单指滑动页面")).toBeHidden();
  const start = await editor.toPage(298, 500);
  await send("touchStart", [start]);
  for (let i = 1; i <= 6; i++) await send("touchMove", [{ x: start.x + 10 * i, y: start.y }]);
  await send("touchEnd", []);
  await cdp.detach();
  await expect.poll(() => editor.pixelCount("ink")).toBeGreaterThan(0);

  // 实测 Chromium 在一串触摸刚结束时立刻轻点不会触发 click，隔 400ms 才会
  await page.waitForTimeout(400);
  await editor.button("画笔").tap();
  await expect(page.getByText("浏览中：单指滑动页面")).toBeVisible();
});

test("双指捏合：放大视图，不撤销也不画", async ({ page, editor, browserName }) => {
  test.skip(browserName !== "chromium", MULTI_TOUCH_NEEDS_CDP);
  await editor.open();
  await editor.newBlankCanvas();
  await page.keyboard.press("b");
  await editor.drag({ x: 100, y: 100 }, { x: 300, y: 100 });
  const ink = await editor.pixelCount("ink");

  const pinchOut = async () => {
    const shown = await editor.visibleInk();
    const mid = { x: shown.x + shown.width / 2, y: shown.y + shown.height / 2 };
    const { cdp, send } = await touchSession(page);
    await send("touchStart", [{ x: mid.x - 40, y: mid.y }]);
    await send("touchStart", [
      { x: mid.x - 40, y: mid.y },
      { x: mid.x + 40, y: mid.y },
    ]);
    for (let i = 1; i <= 6; i++) {
      await send("touchMove", [
        { x: mid.x - 40 - 10 * i, y: mid.y },
        { x: mid.x + 40 + 10 * i, y: mid.y },
      ]);
    }
    await send("touchEnd", []);
    await cdp.detach();
  };

  await pinchOut();
  // 两指距离 80 → 200：视图放大到 250%
  await expect(page.getByRole("button", { name: /^\d+%$/ })).toHaveText("250%");
  expect(await editor.pixelCount("ink")).toBe(ink);
  expect(await editor.history()).toEqual({ undo: true, redo: false });
});

test("手写笔画到一半手掌落下：笔画照常画完提交，手掌抬起不撤销", async ({ page, editor, browserName }) => {
  test.skip(browserName !== "chromium", MULTI_TOUCH_NEEDS_CDP);
  await editor.open();
  await editor.newBlankCanvas();
  await page.keyboard.press("b");
  const a = await editor.toPage(150, 300);
  const palm = await editor.toPage(400, 700);
  const cdp = await page.context().newCDPSession(page);
  const pen = (type: "mousePressed" | "mouseMoved" | "mouseReleased", x: number, y: number) =>
    cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, pointerType: "pen", clickCount: 1 });

  await pen("mousePressed", a.x, a.y);
  await pen("mouseMoved", a.x + 20, a.y);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: palm.x, y: palm.y, id: 1 }] });
  for (let i = 2; i <= 6; i++) await pen("mouseMoved", a.x + 20 * i, a.y);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await pen("mouseReleased", a.x + 120, a.y);
  await cdp.detach();

  await expect.poll(() => editor.history()).toEqual({ undo: true, redo: false });
  expect(await editor.pixelCount("ink")).toBeGreaterThan(0);
});

test("触屏上关键控件的触控目标至少 40px", async ({ page, editor }) => {
  await editor.open();
  const targets = [
    editor.button("画笔"),
    editor.button("撤销"),
    editor.button("下载 PNG"),
    editor.button("放大"),
    page.getByText("直线", { exact: true }),
    page.getByRole("slider", { name: "明暗分界" }),
  ];
  for (const target of targets) {
    const box = (await target.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(40);
  }
});

test.describe("320px 宽的小屏", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("按钮文字都在一行，也不超出所在卡片", async ({ page, editor }) => {
    await editor.open();
    await editor.newBlankCanvas();
    // 点阵模式才有「网点形状」那一排按钮
    await editor.button("黑白点阵").click();
    const problems = await page.evaluate(() =>
      [...document.querySelectorAll("section button")].flatMap((button) => {
        const box = button.getBoundingClientRect();
        if (box.width === 0) return [];
        const card = button.closest("section")!.getBoundingClientRect();
        // 按文字片段的纵向位置数行：相邻片段的 top 相差超过半个字号算换了一行
        const half = parseFloat(getComputedStyle(button).fontSize) / 2;
        const tops: number[] = [];
        const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) if (rect.width > 0) tops.push(rect.top);
        }
        tops.sort((a, b) => a - b);
        const lines = tops.filter((top, i) => i === 0 || top - tops[i - 1] > half).length;
        const name = button.textContent!.trim();
        return [
          ...(lines > 1 ? [`「${name}」折成了 ${lines} 行`] : []),
          ...(box.left < card.left - 0.5 || box.right > card.right + 0.5 ? [`「${name}」超出卡片`] : []),
        ];
      }),
    );
    expect(problems).toEqual([]);
  });
});
