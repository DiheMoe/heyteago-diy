import { expect, test } from "./fixtures";

test.describe("取景与设置的撤销", () => {
  test.beforeEach(async ({ editor }) => {
    await editor.open();
    await editor.newBlankCanvas();
  });

  test("拖一次滑块算一步撤销：拖两次，撤销两步回到原值", async ({ page, editor }) => {
    const threshold = page.getByRole("slider", { name: "明暗分界" });
    const box = (await threshold.boundingBox())!;
    const y = box.y + box.height / 2;
    const drag = async (from: number, to: number) => {
      await page.mouse.move(box.x + box.width * from, y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * to, y, { steps: 8 });
      await page.mouse.up();
    };
    await expect(threshold).toHaveValue("170");

    await drag(0.7, 0.9);
    const first = await threshold.inputValue();
    await drag(0.9, 0.3);
    expect(Number(first)).toBeGreaterThan(170);
    expect(Number(await threshold.inputValue())).toBeLessThan(170);

    await editor.button("撤销").click();
    await expect(threshold).toHaveValue(first);
    await editor.button("撤销").click();
    await expect(threshold).toHaveValue("170");
    await expect(editor.button("撤销")).toBeDisabled();
  });

  test("画布上有笔画时，取景卡片提示笔画和文字不随原图移动", async ({ page, editor }) => {
    const notice = page.getByText("画笔和文字固定在画布上，不随原图移动");
    await expect(notice).toBeHidden();
    await editor.tool("画笔");
    await editor.drag({ x: 100, y: 100 }, { x: 300, y: 100 });
    await expect(notice).toBeVisible();
    await editor.undo();
    await expect(notice).toBeHidden();
  });

  test("明暗分界在二值和点阵模式下都是往右更黑", async ({ page }) => {
    // 从左到右由白变黑的渐变图
    const gradient = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 596;
      c.height = 832;
      const ctx = c.getContext("2d")!;
      const g = ctx.createLinearGradient(0, 0, 596, 0);
      g.addColorStop(0, "#fff");
      g.addColorStop(1, "#000");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 596, 832);
      return c.toDataURL("image/png").split(",")[1];
    });
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "gradient.png", mimeType: "image/png", buffer: Buffer.from(gradient, "base64") });
    await expect(page.getByText("已选择：gradient.png")).toBeVisible();
    const blackPixels = () =>
      page.locator("canvas").first().evaluate((el) => {
        const { data } = (el as HTMLCanvasElement).getContext("2d")!.getImageData(0, 0, 596, 832);
        let count = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] === 0) count++;
        return count;
      });
    const slider = page.getByRole("slider", { name: "明暗分界" });
    for (const mode of ["黑白二值", "黑白点阵"]) {
      await page.getByRole("button", { name: mode }).click();
      await slider.focus();
      await page.keyboard.press("Home");
      const left = await blackPixels();
      await page.keyboard.press("End");
      expect(await blackPixels()).toBeGreaterThan(left);
    }
  });

  test("旋转后按钮大小不变，当前角度显示在按钮旁边", async ({ page, editor }) => {
    const rotate = editor.button("旋转");
    const before = (await rotate.boundingBox())!;
    await rotate.click();
    await expect(page.getByText("90°", { exact: true })).toBeVisible();
    const after = (await rotate.boundingBox())!;
    expect([after.width, after.height]).toEqual([before.width, before.height]);
    await expect(rotate).toHaveText("旋转");
  });
});
