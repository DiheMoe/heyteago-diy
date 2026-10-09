// 端到端测试的公共夹具：接口 mock 与画布操作。
// 接口一律在浏览器层拦截，请求到不了前端代理，测试不会碰真实后端或喜茶。
import { test as base, expect, type Page, type Route } from "@playwright/test";

export type UploadOutcome = "ok" | "400" | "expired" | "500" | "502" | "abort";
// /api/user 的结果：正常、登录态失效（喜茶业务码 401）、与喜茶通信失败
export type UserOutcome = "ok" | "expired" | "502";

const USER = { user_main_id: 42, name: "测试账号" };
const FAKE_CAPTCHA = `window.TencentCaptcha = function (appId, onResult) {
  return { show() { setTimeout(() => onResult({ ret: 0, ticket: "e2e-ticket", randstr: "e2e" }), 0); }, destroy() {} };
};`;
const TOKEN_STORAGE_KEY = "heyteago-diy:token";
const CUP_WIDTH = 596;
const CUP_HEIGHT = 832;

// 图层在 DOM 中的顺序就是合成顺序：底图、擦除、文字、墨迹（最上层接收指针）
const LAYER_INDEX = { base: 0, erase: 1, text: 2, ink: 3 } as const;
export type Layer = keyof typeof LAYER_INDEX;

export interface Point {
  x: number;
  y: number;
}

export class ApiMock {
  private readonly started = new Map<string, number>();
  private readonly finished = new Map<string, number>();
  private readonly holds = new Map<string, Promise<void>>();
  private readonly uploadOutcomes: UploadOutcome[] = [];
  private readonly userOutcomes: UserOutcome[] = [];

  count(path: string): number {
    return this.started.get(path) ?? 0;
  }

  inFlight(path: string): number {
    return this.count(path) - (this.finished.get(path) ?? 0);
  }

  // 之后的上传依次按给定结果响应，用完后恢复为成功
  queueUploads(...outcomes: UploadOutcome[]) {
    this.uploadOutcomes.push(...outcomes);
  }

  // 之后带 token 的用户查询依次按给定结果响应，用完后恢复为正常
  queueUser(...outcomes: UserOutcome[]) {
    this.userOutcomes.push(...outcomes);
  }

  // 该路径之后的请求一直挂起，直到调用返回的 release
  hold(path: string): () => void {
    let release!: () => void;
    this.holds.set(path, new Promise<void>((resolve) => (release = resolve)));
    return () => {
      this.holds.delete(path);
      release();
    };
  }

  async handle(route: Route) {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    this.started.set(path, this.count(path) + 1);
    try {
      await this.holds.get(path);
      await this.respond(route, path, request.headers()["authorization"]);
    } finally {
      this.finished.set(path, (this.finished.get(path) ?? 0) + 1);
    }
  }

  private async respond(route: Route, path: string, authorization: string | undefined) {
    if (path === "/api/user") {
      if (!authorization) return json(route, 400, { message: "缺少授权 token" });
      const outcome = this.userOutcomes.shift() ?? "ok";
      if (outcome === "expired") return json(route, 400, { message: "登录态失效", code: 401 });
      if (outcome === "502") return json(route, 502, { message: "连接喜茶超时或中断" });
      return json(route, 200, { user: USER });
    }
    if (path === "/api/login/sms") return json(route, 200, {});
    if (path === "/api/login") return json(route, 200, { token: "sms-token", user: USER });
    if (path === "/api/draft/save") return json(route, 200, { message: "草稿已保存（mock）" });
    if (path === "/api/upload") {
      const outcome = this.uploadOutcomes.shift() ?? "ok";
      switch (outcome) {
        case "ok":
          return json(route, 200, { message: "发布成功（mock）" });
        case "400":
          return json(route, 400, { message: "图片审核未通过", code: 50001 });
        case "expired":
          return json(route, 400, { message: "登录态失效", code: 401 });
        case "502":
          return json(route, 502, { message: "连接喜茶超时或中断" });
        case "500":
          return route.fulfill({ status: 500, contentType: "text/plain", body: "Internal Server Error" });
        case "abort":
          return route.abort("failed");
      }
    }
    return json(route, 404, { message: `未 mock 的接口 ${path}` });
  }
}

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

export class Editor {
  constructor(readonly page: Page) {}

  button(name: string | RegExp) {
    return this.page.getByRole("button", { name, exact: typeof name === "string" });
  }

  textInput() {
    return this.page.getByPlaceholder("输入文字");
  }

  // savedToken：本机已保存登录 token（默认与 signedIn 相同）；signedIn 时等到显示已登录
  async open({ signedIn = false, savedToken = signedIn }: { signedIn?: boolean; savedToken?: boolean } = {}) {
    if (savedToken) {
      await this.page.addInitScript(([key, token]) => localStorage.setItem(key, token), [TOKEN_STORAGE_KEY, "e2e-token"]);
    }
    await this.page.goto("/");
    if (signedIn) await expect(this.page.getByText(`已登录：${USER.name}`)).toBeVisible();
  }

  // 下载按钮只取决于画布就绪与底图渲染落定，可用即表示渲染已落定
  async newBlankCanvas() {
    await this.button("新建空白画布").click();
    await expect(this.button("下载 PNG")).toBeEnabled();
  }

  async tool(name: "移动" | "画笔" | "橡皮擦" | "文字") {
    await this.button(name).click();
  }

  private layer(layer: Layer) {
    return this.page.locator("canvas").nth(LAYER_INDEX[layer]);
  }

  // 画布坐标（596×832）→ 页面坐标
  async toPage(x: number, y: number): Promise<Point> {
    const ink = this.layer("ink");
    await ink.scrollIntoViewIfNeeded();
    const box = await ink.boundingBox();
    if (!box) throw new Error("画布不可见");
    return { x: box.x + (x / CUP_WIDTH) * box.width, y: box.y + (y / CUP_HEIGHT) * box.height };
  }

  // 预览区滚动容器（画布叠层的外层）的滚动位置：双指平移滚动的就是它
  async viewScroll(): Promise<{ left: number; top: number }> {
    return this.layer("ink").evaluate((el) => {
      const view = el.parentElement!.parentElement!;
      return { left: view.scrollLeft, top: view.scrollTop };
    });
  }

  // 墨迹层画布在屏幕上实际可见的部分（页面坐标）：放大后画布超出预览区，超出部分被裁掉、点不到
  async visibleInk(): Promise<{ x: number; y: number; width: number; height: number }> {
    return this.layer("ink").evaluate((el) => {
      const c = el.getBoundingClientRect();
      const v = el.parentElement!.parentElement!.getBoundingClientRect();
      const x = Math.max(c.left, v.left, 0);
      const y = Math.max(c.top, v.top, 0);
      const right = Math.min(c.right, v.right, window.innerWidth);
      const bottom = Math.min(c.bottom, v.bottom, window.innerHeight);
      return { x, y, width: right - x, height: bottom - y };
    });
  }

  // 页面上这一点按下时是否落在墨迹层画布上
  async inkAt(p: Point): Promise<boolean> {
    return this.layer("ink").evaluate((el, { x, y }) => document.elementFromPoint(x, y) === el, p);
  }

  // 画布像素与页面像素之比（页面像素 = 画布像素 × scale）
  async scale(): Promise<number> {
    const box = await this.layer("ink").boundingBox();
    if (!box) throw new Error("画布不可见");
    return box.height / CUP_HEIGHT;
  }

  // 该图层非透明像素数与其纵向重心（画布坐标）
  async pixels(layer: Layer): Promise<{ count: number; centerY: number | null }> {
    return this.layer(layer).evaluate((el) => {
      const canvas = el as HTMLCanvasElement;
      const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      let sumY = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) {
          count++;
          sumY += Math.floor(i / 4 / canvas.width);
        }
      }
      return { count, centerY: count ? Math.round(sumY / count) : null };
    });
  }

  async pixelCount(layer: Layer): Promise<number> {
    return (await this.pixels(layer)).count;
  }

  // 该图层非透明像素的外接矩形（画布坐标）；图层为空时返回 null
  async inkBounds(layer: Layer): Promise<{ left: number; top: number; right: number; bottom: number } | null> {
    return this.layer(layer).evaluate((el) => {
      const canvas = el as HTMLCanvasElement;
      const { width, height } = canvas;
      const data = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
      let left = width;
      let top = height;
      let right = -1;
      let bottom = -1;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] === 0) continue;
        const x = (i >> 2) % width;
        const y = Math.floor((i >> 2) / width);
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
      return right < 0 ? null : { left, top, right, bottom };
    });
  }

  async click(x: number, y: number, modifiers: Array<"Shift"> = []) {
    const p = await this.toPage(x, y);
    for (const m of modifiers) await this.page.keyboard.down(m);
    await this.page.mouse.click(p.x, p.y);
    for (const m of modifiers) await this.page.keyboard.up(m);
  }

  async dblclick(x: number, y: number) {
    const p = await this.toPage(x, y);
    await this.page.mouse.dblclick(p.x, p.y);
  }

  async drag(from: Point, to: Point, steps = 8) {
    const a = await this.toPage(from.x, from.y);
    const b = await this.toPage(to.x, to.y);
    await this.page.mouse.move(a.x, a.y);
    await this.page.mouse.down();
    await this.page.mouse.move(b.x, b.y, { steps });
    await this.page.mouse.up();
  }

  // 文字工具下在 (x, y) 放置文字，输入后点「完成」；content 里的 \n 是回车换行
  async placeText(x: number, y: number, content: string) {
    await this.click(x, y);
    await expect(this.textInput()).toBeVisible();
    await this.page.keyboard.type(content);
    await this.button("完成").click();
    await expect(this.textInput()).toBeHidden();
  }

  // 手柄中心（页面坐标）
  async handleCenter(name: "nw" | "ne" | "se" | "sw" | "rotate"): Promise<Point> {
    const box = await this.page.locator(`[data-text-handle="${name}"]`).boundingBox();
    if (!box) throw new Error("没有选中的文字");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  // 选中的单行未旋转文字的字号：左侧上下两个角手柄的距离（换算回画布像素）
  async textSize(): Promise<number> {
    const nw = await this.handleCenter("nw");
    const sw = await this.handleCenter("sw");
    return Math.round((sw.y - nw.y) / (await this.scale()));
  }

  // 本机自动保存的记录：几笔、几段文字、原图的文件类型；没有记录时为 null
  async savedDraft(): Promise<{ strokes: number; texts: number; imageType: string } | null> {
    return this.page.evaluate(
      () =>
        new Promise<{ strokes: number; texts: number; imageType: string } | null>((resolve, reject) => {
          const open = indexedDB.open("heyteago-diy", 1);
          open.onupgradeneeded = () => open.result.createObjectStore("autosave");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const get = db.transaction("autosave").objectStore("autosave").get("draft");
            get.onsuccess = () => {
              db.close();
              const r = get.result as { strokes: unknown[]; texts: unknown[]; imageType: string } | undefined;
              resolve(r ? { strokes: r.strokes.length, texts: r.texts.length, imageType: r.imageType } : null);
            };
            get.onerror = () => reject(get.error);
          };
        }),
    );
  }

  async undo() {
    await this.page.keyboard.press("ControlOrMeta+z");
  }

  async redo() {
    await this.page.keyboard.press("ControlOrMeta+Shift+z");
  }

  async history(): Promise<{ undo: boolean; redo: boolean }> {
    return { undo: await this.button("撤销").isEnabled(), redo: await this.button("重做").isEnabled() };
  }

  // 用浏览器解码 PNG，返回逐像素的 RGBA
  async decodePng(png: Buffer): Promise<{ width: number; height: number; rgba: Uint8Array }> {
    const decoded = await this.page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }), {
        colorSpaceConversion: "none",
        premultiplyAlpha: "none",
      });
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let binary = "";
      for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
      return { width: bitmap.width, height: bitmap.height, rgba: btoa(binary) };
    }, png.toString("base64"));
    return { width: decoded.width, height: decoded.height, rgba: new Uint8Array(Buffer.from(decoded.rgba, "base64")) };
  }

  async download(): Promise<Buffer> {
    const [file] = await Promise.all([this.page.waitForEvent("download"), this.button("下载 PNG").click()]);
    const chunks: Buffer[] = [];
    for await (const chunk of await file.createReadStream()) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  // 两指同时落下再一起抬起（CDP 触摸事件；Playwright 自带的 touchscreen 只支持单指）
  async twoFingerTap(a: Point, b: Point) {
    const pa = await this.toPage(a.x, a.y);
    const pb = await this.toPage(b.x, b.y);
    const cdp = await this.page.context().newCDPSession(this.page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pa.x, y: pa.y, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: pa.x, y: pa.y, id: 1 },
        { x: pb.x, y: pb.y, id: 2 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  }
}

// 夹具回调的第二个参数按 Playwright 惯例叫 use，这里改名 provide：
// react-hooks 的 lint 规则会把名为 use 的调用当成 React Hook。
// api 设为自动夹具：每个测试在任何导航之前就拦截接口，没声明它的测试也不会发出真实请求
export const test = base.extend<{ api: ApiMock; editor: Editor }>({
  api: [
    async ({ page }, provide) => {
      const api = new ApiMock();
      await page.route("**/api/**", (route) => api.handle(route));
      // 腾讯滑块脚本换成立即验证通过的假实现：测试不加载外部脚本
      await page.route("https://turing.captcha.qcloud.com/**", (route) =>
        route.fulfill({ contentType: "application/javascript", body: FAKE_CAPTCHA }),
      );
      await provide(api);
    },
    { auto: true },
  ],
  editor: async ({ page }, provide) => {
    await provide(new Editor(page));
  },
});

export { expect };
