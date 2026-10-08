// 文字交互的状态转移（纯函数，由 editorReducer 调用）。
// 选中/编辑状态见 TextSession；拖动和手柄拖拽各用一个手势 key，就地编辑用一个会话 key，
// 同一 key 的连续改动在撤销历史里合并为一步。
import { CUP_HEIGHT, CUP_WIDTH } from "@/shared/constants";
import type { EditorState } from "./document";
import { recordTexts } from "./history";
import { dragTextHandle, isBlankText, sameTexts, type TextHandleDrag, type TextObj } from "./text";

// 新放置文字的默认值；大小、角度可在选中后经手柄调整
const NEW_TEXT = { content: "", size: 48, angle: 0, weight: 700 };

const IDLE = { mode: "idle" } as const;

function selected(s: EditorState): number | null {
  return s.text.mode === "idle" ? null : s.text.id;
}

// 选中或正在编辑的文字：不变量保证这个 id 在 doc.texts 里
function textOf(s: EditorState, id: number): TextObj {
  return s.doc.texts.find((x) => x.id === id)!;
}

// changeTexts 换上新的文字列表并按 key 记入撤销历史；内容没有变化时什么也不改
function changeTexts(s: EditorState, after: TextObj[], key: number): EditorState {
  if (sameTexts(s.doc.texts, after)) return s;
  return { ...s, doc: { ...s.doc, texts: after }, history: recordTexts(s.history, s.doc.texts, after, key) };
}

function patchText(s: EditorState, id: number, patch: Partial<TextObj>, key: number): EditorState {
  return changeTexts(
    s,
    s.doc.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    key,
  );
}

// 就地编辑收尾（完成、失焦、Esc、切换工具、点到别处）：内容为空则删除该文字并取消选中；
// 新建后没输入的不留撤销步骤（空文字不进历史快照），原有文字被清空则记为一次删除
export function finishEdit(s: EditorState): EditorState {
  if (s.text.mode !== "editing") return s;
  const { id, key } = s.text;
  const next: EditorState = { ...s, text: { mode: "selected", id } };
  if (!isBlankText(textOf(s, id))) return next;
  return {
    ...changeTexts(
      next,
      next.doc.texts.filter((x) => x.id !== id),
      key,
    ),
    text: IDLE,
  };
}

// 文字工具按下（hitId 为命中的文字）：命中则选中，之后的拖动是新手势；编辑中点到空白处只结束编辑、
// 取消选中；否则在该点放置空文字并进入编辑，之后的拖动与输入都归入这次新建。
// 按下即开始新手势：没收到抬起的手柄拖拽随之结束
export function pointerDown(s: EditorState, point: { x: number; y: number }, hitId: number | null): EditorState {
  const editingId = s.text.mode === "editing" ? s.text.id : null;
  // 点到别处先收尾正在编辑的文字：输入框不一定失焦，空文字得在这里清掉
  let next = editingId !== null && hitId !== editingId ? finishEdit(s) : s;
  const key = next.seq + 1;
  if (hitId !== null) {
    const keepEditing = next.text.mode === "editing" && next.text.id === hitId;
    return {
      ...next,
      seq: key,
      gesture: key,
      handle: null,
      text: keepEditing ? next.text : { mode: "selected", id: hitId },
    };
  }
  if (editingId !== null) return { ...next, seq: key, gesture: key, handle: null, text: IDLE };
  const t: TextObj = { id: key, x: point.x, y: point.y, ...NEW_TEXT };
  next = changeTexts(next, [...next.doc.texts, t], key);
  return { ...next, seq: key, gesture: key, handle: null, text: { mode: "editing", id: t.id, key } };
}

// 拖动移动选中文字，钳制在画布内
export function dragBy(s: EditorState, dx: number, dy: number): EditorState {
  const id = selected(s);
  if (id === null) return s;
  const t = textOf(s, id);
  return patchText(
    s,
    id,
    { x: Math.max(0, Math.min(CUP_WIDTH, t.x + dx)), y: Math.max(0, Math.min(CUP_HEIGHT, t.y + dy)) },
    s.gesture,
  );
}

export function handleStart(s: EditorState, snapshot: TextHandleDrag): EditorState {
  const key = s.seq + 1;
  return { ...s, seq: key, gesture: key, handle: snapshot };
}

// 手柄拖拽中：按按下时的快照算出新字号或新角度
export function handleMove(s: EditorState, point: { x: number; y: number }): EditorState {
  const id = selected(s);
  if (!s.handle || id === null) return s;
  return patchText(s, id, dragTextHandle(s.handle, textOf(s, id), point), s.gesture);
}

export function handleEnd(s: EditorState): EditorState {
  return s.handle ? { ...s, handle: null } : s;
}

// 双击进入编辑选中的文字；已在编辑时保持原会话
export function editStart(s: EditorState): EditorState {
  if (s.text.mode !== "selected") return s;
  const key = s.seq + 1;
  return { ...s, seq: key, text: { mode: "editing", id: s.text.id, key } };
}

export function editChange(s: EditorState, content: string): EditorState {
  if (s.text.mode !== "editing") return s;
  return patchText(s, s.text.id, { content }, s.text.key);
}

// 改选中文字的字重：编辑中并入这次编辑，否则单独算一步
export function setWeight(s: EditorState, weight: number): EditorState {
  const id = selected(s);
  if (id === null || textOf(s, id).weight === weight) return s;
  if (s.text.mode === "editing") return patchText(s, id, { weight }, s.text.key);
  const key = s.seq + 1;
  return patchText({ ...s, seq: key }, id, { weight }, key);
}

// 删除选中文字：单独一步，可撤销恢复
export function deleteSelected(s: EditorState): EditorState {
  const id = selected(s);
  if (id === null) return s;
  const key = s.seq + 1;
  const next = changeTexts(
    { ...s, seq: key },
    s.doc.texts.filter((t) => t.id !== id),
    key,
  );
  return { ...next, text: IDLE, handle: null };
}

// 离开文字工具：收尾当前编辑并取消选中
export function leave(s: EditorState): EditorState {
  const next = finishEdit(s);
  return next.text.mode === "idle" && !next.handle ? next : { ...next, text: IDLE, handle: null };
}

// 撤销、重做或清空后，选中或正在编辑的文字可能已不存在，随之清掉
export function dropStale(s: EditorState): EditorState {
  if (s.text.mode === "idle") return s;
  const id = s.text.id;
  return s.doc.texts.some((t) => t.id === id) ? s : { ...s, text: IDLE, handle: null };
}
