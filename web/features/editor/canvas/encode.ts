// 同步编码画布：Chromium 的 toBlob 排在主线程空闲时才编码，页面忙时实测会拖过 5 秒
export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Blob {
  const base64 = canvas.toDataURL(type, quality).split(",")[1];
  return new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type });
}
