// 手机号短信登录流程（与官方 App 行为一致）：
// 发短信默认不触发人机验证；上游风控升级返回 4005021 时才过滑块、
// 带 ticket+randstr 重试一次（4005021 的文案"当前版本较低"有误导，重试
// 仍命中时改写为可操作的提示）。
// 滑块在登录步触发，ticket 一次性、随当次登录尝试消耗。
// 因此登录失败（验证码错/ticket 失效）重试只需重新滑块，短信未过期就不必
// 重发——短信每日有发送上限，要省着用。
import { ApiError, type User } from "./api";

export const PHONE_PATTERN = /^1\d{10}$/;

// 上游风控要求人机验证的业务码：命中后过滑块带 ticket+randstr 重试
export const SMS_NEED_CAPTCHA = 4005021;

export interface SmsLoginDeps {
  runCaptcha(): Promise<{ ticket: string; randstr: string }>;
  requestLoginSms(phone: string, captcha?: { ticket: string; randstr: string }): Promise<void>;
  loginByPhone(phone: string, code: string, ticket: string): Promise<{ token: string; user: User }>;
}

// sendLoginSms 发送短信验证码。先不带验证直发；命中 4005021 才过滑块重试。
export async function sendLoginSms(deps: SmsLoginDeps, phone: string): Promise<void> {
  if (!PHONE_PATTERN.test(phone)) throw new Error("请输入 11 位手机号");
  try {
    await deps.requestLoginSms(phone);
    return;
  } catch (err) {
    if (!hasCode(err, SMS_NEED_CAPTCHA)) throw err;
  }
  const captcha = await deps.runCaptcha();
  try {
    await deps.requestLoginSms(phone, captcha);
  } catch (err) {
    if (hasCode(err, SMS_NEED_CAPTCHA)) throw new Error("人机验证未通过，请重试");
    throw err;
  }
}

// loginWithCaptcha 先过滑块再用短信验证码登录；ticket 仅用于本次尝试。
export async function loginWithCaptcha(
  deps: SmsLoginDeps,
  phone: string,
  code: string,
): Promise<{ token: string; user: User }> {
  if (!PHONE_PATTERN.test(phone)) throw new Error("请输入 11 位手机号");
  if (!code) throw new Error("请输入短信验证码");
  const captcha = await deps.runCaptcha();
  return deps.loginByPhone(phone, code, captcha.ticket);
}

// 回执里确认发送目标，138****8000
export function maskPhone(phone: string): string {
  return phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(7)}` : phone;
}

function hasCode(err: unknown, code: number): boolean {
  return err instanceof ApiError && err.code === code;
}
