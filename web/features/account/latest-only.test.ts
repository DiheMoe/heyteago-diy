import { describe, expect, it } from "vitest";
import { createLatestOnly } from "./latest-only";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("createLatestOnly", () => {
  it("新的调用开始后，旧调用的结果作废", async () => {
    const latest = createLatestOnly();
    const slow = deferred<string>();
    const first = latest.run(() => slow.promise);
    expect(await latest.run(async () => "B")).toBe("B");
    slow.resolve("A");
    expect(await first).toBeNull();
  });

  it("invalidate 之后，在途调用的结果作废", async () => {
    const latest = createLatestOnly();
    const pending = deferred<string>();
    const call = latest.run(() => pending.promise);
    latest.invalidate();
    pending.resolve("A");
    expect(await call).toBeNull();
  });

  it("当前调用的失败照常抛出", async () => {
    const latest = createLatestOnly();
    await expect(latest.run(async () => Promise.reject(new Error("token 已失效")))).rejects.toThrow("token 已失效");
  });

  it("作废的调用失败时同样作废：返回 null，不抛出", async () => {
    const latest = createLatestOnly();
    const failing = deferred<string>();
    const stale = latest.run(() => failing.promise.then(() => Promise.reject(new Error("旧 token 已失效"))));
    latest.invalidate();
    failing.resolve("");
    expect(await stale).toBeNull();
  });
});
