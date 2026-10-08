// 自动保存的记录、它在 IndexedDB 里的存法与读出时的校验。读出来的内容可能损坏、被改过或来自别的版本，
// 一律当作不可信输入：任何一项不合法就整条丢弃，不做旧格式兼容。
import {
  type DotPattern,
  type FitMode,
  type ToneMode,
  type ToneSettings,
  type View,
} from "@/features/editor/model/settings";
import type { Stroke, StrokePoint } from "@/features/editor/model/stroke";
import type { TextObj } from "@/features/editor/model/text";

export interface SavedDraft {
  savedAt: number; // 保存时间（毫秒时间戳）
  image: Blob; // 原图（导入时的工作副本）
  imageName: string;
  tone: ToneSettings;
  view: View;
  strokes: Stroke[];
  texts: TextObj[];
}

type Fields = Record<string, unknown>;
const isFields = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const within = (v: unknown, min: number, max: number): v is number => finite(v) && v >= min && v <= max;
const oneOf = <T extends string | number>(v: unknown, values: readonly T[]): v is T => values.includes(v as T);

const TONE_MODES: readonly ToneMode[] = ["binary", "dots"];
const PATTERNS: readonly DotPattern[] = ["circle", "diamond", "cross", "grid"];
const FITS: readonly FitMode[] = ["cover", "contain"];
const ROTATIONS = [0, 90, 180, 270] as const;
const STROKE_TOOLS = ["brush", "eraser"] as const;

function parseTone(v: unknown): ToneSettings | null {
  if (!isFields(v)) return null;
  const { toneMode, threshold, density, pattern } = v;
  if (!oneOf(toneMode, TONE_MODES) || !within(threshold, 0, 255) || !within(density, 2, 24) || !oneOf(pattern, PATTERNS)) {
    return null;
  }
  return { toneMode, threshold, density, pattern };
}

function parseView(v: unknown): View | null {
  if (!isFields(v)) return null;
  const { fit, rotate, offsetX, offsetY } = v;
  if (!oneOf(fit, FITS) || !oneOf(rotate, ROTATIONS) || !finite(offsetX) || !finite(offsetY)) return null;
  return { fit, rotate, offsetX, offsetY };
}

function parsePoint(v: unknown): StrokePoint | null {
  if (!isFields(v) || !finite(v.x) || !finite(v.y)) return null;
  if (v.p === undefined) return { x: v.x, y: v.y };
  return within(v.p, 0, 1) ? { x: v.x, y: v.y, p: v.p } : null;
}

function parseStroke(v: unknown): Stroke | null {
  if (!isFields(v) || !oneOf(v.tool, STROKE_TOOLS) || !within(v.size, 2, 80)) return null;
  if (!Array.isArray(v.points) || v.points.length === 0) return null;
  const points = v.points.map(parsePoint);
  return points.every((p) => p !== null) ? { tool: v.tool, size: v.size, points } : null;
}

function parseText(v: unknown): TextObj | null {
  if (!isFields(v)) return null;
  const { id, content, x, y, size, angle, weight } = v;
  if (
    !Number.isInteger(id) ||
    !within(id, 1, Number.MAX_SAFE_INTEGER) ||
    typeof content !== "string" ||
    !finite(x) ||
    !finite(y) ||
    !within(size, 12, 240) ||
    !finite(angle) ||
    !Number.isInteger(weight) ||
    !within(weight, 100, 900)
  ) {
    return null;
  }
  return { id, content, x, y, size, angle, weight };
}

// serializeDraft 把记录转成存进 IndexedDB 的样子：原图存成字节和类型——
// WebKit 的无痕会话里 IndexedDB 存不了 Blob（实测事务直接失败），字节可以
export async function serializeDraft(draft: SavedDraft): Promise<Record<string, unknown>> {
  const { image, ...rest } = draft;
  return { ...rest, imageType: image.type, imageBytes: await image.arrayBuffer() };
}

// parseSavedDraft 校验从 IndexedDB 读出的记录，只取认识的字段，原图还原成 Blob；不合法返回 null
export function parseSavedDraft(raw: unknown): SavedDraft | null {
  if (!isFields(raw)) return null;
  const { savedAt, imageType, imageBytes, imageName } = raw;
  if (
    !finite(savedAt) ||
    typeof imageType !== "string" ||
    !imageType.startsWith("image/") ||
    !(imageBytes instanceof ArrayBuffer) ||
    typeof imageName !== "string"
  ) {
    return null;
  }
  const tone = parseTone(raw.tone);
  const view = parseView(raw.view);
  if (!tone || !view || !Array.isArray(raw.strokes) || !Array.isArray(raw.texts)) return null;
  const strokes = raw.strokes.map(parseStroke);
  const texts = raw.texts.map(parseText);
  if (!strokes.every((s) => s !== null) || !texts.every((t) => t !== null)) return null;
  if (new Set(texts.map((t) => t.id)).size !== texts.length) return null;
  return { savedAt, image: new Blob([imageBytes], { type: imageType }), imageName, tone, view, strokes, texts };
}
