import { expect, test } from "./fixtures";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("未登录也能下载编辑后的 PNG，草稿和发布需要登录", async ({ page, api, editor }) => {
  await editor.open();
  await editor.newBlankCanvas();
  await editor.tool("画笔");
  await editor.drag({ x: 100, y: 100 }, { x: 300, y: 200 });

  await expect(editor.button("存为喜茶草稿")).toBeDisabled();
  await expect(editor.button("发布杯贴")).toBeDisabled();
  await expect(page.getByText("登录后可存草稿或发布")).toBeVisible();

  const png = await editor.download();
  expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  expect(api.count("/api/upload") + api.count("/api/draft/save")).toBe(0);
});

test("下载的 PNG 包含文字", async ({ editor }) => {
  await editor.open();
  await editor.newBlankCanvas();
  const plain = await editor.download();
  // 画面不变时导出结果不变，下面的差异才能归因于文字
  expect((await editor.download()).equals(plain)).toBe(true);

  await editor.tool("文字");
  await editor.placeText(298, 400, "喜茶");
  expect((await editor.download()).equals(plain)).toBe(false);
});

test("彩色、带半透明的原图导出后，成品只有黑和喜茶底色两种颜色", async ({ page, editor }) => {
  await editor.open();
  const source = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 300;
    c.height = 400;
    const g = c.getContext("2d")!;
    const gradient = g.createLinearGradient(0, 0, 300, 400);
    gradient.addColorStop(0, "rgba(255, 0, 0, 1)");
    gradient.addColorStop(0.5, "rgba(0, 160, 255, 0.4)");
    gradient.addColorStop(1, "rgba(40, 200, 40, 0)");
    g.fillStyle = gradient;
    g.fillRect(0, 0, 300, 400);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "color.png", mimeType: "image/png", buffer: Buffer.from(source, "base64") });
  await expect(editor.button("下载 PNG")).toBeEnabled();

  const { width, height, rgba } = await editor.decodePng(await editor.download());
  expect({ width, height }).toEqual({ width: 596, height: 832 });
  const colors = new Set<string>();
  for (let i = 0; i < rgba.length; i += 4) colors.add(rgba.subarray(i, i + 4).join(","));
  expect(colors).toEqual(new Set(["0,0,0,255", "238,238,238,255"]));
});

test("下载的文件名带日期和时间", async ({ page, editor }) => {
  await editor.open();
  await editor.newBlankCanvas();
  const [file] = await Promise.all([page.waitForEvent("download"), editor.button("下载 PNG").click()]);
  expect(file.suggestedFilename()).toMatch(/^heytea-cup-\d{8}-\d{6}\.png$/);
});

test("浏览器支持分享图片时，「分享 / 存到相册」把成品交给系统分享；被要求重新点击时再点一次即可", async ({ page, editor }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { shared?: Array<{ name: string; type: string }>; shareCalls: number };
    w.shareCalls = 0;
    navigator.canShare = () => true;
    navigator.share = async (data?: ShareData) => {
      w.shareCalls++;
      // 第一次模拟浏览器以「点击已过期」拒绝
      if (w.shareCalls === 1) throw new DOMException("需要用户操作", "NotAllowedError");
      w.shared = (data?.files ?? []).map((f) => ({ name: f.name, type: f.type }));
    };
  });
  await editor.open();
  await editor.newBlankCanvas();

  await editor.button("分享 / 存到相册").click();
  await expect(page.getByText("请再点一次「分享 / 存到相册」")).toBeVisible();
  await editor.button("分享 / 存到相册").click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { shared?: unknown }).shared))
    .toEqual([{ name: expect.stringMatching(/^heytea-cup-\d{8}-\d{6}\.png$/), type: "image/png" }]);
});

test("浏览器不支持分享图片时不显示分享按钮", async ({ editor }) => {
  await editor.open();
  await editor.newBlankCanvas();
  await expect(editor.button("分享 / 存到相册")).toBeHidden();
});
