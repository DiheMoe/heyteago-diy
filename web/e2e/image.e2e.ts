import { expect, test } from "./fixtures";

test.describe("原图", () => {
  test.beforeEach(async ({ editor }) => {
    await editor.open();
  });

  test("选择图片：显示文件名，底图按这张图渲染，可以下载；原图原样自动保存", async ({ page, editor }) => {
    // 40×30 的横图，左半黑、右半白；铺满（cover）竖向画布后左半边是黑的
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 40;
      c.height = 30;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 40, 30);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, 20, 30);
      return c.toDataURL("image/png").split(",")[1];
    });
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "half.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });

    await expect(page.getByText("已选择：half.png")).toBeVisible();
    await expect(editor.button("下载 PNG")).toBeEnabled();
    const brightness = await page.locator("canvas").first().evaluate((el) => {
      const ctx = (el as HTMLCanvasElement).getContext("2d")!;
      const at = (x: number) => {
        const [r, g, b] = ctx.getImageData(x, 416, 1, 1).data;
        return r + g + b;
      };
      return { left: at(100), right: at(500) };
    });
    expect(brightness.left).toBeLessThan(100);
    expect(brightness.right).toBeGreaterThan(400);
    await expect.poll(() => editor.savedDraft()).toMatchObject({ imageType: "image/png" });
  });

  test("导入照片时自动选明暗分界：整体偏亮的照片按默认分界会全白，自动选后仍分出黑白", async ({ page }) => {
    // 左半亮度 200、右半 230：默认分界 170 下两半都变白
    const light = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 596;
      c.height = 832;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "rgb(200, 200, 200)";
      ctx.fillRect(0, 0, 298, 832);
      ctx.fillStyle = "rgb(230, 230, 230)";
      ctx.fillRect(298, 0, 298, 832);
      return c.toDataURL("image/png").split(",")[1];
    });
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "light.png", mimeType: "image/png", buffer: Buffer.from(light, "base64") });
    await expect(page.getByText("已选择：light.png")).toBeVisible();

    const threshold = Number(await page.getByRole("slider", { name: "明暗分界" }).inputValue());
    expect(threshold).toBeGreaterThan(200);
    expect(threshold).toBeLessThanOrEqual(230);
    const halves = await page.locator("canvas").first().evaluate((el) => {
      const ctx = (el as HTMLCanvasElement).getContext("2d")!;
      return [ctx.getImageData(100, 416, 1, 1).data[0], ctx.getImageData(500, 416, 1, 1).data[0]];
    });
    expect(halves).toEqual([0, 0xee]);
  });

  test("图片文件损坏或格式不支持：提示换成 JPG 或 PNG，画布仍没有原图", async ({ page, editor }) => {
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not a png") });

    await expect(page.getByText("无法读取这张图片（文件损坏或格式不支持），请换成 JPG 或 PNG")).toBeVisible();
    await expect(page.getByText("无画布")).toBeVisible();
    await expect(editor.button("下载 PNG")).toBeDisabled();
  });

  test("短边超过 1664 的大图缩成工作副本（JPEG）后照常使用", async ({ page, editor }) => {
    // 2000×1800 的图，左半黑、右半白；铺满竖向画布后中间是黑白分界
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 2000;
      c.height = 1800;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 2000, 1800);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, 1000, 1800);
      return c.toDataURL("image/png").split(",")[1];
    });
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "wide.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    await expect(page.getByText("已选择：wide.png")).toBeVisible();
    await expect(editor.button("下载 PNG")).toBeEnabled();
    const brightness = await page.locator("canvas").first().evaluate((el) => {
      const ctx = (el as HTMLCanvasElement).getContext("2d")!;
      const at = (x: number) => {
        const [r, g, b] = ctx.getImageData(x, 416, 1, 1).data;
        return r + g + b;
      };
      return { left: at(100), right: at(500) };
    });
    expect(brightness.left).toBeLessThan(100);
    expect(brightness.right).toBeGreaterThan(400);
    await expect.poll(() => editor.savedDraft()).toMatchObject({ imageType: "image/jpeg" });
  });

  test("导入时先显示「读取中…」，读完显示文件名", async ({ page }) => {
    // 读取通常很快，轮询未必赶得上：在页面里记下这段提示是否出现过
    await page.evaluate(() => {
      const w = window as unknown as { sawLoading: boolean };
      w.sawLoading = false;
      new MutationObserver(() => {
        if (document.body.textContent?.includes("读取中…")) w.sawLoading = true;
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 40;
      c.height = 30;
      c.getContext("2d")!.fillRect(0, 0, 20, 30);
      return c.toDataURL("image/png").split(",")[1];
    });
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "small.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    await expect(page.getByText("已选择：small.png")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { sawLoading: boolean }).sawLoading)).toBe(true);
  });

  test("账号登录排在最上面，原图卡片在它下面", async ({ page }) => {
    const account = (await page.getByRole("heading", { name: "账号登录" }).boundingBox())!;
    const picker = (await page.getByRole("heading", { name: "原图" }).boundingBox())!;
    expect(account.y).toBeLessThan(picker.y);
  });

  test("图片拖到预览区就导入，浏览器不会转去打开这个文件", async ({ page }) => {
    // 页面水合完成、拖拽监听挂上之前派发的事件没人处理：先等到拖拽能被接住
    await expect
      .poll(() =>
        page.evaluate(() => {
          const data = new DataTransfer();
          data.items.add(new File([""], "probe.png", { type: "image/png" }));
          const over = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: data });
          return !document.querySelectorAll("canvas")[3].dispatchEvent(over);
        }),
      )
      .toBe(true);
    const prevented = await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 40;
      c.height = 30;
      c.getContext("2d")!.fillRect(0, 0, 20, 30);
      const blob = await new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), "image/png"));
      const data = new DataTransfer();
      data.items.add(new File([blob], "dropped.png", { type: "image/png" }));
      const target = document.querySelectorAll("canvas")[3];
      const send = (type: string) =>
        !target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
      // 返回 true 表示默认行为（打开文件）被拦下
      return { dragover: send("dragover"), drop: send("drop") };
    });
    expect(prevented).toEqual({ dragover: true, drop: true });
    await expect(page.getByText("已选择：dropped.png")).toBeVisible();
  });

  test("画布上有内容时，新建空白画布要先确认：取消保留，确认才清空", async ({ page, editor }) => {
    await editor.newBlankCanvas();
    await editor.drag({ x: 100, y: 100 }, { x: 300, y: 200 });
    const ink = await editor.pixelCount("ink");

    await editor.button("新建空白画布").click();
    await expect(page.getByText("清空当前画布？")).toBeVisible();
    await editor.button("取消").click();
    await expect(page.getByText("清空当前画布？")).toBeHidden();
    expect(await editor.pixelCount("ink")).toBe(ink);

    await editor.button("新建空白画布").click();
    await editor.button("清空").click();
    await expect.poll(() => editor.pixelCount("ink")).toBe(0);
    expect(await editor.history()).toEqual({ undo: false, redo: false });
  });
});
