import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSubmission, validPending } from "./submission";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// latest() 即页面当前所见（页面经 subscribe 读到的同一份状态）；
// doc 模拟画布文档：改动画布 = 换一个新的 doc 对象；换账号由页面调 accountChanged 通知
function setup() {
  const s = createSubmission();
  const latest = () => s.getState();
  let doc = {};
  const now = () => doc;
  const editCanvas = () => (doc = {});
  return { s, latest, now, editCanvas };
}

const blob = new Blob(["png"]);
const exportOk = async () => blob;
const hashOf = (h: string) => async () => h;
// 发布失败的分类（页面传 isRequestRejected）：明确被拒 = 确定没发布；其余 = 结果未知
const asRejected = () => true;
const asUnknown = () => false;
const timeout = async () => Promise.reject(new Error("请求超时"));

describe("createSubmission", () => {
  it("发布在途时改动画布：在途状态保持，也不能再发起导出或存草稿", async () => {
    const { s, latest, now, editCanvas } = setup();
    await s.requestUpload(exportOk, hashOf("h1"), now);
    const upload = deferred<string>();
    const inFlight = s.confirmUpload(() => upload.promise, asUnknown, now);

    editCanvas();
    expect(latest().submitting).toBe("upload");
    const exportSpy = vi.fn(exportOk);
    await s.requestUpload(exportSpy, hashOf("h2"), now);
    await s.saveDraft(exportSpy, async () => "draft");
    expect(exportSpy).not.toHaveBeenCalled();

    upload.resolve("ok");
    await inFlight;
    expect(latest().submitting).toBeNull();
  });

  it("上传在途时重复确认只发一次请求", async () => {
    const { s, now } = setup();
    await s.requestUpload(exportOk, hashOf("h1"), now);
    const upload = deferred<string>();
    const send = vi.fn(() => upload.promise);
    const first = s.confirmUpload(send, asUnknown, now);
    expect(await s.confirmUpload(send, asUnknown, now)).toBeUndefined();
    upload.resolve("ok");
    expect(await first).toBe("ok");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("导出期间画布被改动：产物作废，不进确认态，返回 false", async () => {
    const { s, latest, now, editCanvas } = setup();
    const exported = deferred<Blob>();
    const req = s.requestUpload(() => exported.promise, hashOf("h1"), now);
    editCanvas();
    exported.resolve(blob);
    expect(await req).toBe(false);
    expect(latest().pending).toBeNull();
    expect(latest().submitting).toBeNull();
  });

  it("导出成功进入确认态时返回 true", async () => {
    const { s, latest, now } = setup();
    expect(await s.requestUpload(exportOk, hashOf("h1"), now)).toBe(true);
    expect(validPending(latest(), now())?.hash).toBe("h1");
  });

  it("导出失败（如 PNG 超出上限）释放单飞锁，不进入确认态，可再次发起", async () => {
    const { s, latest, now } = setup();
    const tooBig = async (): Promise<Blob> => {
      throw new Error("编辑后 PNG 超过 200KB 上限");
    };
    await expect(s.requestUpload(tooBig, hashOf("h1"), now)).rejects.toThrow("200KB");
    expect(latest()).toEqual({ submitting: null, pending: null });
    expect(await s.requestUpload(exportOk, hashOf("h1"), now)).toBe(true);
  });

  it("进入确认态后改动画布：确认框不再显示，确认也不发请求", async () => {
    const { s, latest, now, editCanvas } = setup();
    await s.requestUpload(exportOk, hashOf("h1"), now);
    editCanvas();
    expect(validPending(latest(), now())).toBeNull();
    const send = vi.fn(async () => "ok");
    expect(await s.confirmUpload(send, asUnknown, now)).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it("进入确认态后换账号：确认框不再显示，确认也不发请求", async () => {
    const { s, latest, now } = setup();
    await s.requestUpload(exportOk, hashOf("h1"), now);
    s.accountChanged();
    expect(validPending(latest(), now())).toBeNull();
    const send = vi.fn(async () => "ok");
    expect(await s.confirmUpload(send, asUnknown, now)).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it("导出期间换账号：产物作废，不进确认态，返回 false", async () => {
    const { s, latest, now } = setup();
    const exported = deferred<Blob>();
    const req = s.requestUpload(() => exported.promise, hashOf("h1"), now);
    s.accountChanged();
    exported.resolve(blob);
    expect(await req).toBe(false);
    expect(latest().pending).toBeNull();
    expect(await s.requestUpload(exportOk, hashOf("h1"), now)).toBe(true);
  });

  it("取消后待确认清空", async () => {
    const { s, latest, now } = setup();
    await s.requestUpload(exportOk, hashOf("h1"), now);
    s.cancel();
    expect(latest().pending).toBeNull();
  });

  it("明确被拒的上传失败：释放单飞锁，保留确认态且不带警告，可直接重试", async () => {
    const { s, latest, now } = setup();
    await s.requestUpload(exportOk, hashOf("h1"), now);
    const rejectedByHeytea = async () => Promise.reject(new Error("图片审核未通过"));
    await expect(s.confirmUpload(rejectedByHeytea, asRejected, now)).rejects.toThrow("图片审核未通过");
    expect(latest().submitting).toBeNull();
    expect(validPending(latest(), now())).toMatchObject({ hash: "h1", uncertain: false });
    const retry = vi.fn(async () => "ok");
    await s.confirmUpload(retry, asRejected, now);
    expect(retry).toHaveBeenCalledWith(blob);
    expect(latest().pending).toBeNull();
  });

  it("上传失败不计入查重指纹", async () => {
    const { s, latest, now } = setup();
    await s.requestUpload(exportOk, hashOf("h1"), now);
    await expect(s.confirmUpload(timeout, asRejected, now)).rejects.toThrow();
    await s.requestUpload(exportOk, hashOf("h1"), now);
    expect(latest().pending?.duplicate).toBe(false);
  });

  it("发布成功后，相同产物再次发布会标记为重复", async () => {
    const { s, latest, now } = setup();
    await s.requestUpload(exportOk, hashOf("h1"), now);
    expect(latest().pending?.duplicate).toBe(false);
    await s.confirmUpload(async () => "ok", asUnknown, now);
    await s.requestUpload(exportOk, hashOf("h1"), now);
    expect(latest().pending?.duplicate).toBe(true);
    await s.requestUpload(exportOk, hashOf("h2"), now);
    expect(latest().pending?.duplicate).toBe(false);
  });

  it("结果未知的上传失败：确认态标出警告，单飞锁释放，错误照常抛出", async () => {
    const { s, latest, now } = setup();
    await s.requestUpload(exportOk, hashOf("h1"), now);
    expect(latest().pending?.uncertain).toBe(false);
    await expect(s.confirmUpload(timeout, asUnknown, now)).rejects.toThrow("请求超时");
    expect(latest().submitting).toBeNull();
    expect(validPending(latest(), now())).toMatchObject({ hash: "h1", uncertain: true });
  });

  it("结果未知的图取消后再次导出，确认态仍带警告；换一张图则没有", async () => {
    const { s, latest, now } = setup();
    await s.requestUpload(exportOk, hashOf("h1"), now);
    await expect(s.confirmUpload(timeout, asUnknown, now)).rejects.toThrow();
    s.cancel();
    await s.requestUpload(exportOk, hashOf("h1"), now);
    expect(latest().pending?.uncertain).toBe(true);
    await s.requestUpload(exportOk, hashOf("h2"), now);
    expect(latest().pending?.uncertain).toBe(false);
  });

  it("上传途中改动画布：结果未知时确认框不再显示，但同一张图再导出仍带警告", async () => {
    const { s, latest, now, editCanvas } = setup();
    await s.requestUpload(exportOk, hashOf("h1"), now);
    const upload = deferred<string>();
    const inFlight = s.confirmUpload(() => upload.promise, asUnknown, now);
    editCanvas();
    upload.reject(new Error("请求超时"));
    await expect(inFlight).rejects.toThrow();
    expect(validPending(latest(), now())).toBeNull();
    await s.requestUpload(exportOk, hashOf("h1"), now);
    expect(latest().pending?.uncertain).toBe(true);
  });

  it("结果未知后重试成功：转为普通的重复提示", async () => {
    const { s, latest, now } = setup();
    await s.requestUpload(exportOk, hashOf("h1"), now);
    await expect(s.confirmUpload(timeout, asUnknown, now)).rejects.toThrow();
    await s.confirmUpload(async () => "ok", asUnknown, now);
    await s.requestUpload(exportOk, hashOf("h1"), now);
    expect(latest().pending).toMatchObject({ duplicate: true, uncertain: false });
  });
});

describe("结果未知的标记写入本机", () => {
  const KEY = "heyteago-diy:maybe-published";
  const hash = (n: number) => n.toString(16).padStart(40, "0");
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  // 一次结果未知的发布
  const unknownOutcome = async (h: string) => {
    const { s, now } = setup();
    await s.requestUpload(exportOk, hashOf(h), now);
    await expect(s.confirmUpload(timeout, asUnknown, now)).rejects.toThrow("请求超时");
  };
  // 刷新页面后导出同一张图：确认态是否带警告
  const warnsAfterReload = async (h: string) => {
    const { s, latest, now } = setup();
    await s.requestUpload(exportOk, hashOf(h), now);
    return latest().pending?.uncertain;
  };

  it("刷新页面后同一张图再发布仍带警告；发布成功后不再警告", async () => {
    await unknownOutcome(hash(1));
    expect(await warnsAfterReload(hash(1))).toBe(true);

    const { s, now } = setup();
    await s.requestUpload(exportOk, hashOf(hash(1)), now);
    await s.confirmUpload(async () => "ok", asUnknown, now);
    expect(await warnsAfterReload(hash(1))).toBe(false);
  });

  it("只记最近 20 张图", async () => {
    for (let i = 1; i <= 21; i++) await unknownOutcome(hash(i));
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(20);
    expect(await warnsAfterReload(hash(1))).toBe(false);
    expect(await warnsAfterReload(hash(2))).toBe(true);
    expect(await warnsAfterReload(hash(21))).toBe(true);
  });

  it("本机记录不合法时忽略", async () => {
    localStorage.setItem(KEY, "{oops");
    expect(await warnsAfterReload(hash(1))).toBe(false);
    localStorage.setItem(KEY, JSON.stringify([42, "not-a-hash", hash(1)]));
    expect(await warnsAfterReload(hash(1))).toBe(true);
    // 再记一张时，不合法的条目不会被写回去
    await unknownOutcome(hash(2));
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual([hash(1), hash(2)]);
  });
});
