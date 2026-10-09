import { expect, test } from "./fixtures";

test("弹窗打开时、在输入框里打字时按键不切工具；其余时候切换", async ({ page, editor }) => {
  await editor.open();
  await editor.newBlankCanvas();

  await editor.button("快捷键").click();
  await page.keyboard.press("e");
  await page.keyboard.press("Escape");
  await page.getByText("手动粘贴 token（抓包获取）").click();
  await page.getByPlaceholder("粘贴 App 通道 token").pressSequentially("e");
  // 仍是画笔：画出的是墨迹，不是擦除标记
  await editor.drag({ x: 100, y: 100 }, { x: 300, y: 100 });
  expect(await editor.pixelCount("ink")).toBeGreaterThan(0);
  expect(await editor.pixelCount("erase")).toBe(0);

  // 在画布上按下已让输入框失焦
  await page.keyboard.press("e");
  await editor.drag({ x: 100, y: 300 }, { x: 300, y: 300 });
  expect(await editor.pixelCount("erase")).toBeGreaterThan(0);
});

test("滑块获得焦点时快捷键照常可用：V 切到移动工具，E 切到橡皮擦", async ({ page, editor }) => {
  await editor.open();
  await editor.newBlankCanvas();
  await page.getByRole("slider", { name: "明暗分界" }).focus();
  await page.keyboard.press("v");
  await editor.drag({ x: 100, y: 100 }, { x: 300, y: 100 });
  // 移动工具：不画墨迹
  expect(await editor.pixelCount("ink")).toBe(0);

  await page.getByRole("slider", { name: "明暗分界" }).focus();
  await page.keyboard.press("e");
  await editor.drag({ x: 100, y: 300 }, { x: 300, y: 300 });
  expect(await editor.pixelCount("erase")).toBeGreaterThan(0);
});
