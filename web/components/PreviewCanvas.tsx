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

export type Tool = Stroke["tool"] | "move";

interface Props {
  baseCanvasRef: RefObject<HTMLCanvasElement | null>;
  eraseCanvasRef: RefObject<HTMLCanvasElement | null>;
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
  // 双指轻点（Procreate 式撤销约定）：父组件撤销一笔并重放抹掉进行中的笔画
  onGestureUndo(): void;
}

export function PreviewCanvas({
  baseCanvasRef,
  eraseCanvasRef,
  inkCanvasRef,
  ready,
  tool,
  brushSize,
  eraseColor,
  pressureSensitive,
  onStrokeEnd,
  strokeAnchor,
  onPanDelta,
  onGestureUndo,
}: Props) {
  const drawing = useRef(false);
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

  // 压感开启时记录每点压力（重放保真），关闭时省略（恒粗）
  const withPressure = (p: StrokePoint, pressure: number): StrokePoint =>
    pressureSensitive ? { ...p, p: pressure } : p;

  const beginStroke = (e: PointerEvent<HTMLCanvasElement>) => {
    const point = toCanvasPoint(e);
    if (!point) return;

    // 双指轻点 = 撤销（Procreate 约定）：第二指快速落下且第一指几乎未移动时触发；
    // 进行中的笔画被取消（父组件重放抹掉已画部分）
    activePointers.current.set(e.pointerId, { x: point.x, y: point.y, t: Date.now() });
    if (activePointers.current.size === 2) {
      const [first] = activePointers.current.values();
      const quick = Date.now() - first.t < 400;
      const still = Math.hypot(point.x - first.x, point.y - first.y) < 24;
      activePointers.current.clear();
      if (quick && still) {
        last.current = null; // move 工具平移参考点一并作废
        drawing.current = false;
        strokePoints.current = [];
        segPrev.current = null;
        segMid.current = null;
        onGestureUndo();
        return;
      }
    }

    // 合成指针事件或个别浏览器可能无活动指针，捕获失败不影响绘制
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 忽略：退化为不捕获，笔画仍可用
    }
    if (tool === "move") {
      drawing.current = true;
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
    const pt = toCanvasPoint(e);
    if (pt) {
      setCursorPos({ fx: pt.x / CUP_WIDTH, fy: pt.y / CUP_HEIGHT, sizeFrac: brushSize / CUP_WIDTH });
    }
    if (!drawing.current) return;
    if (tool === "move") {
      const point = toCanvasPoint(e);
      if (!point) return;
      if (last.current) {
        onPanDelta(point.x - last.current.x, point.y - last.current.y);
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
      for (const ctx of ctxs) {
        ctx.lineWidth = widthFor(brushSize, pressureSensitive ? ev.pressure : undefined);
        segMid.current = drawSegment(ctx, segPrev.current, point, segMid.current);
      }
      segPrev.current = point;
    }
  };

  const endStroke = (e: PointerEvent<HTMLCanvasElement>) => {
    activePointers.current.delete(e.pointerId);
    if (drawing.current && tool !== "move" && strokePoints.current.length > 0) {
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

  const cursor = tool === "move" ? "cursor-grab touch-none" : "cursor-none touch-none";

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
      <div className="overflow-auto">
        <div
          style={{ zoom }}
          className={`relative mx-auto aspect-[596/832] h-[40vh] max-w-full lg:h-[560px] ${ready ? "" : "opacity-60"}`}
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
            ref={inkCanvasRef}
            width={CUP_WIDTH}
            height={CUP_HEIGHT}
            onPointerDown={ready ? beginStroke : undefined}
            onPointerMove={ready ? moveStroke : undefined}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            onPointerLeave={() => setCursorPos(null)}
            className={`absolute inset-0 h-full w-full ${ready ? cursor : ""}`}
          />
          {cursorPos && tool !== "move" && (
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
