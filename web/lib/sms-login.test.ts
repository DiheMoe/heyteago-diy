import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { loginWithCaptcha, maskPhone, sendLoginSms, SMS_NEED_CAPTCHA, type SmsLoginDeps } from "./sms-login";

function makeDeps(overrides?: Partial<SmsLoginDeps>) {
  return {
    runCaptcha: vi.fn(async () => ({ ticket: "cap-1", randstr: "rand-1" })),
    requestLoginSms: vi.fn(async () => {}),
    loginByPhone: vi.fn(async () => ({ token: "tok", user: { user_main_id: 1, name: "n" } })),
    ...overrides,
  };
}

describe("sendLoginSms", () => {
  // 风控平静时直发即成功，不打扰用户过滑块
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

  // 上游风控要求人机验证（4005021）时：过滑块、带 ticket+randstr 重试一次
  it("命中 4005021 时过滑块带验证重试", async () => {
    const deps = makeDeps({
      requestLoginSms: vi
        .fn()
        .mockRejectedValueOnce(new ApiError("当前版本较低", 400, SMS_NEED_CAPTCHA))
        .mockResolvedValue(undefined),
    });
    await sendLoginSms(deps, "13800138000");
    expect(deps.runCaptcha).toHaveBeenCalledTimes(1);
    expect(deps.requestLoginSms).toHaveBeenNthCalledWith(1, "13800138000");
    expect(deps.requestLoginSms).toHaveBeenNthCalledWith(2, "13800138000", {
      ticket: "cap-1",
      randstr: "rand-1",
    });
  });

  it("非 4005021 错误不触发滑块，原样抛出", async () => {
    const deps = makeDeps({
      requestLoginSms: vi.fn(async () => {
        throw new ApiError("发送太频繁", 400, 610015);
      }),
    });
    await expect(sendLoginSms(deps, "13800138000")).rejects.toThrow("发送太频繁");
    expect(deps.runCaptcha).not.toHaveBeenCalled();
  });

  // 重试仍命中 4005021（滑块 ticket 被拒）：文案改写为可操作提示
  it("重试仍 4005021 时提示人机验证未通过", async () => {
    const deps = makeDeps({
      requestLoginSms: vi.fn(async () => {
        throw new ApiError("当前版本较低，验证失败", 400, SMS_NEED_CAPTCHA);
      }),
    });
    await expect(sendLoginSms(deps, "13800138000")).rejects.toThrow("人机验证未通过，请重试");
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
      runCaptcha: vi.fn(async () => ({ ticket: `cap-${++n}`, randstr: `rand-${n}` })),
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
