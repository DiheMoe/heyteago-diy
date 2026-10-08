// 贴文字对象与它的纯计算：多行排版、命中、手柄拖拽、比较。文字始终是对象（可重调大小/角度/内容），
// 仅在导出时随图层合成栅格化。
export interface TextObj {
  id: number;
  content: string; // 可含换行，每行居中
  x: number; // 画布坐标（中心锚点）
  y: number;
  size: number; // 字号（画布像素）
  angle: number; // 顺时针角度
  weight: number; // 字重 100–900（渲染取字体最接近档）
}

// isBlankText：没有可见内容（空或只有空白）。这类文字只在就地编辑期间存在，收尾时删除，
// 也不进撤销/重做快照。
export function isBlankText(t: TextObj): boolean {
  return t.content.trim() === "";
}

// 行距（字号的倍数）
export const LINE_HEIGHT = 1.25;

export const textLines = (content: string): string[] => content.split("\n");

// 文字框尺寸：宽为最长一行，高为一行字号加其余各行的行距（单行时就是字号）
export function textBoxSize(lineWidths: number[], size: number): { w: number; h: number } {
  return { w: Math.max(0, ...lineWidths), h: size + (lineWidths.length - 1) * size * LINE_HEIGHT };
}

export type MeasureText = (t: TextObj) => { w: number; h: number };

// 文字框外仍算点中的余量（画布像素）；文字框过窄过矮时按最小半宽/半高算，空文字和单个字也好点中
const HIT_MARGIN = 8;
const MIN_HIT_HALF = 16;

// hitText 返回 point 处最上层（最后绘制）的文字：按文字旋转后的框判断，长文字两端也能点中。
// measure 给出文字框尺寸（界面用画布测量字宽）。
export function hitText(texts: TextObj[], point: { x: number; y: number }, measure: MeasureText): TextObj | null {
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i];
    const { w, h } = measure(t);
    const rad = (t.angle * Math.PI) / 180;
    const dx = point.x - t.x;
    const dy = point.y - t.y;
    // 逆着文字的旋转转回文字自身的坐标系
    const lx = dx * Math.cos(rad) + dy * Math.sin(rad);
    const ly = -dx * Math.sin(rad) + dy * Math.cos(rad);
    if (
      Math.abs(lx) <= Math.max(w / 2, MIN_HIT_HALF) + HIT_MARGIN &&
      Math.abs(ly) <= Math.max(h / 2, MIN_HIT_HALF) + HIT_MARGIN
    ) {
      return t;
    }
  }
  return null;
}

// 手柄拖动的起始快照：按下时记录，整个拖动只以它为基准，不读拖动中的实时字号——
// 实时值每次 move 都在变，混用会让缩放来回跳且跟不上指针。
export interface TextHandleDrag {
  kind: "scale" | "rotate"; // 四角手柄等比缩放，上方手柄旋转
  start: { x: number; y: number };
  size: number;
  angle: number;
}

// dragTextHandle 由手柄快照、文字中心与当前指针算出新字号或新角度：
// 缩放：指针到中心的距离 / 按下时的距离 = 缩放系数 → 新字号（12–240）；
// 旋转：指针相对文字中心转过的夹角 → 新角度（归一到 [-180, 180]）。
export function dragTextHandle(
  d: TextHandleDrag,
  center: { x: number; y: number },
  pt: { x: number; y: number },
): { size: number } | { angle: number } {
  if (d.kind === "scale") {
    const r0 = Math.max(Math.hypot(d.start.x - center.x, d.start.y - center.y), 1);
    const r1 = Math.hypot(pt.x - center.x, pt.y - center.y);
    return { size: Math.min(240, Math.max(12, Math.round((d.size * r1) / r0))) };
  }
  const a0 = Math.atan2(d.start.y - center.y, d.start.x - center.x);
  const a1 = Math.atan2(pt.y - center.y, pt.x - center.x);
  const deg = d.angle + ((a1 - a0) * 180) / Math.PI;
  return { angle: Math.round(((deg + 540) % 360) - 180) };
}

export function sameTexts(a: TextObj[], b: TextObj[]): boolean {
  return a.length === b.length && a.every((t, i) => sameText(t, b[i]));
}

// TextObj 的字段都是原始值，逐字段比较；按键枚举，以后新增字段（如颜色）自动纳入比较
function sameText(a: TextObj, b: TextObj): boolean {
  const keys = Object.keys(a) as Array<keyof TextObj>;
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}
