// 撤销/重做栈（纯数据，不碰画布）：笔画存矢量点列，内存可忽略、深度不限；
// 文字存整组修改前后快照——文字对象很少，整组快照比逐个逆操作简单，也天然保住叠放次序；
// 底图设置（原图、色调、取景）同样存前后快照，原图只存引用。
// 撤销文字、设置条目 = 回到 before，重做 = 回到 after；笔画的重放由调用方负责。
// 空文字（isBlankText）不进快照：撤销/重做不会还原出看不见的文字，只涉及它们的改动也不算一步——
// 这样无论调用方怎样划分手势，放置后放弃的空文字都不会留下点了没反应的撤销步骤。
import { sameSettings, type BaseSettings } from "./settings";
import type { Stroke } from "./stroke";
import { isBlankText, sameTexts, type TextObj } from "./text";

export type HistoryEntry =
  | { kind: "stroke"; stroke: Stroke }
  // key 标识产生这条记录的手势/编辑会话（一次拖动、一次手柄拖拽、一次就地编辑）
  | { kind: "text"; before: TextObj[]; after: TextObj[]; key: number }
  // key 标识一次连续调节（拖一次滑块、一次平移）；null 表示单次改动（点按钮、换图），各自成一步
  | { kind: "settings"; before: BaseSettings; after: BaseSettings; key: symbol | null };

export interface History {
  done: HistoryEntry[];
  undone: HistoryEntry[];
}

export const EMPTY_HISTORY: History = { done: [], undone: [] };

// 新操作入栈并清空重做栈（新操作使重做失效是编辑器惯例）
export function pushStroke(h: History, stroke: Stroke): History {
  return { done: [...h.done, { kind: "stroke", stroke }], undone: [] };
}

// recordTexts 记一次文字改动。同一手势的连续改动（key 相同、紧接在栈顶、且没有可重做的记录）
// 合并为一条；合并后前后一致（如改了又改回）整条丢弃；没有可见变化的改动不入栈、也不动重做栈。
export function recordTexts(h: History, before: TextObj[], after: TextObj[], key: number): History {
  const b = before.filter((t) => !isBlankText(t));
  const a = after.filter((t) => !isBlankText(t));
  const top = h.done[h.done.length - 1];
  if (h.undone.length === 0 && top?.kind === "text" && top.key === key) {
    const rest = h.done.slice(0, -1);
    return { done: sameTexts(top.before, a) ? rest : [...rest, { ...top, after: a }], undone: [] };
  }
  if (sameTexts(b, a)) return h;
  return { done: [...h.done, { kind: "text", before: b, after: a, key }], undone: [] };
}

// recordSettings 记一次有变化的设置改动（调用方保证 before 与 after 不同）。同一次调节的连续改动
// 合并规则同 recordTexts：合并成一条，合并后前后一致（拖走又拖回原值）整条丢弃。
export function recordSettings(h: History, before: BaseSettings, after: BaseSettings, key: symbol | null): History {
  const top = h.done[h.done.length - 1];
  if (key !== null && h.undone.length === 0 && top?.kind === "settings" && top.key === key) {
    const rest = h.done.slice(0, -1);
    return { done: sameSettings(top.before, after) ? rest : [...rest, { ...top, after }], undone: [] };
  }
  return { done: [...h.done, { kind: "settings", before, after, key }], undone: [] };
}

export function undo(h: History): { history: History; entry: HistoryEntry } | null {
  const entry = h.done[h.done.length - 1];
  if (!entry) return null;
  return { history: { done: h.done.slice(0, -1), undone: [...h.undone, entry] }, entry };
}

export function redo(h: History): { history: History; entry: HistoryEntry } | null {
  const entry = h.undone[h.undone.length - 1];
  if (!entry) return null;
  return { history: { done: [...h.done, entry], undone: h.undone.slice(0, -1) }, entry };
}
