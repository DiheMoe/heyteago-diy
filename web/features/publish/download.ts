// 把成品下载到本地。

// 下载的文件名带上本地时间，多次下载不重名、也好区分
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
