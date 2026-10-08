import { defineConfig } from "vitest/config";

// 单测与应用代码一样解析 tsconfig 里的 @/ 路径别名（跨目录的模块都用别名导入）
export default defineConfig({
  resolve: { tsconfigPaths: true },
});
