import { describe, expect, it } from "vitest";
import { actionAvailability } from "./action-availability";

// 有原图、无在途提交、已确认登录的用户
const idle = { ready: true, submitting: false, signedIn: true };

describe("actionAvailability", () => {
  it("下载只处理本地画布，未登录也可用；有 token 但还没确认用户时不能提交", () => {
    expect(actionAvailability({ ...idle, signedIn: false })).toEqual({ download: true, submit: false });
  });

  it("提交在途不影响本地下载，但不能再次提交", () => {
    expect(actionAvailability({ ...idle, submitting: true })).toEqual({ download: true, submit: false });
  });

  it("还没有原图时，导出类操作全部不可用", () => {
    expect(actionAvailability({ ...idle, ready: false })).toEqual({ download: false, submit: false });
  });

  it("已登录且空闲时可提交", () => {
    expect(actionAvailability(idle)).toEqual({ download: true, submit: true });
  });
});
