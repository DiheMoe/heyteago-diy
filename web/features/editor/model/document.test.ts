import { describe, expect, it } from "vitest";
import {
  BLANK_IMAGE_NAME,
  canRedo,
  canUndo,
  editorReducer,
  hasContent,
  initialEditorState,
  strokeAnchor,
  strokeSize,
  type EditorAction,
  type EditorDoc,
  type EditorState,
} from "./document";
import type { Stroke } from "./stroke";

const image = (width: number, height: number) => ({ width, height }) as HTMLImageElement;
const stroke = (x: number): Stroke => ({
  tool: "brush",
  size: 12,
  points: [
    { x, y: 0 },
    { x: x + 10, y: 5 },
  ],
});
const run = (actions: EditorAction[], from: EditorState = initialEditorState()) => actions.reduce(editorReducer, from);

// 深冻结：reducer 若原地修改了旧状态，严格模式下赋值直接抛错
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
const placeText = (x: number, y: number, content: string): EditorAction[] => [
  { type: "textPointerDown", point: { x, y }, hitId: null },
  { type: "textEditChange", content },
  { type: "textEditFinish" },
];

describe("原图与取景", () => {
  it("换原图保留笔画、文字和适配方式，其余取景复位", () => {
    const base = run([
      { type: "imageLoaded", image: image(596, 832), name: "a.png" },
      { type: "commitStroke", stroke: stroke(1) },
      { type: "setTool", tool: "text" },
      ...placeText(100, 100, "茶"),
      { type: "setFit", fit: "contain" },
      { type: "rotateView" },
    ]);
    const next = editorReducer(base, { type: "imageLoaded", image: image(800, 600), name: "b.png" });
    expect(next.doc.strokes).toBe(base.doc.strokes);
    expect(next.doc.texts).toBe(base.doc.texts);
    expect(next.doc.view).toEqual({ fit: "contain", rotate: 0, offsetX: 0, offsetY: 0 });
    expect(next.doc.imageName).toBe("b.png");
  });

  it("新建空白画布清空笔画、文字、撤销记录与选中", () => {
    const base = run([
      { type: "imageLoaded", image: image(596, 832), name: "a.png" },
      { type: "commitStroke", stroke: stroke(1) },
      { type: "setTool", tool: "text" },
      ...placeText(100, 100, "茶"),
    ]);
    const blank = image(596, 832);
    const next = editorReducer(base, { type: "blankCanvas", image: blank });
    expect(next.doc).toMatchObject({
      image: blank,
      imageName: "空白画布",
      strokes: [],
      texts: [],
      view: { fit: "cover", rotate: 0, offsetX: 0, offsetY: 0 },
    });
    expect(canUndo(next) || canRedo(next)).toBe(false);
    expect(next.text).toEqual({ mode: "idle" });
  });

  it("平移钳制在可平移范围内；到边界后再拖不换 doc", () => {
    // 1192×832 的图按 cover 放进 596×832：横向溢出 596，可平移 ±298；纵向不可平移
    let s = run([{ type: "imageLoaded", image: image(1192, 832), name: "wide.png" }]);
    s = editorReducer(s, { type: "panView", dx: 500, dy: 40 });
    expect(s.doc.view).toEqual({ fit: "cover", rotate: 0, offsetX: 298, offsetY: 0 });
    const doc = s.doc;
    expect(editorReducer(s, { type: "panView", dx: 10, dy: 0 }).doc).toBe(doc);
  });

  it("没有原图时平移和旋转不生效", () => {
    const s = initialEditorState();
    expect(editorReducer(s, { type: "panView", dx: 5, dy: 5 })).toBe(s);
    expect(editorReducer(s, { type: "rotateView" })).toBe(s);
  });

  it("旋转按 90° 步进并复位位移", () => {
    let s = run([
      { type: "imageLoaded", image: image(1192, 832), name: "wide.png" },
      { type: "panView", dx: 100, dy: 0 },
    ]);
    s = editorReducer(s, { type: "rotateView" });
    expect(s.doc.view).toMatchObject({ rotate: 90, offsetX: 0, offsetY: 0 });
    s = run([{ type: "rotateView" }, { type: "rotateView" }, { type: "rotateView" }], s);
    expect(s.doc.view.rotate).toBe(0);
  });

  it("切换适配方式时位移复位，调色调保留位移", () => {
    let s = run([
      { type: "imageLoaded", image: image(1192, 832), name: "wide.png" },
      { type: "panView", dx: 100, dy: 0 },
    ]);
    s = editorReducer(s, { type: "setTone", tone: { ...s.doc.tone, threshold: 180 } });
    expect(s.doc.view.offsetX).toBe(100);
    s = editorReducer(s, { type: "setFit", fit: "contain" });
    expect(s.doc.view).toEqual({ fit: "contain", rotate: 0, offsetX: 0, offsetY: 0 });
  });
});

const settingsOf = (doc: EditorState["doc"]) => ({ image: doc.image, imageName: doc.imageName, tone: doc.tone, view: doc.view });

describe("设置的撤销", () => {
  it("色调、适配、旋转、平移、换图都能撤销和重做", () => {
    let s = run([{ type: "imageLoaded", image: image(596, 832), name: "a.png" }]);
    expect(canUndo(s)).toBe(false);
    const steps: EditorAction[] = [
      { type: "setTone", tone: { ...s.doc.tone, threshold: 120 } },
      { type: "setFit", fit: "contain" },
      { type: "rotateView" },
      // 完整包含、旋转 90° 后原图横着放，纵向有空余可以平移
      { type: "panView", dx: 0, dy: 30 },
      { type: "imageLoaded", image: image(800, 600), name: "b.png" },
    ];
    const docs = [s.doc];
    for (const step of steps) {
      s = editorReducer(s, step);
      docs.push(s.doc);
    }
    for (let i = steps.length - 1; i >= 0; i--) {
      s = editorReducer(s, { type: "undo" });
      expect(settingsOf(s.doc)).toEqual(settingsOf(docs[i]));
    }
    expect(canUndo(s)).toBe(false);
    for (let i = 1; i <= steps.length; i++) {
      s = editorReducer(s, { type: "redo" });
      expect(settingsOf(s.doc)).toEqual(settingsOf(docs[i]));
    }
  });

  it("同一 key 的连续改动算一步，不同 key 各算一步", () => {
    let s = run([{ type: "imageLoaded", image: image(596, 832), name: "a.png" }]);
    const original = s.doc.tone;
    const first = Symbol("第一次拖动");
    const second = Symbol("第二次拖动");
    s = run(
      [
        { type: "setTone", tone: { ...original, threshold: 150 }, key: first },
        { type: "setTone", tone: { ...original, threshold: 120 }, key: first },
        { type: "setTone", tone: { ...original, threshold: 100 }, key: second },
      ],
      s,
    );
    s = editorReducer(s, { type: "undo" });
    expect(s.doc.tone.threshold).toBe(120);
    s = editorReducer(s, { type: "undo" });
    expect(s.doc.tone).toEqual(original);
    expect(canUndo(s)).toBe(false);
  });

  it("拖动后又回到原值：不留撤销步骤", () => {
    let s = run([{ type: "imageLoaded", image: image(596, 832), name: "a.png" }]);
    const original = s.doc.tone;
    const drag = Symbol("拖动");
    s = run(
      [
        { type: "setTone", tone: { ...original, threshold: 150 }, key: drag },
        { type: "setTone", tone: { ...original }, key: drag },
      ],
      s,
    );
    expect(canUndo(s)).toBe(false);
  });

  it("撤销之后继续同一次调节：另起一步，不跨过撤销合并", () => {
    let s = run([{ type: "imageLoaded", image: image(596, 832), name: "a.png" }]);
    const original = s.doc.tone;
    const drag = Symbol("拖动");
    s = run(
      [
        { type: "setTone", tone: { ...original, threshold: 150 }, key: drag },
        { type: "commitStroke", stroke: stroke(1) },
        { type: "undo" },
        { type: "setTone", tone: { ...original, threshold: 120 }, key: drag },
      ],
      s,
    );
    expect(canRedo(s)).toBe(false);
    s = editorReducer(s, { type: "undo" });
    expect(s.doc.tone.threshold).toBe(150);
  });

  it("设置改动与笔画交错时，撤销按时间倒序逐步回退", () => {
    let s = run([{ type: "imageLoaded", image: image(596, 832), name: "a.png" }]);
    s = run(
      [
        { type: "commitStroke", stroke: stroke(1) },
        { type: "setTone", tone: { ...s.doc.tone, threshold: 100 } },
        { type: "commitStroke", stroke: stroke(2) },
      ],
      s,
    );
    s = editorReducer(s, { type: "undo" });
    expect(s.doc.strokes).toHaveLength(1);
    expect(s.doc.tone.threshold).toBe(100);
    s = editorReducer(s, { type: "undo" });
    expect(s.doc.tone.threshold).toBe(170);
    s = editorReducer(s, { type: "undo" });
    expect(s.doc.strokes).toHaveLength(0);
  });
});

describe("撤销历史", () => {
  // 每一步都在深冻结的状态上执行：reducer 从不原地修改状态，改变导出内容的动作因此一定换新的 doc 对象
  it("随机动作序列下 doc.strokes 始终等于历史中的笔画序列，选中的文字始终存在，旧状态从不被修改；设置改动全部可撤销、可重做", () => {
    // 线性同余伪随机，结果可重现；取高位（低位周期很短，比如最低位只是 0、1 交替）
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return Math.floor((seed / 2147483648) * n);
    };
    let s = run([
      { type: "imageLoaded", image: image(596, 832), name: "a.png" },
      { type: "setTool", tool: "text" },
    ]);
    // 撤销到底时的设置：历史起点（首次载入原图或新建空白画布）时的设置
    let origin = settingsOf(s.doc);
    const checkRoundTrip = (from: EditorState) => {
      let t = from;
      while (canRedo(t)) t = editorReducer(t, { type: "redo" });
      const latest = settingsOf(t.doc);
      while (canUndo(t)) t = editorReducer(t, { type: "undo" });
      expect(settingsOf(t.doc)).toEqual(origin);
      while (canRedo(t)) t = editorReducer(t, { type: "redo" });
      expect(settingsOf(t.doc)).toEqual(latest);
    };
    const point = () => ({ x: rand(596), y: rand(832) });
    const keys = [Symbol("a"), Symbol("b"), Symbol("c")];
    const actions: Array<(i: number) => EditorAction> = [
      (i) => ({ type: "commitStroke", stroke: stroke(i) }),
      () => ({ type: "undo" }),
      () => ({ type: "redo" }),
      () => {
        // 界面只会报告已有文字的 id 为命中
        const { texts } = s.doc;
        const hitId = texts.length > 0 && rand(2) ? texts[rand(texts.length)].id : null;
        return { type: "textPointerDown", point: point(), hitId };
      },
      () => ({ type: "textEditChange", content: ["茶", "", "喜\n茶"][rand(3)] }),
      () => ({ type: "setTextWeight", weight: [400, 700, 900][rand(3)] }),
      () => ({ type: "deleteSelectedText" }),
      () => ({ type: "textEditFinish" }),
      () => ({ type: "textEditStart" }),
      () => ({ type: "textDragBy", dx: rand(81) - 40, dy: rand(81) - 40 }),
      () => ({
        type: "textHandleStart",
        snapshot: { kind: rand(2) ? "scale" : "rotate", start: point(), size: 48, angle: 0 },
      }),
      () => ({ type: "textHandleMove", point: point() }),
      () => ({ type: "textHandleEnd" }),
      () => ({ type: "setTool", tool: rand(2) ? "text" : "brush" }),
      () => ({ type: "setStrokeSize", size: 2 + rand(79) }),
      () => ({ type: "nudgeStrokeSize", delta: rand(2) ? 2 : -2 }),
      () => ({ type: "setPressure", on: rand(2) === 0 }),
      () => ({ type: "imageLoaded", image: image(800 + rand(400), 600), name: "b.png" }),
      () => ({ type: "setTone", tone: { ...s.doc.tone, threshold: rand(256) }, key: keys[rand(3)] }),
      () => ({ type: "setFit", fit: rand(2) ? "cover" : "contain" }),
      () => ({ type: "panView", dx: rand(81) - 40, dy: rand(81) - 40, key: keys[rand(3)] }),
      () => ({ type: "rotateView" }),
    ];
    for (let i = 0; i < 2000; i++) {
      // 新建画布会清空一切，只以约 1% 的概率抽中，让历史有机会积累
      const action: EditorAction =
        rand(100) === 0 ? { type: "blankCanvas", image: image(596, 832) } : actions[rand(actions.length)](i);
      s = editorReducer(deepFreeze(s), action);
      if (action.type === "blankCanvas") origin = settingsOf(s.doc);
      if (i % 100 === 99) checkRoundTrip(s);
      const fromHistory = s.history.done.flatMap((e) => (e.kind === "stroke" ? [e.stroke] : []));
      expect(s.doc.strokes).toHaveLength(fromHistory.length);
      s.doc.strokes.forEach((x, k) => expect(x).toBe(fromHistory[k]));
      const text = s.text;
      if (text.mode !== "idle") expect(s.doc.texts.some((t) => t.id === text.id)).toBe(true);
    }
  });

  it("撤销笔画去掉最后一笔，重做补回同一笔；Shift 直线的起点随之变化", () => {
    const a = stroke(1);
    const b = stroke(100);
    let s = run([
      { type: "commitStroke", stroke: a },
      { type: "commitStroke", stroke: b },
    ]);
    expect(strokeAnchor(s)).toBe(b.points[1]);
    s = editorReducer(s, { type: "undo" });
    expect(s.doc.strokes).toEqual([a]);
    expect(strokeAnchor(s)).toBe(a.points[1]);
    s = editorReducer(s, { type: "redo" });
    expect(s.doc.strokes[1]).toBe(b);
    expect(strokeAnchor(run([]))).toBeNull();
  });

  it("没有可撤销、可重做的记录时状态不变", () => {
    const s = initialEditorState();
    expect(editorReducer(s, { type: "undo" })).toBe(s);
    expect(editorReducer(s, { type: "redo" })).toBe(s);
  });
});

describe("导入照片时自动选明暗分界", () => {
  it("黑白二值模式下采用自动选出的分界，对齐到滑块步长并限制在滑块范围内；与换图同属一步撤销", () => {
    let s = run([{ type: "imageLoaded", image: image(596, 832), name: "a.png" }]);
    s = editorReducer(s, { type: "imageLoaded", image: image(800, 600), name: "b.png", threshold: 131.5 });
    expect(s.doc.tone.threshold).toBe(130);
    expect(editorReducer(s, { type: "imageLoaded", image: image(800, 600), name: "c.png", threshold: 250 }).doc.tone.threshold).toBe(220);
    expect(editorReducer(s, { type: "imageLoaded", image: image(800, 600), name: "c.png", threshold: 10 }).doc.tone.threshold).toBe(60);
    s = editorReducer(s, { type: "undo" });
    expect(s.doc).toMatchObject({ imageName: "a.png", tone: { threshold: 170 } });
  });

  it("没有自动分界（单一亮度）或在点阵模式下，分界保持不变", () => {
    const s = run([{ type: "imageLoaded", image: image(596, 832), name: "a.png" }]);
    expect(editorReducer(s, { type: "imageLoaded", image: image(800, 600), name: "b.png" }).doc.tone.threshold).toBe(170);
    const dots = editorReducer(s, { type: "setTone", tone: { ...s.doc.tone, toneMode: "dots" } });
    expect(editorReducer(dots, { type: "imageLoaded", image: image(800, 600), name: "b.png", threshold: 100 }).doc.tone.threshold).toBe(170);
  });
});

describe("恢复上次的编辑", () => {
  // 1192×832 的图按 cover 放进画布：横向可平移 ±298，纵向不可平移
  const saved = (patch: Partial<EditorDoc> = {}): EditorDoc => ({
    image: image(1192, 832),
    imageName: "a.png",
    tone: { toneMode: "dots", threshold: 120, density: 8, pattern: "diamond" },
    view: { fit: "cover", rotate: 0, offsetX: 50, offsetY: 0 },
    strokes: [stroke(1), stroke(2)],
    // id 1 正是全新状态下一段新文字会拿到的 id
    texts: [{ id: 1, content: "茶", x: 100, y: 100, size: 48, angle: 0, weight: 700 }],
    ...patch,
  });

  it("换上保存的文档；笔画重建为撤销历史，文字和设置不进历史；选中与编辑态清空", () => {
    const before = run([{ type: "imageLoaded", image: image(800, 600), name: "b.png" }, { type: "setTool", tool: "text" }, ...placeText(10, 10, "旧")]);
    const doc = saved();
    const s = editorReducer(before, { type: "restore", doc });
    expect(s.doc).toEqual(doc);
    expect(s.history).toEqual({ done: doc.strokes.map((stroke) => ({ kind: "stroke", stroke })), undone: [] });
    expect(s.text).toEqual({ mode: "idle" });
    const undone = run([{ type: "undo" }, { type: "undo" }], s);
    expect(undone.doc.strokes).toEqual([]);
    expect(undone.doc.texts).toEqual(doc.texts);
    expect(canUndo(undone)).toBe(false);
  });

  it("之后新放的文字 id 不与恢复的文字冲突", () => {
    let s = editorReducer(initialEditorState(), { type: "restore", doc: saved() });
    s = run([{ type: "setTool", tool: "text" }, ...placeText(300, 300, "新")], s);
    expect(new Set(s.doc.texts.map((t) => t.id)).size).toBe(2);
  });

  it("取景位移钳回可平移范围", () => {
    const s = editorReducer(initialEditorState(), {
      type: "restore",
      doc: saved({ view: { fit: "cover", rotate: 0, offsetX: 5000, offsetY: 5000 } }),
    });
    expect(s.doc.view).toMatchObject({ offsetX: 298, offsetY: 0 });
  });
});

describe("画布上有没有值得保留的内容", () => {
  it("空白画布没画东西不算；画了笔画、放了文字或用的是照片都算", () => {
    const blank = run([{ type: "blankCanvas", image: image(596, 832) }]);
    expect(blank.doc.imageName).toBe(BLANK_IMAGE_NAME);
    expect(hasContent(initialEditorState())).toBe(false);
    expect(hasContent(blank)).toBe(false);
    expect(hasContent(editorReducer(blank, { type: "commitStroke", stroke: stroke(1) }))).toBe(true);
    expect(hasContent(run([{ type: "setTool", tool: "text" }, ...placeText(100, 100, "茶")], blank))).toBe(true);
    expect(hasContent(editorReducer(blank, { type: "imageLoaded", image: image(800, 600), name: "b.png" }))).toBe(true);
    // 正在输入、还没有内容的文字不算
    expect(hasContent(run([{ type: "setTool", tool: "text" }, { type: "textPointerDown", point: { x: 1, y: 1 }, hitId: null }], blank))).toBe(false);
  });
});

describe("工具设置", () => {
  it("画笔和橡皮擦各自记忆粗细；[ ] 调节钳制在 2–80", () => {
    let s = initialEditorState();
    expect(strokeSize(s)).toBe(12);
    s = editorReducer(s, { type: "setStrokeSize", size: 30 });
    s = editorReducer(s, { type: "setTool", tool: "eraser" });
    expect(strokeSize(s)).toBe(40);
    s = run(Array.from({ length: 30 }, (): EditorAction => ({ type: "nudgeStrokeSize", delta: 2 })), s);
    expect(strokeSize(s)).toBe(80);
    s = editorReducer(s, { type: "setTool", tool: "brush" });
    expect(strokeSize(s)).toBe(30);
    s = run(Array.from({ length: 30 }, (): EditorAction => ({ type: "nudgeStrokeSize", delta: -2 })), s);
    expect(strokeSize(s)).toBe(2);
  });

  it("选中文字、切换工具、调粗细、开关压感和直线都不换 doc", () => {
    const s = run([
      { type: "imageLoaded", image: image(596, 832), name: "a.png" },
      { type: "setTool", tool: "text" },
      ...placeText(100, 100, "茶"),
    ]);
    const after = run(
      [
        { type: "textPointerDown", point: { x: 100, y: 100 }, hitId: s.doc.texts[0].id },
        { type: "setTool", tool: "brush" },
        { type: "setStrokeSize", size: 20 },
        { type: "nudgeStrokeSize", delta: 2 },
        { type: "setPressure", on: true },
        { type: "setLineMode", on: true },
      ],
      s,
    );
    expect(after.doc).toBe(s.doc);
    expect(after.lineMode).toBe(true);
  });
});
