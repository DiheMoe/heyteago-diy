import { defineConfig, devices } from "@playwright/test";

// 端到端测试跑在生产构建上，启动方式与 web/Dockerfile 相同（standalone 的 server.js；
// next start 不支持 output: standalone）。
// 后端地址指向不可达端口：接口由测试在浏览器层 mock，漏 mock 的请求会失败，不会打到真实后端。
// rewrites 在构建期固化，所以 BACKEND_ORIGIN 必须在 build 时注入。
// 每次都重新构建、不复用已有服务：复用会让测试跑在旧代码上。
const PORT = 3210;
// WebKit 项目只在 CI 或设置了 E2E_WEBKIT 时跑：Playwright 的 WebKit 只支持 Ubuntu、Debian 等发行版，
// 其他系统可以在官方 Playwright Docker 镜像里设 E2E_WEBKIT=1 再跑
const WEBKIT = !!process.env.CI || !!process.env.E2E_WEBKIT;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "pnpm build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/ && node .next/standalone/server.js",
    url: `http://127.0.0.1:${PORT}`,
    env: { BACKEND_ORIGIN: "http://127.0.0.1:9", PORT: String(PORT), HOSTNAME: "127.0.0.1" },
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 1000 } },
      testIgnore: "**/touch.e2e.ts",
    },
    {
      name: "touch",
      use: { ...devices["Pixel 7"] },
      testMatch: "**/touch.e2e.ts",
    },
    ...(WEBKIT
      ? [
          {
            name: "webkit",
            use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 1000 } },
            testIgnore: "**/touch.e2e.ts",
          },
          {
            name: "iphone",
            use: { ...devices["iPhone 14"] },
            testMatch: "**/touch.e2e.ts",
          },
        ]
      : []),
  ],
});
