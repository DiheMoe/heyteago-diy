"use client";

// 596×832 预览画布：三层叠放——底层渲染基底、中层擦除掩码（底色着色预览）、
// 顶层画笔笔迹（接收指针事件）。调参/换图只重绘底层，笔触与擦除标记保留。
// move 工具的拖动经 onPanDelta 换算成画布坐标位移交给父组件。
// 笔画实时分段增量绘制（不重描整条路径），点列在 onStrokeEnd 交给父组件记撤销栈。
// 视图缩放用 CSS zoom（指针换算走 getBoundingClientRect 比例，缩放后仍正确），
// 平移 = 容器溢出后的原生滚动。
import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { CUP_HEIGHT, CUP_WIDTH, DEFAULT_BACKGROUND } from "@/lib/canvas/constants";
import { drawSegment, drawStroke, strokeTargets, widthFor, type Stroke, type StrokePoint } from "@/lib/canvas/strokes";
import { measureTextObj, type TextObj } from "@/lib/canvas/texts";

export type Tool = Stroke["tool"] | "move" | "text";

interface Props {
  baseCanvasRef: RefObject<HTMLCanvasElement | null>;
  eraseCanvasRef: RefObject<HTMLCanvasElement | null>;
  // 贴文字层（erase 与 ink 之间）
  textCanvasRef: RefObject<HTMLCanvasElement | null>;
  inkCanvasRef: RefObject<HTMLCanvasElement | null>;
  ready: boolean;
  tool: Tool;
  brushSize: number;
  // 橡皮擦掩码的预览着色（父组件给当前生效底色）
  eraseColor: string;
  // 压感开关（手写笔粗细随压力）；关闭时恒粗
  pressureSensitive: boolean;
  // 一笔结束（含点列），父组件记入撤销栈
  onStrokeEnd(stroke: Stroke): void;
  // Shift+点击直线的锚点（最后一笔终点，父组件随撤销/重做同步）
  strokeAnchor: StrokePoint | null;
  onPanDelta(dx: number, dy: number): void;
  // 文字工具按下：父组件决定选中或放置；拖动经 onTextDrag 移动选中文字
  onTextPointerDown(p: { x: number; y: number }): void;
  onTextDrag(dx: number, dy: number): void;
  // 贴文字对象与编辑态（选中手柄/就地输入框由本组件渲染）
  texts: TextObj[];
  selectedTextId: number | null;
  editingTextId: number | null;
  onTextContent(id: number, v: string): void;
  onTextEditStart(id: number): void;
  onTextEditDone(id: number): void;
  onTextResize(id: number, size: number): void;
  onTextRotate(id: number, angle: number): void;
  onTextWeight(id: number, weight: number): void;
  // 双指轻点（Procreate 式撤销约定）：父组件撤销一笔并重放抹掉进行中的笔画
  onGestureUndo(): void;
  // 双指拖动平移视图时，丢弃进行中的笔画（重放已提交笔画，不做撤销）
  onDiscardLiveStroke(): void;
}

export function PreviewCanvas({
  baseCanvasRef,
  eraseCanvasRef,
  textCanvasRef,
  inkCanvasRef,
  ready,
  tool,
  brushSize,
  eraseColor,
  pressureSensitive,
  onStrokeEnd,
  strokeAnchor,
  onPanDelta,
  onTextPointerDown,
  onTextDrag,
  texts,
  selectedTextId,
  editingTextId,
  onTextContent,
  onTextEditStart,
  onTextEditDone,
  onTextResize,
  onTextRotate,
  onTextWeight,
  onGestureUndo,
  onDiscardLiveStroke,
}: Props) {
  const drawing = useRef(false);
  // 当前笔画归属的指针：move/end 只响应它，其余指针只参与双指手势（手掌误触常态）
  const activeStrokeId = useRef<number | null>(null);
  // 双指手势：落下时快照，移动判平移、轻点判撤销
  const panGesture = useRef<{
    midX: number;
    midY: number;
    scrollLeft: number;
    scrollTop: number;
    startT: number;
    moved: boolean;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  // 本次笔画的点列（结束后交给父组件记入撤销栈）与增量分段状态
  const strokePoints = useRef<StrokePoint[]>([]);
  const segPrev = useRef<StrokePoint | null>(null);
  const segMid = useRef<StrokePoint | null>(null);
  // 笔刷光标：直径=笔刷粗细的圆圈跟随指针。
  // 位置与直径用画布占比（%）存取——wrapper 带 CSS zoom，用像素坐标会被二次缩放
  const [cursorPos, setCursorPos] = useState<{ fx: number; fy: number; sizeFrac: number } | null>(null);
  // 活跃指针（双指轻点撤销手势检测）
  const activePointers = useRef(new Map<number, { x: number; y: number; t: number }>());

  const toCanvasPoint = (e: { clientX: number; clientY: number }) => {
    const canvas = inkCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  // 本笔画作用的层及其上下文配置（目标层清单与重放共用 strokeTargets）。
  // 粗细不在此设置——压感模式下逐段随压力变化。
  const strokeCtxs = () =>
    strokeTargets(
      { ink: inkCanvasRef.current, erase: eraseCanvasRef.current },
      tool === "eraser" ? "eraser" : "brush",
      eraseColor,
    )
      .map((t) => {
        const ctx = t.canvas?.getContext("2d");
        if (!ctx) return null;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.globalCompositeOperation = t.comp;
        ctx.strokeStyle = t.color;
        return ctx;
      })
      .filter((c): c is CanvasRenderingContext2D => c !== null);

  const midpointOf = () => {
    const pts = [...activePointers.current.values()];
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  };

  // 压感开启时记录每点压力（重放保真），关闭时省略（恒粗）
  const withPressure = (p: StrokePoint, pressure: number): StrokePoint =>
    pressureSensitive ? { ...p, p: pressure } : p;

  // 手柄拖动状态：按下时快照（大小/角度在整个拖动过程中以快照为基准计算）
  const handleDrag = useRef<{
    kind: string;
    start: StrokePoint;
    size: number;
    w: number;
    angle: number;
  } | null>(null);

  const selectedTextObj = () => texts.find((t) => t.id === selectedTextId) ?? null;

  // 边缘手柄：沿文字轴向的投影距离 / 初始偏移 = 缩放系数 → 新字号
  // 角手柄：指针相对文字中心的夹角差 → 新角度
  const beginHandleDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const kind = e.currentTarget.getAttribute("data-text-handle");
    if (!kind) return;
    const sel = selectedTextObj();
    const pt = toCanvasPoint(e);
    if (!sel || !pt) return;
    const m = measureTextObj(sel);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 合成指针事件没有可捕获对象时退化为普通拖动
    }
    handleDrag.current = { kind, start: pt, size: sel.size, w: m.w, angle: sel.angle };
  };

  const moveHandleDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = handleDrag.current;
    const sel = selectedTextObj();
    if (!d || !sel) return;
    const pt = toCanvasPoint(e);
    if (!pt) return;
    const rad = (d.angle * Math.PI) / 180;
    if (["e", "w", "n", "s"].includes(d.kind)) {
      const horizontal = d.kind === "e" || d.kind === "w";
      const axis = horizontal ? { x: Math.cos(rad), y: Math.sin(rad) } : { x: -Math.sin(rad), y: Math.cos(rad) };
      const proj = (pt.x - sel.x) * axis.x + (pt.y - sel.y) * axis.y;
      const offset0 = Math.max(horizontal ? d.w / 2 : sel.size / 2, 1);
      const size = Math.min(240, Math.max(12, Math.round((d.size * Math.abs(proj)) / offset0)));
      onTextResize(sel.id, size);
    } else {
      const a0 = Math.atan2(d.start.y - sel.y, d.start.x - sel.x);
      const a1 = Math.atan2(pt.y - sel.y, pt.x - sel.x);
      const deg = d.angle + ((a1 - a0) * 180) / Math.PI;
      onTextRotate(sel.id, Math.round(((deg + 540) % 360) - 180));
    }
  };

  const endHandleDrag = () => {
    handleDrag.current = null;
  };

  const beginStroke = (e: PointerEvent<HTMLCanvasElement>) => {
    const point = toCanvasPoint(e);
    if (!point) return;

    // 第二指落下：进入双指手势（拖动平移视图 / 轻点撤销，抬起时判定）；
    // 进行中的笔画只丢弃已画部分，不重置给第二指——否则第一指继续移动会画出跨画布长线
    activePointers.current.set(e.pointerId, { x: point.x, y: point.y, t: e.timeStamp });
    if (activePointers.current.size === 2) {
      const el = scrollRef.current;
      const mid = midpointOf();
      panGesture.current = el
        ? { midX: mid.x, midY: mid.y, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop, startT: e.timeStamp, moved: false }
        : null;
      if (drawing.current) {
        drawing.current = false;
        activeStrokeId.current = null;
        strokePoints.current = [];
        segPrev.current = null;
        segMid.current = null;
        onDiscardLiveStroke();
      }
      return;
    }

    // 已有笔画进行中：其余指针不参与（只允许归属指针继续）
    if (activeStrokeId.current !== null && e.pointerId !== activeStrokeId.current) return;

    // 合成指针事件或个别浏览器可能无活动指针，捕获失败不影响绘制
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 忽略：退化为不捕获，笔画仍可用
    }
    if (tool === "move") {
      drawing.current = true;
      activeStrokeId.current = e.pointerId;
      last.current = point;
      return;
    }
    if (tool === "text") {
      // 阻止 click 默认行为：否则点击非可聚焦元素会把焦点拉回 body，
      // 刚弹出的就地输入框立刻 blur 被删除
      e.preventDefault();
      onTextPointerDown(point);
      drawing.current = true;
      activeStrokeId.current = e.pointerId;
      last.current = point;
      return;
    }

    // Shift+点击：从上一笔终点画直线段（写字/描边高频动作）
    if (e.shiftKey && strokeAnchor) {
      const s: Stroke = {
        tool,
        size: brushSize,
        points: [strokeAnchor, withPressure(point, e.pressure)],
      };
      drawStroke({ ink: inkCanvasRef.current, erase: eraseCanvasRef.current }, s, eraseColor);
      onStrokeEnd(s);
      return;
    }

    drawing.current = true;
    activeStrokeId.current = e.pointerId;
    strokePoints.current = [withPressure(point, e.pressure)];
    segPrev.current = point;
    segMid.current = null;
    for (const ctx of strokeCtxs()) {
      ctx.lineWidth = widthFor(brushSize, pressureSensitive ? e.pressure : undefined);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x + 0.01, point.y + 0.01); // 单点也能画出圆点
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    }
  };

  const moveStroke = (e: PointerEvent<HTMLCanvasElement>) => {
    // 笔刷光标钳在画布内：否则圆环探出画布底边会制造幻影纵向溢出（滚动条闪现）
    const clampFrac = (v: number, frac: number) => Math.min(1 - frac / 2, Math.max(frac / 2, v));
    // 双指手势中：中点位移平移视图（滚动容器）；超过阈值即判定为平移而非轻点
    if (panGesture.current && activePointers.current.size === 2) {
      const g = panGesture.current;
      const el = scrollRef.current;
      if (el) {
        const canvas = inkCanvasRef.current;
        const rect = canvas?.getBoundingClientRect();
        if (rect) {
          const mid = midpointOf();
          const dx = ((mid.x - g.midX) * rect.width) / CUP_WIDTH;
          const dy = ((mid.y - g.midY) * rect.height) / CUP_HEIGHT;
          if (!g.moved && Math.hypot(dx, dy) > 8) g.moved = true;
          if (g.moved) {
            el.scrollLeft = g.scrollLeft - dx;
            el.scrollTop = g.scrollTop - dy;
          }
        }
      }
      const p2 = toCanvasPoint(e);
      if (p2) activePointers.current.set(e.pointerId, { x: p2.x, y: p2.y, t: e.timeStamp });
      return;
    }

    const pt = toCanvasPoint(e);
    if (pt) {
      const sizeFrac = brushSize / CUP_WIDTH;
      setCursorPos({
        fx: clampFrac(pt.x / CUP_WIDTH, sizeFrac),
        fy: clampFrac(pt.y / CUP_HEIGHT, sizeFrac),
        sizeFrac,
      });
    }
    if (!drawing.current) return;
    // 只响应归属指针，其余指针的移动不影响笔画
    if (e.pointerId !== activeStrokeId.current) return;
    if (tool === "move" || tool === "text") {
      const point = toCanvasPoint(e);
      if (!point) return;
      if (last.current) {
        const dx = point.x - last.current.x;
        const dy = point.y - last.current.y;
        if (tool === "move") onPanDelta(dx, dy);
        else onTextDrag(dx, dy);
        last.current = point;
      }
      return;
    }
    // 合并采样点：快速挥笔时一个帧内多个点全部入列，线条更连贯
    const native = e.nativeEvent;
    const events = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    const ctxs = strokeCtxs();
    for (const ev of events.length > 0 ? events : [native]) {
      const point = toCanvasPoint(ev);
      if (!point || !segPrev.current) continue;
      strokePoints.current.push(withPressure(point, ev.pressure));
      // 各图层共用本段的旧中点（否则第二层起会拿到第一层更新后的中点，轨迹分叉）
      const sharedLastMid = segMid.current;
      let nextMid: StrokePoint | null = null;
      for (const ctx of ctxs) {
        ctx.lineWidth = widthFor(brushSize, pressureSensitive ? ev.pressure : undefined);
        nextMid = drawSegment(ctx, segPrev.current, point, sharedLastMid);
      }
      segMid.current = nextMid;
      segPrev.current = point;
    }
  };

  const endStroke = (e: PointerEvent<HTMLCanvasElement>) => {
    activePointers.current.delete(e.pointerId);
    // 双指手势结束：未平移且够快 = 轻点撤销
    if (panGesture.current && activePointers.current.size < 2) {
      const g = panGesture.current;
      panGesture.current = null;
      if (!g.moved && e.timeStamp - g.startT < 400) onGestureUndo();
      return;
    }
    if (e.pointerId !== activeStrokeId.current) return;
    activeStrokeId.current = null;
    if (drawing.current && tool !== "move" && tool !== "text" && strokePoints.current.length > 0) {
      // 收尾：把曲线延伸到最后一个采样点
      const lastPoint = strokePoints.current[strokePoints.current.length - 1];
      if (strokePoints.current.length > 1 && segPrev.current) {
        for (const ctx of strokeCtxs()) {
          ctx.lineWidth = widthFor(brushSize, lastPoint.p);
          drawSegment(ctx, lastPoint, lastPoint, segMid.current);
          ctx.globalCompositeOperation = "source-over";
        }
      }
      onStrokeEnd({ tool, size: brushSize, points: strokePoints.current });
    }
    drawing.current = false;
    last.current = null;
    strokePoints.current = [];
    segPrev.current = null;
    segMid.current = null;
  };

  const cursor =
    tool === "move" ? "cursor-grab touch-none" : tool === "text" ? "cursor-text touch-none" : "cursor-none touch-none";

  // 视图缩放（细活需要）：CSS zoom 放大层叠容器，容器溢出滚动即平移
  const [zoom, setZoom] = useState(1);
  const clampZoom = (z: number) => Math.min(4, Math.max(0.5, Math.round(z * 100) / 100));

  // Ctrl/Cmd+滚轮缩放：React 的 onWheel 是 passive 监听，preventDefault 需要原生注册
  const sectionRef = useRef<HTMLElement | null>(null);
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

  return (
    <section ref={sectionRef} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 flex items-center text-sm font-semibold text-neutral-800">
        预览 <span className="ml-1 font-normal text-neutral-400">{CUP_WIDTH}×{CUP_HEIGHT}</span>
        <span className="ml-auto flex items-center gap-1 font-normal">
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
            title="复位缩放（Ctrl/⌘+滚轮也可缩放）"
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
          // 横向极宽才内部滚动；不再依赖 overflow 简写/长写的优先级
          className="max-h-none overflow-x-auto overflow-y-visible max-lg:max-h-[46vh] max-lg:overflow-y-auto"
        >
        <div
          style={{ zoom }}
          className={`relative mx-auto aspect-[596/832] h-[40vh] w-max max-w-none lg:h-[560px] ${ready ? "" : "opacity-60"}`}
        >
          <canvas
            ref={baseCanvasRef}
            width={CUP_WIDTH}
            height={CUP_HEIGHT}
            style={{ backgroundColor: DEFAULT_BACKGROUND }}
            className="pointer-events-none absolute inset-0 h-full w-full rounded-lg border border-neutral-200"
          />
          <canvas
            ref={eraseCanvasRef}
            width={CUP_WIDTH}
            height={CUP_HEIGHT}
            className="pointer-events-none absolute inset-0 h-full w-full"
          />
          <canvas
            ref={textCanvasRef}
            width={CUP_WIDTH}
            height={CUP_HEIGHT}
            className="pointer-events-none absolute inset-0 h-full w-full"
          />
          <canvas
            ref={inkCanvasRef}
            width={CUP_WIDTH}
            height={CUP_HEIGHT}
            onDoubleClick={() => {
              if (tool === "text" && selectedTextId !== null) onTextEditStart(selectedTextId);
            }}
            onPointerDown={ready ? beginStroke : undefined}
            onPointerMove={ready ? moveStroke : undefined}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            onPointerLeave={() => setCursorPos(null)}
            className={`absolute inset-0 h-full w-full ${ready ? cursor : ""}`}
          />
          {(() => {
            const sel = texts.find((t) => t.id === selectedTextId) ?? null;
            if (!sel) return null;
            const m = measureTextObj(sel);
            const rad = (sel.angle * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const defs: Array<{ kind: string; dx: number; dy: number; cursor: string }> = [
              { kind: "e", dx: m.w / 2, dy: 0, cursor: "ew-resize" },
              { kind: "w", dx: -m.w / 2, dy: 0, cursor: "ew-resize" },
              { kind: "s", dx: 0, dy: m.h / 2, cursor: "ns-resize" },
              { kind: "n", dx: 0, dy: -m.h / 2, cursor: "ns-resize" },
              { kind: "ne", dx: m.w / 2, dy: -m.h / 2, cursor: "grab" },
              { kind: "nw", dx: -m.w / 2, dy: -m.h / 2, cursor: "grab" },
              { kind: "se", dx: m.w / 2, dy: m.h / 2, cursor: "grab" },
              { kind: "sw", dx: -m.w / 2, dy: m.h / 2, cursor: "grab" },
            ];
            return defs.map((h) => {
              const fx = (sel.x + h.dx * cos - h.dy * sin) / CUP_WIDTH;
              const fy = (sel.y + h.dx * sin + h.dy * cos) / CUP_HEIGHT;
              return (
                <div
                  key={h.kind}
                  data-text-handle={h.kind}
                  onPointerDown={beginHandleDrag}
                  onPointerMove={moveHandleDrag}
                  onPointerUp={endHandleDrag}
                  onPointerCancel={endHandleDrag}
                  className="absolute z-20 h-2.5 w-2.5 rounded-sm border border-white bg-neutral-700 shadow"
                  style={{
                    left: `${fx * 100}%`,
                    top: `${fy * 100}%`,
                    transform: "translate(-50%, -50%)",
                    cursor: h.cursor,
                    touchAction: "none",
                  }}
                />
              );
            });
          })()}
          {(() => {
            const editing = texts.find((t) => t.id === editingTextId) ?? null;
            if (!editing) return null;
            return (
              <div
                className="absolute z-10 flex flex-col items-center gap-1"
                style={{
                  left: `${(editing.x / CUP_WIDTH) * 100}%`,
                  top: `${((editing.y - editing.size / 2 - 16) / CUP_HEIGHT) * 100}%`,
                  transform: "translate(-50%, -100%)",
                }}
              >
                <input
                  autoFocus
                  value={editing.content}
                  placeholder="输入文字，回车完成"
                  onChange={(e) => onTextContent(editing.id, e.target.value)}
                  onBlur={(e) => {
                    // 点击手柄不结束编辑（手柄会持续拖动）
                    if (e.relatedTarget instanceof HTMLElement && e.relatedTarget.closest("[data-text-handle],[data-text-edit-ui]")) return;
                    onTextEditDone(editing.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") onTextEditDone(editing.id);
                  }}
                  className="w-32 rounded border border-neutral-500 bg-white/90 px-2 py-1 text-center text-sm shadow focus:outline-none"
                />
                {/* 字重选择：点击即改，编辑态即时生效 */}
                <div
                  data-text-edit-ui
                  className="flex gap-1 rounded border border-neutral-300 bg-white/90 px-1 py-0.5 shadow"
                >
                  {([
                    [400, "常规"],
                    [700, "粗体"],
                    [900, "特粗"],
                  ] as Array<[number, string]>).map(([w, label]) => (
                    <button
                      key={w}
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => onTextWeight(editing.id, w)}
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        editing.weight === w ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
          {cursorPos && (tool === "brush" || tool === "eraser") && (
            <div
              aria-hidden
              className="pointer-events-none absolute aspect-square rounded-full mix-blend-difference"
              style={{
                width: `${cursorPos.sizeFrac * 100}%`,
                left: `${(cursorPos.fx - cursorPos.sizeFrac / 2) * 100}%`,
                top: `${(cursorPos.fy - cursorPos.sizeFrac / 2) * 100}%`,
                border: "1.5px solid #fff",
              }}
            />
          )}
        </div>
      </div>
      {!ready && <p className="mt-2 text-center text-xs text-neutral-400">先选择原图</p>}
    </section>
  );
}
