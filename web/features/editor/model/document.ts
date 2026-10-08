// 编辑器状态与唯一的写入者 editorReducer（纯函数，不碰 React、DOM、画布）。
// 不变量（由 reducer 保证、单测覆盖）：
// - doc.strokes 恒等于 history.done 中笔画条目按顺序组成的序列；
// - 选中、正在编辑的文字 id 一定存在于 doc.texts；
// - reducer 从不原地修改状态，改变导出内容的动作因此一定换 doc 对象；选中、调粗细、开关压感和直线不换，
//   切换工具也不换（离开文字工具时删掉正在编辑的空文字除外）。待确认的发布据此判断是否过期。
import { createStore, type Store } from "@/shared/store";
import { EMPTY_HISTORY, pushStroke, recordSettings, redo, undo, type History, type HistoryEntry } from "./history";
import {
  offsetBounds,
  sameSettings,
  snapBinaryThreshold,
  type BaseSettings,
  type FitMode,
  type ToneSettings,
  type View,
} from "./settings";
import type { Stroke, StrokePoint } from "./stroke";
import * as text from "./text-session";
import { isBlankText, type TextHandleDrag, type TextObj } from "./text";

// browse（浏览）：不选工具，画布不接管触摸，单指滑动滚动页面。触屏设备默认处于浏览
export type Tool = "browse" | "brush" | "eraser" | "move" | "text";

// 空白画布的原图名
export const BLANK_IMAGE_NAME = "空白画布";

// 决定导出内容的全部数据。原图换了也保留笔画和文字（它们在独立图层）
export interface EditorDoc extends BaseSettings {
  strokes: Stroke[];
  texts: TextObj[];
}

// 文字交互状态：editing 的文字必然也是选中的那段；key 是这次就地编辑的会话 key
export type TextSession =
  | { mode: "idle" }
  | { mode: "selected"; id: number }
  | { mode: "editing"; id: number; key: number };

export interface EditorState {
  doc: EditorDoc;
  history: History;
  text: TextSession;
  // 当前指针手势（文字拖动、手柄拖拽）的 key
  gesture: number;
  // 手柄拖拽的起始快照；拖拽结束后为 null
  handle: TextHandleDrag | null;
  tool: Tool;
  // 画笔与橡皮擦各自记忆粗细，来回切换不用重调
  brushSize: number;
  eraserSize: number;
  // 压感开关（手写笔），关闭时恒粗
  pressure: boolean;
  // 直线模式：每次按下都从上一笔终点连一条直线（同 Shift+点击，触屏上没有 Shift 键）
  lineMode: boolean;
  // 文字 id、手势 key、编辑会话 key 共用的递增计数
  seq: number;
}

// 调节底图设置的动作可带 key 标识一次连续调节（一次滑块拖动、一次平移拖动传同一个 key），
// 同一 key 的改动合并为一步撤销；不带 key 的改动各自成一步。
export type EditorAction =
  // threshold：按新原图取景后的亮度自动选出的明暗分界，黑白二值时采用；原图只有一种亮度时没有
  | { type: "imageLoaded"; image: HTMLImageElement; name: string; threshold?: number }
  | { type: "blankCanvas"; image: HTMLImageElement }
  // 恢复自动保存的编辑（doc 已校验过）
  | { type: "restore"; doc: EditorDoc }
  | { type: "setTone"; tone: ToneSettings; key?: symbol }
  | { type: "setFit"; fit: FitMode }
  | { type: "panView"; dx: number; dy: number; key?: symbol }
  | { type: "rotateView" }
  | { type: "commitStroke"; stroke: Stroke }
  // hitId：按下位置命中的文字，由界面按文字框的实际尺寸算出（见 hitText）
  | { type: "textPointerDown"; point: { x: number; y: number }; hitId: number | null }
  | { type: "textDragBy"; dx: number; dy: number }
  | { type: "textHandleStart"; snapshot: TextHandleDrag }
  | { type: "textHandleMove"; point: { x: number; y: number } }
  | { type: "textHandleEnd" }
  | { type: "textEditStart" }
  | { type: "textEditChange"; content: string }
  | { type: "setTextWeight"; weight: number }
  | { type: "textEditFinish" }
  | { type: "deleteSelectedText" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "setTool"; tool: Tool }
  | { type: "setStrokeSize"; size: number }
  | { type: "nudgeStrokeSize"; delta: number }
  | { type: "setPressure"; on: boolean }
  | { type: "setLineMode"; on: boolean };

// 换原图时取景复位，只保留适配方式（它是对所有原图的偏好）
export const freshView = (fit: FitMode): View => ({ fit, rotate: 0, offsetX: 0, offsetY: 0 });

export function initialEditorState(): EditorState {
  return {
    doc: {
      image: null,
      imageName: null,
      tone: { toneMode: "binary", threshold: 170, density: 6, pattern: "circle" },
      view: freshView("cover"),
      strokes: [],
      texts: [],
    },
    history: EMPTY_HISTORY,
    text: { mode: "idle" },
    gesture: 0,
    handle: null,
    tool: "brush",
    brushSize: 12,
    eraserSize: 40,
    pressure: false,
    lineMode: false,
    seq: 0,
  };
}

function withDoc(s: EditorState, patch: Partial<EditorDoc>): EditorState {
  return { ...s, doc: { ...s.doc, ...patch } };
}

const settingsOf = (doc: EditorDoc): BaseSettings => ({
  image: doc.image,
  imageName: doc.imageName,
  tone: doc.tone,
  view: doc.view,
});

// 改底图设置，没有变化时原样返回。有原图时记入撤销历史；还没有原图时只是预选（看不到效果），
// 不记——首次载入原图也因此不算一步，撤销不会退回到没有原图的空画布。
function changeSettings(s: EditorState, patch: Partial<BaseSettings>, key?: symbol): EditorState {
  const before = settingsOf(s.doc);
  const after = { ...before, ...patch };
  if (sameSettings(before, after)) return s;
  const next = withDoc(s, after);
  return before.image ? { ...next, history: recordSettings(s.history, before, after, key ?? null) } : next;
}

// 换取景（需要原图）：位移钳回新取景的可平移范围
function changeView(s: EditorState, view: View, key?: symbol): EditorState {
  if (!s.doc.image) return s;
  const b = offsetBounds(s.doc.image, view);
  const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v));
  return changeSettings(
    s,
    { view: { ...view, offsetX: clamp(view.offsetX, b.maxX), offsetY: clamp(view.offsetY, b.maxY) } },
    key,
  );
}

// 撤销一条记录对 doc 的改动；reapply 是它的逆
function revert(doc: EditorDoc, entry: HistoryEntry): Partial<EditorDoc> {
  switch (entry.kind) {
    case "stroke":
      return { strokes: doc.strokes.slice(0, -1) };
    case "text":
      return { texts: entry.before };
    case "settings":
      return entry.before;
  }
}

function reapply(doc: EditorDoc, entry: HistoryEntry): Partial<EditorDoc> {
  switch (entry.kind) {
    case "stroke":
      return { strokes: [...doc.strokes, entry.stroke] };
    case "text":
      return { texts: entry.after };
    case "settings":
      return entry.after;
  }
}

function setStrokeSize(s: EditorState, size: number): EditorState {
  return s.tool === "eraser" ? { ...s, eraserSize: size } : { ...s, brushSize: size };
}

export function editorReducer(s: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "imageLoaded": {
      const { tone } = s.doc;
      const threshold = tone.toneMode === "binary" ? action.threshold : undefined;
      return changeSettings(s, {
        image: action.image,
        imageName: action.name,
        tone: threshold === undefined ? tone : { ...tone, threshold: snapBinaryThreshold(threshold) },
        view: freshView(s.doc.view.fit),
      });
    }
    case "blankCanvas":
      // 全新开始：清空笔画、文字与撤销/重做历史
      return {
        ...withDoc(s, {
          image: action.image,
          imageName: BLANK_IMAGE_NAME,
          view: freshView(s.doc.view.fit),
          strokes: [],
          texts: [],
        }),
        history: EMPTY_HISTORY,
        text: { mode: "idle" },
        handle: null,
      };
    case "restore": {
      // 笔画重建为撤销历史，文字和设置不进历史；之后新建的文字 id 接着恢复的往后排
      const { doc } = action;
      const b = doc.image ? offsetBounds(doc.image, doc.view) : { maxX: 0, maxY: 0 };
      const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v));
      return {
        ...s,
        doc: {
          ...doc,
          view: { ...doc.view, offsetX: clamp(doc.view.offsetX, b.maxX), offsetY: clamp(doc.view.offsetY, b.maxY) },
        },
        history: { done: doc.strokes.map((stroke) => ({ kind: "stroke", stroke })), undone: [] },
        text: { mode: "idle" },
        handle: null,
        seq: Math.max(s.seq, ...doc.texts.map((t) => t.id)),
      };
    }
    case "setTone":
      return changeSettings(s, { tone: action.tone }, action.key);
    case "setFit":
      // 适配方式切换改变可平移范围，已有位移随之复位
      if (action.fit === s.doc.view.fit) return s;
      return changeSettings(s, { view: { ...s.doc.view, fit: action.fit, offsetX: 0, offsetY: 0 } });
    case "panView": {
      const { view } = s.doc;
      return changeView(
        s,
        { ...view, offsetX: view.offsetX + action.dx, offsetY: view.offsetY + action.dy },
        action.key,
      );
    }
    case "rotateView":
      // 旋转后可平移范围变化，位移复位
      if (!s.doc.image) return s;
      return changeSettings(s, {
        view: { ...s.doc.view, rotate: (s.doc.view.rotate + 90) % 360, offsetX: 0, offsetY: 0 },
      });
    case "commitStroke":
      return {
        ...withDoc(s, { strokes: [...s.doc.strokes, action.stroke] }),
        history: pushStroke(s.history, action.stroke),
      };
    case "textPointerDown":
      return text.pointerDown(s, action.point, action.hitId);
    case "textDragBy":
      return text.dragBy(s, action.dx, action.dy);
    case "textHandleStart":
      return text.handleStart(s, action.snapshot);
    case "textHandleMove":
      return text.handleMove(s, action.point);
    case "textHandleEnd":
      return text.handleEnd(s);
    case "textEditStart":
      return text.editStart(s);
    case "textEditChange":
      return text.editChange(s, action.content);
    case "setTextWeight":
      return text.setWeight(s, action.weight);
    case "textEditFinish":
      return text.finishEdit(s);
    case "deleteSelectedText":
      return text.deleteSelected(s);
    case "undo": {
      const r = undo(s.history);
      if (!r) return s;
      return text.dropStale({ ...withDoc(s, revert(s.doc, r.entry)), history: r.history });
    }
    case "redo": {
      const r = redo(s.history);
      if (!r) return s;
      return text.dropStale({ ...withDoc(s, reapply(s.doc, r.entry)), history: r.history });
    }
    case "setTool":
      if (action.tool === s.tool) return s;
      return { ...(s.tool === "text" ? text.leave(s) : s), tool: action.tool };
    case "setStrokeSize":
      return setStrokeSize(s, action.size);
    case "nudgeStrokeSize":
      return setStrokeSize(s, Math.min(80, Math.max(2, strokeSize(s) + action.delta)));
    case "setPressure":
      return { ...s, pressure: action.on };
    case "setLineMode":
      return { ...s, lineMode: action.on };
  }
}

export const selectedTextId = (s: EditorState): number | null => (s.text.mode === "idle" ? null : s.text.id);
export const editingTextId = (s: EditorState): number | null => (s.text.mode === "editing" ? s.text.id : null);
export const strokeSize = (s: EditorState): number => (s.tool === "eraser" ? s.eraserSize : s.brushSize);
export const canUndo = (s: EditorState): boolean => s.history.done.length > 0;
export const canRedo = (s: EditorState): boolean => s.history.undone.length > 0;
// 画布上有笔画或看得见的文字
export const hasDrawing = (s: EditorState): boolean =>
  s.doc.strokes.length > 0 || s.doc.texts.some((t) => !isBlankText(t));
// 画布上有值得保留的内容：画了东西，或者用的是照片而不是空白画布
export const hasContent = (s: EditorState): boolean =>
  hasDrawing(s) || (s.doc.image !== null && s.doc.imageName !== BLANK_IMAGE_NAME);

// 直线（Shift+点击、直线模式）的起点：现存最后一笔的终点
export function strokeAnchor(s: EditorState): StrokePoint | null {
  const last = s.doc.strokes[s.doc.strokes.length - 1];
  return last ? (last.points[last.points.length - 1] ?? null) : null;
}

export type EditorStore = Store<EditorState, EditorAction>;
export const createEditorStore = (): EditorStore => createStore(editorReducer, initialEditorState());
