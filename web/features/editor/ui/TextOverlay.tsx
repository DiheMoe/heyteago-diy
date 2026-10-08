"use client";

// 叠在画布上的文字交互层：选中文字的手柄（四角等比缩放、上方旋转）与操作条（编辑、删除、字重），
// 编辑时的多行输入框。位置用画布占比（%）表示，外层的 CSS zoom 不影响。
import { useLayoutEffect, useRef, type PointerEvent, type ReactNode, type RefObject } from "react";
import { CUP_HEIGHT, CUP_WIDTH } from "@/shared/constants";
import { useStore } from "@/shared/use-store";
import { measureTextObj } from "../canvas/text-layer";
import { editingTextId, selectedTextId, type EditorStore } from "../model/document";
import { isBlankText, textLines, type TextObj } from "../model/text";
import { toCanvasPoint } from "./gestures";

interface Props {
  store: EditorStore;
  // 墨迹层画布：手柄拖拽按它实际显示的矩形换算画布坐标
  inkRef: RefObject<HTMLCanvasElement | null>;
}

const WEIGHTS: Array<[number, string]> = [
  [400, "常规"],
  [700, "粗体"],
  [900, "特粗"],
];

// 旋转手柄在文字框上边中点再往外的距离（屏幕像素，随视图缩放）
const ROTATE_HANDLE_GAP = 24;
// 浮层与文字框之间的间距（画布像素）
const PANEL_GAP = 12;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function TextOverlay({ store, inkRef }: Props) {
  const texts = useStore(store, (s) => s.doc.texts);
  const selectedId = useStore(store, selectedTextId);
  const editingId = useStore(store, editingTextId);
  const selected = texts.find((t) => t.id === selectedId) ?? null;
  const editing = texts.find((t) => t.id === editingId) ?? null;

  if (editing) return <EditPanel key={editing.id} text={editing} store={store} />;
  // 手柄和操作条只在选中（不在编辑）且有内容时出现
  if (selected && !isBlankText(selected)) return <SelectionControls text={selected} store={store} inkRef={inkRef} />;
  return null;
}

function SelectionControls({ text, store, inkRef }: { text: TextObj; store: EditorStore; inkRef: Props["inkRef"] }) {
  const { dispatch } = store;
  const pointOf = (e: PointerEvent) => toCanvasPoint(e, inkRef.current!.getBoundingClientRect());

  // 手柄按下：记下快照，整个拖拽以它为基准缩放或旋转
  const beginHandleDrag = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 合成指针事件没有可捕获对象时退化为普通拖动
    }
    const kind = e.currentTarget.dataset.textHandle === "rotate" ? "rotate" : "scale";
    dispatch({ type: "textHandleStart", snapshot: { kind, start: pointOf(e), size: text.size, angle: text.angle } });
  };
  // 没按着任何键却收到移动：抬起没送到手柄（指针捕获失败或丢失），这次拖拽其实已经结束
  const moveHandleDrag = (e: PointerEvent<HTMLDivElement>) =>
    dispatch(e.buttons === 0 ? { type: "textHandleEnd" } : { type: "textHandleMove", point: pointOf(e) });
  const endHandleDrag = () => dispatch({ type: "textHandleEnd" });

  // 手柄位置：文字框四角（缩放）与上边中点再往外（旋转），随文字旋转
  const { w, h } = measureTextObj(text);
  const rad = (text.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const at = (dx: number, dy: number) => ({
    left: `${((text.x + dx * cos - dy * sin) / CUP_WIDTH) * 100}%`,
    top: `${((text.y + dx * sin + dy * cos) / CUP_HEIGHT) * 100}%`,
  });
  const handles = [
    { name: "nw", cursor: "nwse-resize", ...at(-w / 2, -h / 2), shift: "" },
    { name: "ne", cursor: "nesw-resize", ...at(w / 2, -h / 2), shift: "" },
    { name: "se", cursor: "nwse-resize", ...at(w / 2, h / 2), shift: "" },
    { name: "sw", cursor: "nesw-resize", ...at(-w / 2, h / 2), shift: "" },
    // 文字自身坐标系的「上」在屏幕上是 (sin, -cos)
    {
      name: "rotate",
      cursor: "grab",
      ...at(0, -h / 2),
      shift: ` translate(${sin * ROTATE_HANDLE_GAP}px, ${-cos * ROTATE_HANDLE_GAP}px)`,
    },
  ];

  return (
    <>
      {handles.map((handle) => (
        <div
          key={handle.name}
          data-text-handle={handle.name}
          title={handle.name === "rotate" ? "拖动旋转" : "拖动缩放"}
          onPointerDown={beginHandleDrag}
          onPointerMove={moveHandleDrag}
          onPointerUp={endHandleDrag}
          onPointerCancel={endHandleDrag}
          // 手柄看起来小，按得到的范围更大：鼠标 16px，触屏 32px
          className="absolute z-20 flex h-4 w-4 items-center justify-center pointer-coarse:h-8 pointer-coarse:w-8"
          style={{
            left: handle.left,
            top: handle.top,
            transform: `translate(-50%, -50%)${handle.shift}`,
            cursor: handle.cursor,
            touchAction: "none",
          }}
        >
          <span
            className={`border border-white bg-neutral-700 shadow ${
              handle.name === "rotate" ? "h-3 w-3 rounded-full" : "h-2.5 w-2.5 rounded-sm"
            }`}
          />
        </div>
      ))}
      <FloatingPanel
        text={text}
        prefer="below"
        className="flex items-center gap-1 whitespace-nowrap rounded-md border border-neutral-300 bg-white/95 px-1 py-0.5 shadow"
      >
        <button
          type="button"
          onClick={() => dispatch({ type: "textEditStart" })}
          className="rounded px-1.5 py-0.5 text-xs text-neutral-700 hover:bg-neutral-100"
        >
          编辑
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: "deleteSelectedText" })}
          className="rounded px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50"
        >
          删除
        </button>
        <span aria-hidden className="h-4 w-px bg-neutral-200" />
        <WeightButtons text={text} store={store} />
      </FloatingPanel>
    </>
  );
}

function EditPanel({ text, store }: { text: TextObj; store: EditorStore }) {
  const finish = () => store.dispatch({ type: "textEditFinish" });
  return (
    <FloatingPanel text={text} prefer="above" className="flex w-48 flex-col gap-1">
      <textarea
        autoFocus
        value={text.content}
        rows={clamp(textLines(text.content).length, 1, 4)}
        placeholder="输入文字"
        onChange={(e) => store.dispatch({ type: "textEditChange", content: e.target.value })}
        onBlur={(e) => {
          // 焦点移到编辑面板里的按钮（如键盘 Tab）不结束编辑
          if (e.relatedTarget instanceof HTMLElement && e.relatedTarget.closest("[data-text-edit-ui]")) return;
          finish();
        }}
        onKeyDown={(e) => {
          // 输入法组字中的回车、Esc 留给输入法
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
            e.preventDefault();
            finish();
          }
        }}
        // 手机上字号 16px：iOS 聚焦小于 16px 的输入框会放大页面
        className="resize-none rounded border border-neutral-500 bg-white/95 px-2 py-1 text-center text-base leading-snug shadow focus:outline-none sm:text-sm"
      />
      <div
        data-text-edit-ui
        className="flex items-center gap-1 whitespace-nowrap rounded border border-neutral-300 bg-white/95 px-1 py-0.5 shadow"
      >
        <WeightButtons text={text} store={store} keepFocus />
        <button
          type="button"
          onPointerDown={keepInputFocus}
          onClick={finish}
          title="完成（Ctrl/⌘+回车 或 Esc）"
          className="ml-auto rounded bg-neutral-900 px-2 py-0.5 text-xs text-white"
        >
          完成
        </button>
      </div>
    </FloatingPanel>
  );
}

// 按下按钮时不让它抢走输入框的焦点：输入框失焦会结束编辑，Safari 上按钮还可能因此点了没反应
const keepInputFocus = (e: PointerEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

function WeightButtons({ text, store, keepFocus = false }: { text: TextObj; store: EditorStore; keepFocus?: boolean }) {
  return WEIGHTS.map(([weight, label]) => (
    <button
      key={weight}
      type="button"
      aria-pressed={text.weight === weight}
      onPointerDown={keepFocus ? keepInputFocus : undefined}
      onClick={() => store.dispatch({ type: "setTextWeight", weight })}
      className={`rounded px-1.5 py-0.5 text-xs ${
        text.weight === weight ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"
      }`}
    >
      {label}
    </button>
  ));
}

// 浮在文字旁的面板：水平对准文字中心，优先放在文字框上方（或下方），放不下就换到另一侧；
// 量出面板占画布的比例后钳在画布内，文字靠近画布边缘时面板也不会被裁掉。
// 面板大小随内容变化，所以每次渲染后都重新放置。
function FloatingPanel({
  text,
  prefer,
  className,
  children,
}: {
  text: TextObj;
  prefer: "above" | "below";
  className: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const area = el.parentElement!.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const fw = box.width / area.width;
    const fh = box.height / area.height;
    // 旋转后文字框的上下边界
    const { w, h } = measureTextObj(text);
    const rad = (text.angle * Math.PI) / 180;
    const half = (w * Math.abs(Math.sin(rad)) + h * Math.abs(Math.cos(rad))) / 2;
    const above = (text.y - half - PANEL_GAP) / CUP_HEIGHT - fh;
    const below = (text.y + half + PANEL_GAP) / CUP_HEIGHT;
    const fitsAbove = above >= 0;
    const fitsBelow = below + fh <= 1;
    const useAbove = prefer === "above" ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove;
    el.style.left = `${clamp(text.x / CUP_WIDTH - fw / 2, 0, 1 - fw) * 100}%`;
    el.style.top = `${clamp(useAbove ? above : below, 0, 1 - fh) * 100}%`;
  });
  return (
    <div ref={ref} className={`absolute z-20 ${className}`}>
      {children}
    </div>
  );
}
