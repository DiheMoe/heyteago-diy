# 前端镜像：Next.js standalone 生产构建。
# standalone 只携带 nft 追踪出的运行时最小依赖（不含 swc/typescript/eslint 等构建期原生包），
# 构建与运行同为 alpine(musl)，原生绑定按 musl 变体安装，无 glibc 依赖。
# 用 npm 全局安装 pnpm 而不是 corepack：npm 尊重 HTTP(S)_PROXY 构建参数，
# corepack 自带的 undici fetch 不认代理环境变量，受限网络下必然直连超时。
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# 国内网络拉 npm 官方源不稳定时默认走 npmmirror；不需要时 --build-arg NPM_REGISTRY= 置空
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi && \
    npm install -g pnpm@11.26.0 && \
    pnpm config set registry "${NPM_REGISTRY:-https://registry.npmjs.org}" && \
    pnpm install --frozen-lockfile
COPY . .
# Next 的 rewrites 在构建时固化进产物，BACKEND_ORIGIN 必须构建期注入（默认 compose 服务名）
ARG BACKEND_ORIGIN=http://server:8790
ENV BACKEND_ORIGIN=$BACKEND_ORIGIN
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
