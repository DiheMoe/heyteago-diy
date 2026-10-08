// 原图与它的文件内容。自动保存要存原图本身，HTMLImageElement 却拿不回文件，所以解码时记下。
// 画布上的原图都经 decodeImage 得到（导入、空白画布、恢复），一定有记录。
const sources = new WeakMap<HTMLImageElement, Blob>();

export function imageSource(image: HTMLImageElement): Blob {
  return sources.get(image)!;
}

// 把图片文件解码成 HTMLImageElement；不是可解码的图片时抛错
export function decodeImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  return new Promise((resolve, reject) => {
    image.onload = () => {
      URL.revokeObjectURL(url);
      sources.set(image, blob);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取这张图片（文件损坏或格式不支持），请换成 JPG 或 PNG"));
    };
    image.src = url;
  });
}
