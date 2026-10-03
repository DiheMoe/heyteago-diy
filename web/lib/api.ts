// 后端 API 客户端。浏览器经 Next 同源代理访问 Go 服务（见 next.config.ts rewrites）。

export interface User {
  user_main_id: number;
  name: string;
}

export interface UploadResult {
  message: string;
  data?: unknown;
}

class ApiError extends Error {
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

export async function requestLoginSms(phone: string): Promise<void> {
  const resp = await fetch("/api/login/sms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
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
  form.append("file", blob, fileNameFor(blob));
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
  form.append("file", blob, fileNameFor(blob));
  form.append("token", token);

  const resp = await fetch("/api/draft/save", { method: "POST", body: form });
  if (!resp.ok) throw await parseError(resp);
  return resp.json();
}

function fileNameFor(blob: Blob): string {
  return blob.type === "image/jpeg" ? "cup.jpg" : "cup.png";
}
