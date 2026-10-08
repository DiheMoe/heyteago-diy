import { describe, expect, it } from "vitest";
import { ApiError, isRequestRejected, isSessionExpired } from "./api";

describe("isRequestRejected", () => {
  it("4xx：参数校验失败或喜茶明确拒绝，请求确定没有生效", () => {
    expect(isRequestRejected(new ApiError("图片审核未通过", 400, 50001))).toBe(true);
    expect(isRequestRejected(new ApiError("登录态失效", 400, 401))).toBe(true);
    expect(isRequestRejected(new ApiError("请求失败（HTTP 413）", 413))).toBe(true);
  });

  it("5xx、断网：请求可能已到喜茶，结果未知", () => {
    expect(isRequestRejected(new ApiError("连接喜茶超时或中断", 502))).toBe(false); // 上游异常
    expect(isRequestRejected(new ApiError("请求失败（HTTP 500）", 500))).toBe(false); // Next 代理超时
    expect(isRequestRejected(new TypeError("Failed to fetch"))).toBe(false); // 断网
  });
});

describe("isSessionExpired", () => {
  it("只有喜茶的业务码 401（登录态失效）才算登录失效", () => {
    expect(isSessionExpired(new ApiError("登录态失效", 400, 401))).toBe(true);
    expect(isSessionExpired(new ApiError("图片审核未通过", 400, 50001))).toBe(false);
    expect(isSessionExpired(new ApiError("请求失败（HTTP 401）", 401))).toBe(false);
    expect(isSessionExpired(new TypeError("Failed to fetch"))).toBe(false);
  });
});
