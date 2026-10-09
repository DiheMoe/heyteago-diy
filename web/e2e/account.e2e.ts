import { expect, test } from "./fixtures";

const TOKEN_KEY = "heyteago-diy:token";

test.describe("账号", () => {
  test("短信登录后默认在本机保持登录；退出登录后刷新仍是未登录", async ({ page, editor }) => {
    await editor.open();
    await page.getByPlaceholder("手机号").fill("+86 138 0013 8000");
    await editor.button("发送验证码").click();
    await expect(page.getByText("验证码已发送至 138****8000，请查收")).toBeVisible();
    await page.getByPlaceholder("短信验证码").fill("123456");
    await editor.button("登录").click();
    await expect(page.getByText("已登录：测试账号")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /在本机保持登录/ })).toBeChecked();

    await page.reload();
    await expect(page.getByText("已登录：测试账号")).toBeVisible();

    await editor.button("退出登录").click();
    await expect(editor.button("登录")).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY)).toBeNull();
    await page.reload();
    await expect(editor.button("登录")).toBeVisible();
    await expect(page.getByText("已登录：测试账号")).toBeHidden();
  });

  test("取消「在本机保持登录」不影响当前登录，刷新后回到未登录", async ({ page, editor }) => {
    // 真正登录一次（夹具的 savedToken 用初始化脚本写入，每次刷新都会重新写回）
    await editor.open();
    await page.getByText("手动粘贴 token（抓包获取）").click();
    await page.getByPlaceholder("粘贴 App 通道 token").fill("pasted-token");
    await expect(page.getByText("已登录：测试账号")).toBeVisible();
    await page.getByRole("checkbox", { name: /在本机保持登录/ }).uncheck();
    await expect(page.getByText("已登录：测试账号")).toBeVisible();

    await page.reload();
    await expect(page.getByText("已登录：测试账号")).toBeHidden();
    await expect(editor.button("登录")).toBeVisible();
  });

  test("手动粘贴 token 后自动验证并登录", async ({ page, editor }) => {
    await editor.open();
    await page.getByText("手动粘贴 token（抓包获取）").click();
    await page.getByPlaceholder("粘贴 App 通道 token").fill("pasted-token");
    await expect(page.getByText("已登录：测试账号")).toBeVisible();
  });

  test("本机保存的登录已过期：提示重新登录，并清除保存的 token", async ({ page, api, editor }) => {
    api.queueUser("expired");
    await editor.open({ savedToken: true });
    await expect(page.getByText("登录已过期，请重新登录")).toBeVisible();
    await expect(editor.button("登录")).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY)).toBeNull();
  });

  test("暂时无法验证登录状态：保留登录信息并可重试；确认前不能存草稿或发布", async ({ page, api, editor }) => {
    api.queueUser("502");
    await editor.open({ savedToken: true });
    await editor.newBlankCanvas();
    await expect(page.getByText(/暂时无法验证登录状态/)).toBeVisible();
    await expect(editor.button("存为喜茶草稿")).toBeDisabled();
    expect(await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY)).not.toBeNull();

    await editor.button("重试").click();
    await expect(page.getByText("已登录：测试账号")).toBeVisible();
    await expect(editor.button("存为喜茶草稿")).toBeEnabled();
  });

  test("已登录时复制 token：先提醒不要分享给任何人，确认后才复制；取消不复制", async ({ page, context, editor, browserName }) => {
    test.skip(browserName !== "chromium", "测试里读取剪贴板只在 Chromium 上可行");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await editor.open({ signedIn: true });
    await page.evaluate(() => navigator.clipboard.writeText("剪贴板原来的内容"));

    const copyButton = editor.button("复制 token");
    const width = (await copyButton.boundingBox())!.width;
    await copyButton.click();
    await expect(page.getByText("请勿把 token 分享给任何人")).toBeVisible();
    await editor.button("取消").click();
    await expect(page.getByText("请勿把 token 分享给任何人")).toBeHidden();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("剪贴板原来的内容");

    await copyButton.click();
    await editor.button("我了解，复制").click();
    // 复制成功：按钮短暂显示「✓ 已复制」，宽度不变
    const copied = editor.button("✓ 已复制");
    await expect(copied).toBeVisible();
    expect((await copied.boundingBox())!.width).toBe(width);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("e2e-token");
    await expect(page.getByText("请勿把 token 分享给任何人")).toBeHidden();
    await expect(copyButton).toBeVisible();
  });

  test("浏览器不允许自动复制时：同样先提醒，再把 token 显示出来供手动复制", async ({ page, editor }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new DOMException("不允许", "NotAllowedError")) },
      });
    });
    await editor.open({ signedIn: true });
    await editor.button("复制 token").click();
    await editor.button("我了解，复制").click();
    await expect(page.getByRole("textbox", { name: "token" })).toHaveValue("e2e-token");
    await expect(page.getByText("请勿把 token 分享给任何人")).toBeVisible();
    await editor.button("完成").click();
    await expect(page.getByRole("textbox", { name: "token" })).toBeHidden();
  });
});
