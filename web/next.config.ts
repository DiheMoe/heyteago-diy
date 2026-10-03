import type { NextConfig } from "next";

const backend = process.env.BACKEND_ORIGIN ?? "http://127.0.0.1:8790";

const nextConfig: NextConfig = {
  // 浏览器只与同源的 Next 进程通信，/api 由这里转发给 Go 后端。
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};

export default nextConfig;
