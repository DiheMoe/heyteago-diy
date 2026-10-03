// 手机号短信登录流程（与官方 App 行为一致）：
// 发短信不触发人机验证——官方短信接口不消费人机 ticket；
// 滑块在登录步触发，ticket 一次性、随当次登录尝试消耗。
// 因此登录失败（验证码错/ticket 失效）重试只需重新滑块，短信未过期就不必
// 重发——短信每日有发送上限，要省着用。
import type { User } from "./api";

export const PHONE_PATTERN = /^1\d{10}$/;

export interface SmsLoginDeps {
  runCaptcha(): Promise<{ ticket: string }>;
  requestLoginSms(phone: string): Promise<void>;
  loginByPhone(phone: string, code: string, ticket: string): Promise<{ token: string; user: User }>;
}

// sendLoginSms 发送短信验证码。这里刻意不跑滑块（见文件头说明）。
export async function sendLoginSms(deps: SmsLoginDeps, phone: string): Promise<void> {
  if (!PHONE_PATTERN.test(phone)) throw new Error("请输入 11 位手机号");
  await deps.requestLoginSms(phone);
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
