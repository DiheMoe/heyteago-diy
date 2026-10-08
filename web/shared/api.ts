// 后端 API 客户端。浏览器经 Next 同源代理访问 Go 服务（见 next.config.ts rewrites）。

export interface User {
  user_main_id: number;
  name: string;
}

export interface UploadResult {
  message: string;
  data?: unknown;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
  }
}

async function parseError(resp: Response): Promise<ApiError> {
  let message = `请求失败（HTTP ${resp.status}）`;
  let code: number | undefined;
  try {
    const body = await resp.json();
    if (body?.message) message = body.message;
    if (typeof body?.code === "number") code = body.code;
  } catch {
    // 非 JSON 错误体，保留默认 message
  }
  return new ApiError(message, resp.status, code);
}

export async function fetchUser(token?: string): Promise<User> {
  const resp = await fetch("/api/user", {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!resp.ok) throw await parseError(resp);
  const body = await resp.json();
  return body.user as User;
}

// captcha 是腾讯滑块验证结果，仅当上游返回 4005021 要求人机验证后重试时携带。
export async function requestLoginSms(
  phone: string,
  captcha?: { ticket: string; randstr: string },
): Promise<void> {
  const resp = await fetch("/api/login/sms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, ...captcha }),
  });
  if (!resp.ok) throw await parseError(resp);
}

export async function loginByPhone(
  phone: string,
  code: string,
  ticket: string,
): Promise<{ token: string; user: User }> {
  const resp = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code, ticket }),
  });
  if (!resp.ok) throw await parseError(resp);
  return resp.json();
}

export async function uploadSticker(
  blob: Blob,
  opts: { token: string; userMainId: number; width?: number; height?: number },
): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", blob, STICKER_FILE_NAME);
  form.append("token", opts.token);
  form.append("userMainId", String(opts.userMainId));
  if (opts.width) form.append("width", String(opts.width));
  if (opts.height) form.append("height", String(opts.height));

  const resp = await fetch("/api/upload", { method: "POST", body: form });
  if (!resp.ok) throw await parseError(resp);
  return resp.json();
}

export async function saveDraft(blob: Blob, token: string): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", blob, STICKER_FILE_NAME);
  form.append("token", token);

  const resp = await fetch("/api/draft/save", { method: "POST", body: form });
  if (!resp.ok) throw await parseError(resp);
  return resp.json();
}

// isRequestRejected：请求是否确定没有生效。后端只在请求被拒时回 4xx
// （参数校验失败、喜茶业务码非 0：审核未通过、登录态失效等）；
// 5xx 与断网说明请求可能已经到了喜茶，结果未知（发布时重试可能重复发布）。
export function isRequestRejected(err: unknown): boolean {
  return err instanceof ApiError && err.status >= 400 && err.status < 500;
}

// 喜茶以业务码 401 表示登录态失效：查询用户、发布、存草稿都可能遇到
export function isSessionExpired(err: unknown): boolean {
  return err instanceof ApiError && err.code === 401;
}

// 上传给喜茶的文件名；成品一律是 PNG（见 features/editor/canvas/export.ts）
const STICKER_FILE_NAME = "cup.png";
