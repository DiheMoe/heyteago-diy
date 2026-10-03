# 前端镜像：Next.js 生产构建。
# node_modules 与 pnpm 均在 glibc 阶段产出（含原生绑定），运行镜像同为 glibc（不能 alpine）。
# 用 npm 全局安装 pnpm 而不是 corepack：npm 尊重 HTTP(S)_PROXY 构建参数，
# corepack 自带的 undici fetch 不认代理环境变量，受限网络下必然直连超时。
FROM node:22 AS build
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

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./
EXPOSE 3000
CMD ["node_modules/.bin/next", "start"]
