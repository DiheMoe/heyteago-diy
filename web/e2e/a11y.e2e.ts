import { expect, test } from "./fixtures";

test.describe("可访问性", () => {
  test.beforeEach(async ({ editor }) => {
    await editor.open();
  });

  test("弹窗：打开后焦点在弹窗里，Tab 不会移到弹窗外的控件；Esc 关闭后焦点回到打开它的按钮", async ({ page, editor }) => {
    const trigger = editor.button("快捷键");
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "快捷键与手势" });
    await expect(dialog).toBeVisible();
    // 焦点要么在弹窗里，要么暂时离开页面到浏览器界面（activeElement 为 body），不会落在页面其他控件上
    const focusOutsideDialog = () =>
      page.evaluate(() => {
        const el = document.activeElement;
        return !!el && el !== document.body && !el.closest("dialog");
      });
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest("dialog"))).toBe(true);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      expect(await focusOutsideDialog()).toBe(false);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("弹窗：点背板关闭", async ({ page, editor }) => {
    await editor.button("常见问题").click();
    const dialog = page.getByRole("dialog", { name: "常见问题" });
    await expect(dialog).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(dialog).toBeHidden();
  });

  test("滑块和输入框都能按标签找到，分段按钮带选中状态", async ({ page }) => {
    for (const name of ["明暗分界", "笔触粗细"]) await expect(page.getByRole("slider", { name })).toBeAttached();
    for (const name of ["手机号", "短信验证码"]) await expect(page.getByRole("textbox", { name })).toBeVisible();
    await expect(page.getByRole("button", { name: "黑白二值", pressed: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "画笔", pressed: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "裁剪填满", pressed: true })).toBeVisible();
  });

  test("选图区可以用空格键打开选图框", async ({ page }) => {
    await page.getByRole("button", { name: "点击选择、拖拽或粘贴图片" }).focus();
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.keyboard.press(" ")]);
    expect(chooser).toBeTruthy();
  });
});
