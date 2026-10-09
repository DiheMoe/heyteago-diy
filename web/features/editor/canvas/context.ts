// 取 2D 上下文。画布都由本应用创建，取不到只能是运行环境不支持 Canvas：
// 直接抛错，不让绘制静默跳过。
export function ctx2d(canvas: HTMLCanvasElement, settings?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", settings);
  if (!ctx) throw new Error("当前浏览器不支持 Canvas");
  return ctx;
}
