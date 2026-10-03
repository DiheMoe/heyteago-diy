import { describe, expect, it, vi } from "vitest";
import { loginWithCaptcha, maskPhone, sendLoginSms, type SmsLoginDeps } from "./sms-login";

function makeDeps(overrides?: Partial<SmsLoginDeps>) {
  return {
    runCaptcha: vi.fn(async () => ({ ticket: "cap-1" })),
    requestLoginSms: vi.fn(async () => {}),
    loginByPhone: vi.fn(async () => ({ token: "tok", user: { user_main_id: 1, name: "n" } })),
    ...overrides,
  };
}

describe("sendLoginSms", () => {
  // 官方短信接口不消费人机 ticket；滑块挪回登录步，发送按钮不应再弹验证
  it("发短信不触发人机验证", async () => {
    const deps = makeDeps();
    await sendLoginSms(deps, "13800138000");
    expect(deps.requestLoginSms).toHaveBeenCalledWith("13800138000");
    expect(deps.runCaptcha).not.toHaveBeenCalled();
  });

  it("手机号不合法时不发请求", async () => {
    const deps = makeDeps();
    await expect(sendLoginSms(deps, "123")).rejects.toThrow("11 位手机号");
    expect(deps.requestLoginSms).not.toHaveBeenCalled();
  });
});

describe("loginWithCaptcha", () => {
  it("先过滑块再登录，ticket 透传给登录接口", async () => {
    const deps = makeDeps();
    const out = await loginWithCaptcha(deps, "13800138000", "123456");
    expect(out.token).toBe("tok");
    expect(deps.loginByPhone).toHaveBeenCalledWith("13800138000", "123456", "cap-1");
  });

  // ticket 一次性：失败重试用新 ticket 即可，整条路径不需要重发短信
  it("每次登录尝试都重新过滑块取新 ticket", async () => {
    let n = 0;
    const deps = makeDeps({
      runCaptcha: vi.fn(async () => ({ ticket: `cap-${++n}` })),
      loginByPhone: vi
        .fn()
        .mockRejectedValueOnce(new Error("验证码错误"))
        .mockResolvedValue({ token: "tok", user: { user_main_id: 1, name: "n" } }),
    });
    await expect(loginWithCaptcha(deps, "13800138000", "123456")).rejects.toThrow("验证码错误");
    const out = await loginWithCaptcha(deps, "13800138000", "123456");
    expect(out.token).toBe("tok");
    expect(deps.loginByPhone).toHaveBeenNthCalledWith(1, "13800138000", "123456", "cap-1");
    expect(deps.loginByPhone).toHaveBeenNthCalledWith(2, "13800138000", "123456", "cap-2");
  });

  it("缺验证码时不跑滑块", async () => {
    const deps = makeDeps();
    await expect(loginWithCaptcha(deps, "13800138000", "")).rejects.toThrow("请输入短信验证码");
    expect(deps.runCaptcha).not.toHaveBeenCalled();
  });
});

describe("maskPhone", () => {
  it("11 位号码打码", () => {
    expect(maskPhone("13800138000")).toBe("138****8000");
  });
  it("非 11 位原样返回", () => {
    expect(maskPhone("123")).toBe("123");
  });
});
