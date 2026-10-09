"use client";

// 预览区：视图缩放（按钮、Ctrl/⌘+滚轮、双指捏合）与滚动平移，并把画布上的指针事件分派给当前工具或双指手势。
// 视图缩放用 CSS zoom（指针换算按画布实际显示的矩形，缩放后仍正确），平移 = 容器溢出后的原生滚动。
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { CUP_HEIGHT, CUP_WIDTH } from "@/shared/constants";
import { useStore } from "@/shared/use-store";
import { measureTextObj } from "../canvas/text-layer";
import type { EditorCanvas } from "../canvas/use-editor-canvas";
import { selectedTextId, strokeSize, type EditorStore } from "../model/document";
import { CanvasStack, type BrushCursor } from "./CanvasStack";
import {
  isTwoFingerTap,
  midpoint,
  toCanvasPoint,
  twoFingerUpdate,
  type Point,
  type TwoFingerGesture,
} from "./gestures";
import { TextOverlay } from "./TextOverlay";
import { createPointerTools, type PointerSample } from "./tools";

interface Props {
  store: EditorStore;
  canvas: EditorCanvas;
}

const clampZoom = (z: number) => Math.min(4, Math.max(0.5, Math.round(z * 100) / 100));

// 笔刷光标钳在画布内：否则圆环探出画布底边会制造幻影纵向溢出（滚动条闪现）
const clampFrac = (v: number, frac: number) => Math.min(1 - frac / 2, Math.max(frac / 2, v));

// 视图捏合时钉在两指下的点：画布上 (u, v) 处（画布占比）要留在页面坐标 (x, y)
interface Focus {
  u: number;
  v: number;
  x: number;
  y: number;
}

// 调整预览区的滚动，让焦点处的画布回到两指中点下（滚不动的方向由浏览器钳制）
function scrollToFocus(ink: HTMLCanvasElement, scroller: HTMLElement, f: Focus) {
  const r = ink.getBoundingClientRect();
  scroller.scrollLeft += r.left + f.u * r.width - f.x;
  scroller.scrollTop += r.top + f.v * r.height - f.y;
}

interface Pinch extends TwoFingerGesture {
  // 落下时两指中点在画布上的位置（画布占比）与当时的视图缩放
  u: number;
  v: number;
  zoom0: number;
}

export function Viewport({ store, canvas }: Props) {
  const { inkRef, ready } = canvas;
  const tool = useStore(store, (s) => s.tool);
  const [tools] = useState(() => createPointerTools(store, canvas.strokes, measureTextObj));
  // 视图缩放（细活需要）：CSS zoom 放大画布叠层，容器溢出滚动即平移
  const [zoom, setZoom] = useState(1);
  const [cursor, setCursor] = useState<BrushCursor | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 当前拖拽归属的指针：move/up 只响应它，其余指针只参与双指手势（手掌误触常态）
  const activeId = useRef<number | null>(null);
  // 落在画布上的指针（页面坐标），第二指落下即进入双指手势
  const pointers = useRef(new Map<number, Point>());
  // 双指手势：落下时快照，移动时捏合、拖动，抬起时判轻点撤销
  const twoFinger = useRef<Pinch | null>(null);
  // 按着的手写笔：它按着时触摸指针（手掌）一律忽略
  const penId = useRef<number | null>(null);
  // 双指缩放视图的焦点；缩放改变布局后由下面的 layout effect 把它钉回两指下
  const focus = useRef<Focus | null>(null);

  useLayoutEffect(() => {
    if (focus.current) scrollToFocus(inkRef.current!, scrollRef.current!, focus.current);
  }, [zoom, inkRef]);

  // Ctrl/Cmd+滚轮缩放：React 的 onWheel 是 passive 监听，preventDefault 需要原生注册
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // 每次换算都重新取画布矩形：双指平移滚动视图后，画布在页面上的位置已经变了
  const pointOf = (e: { clientX: number; clientY: number }) =>
    toCanvasPoint(e, inkRef.current!.getBoundingClientRect());
  const sampleOf = (e: { clientX: number; clientY: number; pressure: number }): PointerSample => ({
    ...pointOf(e),
    pressure: e.pressure,
  });

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const s = store.getState();
    // 浏览：画布不接管，单指滑动由浏览器滚动页面
    if (s.tool === "browse") return;
    if (e.pointerType === "touch" && penId.current !== null) return;
    if (e.pointerType === "pen") {
      // 手写笔优先：此前手掌引起的拖拽或双指手势都作废
      tools.cancel();
      activeId.current = null;
      twoFinger.current = null;
      focus.current = null;
      pointers.current.clear();
      penId.current = e.pointerId;
    }
    // 双指手势中再落下的手指不参与
    if (twoFinger.current) return;
    // 第二指落下：进入双指手势（捏合缩放、拖动平移，抬起时判轻点撤销）；
    // 进行中的拖拽只丢弃已画部分，不交给第二指——否则第一指继续移动会画出跨画布长线
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = pointers.current.values();
      const mid = midpoint(a, b);
      const rect = inkRef.current!.getBoundingClientRect();
      twoFinger.current = {
        a,
        b,
        startT: e.timeStamp,
        moved: false,
        u: (mid.x - rect.left) / rect.width,
        v: (mid.y - rect.top) / rect.height,
        zoom0: zoom,
      };
      activeId.current = null;
      tools.cancel();
      return;
    }

    // 已有拖拽进行中：其余指针不参与（只允许归属指针继续）
    if (activeId.current !== null && e.pointerId !== activeId.current) return;

    // 合成指针事件或个别浏览器可能无活动指针，捕获失败不影响绘制
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 忽略：退化为不捕获，拖拽仍可用
    }
    // 文字工具阻止 click 默认行为：否则点击非可聚焦元素会把焦点拉回 body，
    // 刚弹出的就地输入框立刻 blur 被删除
    if (s.tool === "text") e.preventDefault();
    if (tools.down(sampleOf(e), e.shiftKey)) activeId.current = e.pointerId;
  };

  // 双指移动：捏合缩放视图、拖动平移视图
  const movePinch = (g: Pinch) => {
    const [a, b] = pointers.current.values();
    const update = twoFingerUpdate(g, a, b);
    g.moved = update.moved;
    if (!update.moved) return;
    focus.current = { u: g.u, v: g.v, x: update.mid.x, y: update.mid.y };
    scrollToFocus(inkRef.current!, scrollRef.current!, focus.current);
    setZoom(clampZoom(g.zoom0 * update.ratio));
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const g = twoFinger.current;
    if (g && pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      movePinch(g);
      return;
    }

    const point = pointOf(e);
    const sizeFrac = strokeSize(store.getState()) / CUP_WIDTH;
    setCursor({
      fx: clampFrac(point.x / CUP_WIDTH, sizeFrac),
      fy: clampFrac(point.y / CUP_HEIGHT, sizeFrac),
      sizeFrac,
    });
    // 只响应归属指针，其余指针的移动不影响当前拖拽
    if (e.pointerId !== activeId.current) return;
    // 合并采样点：快速挥笔时一个帧内多个点全部入列，线条更连贯
    const native = e.nativeEvent;
    const coalesced = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    const at = sampleOf(e);
    tools.move(at, coalesced.length > 0 ? coalesced.map(sampleOf) : [at]);
  };

  const onPointerEnd = (e: PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    if (e.pointerId === penId.current) penId.current = null;
    // 双指手势结束：两指都没动且够快 = 轻点撤销
    const g = twoFinger.current;
    if (g && pointers.current.size < 2) {
      twoFinger.current = null;
      focus.current = null;
      if (isTwoFingerTap(g, e.timeStamp)) store.dispatch({ type: "undo" });
      return;
    }
    if (e.pointerId !== activeId.current) return;
    activeId.current = null;
    tools.up();
  };

  const onDoubleClick = () => {
    const s = store.getState();
    if (s.tool === "text" && selectedTextId(s) !== null) store.dispatch({ type: "textEditStart" });
  };

  return (
    <section ref={sectionRef} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 flex items-center text-sm font-semibold text-neutral-800">
        预览 <span className="ml-1 font-normal text-neutral-500">{CUP_WIDTH}×{CUP_HEIGHT}</span>
        <span
          role="group"
          aria-label="视图缩放，不影响成品"
          title="视图缩放，不影响成品"
          className="ml-auto flex items-center gap-1 font-normal"
        >
          <span className="text-xs text-neutral-500">视图</span>
          <button
            type="button"
            onClick={() => setZoom((z) => clampZoom(z / 1.25))}
            aria-label="缩小"
            className="rounded-md border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            title="复位视图缩放（Ctrl/⌘+滚轮也可缩放）"
            className="rounded-md border border-neutral-300 px-2 py-0.5 font-mono text-xs hover:bg-neutral-50"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => clampZoom(z * 1.25))}
            aria-label="放大"
            className="rounded-md border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50"
          >
            +
          </button>
        </span>
      </h2>
      <div
        ref={scrollRef}
        // 移动端（max-lg）限高滚动（双指平移）；桌面端竖向可见溢出交页面滚动，
        // 横向极宽才内部滚动；不依赖 overflow 简写/长写的优先级
        className="max-h-none overflow-x-auto overflow-y-visible max-lg:max-h-[46vh] max-lg:overflow-y-auto"
      >
        <CanvasStack
          canvas={canvas}
          zoom={zoom}
          tool={tool}
          cursor={cursor}
          ink={{ onPointerDown, onPointerMove, onPointerEnd, onPointerLeave: () => setCursor(null), onDoubleClick }}
        >
          <TextOverlay store={store} inkRef={inkRef} />
          {!ready && (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-neutral-500">
              无画布
            </p>
          )}
        </CanvasStack>
      </div>
      {!ready ? null : tool === "browse" ? (
        <p className="mt-2 text-center text-xs text-neutral-500">浏览中：单指滑动页面；在「画笔编辑」里选一个工具开始编辑</p>
      ) : (
        <p className="mt-2 hidden text-center text-xs text-neutral-500 pointer-coarse:block">
          双指捏合缩放视图、拖动平移视图 · 双指轻点撤销 · 再点一次当前工具回到浏览
        </p>
      )}
    </section>
  );
}
