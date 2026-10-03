"use client";

// 596×832 预览画布：显示渲染结果，支持画笔/橡皮擦编辑。
// 笔画快照（撤销栈）由父组件在 onStrokeStart 里维护。
import { useRef, type PointerEvent, type RefObject } from "react";
import { CUP_HEIGHT, CUP_WIDTH } from "@/lib/canvas/constants";

export type Tool = "brush" | "eraser";

interface Props {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  ready: boolean;
  tool: Tool;
  brushColor: string;
  brushSize: number;
  onStrokeStart(): void;
}

export function PreviewCanvas({ canvasRef, ready, tool, brushColor, brushSize, onStrokeStart }: Props) {
  const drawing = useRef(false);

  const toCanvasPoint = (e: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const beginStroke = (e: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const point = toCanvasPoint(e);
    if (!canvas || !point) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // 合成指针事件或个别浏览器可能无活动指针，捕获失败不影响绘制
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 忽略：退化为不捕获，笔画仍可用
    }
    onStrokeStart();
    drawing.current = true;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brushSize;
    // 橡皮擦用 destination-out 抠出透明，导出时再合成到底色上；
    // 画布 CSS 底色同为 #EEEEEE，预览时孔洞不显白
    ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = brushColor;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x + 0.01, point.y + 0.01); // 单点也能画出圆点
    ctx.stroke();
  };

  const moveStroke = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const point = toCanvasPoint(e);
    const ctx = canvasRef.current?.getContext("2d");
    if (!point || !ctx) return;
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  };

  const endStroke = () => {
    drawing.current = false;
  };

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-neutral-800">
        预览 <span className="ml-1 font-normal text-neutral-400">{CUP_WIDTH}×{CUP_HEIGHT}</span>
      </h2>
      <div className="flex justify-center">
        <canvas
          ref={canvasRef}
          width={CUP_WIDTH}
          height={CUP_HEIGHT}
          onPointerDown={ready ? beginStroke : undefined}
          onPointerMove={ready ? moveStroke : undefined}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          className={`max-h-[560px] w-auto max-w-full rounded-lg border border-neutral-200 bg-[#EEEEEE] ${
            ready ? "cursor-crosshair touch-none" : "opacity-60"
          }`}
        />
      </div>
      {!ready && <p className="mt-2 text-center text-xs text-neutral-400">先选择原图</p>}
    </section>
  );
}
