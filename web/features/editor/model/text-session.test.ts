import { describe, expect, it } from "vitest";
import {
  canRedo,
  canUndo,
  editingTextId,
  editorReducer,
  initialEditorState,
  selectedTextId,
  type EditorAction,
  type EditorState,
} from "./document";

const image = { width: 596, height: 832 } as HTMLImageElement;
const run = (actions: EditorAction[], from: EditorState) => actions.reduce(editorReducer, from);
const start = () =>
  run(
    [
      { type: "imageLoaded", image, name: "a.png" },
      { type: "setTool", tool: "text" },
    ],
    initialEditorState(),
  );
// 文字工具按下；hit 是按下位置命中的文字（界面按文字框算出），默认没命中
const down = (x: number, y: number, hitId: number | null = null): EditorAction => ({
  type: "textPointerDown",
  point: { x, y },
  hitId,
});
// 在 (x, y) 放置一段文字，输入内容后收尾
const place = (s: EditorState, x: number, y: number, content: string) =>
  run([down(x, y), { type: "textEditChange", content }, { type: "textEditFinish" }], s);
const firstId = (s: EditorState) => s.doc.texts[0].id;
const contents = (s: EditorState) => s.doc.texts.map((t) => t.content);
const undoSteps = (s: EditorState) => s.history.done.length;

describe("文字交互", () => {
  it("空白处按下：新建空文字并进入编辑；输入后收尾只算一步，仍保持选中", () => {
    let s = editorReducer(start(), down(100, 200));
    expect(s.doc.texts).toEqual([
      { id: expect.any(Number), content: "", x: 100, y: 200, size: 48, angle: 0, weight: 700 },
    ]);
    const id = s.doc.texts[0].id;
    expect(editingTextId(s)).toBe(id);
    expect(selectedTextId(s)).toBe(id);

    s = run(
      [
        { type: "textEditChange", content: "喜" },
        { type: "textEditChange", content: "喜茶" },
        { type: "textEditFinish" },
      ],
      s,
    );
    expect(contents(s)).toEqual(["喜茶"]);
    expect(undoSteps(s)).toBe(1);
    expect(editingTextId(s)).toBeNull();
    expect(selectedTextId(s)).toBe(id);
  });

  it("放置后接着拖动与输入同属这次新建，撤销一次全部回退", () => {
    let s = editorReducer(start(), down(100, 200));
    s = run(
      [
        { type: "textDragBy", dx: 50, dy: 0 },
        { type: "textEditChange", content: "茶" },
        { type: "textEditFinish" },
      ],
      s,
    );
    expect(s.doc.texts[0]).toMatchObject({ x: 150, content: "茶" });
    s = editorReducer(s, { type: "undo" });
    expect(s.doc.texts).toEqual([]);
    expect(canUndo(s)).toBe(false);
  });

  it("命中已有文字：选中并开启新的拖动手势，一次拖动合并为一步", () => {
    let s = place(start(), 100, 200, "喜茶");
    s = run(
      [
        down(105, 205, firstId(s)),
        { type: "textDragBy", dx: 10, dy: 0 },
        { type: "textDragBy", dx: 10, dy: 0 },
      ],
      s,
    );
    expect(s.doc.texts[0].x).toBe(120);
    expect(undoSteps(s)).toBe(2);
    s = editorReducer(s, { type: "undo" });
    expect(s.doc.texts[0].x).toBe(100);
  });

  it("拖动钳制在画布内", () => {
    let s = place(start(), 100, 200, "茶");
    s = run(
      [
        down(100, 200, firstId(s)),
        { type: "textDragBy", dx: -500, dy: 5000 },
      ],
      s,
    );
    expect(s.doc.texts[0]).toMatchObject({ x: 0, y: 832 });
  });

  it("手柄按按下时的快照缩放，同一次拖拽合并为一步；结束后悬停移动不再生效", () => {
    let s = place(start(), 100, 200, "喜茶");
    // 在右下角 (148,224) 按下，拖到离中心两倍远的 (196,248)：字号 48 × 2 = 96
    const snapshot = { kind: "scale" as const, start: { x: 148, y: 224 }, size: 48, angle: 0 };
    s = run(
      [
        { type: "textHandleStart", snapshot },
        { type: "textHandleMove", point: { x: 172, y: 236 } },
        { type: "textHandleMove", point: { x: 196, y: 248 } },
      ],
      s,
    );
    expect(s.doc.texts[0].size).toBe(96);
    expect(undoSteps(s)).toBe(2);

    s = editorReducer(s, { type: "textHandleEnd" });
    expect(editorReducer(s, { type: "textHandleMove", point: { x: 100, y: 300 } })).toBe(s);
    s = editorReducer(s, { type: "undo" });
    expect(s.doc.texts[0].size).toBe(48);
  });

  it("手柄拖拽没收到抬起（指针捕获失败或丢失）：下一次在画布上按下即结束它，之后的手柄移动不再生效", () => {
    let s = place(start(), 100, 200, "喜茶");
    const snapshot = { kind: "scale" as const, start: { x: 148, y: 224 }, size: 48, angle: 0 };
    s = run(
      [
        { type: "textHandleStart", snapshot },
        down(100, 200, firstId(s)),
        { type: "textHandleMove", point: { x: 196, y: 248 } },
      ],
      s,
    );
    expect(s.handle).toBeNull();
    expect(s.doc.texts[0].size).toBe(48);
  });

  it("双击进入编辑开启新会话，内容与字重的改动合并为一步；已在编辑时双击不换会话", () => {
    let s = place(start(), 100, 200, "喜茶");
    s = editorReducer(s, { type: "textEditStart" });
    expect(editingTextId(s)).toBe(s.doc.texts[0].id);
    expect(editorReducer(s, { type: "textEditStart" })).toBe(s);

    s = run(
      [
        { type: "textEditChange", content: "喜茶\n店" },
        { type: "setTextWeight", weight: 900 },
        { type: "textEditFinish" },
      ],
      s,
    );
    expect(undoSteps(s)).toBe(2);
    s = editorReducer(s, { type: "undo" });
    expect(s.doc.texts[0]).toMatchObject({ content: "喜茶", weight: 700 });
  });

  it("双击空白处放置后输入：只算一步", () => {
    // 双击的第一下按下放置空文字，第二下按下命中这段空文字，随后的 dblclick 进入编辑
    let s = editorReducer(start(), down(100, 200));
    s = run(
      [
        down(100, 200, firstId(s)),
        { type: "textEditStart" },
        { type: "textEditChange", content: "喜茶" },
        { type: "textEditFinish" },
      ],
      s,
    );
    expect(undoSteps(s)).toBe(1);
    s = editorReducer(s, { type: "undo" });
    expect(s.doc.texts).toEqual([]);
  });

  it("编辑中点到空白处：只结束编辑并取消选中，不放置新文字；空文字被清掉且不留撤销步骤", () => {
    let s = editorReducer(start(), down(100, 200));
    s = editorReducer(s, down(400, 500));
    expect(s.doc.texts).toEqual([]);
    expect(s.text).toEqual({ mode: "idle" });
    expect(canUndo(s)).toBe(false);

    s = place(s, 400, 500, "茶");
    expect(contents(s)).toEqual(["茶"]);
    expect(undoSteps(s)).toBe(1);
  });

  it("编辑中点到空白处后拖动：不移动刚编辑完的文字", () => {
    let s = place(start(), 100, 200, "喜茶");
    s = run([{ type: "textEditStart" }, down(400, 500), { type: "textDragBy", dx: 30, dy: 30 }], s);
    expect(s.doc.texts[0]).toMatchObject({ x: 100, y: 200 });
  });

  it("编辑中点到另一段文字：收尾当前编辑并选中那段", () => {
    let s = place(start(), 100, 200, "喜");
    s = place(s, 300, 400, "茶");
    const [first, second] = s.doc.texts.map((t) => t.id);
    s = run([{ type: "textEditStart" }, { type: "textEditChange", content: "茶店" }, down(100, 200, first)], s);
    expect(editingTextId(s)).toBeNull();
    expect(selectedTextId(s)).toBe(first);
    expect(s.doc.texts.find((t) => t.id === second)?.content).toBe("茶店");
  });

  it("选中时改字重单独算一步；字重不变不算；编辑中改字重并入这次编辑", () => {
    let s = place(start(), 100, 200, "喜茶");
    const steps = undoSteps(s);
    expect(editorReducer(s, { type: "setTextWeight", weight: 700 })).toBe(s);
    s = editorReducer(s, { type: "setTextWeight", weight: 400 });
    expect(s.doc.texts[0].weight).toBe(400);
    expect(undoSteps(s)).toBe(steps + 1);
    s = run([{ type: "textEditStart" }, { type: "textEditChange", content: "喜茶店" }, { type: "setTextWeight", weight: 900 }], s);
    expect(undoSteps(s)).toBe(steps + 2);
    s = editorReducer(s, { type: "undo" });
    expect(s.doc.texts[0]).toMatchObject({ content: "喜茶", weight: 400 });
    expect(editorReducer(initialEditorState(), { type: "setTextWeight", weight: 400 })).toEqual(initialEditorState());
  });

  it("收尾时内容为空：删除该文字、取消选中，不留撤销步骤", () => {
    const s = run([down(100, 200), { type: "textDragBy", dx: 30, dy: 30 }, { type: "textEditFinish" }], start());
    expect(s.doc.texts).toEqual([]);
    expect(selectedTextId(s)).toBeNull();
    expect(canUndo(s) || canRedo(s)).toBe(false);
  });

  it("清空已有文字的内容等于删除，可撤销恢复", () => {
    let s = place(start(), 100, 200, "喜茶");
    s = run(
      [
        { type: "textEditStart" },
        { type: "textEditChange", content: "" },
        { type: "textEditFinish" },
      ],
      s,
    );
    expect(s.doc.texts).toEqual([]);
    s = editorReducer(s, { type: "undo" });
    expect(contents(s)).toEqual(["喜茶"]);
  });

  it("删除选中文字单独算一步，可撤销恢复", () => {
    let s = place(start(), 100, 200, "喜茶");
    s = editorReducer(s, { type: "deleteSelectedText" });
    expect(s.doc.texts).toEqual([]);
    expect(selectedTextId(s)).toBeNull();
    expect(undoSteps(s)).toBe(2);
    s = editorReducer(s, { type: "undo" });
    expect(contents(s)).toEqual(["喜茶"]);
  });

  it("撤销后选中或正在编辑的文字已不存在：清掉选中与编辑态", () => {
    let s = place(start(), 100, 200, "喜茶");
    s = editorReducer(s, { type: "textEditStart" });
    s = editorReducer(s, { type: "undo" });
    expect(s.doc.texts).toEqual([]);
    expect(s.text).toEqual({ mode: "idle" });
  });

  it("切换到其他工具：收尾当前编辑并取消选中", () => {
    let s = editorReducer(start(), down(100, 200));
    s = editorReducer(s, { type: "setTool", tool: "brush" });
    expect(s.doc.texts).toEqual([]);
    expect(s.text).toEqual({ mode: "idle" });

    let t = place(start(), 100, 200, "茶");
    t = editorReducer(t, { type: "setTool", tool: "eraser" });
    expect(contents(t)).toEqual(["茶"]);
    expect(selectedTextId(t)).toBeNull();
  });
});
