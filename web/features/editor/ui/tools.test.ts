import { describe, expect, it } from "vitest";
import type { StrokeLayer } from "../canvas/stroke-layer";
import { createEditorStore, type EditorAction } from "../model/document";
import type { Stroke } from "../model/stroke";
import { textBoxSize, textLines, type TextObj } from "../model/text";
import { createPointerTools } from "./tools";

// 不画画布的笔画层：只按真实笔画层的约定收集点列，结束时交出
function fakeStrokeLayer() {
  const calls: string[] = [];
  let live: Stroke | null = null;
  const layer: StrokeLayer = {
    begin(tool, size, point) {
      calls.push("begin");
      live = { tool, size, points: [point] };
    },
    extend(points) {
      live?.points.push(...points);
    },
    end() {
      calls.push("end");
      const s = live;
      live = null;
      return s;
    },
    cancel() {
      calls.push("cancel");
      live = null;
    },
    paint() {
      calls.push("paint");
    },
    sync() {},
  };
  return { layer, calls };
}

function setup(...actions: EditorAction[]) {
  const store = createEditorStore();
  for (const a of actions) store.dispatch(a);
  const { layer, calls } = fakeStrokeLayer();
  const tools = createPointerTools(store, () => layer, measure);
  return { store, tools, calls };
}

// 测量替身：每个字宽一个字号（与中文字体相近）
const measure = (t: TextObj) => textBoxSize(textLines(t.content).map((line) => line.length * t.size), t.size);
const sample = (x: number, y: number, pressure = 0.5) => ({ x, y, pressure });
const wideImage = { width: 1192, height: 832 } as HTMLImageElement;

describe("画布指针工具", () => {
  it("画笔：按下、移动、抬起提交一笔；压感关闭时点列不带压力", () => {
    const { store, tools } = setup();
    expect(tools.down(sample(10, 10), false)).toBe(true);
    tools.move(sample(30, 12), [sample(20, 10), sample(30, 12)]);
    tools.up();
    expect(store.getState().doc.strokes).toEqual([
      {
        tool: "brush",
        size: 12,
        points: [
          { x: 10, y: 10 },
          { x: 20, y: 10 },
          { x: 30, y: 12 },
        ],
      },
    ]);
  });

  it("压感开启时点列记录压力", () => {
    const { store, tools } = setup({ type: "setPressure", on: true });
    tools.down(sample(10, 10, 0.3), false);
    tools.up();
    expect(store.getState().doc.strokes[0].points).toEqual([{ x: 10, y: 10, p: 0.3 }]);
  });

  it("拖拽中途切换压感开关：这一笔仍按按下时的设置记录", () => {
    const { store, tools } = setup({ type: "setPressure", on: true });
    tools.down(sample(10, 10, 0.3), false);
    store.dispatch({ type: "setPressure", on: false });
    tools.move(sample(20, 10, 0.6), [sample(20, 10, 0.6)]);
    tools.up();
    expect(store.getState().doc.strokes[0].points).toEqual([
      { x: 10, y: 10, p: 0.3 },
      { x: 20, y: 10, p: 0.6 },
    ]);
  });

  it("Shift+点击：从上一笔终点画直线并立即提交，不开始拖拽", () => {
    const { store, tools, calls } = setup();
    tools.down(sample(10, 10), false);
    tools.move(sample(50, 10), [sample(50, 10)]);
    tools.up();
    expect(tools.down(sample(50, 200), true)).toBe(false);
    const [first, line] = store.getState().doc.strokes;
    expect(line.points).toEqual([first.points[first.points.length - 1], { x: 50, y: 200 }]);
    expect(calls).toContain("paint");
  });

  it("直线模式：按下即从上一笔终点画直线并提交（同 Shift+点击）；还没有笔画时第一下照常画", () => {
    const { store, tools } = setup({ type: "setLineMode", on: true });
    expect(tools.down(sample(10, 10), false)).toBe(true);
    tools.up();
    expect(tools.down(sample(50, 200), false)).toBe(false);
    expect(tools.down(sample(90, 20), false)).toBe(false);
    const strokes = store.getState().doc.strokes;
    expect(strokes.map((s) => s.points)).toEqual([
      [{ x: 10, y: 10 }],
      [
        { x: 10, y: 10 },
        { x: 50, y: 200 },
      ],
      [
        { x: 50, y: 200 },
        { x: 90, y: 20 },
      ],
    ]);
  });

  it("浏览：按下不开始任何拖拽，不画、不放文字、不平移", () => {
    const { store, tools, calls } = setup(
      { type: "imageLoaded", image: wideImage, name: "wide.png" },
      { type: "setTool", tool: "browse" },
    );
    const doc = store.getState().doc;
    expect(tools.down(sample(10, 10), false)).toBe(false);
    tools.move(sample(60, 10), [sample(60, 10)]);
    tools.up();
    expect(store.getState().doc).toBe(doc);
    expect(calls).toEqual([]);
  });

  it("取消（第二指落下）：丢弃实时笔画，之后的移动和抬起都不再生效", () => {
    const { store, tools, calls } = setup();
    tools.down(sample(10, 10), false);
    tools.cancel();
    tools.move(sample(90, 90), [sample(90, 90)]);
    tools.up();
    expect(calls).toEqual(["begin", "cancel"]);
    expect(store.getState().doc.strokes).toEqual([]);
  });

  it("移动工具：按指针当前位置的位移平移取景（不逐个采样点累加）；一次拖动算一步撤销", () => {
    const { store, tools } = setup({ type: "imageLoaded", image: wideImage, name: "wide.png" }, { type: "setTool", tool: "move" });
    tools.down(sample(100, 100), false);
    tools.move(sample(130, 100), [sample(110, 100), sample(120, 100)]);
    tools.move(sample(150, 100), [sample(150, 100)]);
    tools.up();
    expect(store.getState().doc.view.offsetX).toBe(50);
    tools.down(sample(0, 100), false);
    tools.move(sample(10, 100), [sample(10, 100)]);
    tools.move(sample(20, 100), [sample(20, 100)]);
    tools.up();
    expect(store.getState().doc.view.offsetX).toBe(70);
    store.dispatch({ type: "undo" });
    expect(store.getState().doc.view.offsetX).toBe(50);
    store.dispatch({ type: "undo" });
    expect(store.getState().doc.view.offsetX).toBe(0);
  });

  it("文字工具：按下放置文字，接着拖动移动它", () => {
    const { store, tools } = setup({ type: "setTool", tool: "text" });
    tools.down(sample(100, 200), false);
    tools.move(sample(140, 210), [sample(140, 210)]);
    tools.up();
    expect(store.getState().doc.texts[0]).toMatchObject({ x: 140, y: 210 });
  });

  it("文字工具：按文字框判断点中——点长文字的一端选中它并可拖动", () => {
    const { store, tools } = setup(
      { type: "setTool", tool: "text" },
      { type: "textPointerDown", point: { x: 300, y: 200 }, hitId: null },
      { type: "textEditChange", content: "喜茶喜茶喜茶喜茶" },
      { type: "textEditFinish" },
    );
    // 8 个字、字号 48：框宽 384，右端在 x = 492
    tools.down(sample(480, 200), false);
    tools.move(sample(480, 260), [sample(480, 260)]);
    tools.up();
    expect(store.getState().doc.texts).toHaveLength(1);
    expect(store.getState().doc.texts[0]).toMatchObject({ x: 300, y: 260 });
  });

  it("一次拖拽归按下时的工具：中途切换工具不改变这次拖拽", () => {
    const { store, tools } = setup();
    tools.down(sample(10, 10), false);
    store.dispatch({ type: "setTool", tool: "move" });
    tools.move(sample(40, 10), [sample(40, 10)]);
    tools.up();
    expect(store.getState().doc.strokes).toHaveLength(1);
    expect(store.getState().doc.strokes[0].tool).toBe("brush");
  });
});
