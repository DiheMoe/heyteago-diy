// 快捷键与手势一览：同一张表驱动按键处理（useShortcuts）和帮助弹窗（ShortcutsHelp）。
// 手势条目在画布上由 Viewport 和工具处理，这里只提供说明。
import { useEffect } from "react";
import { canRedo, canUndo, type EditorAction, type EditorState, type EditorStore, type Tool } from "../model/document";

export interface KeyChord {
  key: string; // KeyboardEvent.key
  mod: boolean; // 按住 Ctrl 或 ⌘
  shift: boolean;
}

export interface Shortcut {
  // 帮助里显示的按键或手势、说明
  keys: string;
  desc: string;
  // 按键条目：这次按键要做的编辑动作，不适用时返回 null；手势条目没有
  action?: (k: KeyChord, s: EditorState) => EditorAction | null;
  // 匹配后拦下浏览器的默认行为
  preventDefault?: boolean;
}

const TOOL_KEYS = new Map<string, Tool>([
  ["v", "move"],
  ["b", "brush"],
  ["e", "eraser"],
  ["t", "text"],
]);

export const SHORTCUTS: Shortcut[] = [
  {
    keys: "Ctrl/⌘+Z · Ctrl/⌘+Shift+Z",
    desc: "撤销 / 重做",
    action: (k, s) => {
      if (!k.mod || k.key.toLowerCase() !== "z") return null;
      if (k.shift ? !canRedo(s) : !canUndo(s)) return null;
      return { type: k.shift ? "redo" : "undo" };
    },
    preventDefault: true,
  },
  {
    keys: "V / B / E / T",
    desc: "移动 / 画笔 / 橡皮擦 / 文字",
    action: (k) => {
      const tool = k.mod ? undefined : TOOL_KEYS.get(k.key.toLowerCase());
      return tool ? { type: "setTool", tool } : null;
    },
  },
  {
    keys: "[ / ]",
    desc: "调细 / 调粗",
    action: (k) => {
      if (k.mod || (k.key !== "[" && k.key !== "]")) return null;
      return { type: "nudgeStrokeSize", delta: k.key === "[" ? -2 : 2 };
    },
  },
  { keys: "Shift+点击", desc: "从上一笔终点画直线（触屏用画笔栏的「直线」开关）" },
  { keys: "Ctrl/⌘+滚轮", desc: "缩放视图（不影响成品）" },
  {
    keys: "Delete",
    desc: "删除选中文字",
    // 帮助里只写 Delete，Backspace 同样删除（Mac 键盘上标着 delete 的键发出的是 Backspace）；只在文字工具下生效
    action: (k, s) =>
      !k.mod && (k.key === "Delete" || k.key === "Backspace") && s.tool === "text" ? { type: "deleteSelectedText" } : null,
  },
  { keys: "双指轻点画布", desc: "撤销一步（触屏）" },
  { keys: "双指拖动画布", desc: "平移视图（放大后）" },
  { keys: "双指捏合画布", desc: "缩放视图" },
  { keys: "文字工具点按/拖动", desc: "放置、选中并移动文字" },
  { keys: "双击文字", desc: "重新编辑内容" },
  { keys: "Ctrl/⌘+回车 · Esc", desc: "结束文字编辑" },
];

// 一次按键对应的条目与编辑动作；没有条目处理时返回 null
export function matchShortcut(k: KeyChord, s: EditorState): { shortcut: Shortcut; action: EditorAction } | null {
  for (const shortcut of SHORTCUTS) {
    const action = shortcut.action?.(k, s);
    if (action) return { shortcut, action };
  }
  return null;
}

const TEXT_INPUT_TYPES = new Set(["text", "search", "tel", "url", "email", "password", "number"]);

// 能输入文字的元素：在这里按键是在打字，留给元素自己。滑块、复选框、按钮获得焦点时快捷键照常响应
export function isTextEntry(el: { tagName: string; type?: string; isContentEditable: boolean } | null): boolean {
  if (!el) return false;
  if (el.tagName === "TEXTAREA" || el.isContentEditable) return true;
  return el.tagName === "INPUT" && TEXT_INPUT_TYPES.has(el.type ?? "text");
}

// 全局按键处理：能输入文字的元素里的按键留给元素自身；suspended（有弹窗打开）时整体挂起
export function useShortcuts(store: EditorStore, suspended: boolean) {
  useEffect(() => {
    if (suspended) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextEntry(e.target instanceof HTMLElement ? e.target : null)) return;
      const hit = matchShortcut({ key: e.key, mod: e.ctrlKey || e.metaKey, shift: e.shiftKey }, store.getState());
      if (!hit) return;
      if (hit.shortcut.preventDefault) e.preventDefault();
      store.dispatch(hit.action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store, suspended]);
}
