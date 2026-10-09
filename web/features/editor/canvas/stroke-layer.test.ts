import { describe, expect, it } from "vitest";
import type { Stroke } from "../model/stroke";
import { createStrokeLayer, planStrokeSync } from "./stroke-layer";

const stroke = (x: number): Stroke => ({ tool: "brush", size: 12, points: [{ x, y: x }] });
const [a, b, c] = [stroke(1), stroke(2), stroke(3)];

describe("planStrokeSync", () => {
  it("与已画的笔画相同：不动", () => {
    const painted = [a, b];
    expect(planStrokeSync(painted, painted, new Set())).toEqual({ kind: "none" });
    expect(planStrokeSync(painted, [a, b], new Set())).toEqual({ kind: "none" });
    expect(planStrokeSync([], [], new Set())).toEqual({ kind: "none" });
  });

  it("在已画的笔画后追加：只补画追加的，刚实时画过的跳过", () => {
    expect(planStrokeSync([a], [a, b, c], new Set([b]))).toEqual({ kind: "append", strokes: [c] });
    expect(planStrokeSync([a], [a, b], new Set([b]))).toEqual({ kind: "none" });
  });

  it("撤销、清空或前缀不同：全量重放", () => {
    expect(planStrokeSync([a, b], [a], new Set())).toEqual({ kind: "replay" });
    expect(planStrokeSync([a, b], [], new Set())).toEqual({ kind: "replay" });
    expect(planStrokeSync([a, b], [a, c], new Set([c]))).toEqual({ kind: "replay" });
  });
});

// 假画布：getContext 返回的上下文按顺序记下方法调用（带参数）与属性赋值
function fakeCanvas() {
  const ops: string[] = [];
  const sets: string[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, key) => (key in target ? target[key] : (...args: unknown[]) => ops.push(`${String(key)}(${args.join(",")})`)),
    set: (target, key, value) => {
      target[key] = value;
      sets.push(`${String(key)}=${String(value)}`);
      return true;
    },
  });
  const canvas = { width: 596, height: 832, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return {
    canvas,
    ops,
    sets,
    count: (name: string) => ops.filter((op) => op.startsWith(`${name}(`)).length,
    // 画布现在的内容：最后一次清空之后的绘制调用
    shown: () => ops.slice(ops.findLastIndex((op) => op.startsWith("clearRect(")) + 1),
  };
}

function setupLayer(committed: Stroke[] = []) {
  const ink = fakeCanvas();
  const erase = fakeCanvas();
  const layer = createStrokeLayer({ ink: ink.canvas, erase: erase.canvas }, committed);
  return { layer, ink, erase };
}

describe("createStrokeLayer", () => {
  it("创建时整体重放：先清空两层，再画已提交的笔画", () => {
    const { ink, erase } = setupLayer([a, b]);
    expect(ink.ops[0]).toMatch(/^clearRect\(/);
    expect(erase.ops[0]).toMatch(/^clearRect\(/);
    expect(ink.count("stroke")).toBe(2);
  });

  it("实时画过的笔画提交后同步不再重画；之后追加的笔画只补画它自己", () => {
    const { layer, ink } = setupLayer();
    layer.begin("brush", 12, { x: 10, y: 10 });
    layer.extend([{ x: 20, y: 10 }]);
    const live = layer.end()!;
    const drawn = ink.count("stroke");
    layer.sync([live]);
    expect(ink.count("stroke")).toBe(drawn);
    layer.sync([live, c]);
    expect(ink.count("stroke")).toBe(drawn + 1);
    expect(ink.count("clearRect")).toBe(1);
  });

  it("撤销（新列表不是追加）时清空重放；取消进行中的笔画时按已提交的重画", () => {
    const { layer, ink } = setupLayer([a, b]);
    layer.sync([a]);
    expect(ink.count("clearRect")).toBe(2);
    layer.begin("brush", 12, { x: 10, y: 10 });
    layer.cancel();
    expect(ink.count("clearRect")).toBe(3);
  });

  it("实时笔画进行中撤销：补画这一笔已画的部分，提交后画布等于按笔画列表重放", () => {
    const { layer, ink } = setupLayer([a]);
    layer.begin("brush", 12, { x: 10, y: 10 });
    layer.extend([
      { x: 20, y: 10 },
      { x: 30, y: 12 },
    ]);
    layer.sync([]);
    layer.extend([{ x: 40, y: 15 }]);
    const live = layer.end()!;
    layer.sync([live]);
    expect(ink.shown()).toEqual(setupLayer([live]).ink.shown());
  });

  it("实时笔画进行中重做：重做的笔画在下面，这一笔仍在最上面，与重放顺序一致", () => {
    const { layer, ink } = setupLayer();
    layer.begin("brush", 12, { x: 10, y: 10 });
    layer.extend([{ x: 20, y: 10 }]);
    layer.sync([a]);
    const live = layer.end()!;
    layer.sync([a, live]);
    expect(ink.shown()).toEqual(setupLayer([a, live]).ink.shown());
  });
});
