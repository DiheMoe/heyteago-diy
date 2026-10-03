// 腾讯滑块验证码（TCaptcha）封装：脚本动态加载，全局只加载一次。

// 喜茶 GO 登录使用的腾讯验证码应用 ID
export const HEYTEA_CAPTCHA_APP_ID = "197451715";

const SCRIPT_URL = "https://turing.captcha.qcloud.com/TJCaptcha.js";

interface TencentCaptchaResult {
  ret: number;
  ticket?: string;
  randstr?: string;
  errorMessage?: string;
}

declare global {
  interface Window {
    TencentCaptcha?: new (
      appId: string,
      onResult: (res: TencentCaptchaResult) => void,
    ) => {
      show(): void;
      destroy(): void;
    };
  }
}

let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        // 加载失败时允许下次点击重试
        loading = null;
        reject(new Error("人机验证组件加载失败，请检查网络"));
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}

export async function runCaptcha(appId: string): Promise<{ ticket: string; randstr: string }> {
  await loadScript();
  return new Promise((resolve, reject) => {
    const TencentCaptcha = window.TencentCaptcha;
    if (!TencentCaptcha) {
      reject(new Error("人机验证组件未就绪，请刷新页面重试"));
      return;
    }
    const captcha = new TencentCaptcha(appId, (res) => {
      // ret: 0 = 验证通过；2 = 用户主动关闭弹窗
      if (res.ret === 0 && res.ticket) {
        resolve({ ticket: res.ticket, randstr: res.randstr ?? "" });
      } else if (res.ret === 2) {
        reject(new Error("已取消人机验证"));
      } else {
        reject(new Error(res.errorMessage || "人机验证失败，请重试"));
      }
      captcha.destroy();
    });
    captcha.show();
  });
}
