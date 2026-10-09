import { describe, expect, it } from "vitest";
import { editorReducer, initialEditorState, type EditorAction, type EditorState } from "../model/document";
import { isTextEntry, matchShortcut, SHORTCUTS, type KeyChord, type Shortcut } from "./shortcuts";

const press = (key: string, mods: { mod?: boolean; shift?: boolean } = {}): KeyChord => ({
  key,
  mod: mods.mod ?? false,
  shift: mods.shift ?? false,
});
const state = (...actions: EditorAction[]): EditorState => actions.reduce(editorReducer, initialEditorState());
const stroke = { tool: "brush" as const, size: 12, points: [{ x: 1, y: 1 }] };

const brush = state();
const withStroke = state({ type: "commitStroke", stroke });
const undone = state({ type: "commitStroke", stroke }, { type: "undo" });
const textTool = state({ type: "setTool", tool: "text" });

// [按键, 当时的状态, 期望的动作（null = 不处理）]
const CASES: Array<[KeyChord, EditorState, EditorAction | null]> = [
  [press("z", { mod: true }), withStroke, { type: "undo" }],
  [press("Z", { mod: true, shift: true }), undone, { type: "redo" }],
  [press("z", { mod: true }), brush, null],
  [press("Z", { mod: true, shift: true }), withStroke, null],
  [press("b"), textTool, { type: "setTool", tool: "brush" }],
  [press("B", { shift: true }), textTool, { type: "setTool", tool: "brush" }],
  [press("e"), brush, { type: "setTool", tool: "eraser" }],
  [press("T", { shift: true }), brush, { type: "setTool", tool: "text" }],
  [press("v"), brush, { type: "setTool", tool: "move" }],
  [press("b", { mod: true }), textTool, null],
  [press("["), brush, { type: "nudgeStrokeSize", delta: -2 }],
  [press("]"), brush, { type: "nudgeStrokeSize", delta: 2 }],
  [press("Delete"), textTool, { type: "deleteSelectedText" }],
  [press("Backspace"), textTool, { type: "deleteSelectedText" }],
  [press("Delete"), brush, null],
  [press("x"), brush, null],
];

describe("快捷键表", () => {
  it.each(CASES)("%o → %o", (chord, s, expected) => {
    expect(matchShortcut(chord, s)?.action ?? null).toEqual(expected);
  });

  it("每个按键条目都能匹配到动作；手势条目只出现在帮助里", () => {
    const matched = new Set<Shortcut>();
    for (const [chord, s] of CASES) {
      const hit = matchShortcut(chord, s);
      if (hit) matched.add(hit.shortcut);
    }
    expect(SHORTCUTS.filter((sc) => sc.action)).toEqual([...matched].sort((a, b) => SHORTCUTS.indexOf(a) - SHORTCUTS.indexOf(b)));
  });

  it("只在能输入文字的地方让出按键：文本类输入框、多行输入框、可编辑区域；滑块、复选框、按钮照常响应快捷键", () => {
    const el = (tagName: string, extra: { type?: string; isContentEditable?: boolean } = {}) => ({
      tagName,
      isContentEditable: false,
      ...extra,
    });
    for (const type of ["text", "search", "tel", "url", "email", "password", "number"]) {
      expect(isTextEntry(el("INPUT", { type }))).toBe(true);
    }
    expect(isTextEntry(el("TEXTAREA"))).toBe(true);
    expect(isTextEntry(el("DIV", { isContentEditable: true }))).toBe(true);
    for (const type of ["range", "checkbox", "radio", "button", "file"]) {
      expect(isTextEntry(el("INPUT", { type }))).toBe(false);
    }
    expect(isTextEntry(el("BUTTON"))).toBe(false);
    expect(isTextEntry(el("BODY"))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });

  it("只有撤销/重做拦下浏览器默认行为", () => {
    expect(matchShortcut(press("z", { mod: true }), withStroke)?.shortcut.preventDefault).toBe(true);
    expect(matchShortcut(press("e"), brush)?.shortcut.preventDefault).toBeFalsy();
  });
});
