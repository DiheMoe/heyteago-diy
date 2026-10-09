// 本地保存成品：下载与系统分享。
import { useSyncExternalStore } from "react";

// 下载、分享的文件名带上本地时间，多次保存不重名、也好区分
export function stickerFileName(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `heytea-cup-${day}-${time}.png`;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // iOS Safari 在预览、存储文件时还要读这个地址，立刻释放会导致下载失败
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

let shareImages: boolean | undefined;
// 系统分享能否分享图片文件（手机上可在分享面板里「存储图像」到相册）
function canShareImages(): boolean {
  shareImages ??=
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [new File([], "sticker.png", { type: "image/png" })] });
  return shareImages;
}

const noSubscribe = () => () => {};

// 服务端渲染和水合时按不支持算，水合后按浏览器实际能力更新
export function useCanShareImages(): boolean {
  return useSyncExternalStore(noSubscribe, canShareImages, () => false);
}
