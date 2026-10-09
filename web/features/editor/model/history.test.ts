import { describe, expect, it } from "vitest";
import { EMPTY_HISTORY, pushStroke, recordTexts, redo, undo, type History } from "./history";
import type { Stroke } from "./stroke";
import type { TextObj } from "./text";

const tea: TextObj = { id: 1, content: "喜茶", x: 100, y: 100, size: 48, angle: 0, weight: 700 };
const at = (x: number): TextObj => ({ ...tea, x });
// 刚放置、还没输入的文字：画面上看不见，只在就地编辑期间存在
const blank: TextObj = { ...tea, content: "" };
const stroke: Stroke = { tool: "brush", size: 12, points: [{ x: 1, y: 1 }] };

describe("编辑历史", () => {
  it("删除文字后撤销能恢复", () => {
    let h = recordTexts(EMPTY_HISTORY, [], [tea], 1);
    h = recordTexts(h, [tea], [], 2);
    expect(undo(h)?.entry).toEqual({ kind: "text", before: [tea], after: [], key: 2 });
  });

  it("移动后撤销只撤回这次移动：同一手势的多次移动合并为一条", () => {
    let h = recordTexts(EMPTY_HISTORY, [], [tea], 1);
    h = recordTexts(h, [tea], [at(120)], 2);
    h = recordTexts(h, [at(120)], [at(150)], 2);
    expect(h.done).toHaveLength(2);
    expect(undo(h)?.entry).toEqual({ kind: "text", before: [tea], after: [at(150)], key: 2 });
  });

  it("新建后未输入就结束：创建与删除抵消，不留历史", () => {
    let h = recordTexts(EMPTY_HISTORY, [], [blank], 1);
    h = recordTexts(h, [blank], [], 1);
    expect(h.done).toHaveLength(0);
  });

  it("双击空白处放置后输入：放置与输入分属两次会话，也只算一步", () => {
    // 第一下按下放置空文字（会话 1），双击另起会话 3 后输入
    let h = recordTexts(EMPTY_HISTORY, [], [blank], 1);
    h = recordTexts(h, [blank], [tea], 3);
    expect(h.done).toEqual([{ kind: "text", before: [], after: [tea], key: 3 }]);
  });

  it("只涉及空文字的改动（放置、移动、放弃）不入栈，也不清空重做栈", () => {
    const withRedo = undo(recordTexts(EMPTY_HISTORY, [], [tea], 1))!.history;
    let h = recordTexts(withRedo, [], [blank], 2);
    h = recordTexts(h, [blank], [{ ...blank, x: 300 }], 3);
    h = recordTexts(h, [{ ...blank, x: 300 }], [], 4);
    expect(h).toEqual(withRedo);
  });

  it("清空已有文字的内容等同删除：快照不含空文字，撤销/重做不会还原出看不见的文字", () => {
    for (const content of ["", "  "]) {
      const h = recordTexts(EMPTY_HISTORY, [tea], [{ ...tea, content }], 4);
      expect(h.done).toEqual([{ kind: "text", before: [tea], after: [], key: 4 }]);
    }
  });

  it("没有实际变化的改动不入栈", () => {
    expect(recordTexts(EMPTY_HISTORY, [tea], [{ ...tea }], 1).done).toHaveLength(0);
  });

  it("任一属性的改动都会入栈", () => {
    const patches: Array<Partial<TextObj>> = [
      { content: "奶茶" },
      { x: 101 },
      { y: 101 },
      { size: 50 },
      { angle: 15 },
      { weight: 900 },
    ];
    for (const patch of patches) {
      expect(recordTexts(EMPTY_HISTORY, [tea], [{ ...tea, ...patch }], 1).done).toHaveLength(1);
    }
  });

  it("重做恢复修改后的快照；撤销后再改动清空重做栈", () => {
    const u = undo(recordTexts(EMPTY_HISTORY, [], [tea], 1));
    expect(u).not.toBeNull();
    expect(redo(u!.history)?.entry).toMatchObject({ kind: "text", after: [tea] });
    const h = recordTexts(u!.history, [], [{ ...tea, id: 2 }], 2);
    expect(h.undone).toHaveLength(0);
  });

  it("重做栈非空时同 key 的改动另起一条，不并入更早的记录", () => {
    let h: History = recordTexts(EMPTY_HISTORY, [], [tea], 1);
    h = pushStroke(h, stroke);
    h = undo(h)!.history; // 撤销笔画后栈顶又是 key 1 的文字条目
    h = recordTexts(h, [tea], [at(200)], 1);
    expect(h.done).toHaveLength(2);
  });

  it("笔画与文字按时间倒序撤销", () => {
    let h = recordTexts(EMPTY_HISTORY, [], [tea], 1);
    h = pushStroke(h, stroke);
    h = recordTexts(h, [tea], [], 2);
    const kinds: string[] = [];
    for (let r = undo(h); r; r = undo(r.history)) kinds.push(r.entry.kind);
    expect(kinds).toEqual(["text", "stroke", "text"]);
  });
});
