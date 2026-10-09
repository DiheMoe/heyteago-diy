import { expect, test, type UploadOutcome } from "./fixtures";

const UNKNOWN_WARNING = "上次发布这张图时网络异常，结果未知";

test.describe("发布与存草稿", () => {
  test.beforeEach(async ({ editor }) => {
    await editor.open({ signedIn: true });
    await editor.newBlankCanvas();
  });

  test("成品大于 200KB：存草稿、发布都提示不能大于 200KB，不发请求；下载不受限", async ({ page, api, editor, browserName }) => {
    // 逐像素随机的黑白图：二值化后满是细节，浏览器编码出的 PNG 远超 200KB
    const noise = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 596;
      c.height = 832;
      const ctx = c.getContext("2d")!;
      const image = ctx.createImageData(596, 832);
      let seed = 1;
      for (let i = 0; i < image.data.length; i += 4) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        const v = seed < 1073741824 ? 0 : 255;
        image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
        image.data[i + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
      return c.toDataURL("image/png").split(",")[1];
    });
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "noise.png", mimeType: "image/png", buffer: Buffer.from(noise, "base64") });
    await expect(page.getByText("已选择：noise.png")).toBeVisible();
    // 成品大小取决于浏览器的 PNG 编码器：实测 Chromium 约 264KB，WebKit 约 153KB
    const size = (await editor.download()).length;
    test.skip(size <= 200 * 1024, `${browserName} 把这张图编码到 ${Math.ceil(size / 1024)}KB，没超过上限`);
    const tooBig = page.getByText(/^成品 \d+KB，不能大于 200KB/);

    await editor.button("存为喜茶草稿").click();
    await expect(tooBig).toBeVisible();
    await editor.button("发布杯贴").click();
    await expect(tooBig).toBeVisible();
    await expect(editor.button("确认发布")).toBeHidden();
    expect(api.count("/api/draft/save") + api.count("/api/upload")).toBe(0);
  });

  test("结果未知的图刷新页面后再发布，仍提醒先去确认", async ({ page, api, editor }) => {
    api.queueUploads("502");
    await editor.button("发布杯贴").click();
    await editor.button("确认发布").click();
    await expect(page.getByText(UNKNOWN_WARNING)).toBeVisible();

    await page.reload();
    await editor.newBlankCanvas();
    await editor.button("发布杯贴").click();
    await expect(page.getByText(UNKNOWN_WARNING)).toBeVisible();
  });

  test("发布在途时调参和旋转：按钮保持禁用，只发出一个上传请求", async ({ page, api, editor }) => {
    const release = api.hold("/api/upload");
    await editor.button("发布杯贴").click();
    await editor.button("确认发布").click();
    await expect.poll(() => api.inFlight("/api/upload")).toBe(1);

    // 调阈值和旋转都会触发底图重新渲染
    await page.getByRole("slider", { name: "明暗分界" }).focus();
    await page.keyboard.press("ArrowRight");
    await page.getByRole("button", { name: /^旋转/ }).click();

    await expect(editor.button("发布中…")).toBeDisabled();
    await expect(editor.button("存为喜茶草稿")).toBeDisabled();

    release();
    // 发布成功给出醒目的结果卡片，读屏会播报
    await expect(page.getByRole("status").filter({ hasText: "发布成功（mock），去喜茶小程序查看吧" })).toBeVisible();
    await expect(editor.button("发布杯贴")).toBeEnabled();
    expect(api.count("/api/upload")).toBe(1);
  });

  test("存草稿在途时旋转：草稿按钮保持禁用，只发出一个请求", async ({ page, api, editor }) => {
    const release = api.hold("/api/draft/save");
    await editor.button("存为喜茶草稿").click();
    await expect.poll(() => api.inFlight("/api/draft/save")).toBe(1);

    await page.getByRole("button", { name: /^旋转/ }).click();
    await expect(editor.button("保存中…")).toBeDisabled();

    release();
    await expect(page.getByText("草稿已保存（mock）")).toBeVisible();
    await expect(editor.button("存为喜茶草稿")).toBeEnabled();
    expect(api.count("/api/draft/save")).toBe(1);
  });

  for (const outcome of ["502", "abort", "500"] satisfies UploadOutcome[]) {
    test(`发布结果未知（${outcome}）：提示先去小程序确认，重试按钮改名`, async ({ page, api, editor }) => {
      api.queueUploads(outcome);
      await editor.button("发布杯贴").click();
      await editor.button("确认发布").click();

      await expect(page.getByText(UNKNOWN_WARNING)).toBeVisible();
      await expect(editor.button("确认未发布，重新发布")).toBeEnabled();
      await expect(page.getByText(/^发布结果未知/)).toBeVisible();
    });
  }

  test("结果未知的图取消后再导出仍有警告；重试成功后显示重复提示", async ({ page, api, editor }) => {
    api.queueUploads("502");
    await editor.button("发布杯贴").click();
    await editor.button("确认发布").click();
    await expect(editor.button("确认未发布，重新发布")).toBeVisible();
    await editor.button("取消").click();

    await editor.button("发布杯贴").click();
    await expect(page.getByText(UNKNOWN_WARNING)).toBeVisible();
    await editor.button("确认未发布，重新发布").click();
    await expect(page.getByText("发布成功（mock）")).toBeVisible();

    await editor.button("发布杯贴").click();
    await expect(page.getByText("这张图片与上次上传的完全相同")).toBeVisible();
    await expect(page.getByText(UNKNOWN_WARNING)).toBeHidden();
    await expect(editor.button("确认发布")).toBeVisible();
    expect(api.count("/api/upload")).toBe(2);
  });

  test("明确被拒（400）：只显示错误，不提示结果未知", async ({ page, api, editor }) => {
    api.queueUploads("400");
    await editor.button("发布杯贴").click();
    await editor.button("确认发布").click();

    await expect(page.getByText("图片审核未通过")).toBeVisible();
    await expect(page.getByText(UNKNOWN_WARNING)).toBeHidden();
    await expect(editor.button("确认发布")).toBeEnabled();
  });

  test("导出期间画布被改动：不进确认态，提示重新发布", async ({ page, api, editor }) => {
    await editor.tool("画笔");
    await page.evaluate(() => {
      const publish = [...document.querySelectorAll("button")].find((b) => b.textContent === "发布杯贴")!;
      const ink = document.querySelectorAll("canvas")[3];
      const rect = ink.getBoundingClientRect();
      const pointer = (type: string, x: number, y: number) =>
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 7,
          pointerType: "mouse",
          isPrimary: true,
          clientX: rect.left + x,
          clientY: rect.top + y,
          pressure: 0.5,
          buttons: 1,
        });
      // 导出是异步的：同一个任务里紧接着画的一笔必然发生在导出完成之前
      publish.click();
      ink.dispatchEvent(pointer("pointerdown", 60, 60));
      ink.dispatchEvent(pointer("pointermove", 120, 90));
      ink.dispatchEvent(pointer("pointerup", 120, 90));
    });

    await expect(page.getByText("导出期间画布或账号有改动，请重新点击「发布杯贴」")).toBeVisible();
    await expect(editor.button("确认发布")).toBeHidden();
    expect(api.count("/api/upload")).toBe(0);
  });

  test("导出期间退出登录：不进确认态，提示重新发布", async ({ page, api, editor }) => {
    await page.evaluate(() => {
      const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;
      // 导出是异步的：同一个任务里紧接着退出登录，必然发生在导出完成之前
      button("发布杯贴").click();
      button("退出登录").click();
    });

    await expect(page.getByText("导出期间画布或账号有改动，请重新点击「发布杯贴」")).toBeVisible();
    await expect(editor.button("确认发布")).toBeHidden();
    expect(api.count("/api/upload")).toBe(0);
  });

  test("进入确认态后切换「在本机保持登录」：账号没变，确认框保留", async ({ page, editor }) => {
    await editor.button("发布杯贴").click();
    await expect(editor.button("确认发布")).toBeVisible();

    await page.getByRole("checkbox", { name: /在本机保持登录/ }).uncheck();

    await expect(editor.button("确认发布")).toBeVisible();
    await expect(page.getByText("已登录：测试账号")).toBeVisible();
  });

  test("进入确认态后退出登录：确认框消失，不发请求", async ({ api, editor }) => {
    await editor.button("发布杯贴").click();
    await expect(editor.button("确认发布")).toBeVisible();

    await editor.button("退出登录").click();

    await expect(editor.button("确认发布")).toBeHidden();
    await expect(editor.button("发布杯贴")).toBeDisabled();
    expect(api.count("/api/upload")).toBe(0);
  });

  test("发布时登录已过期：退出登录并提示重新登录", async ({ page, api, editor }) => {
    api.queueUploads("expired");
    await editor.button("发布杯贴").click();
    await editor.button("确认发布").click();

    await expect(page.getByText("登录已过期，请重新登录后再试")).toBeVisible();
    await expect(page.getByText("已登录：测试账号")).toBeHidden();
    await expect(page.getByText(/^发布结果未知/)).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem("heyteago-diy:token"))).toBeNull();
  });
});
