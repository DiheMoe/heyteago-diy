"use client";

// 596×832 预览画布：四层叠放——底图、擦除掩码（底色着色预览）、文字、墨迹（最上层，接收指针事件）。
// 画布内容由画布外壳绘制；这里负责叠放、视图缩放、笔刷光标，以及未就绪（没有原图或渲染失败）时变淡、不接受新的按下与移动。
// children 是叠在画布上的交互层，与画布同一坐标系。
import type { MouseEventHandler, PointerEventHandler, ReactNode } from "react";
import { BACKGROUND_COLOR, CUP_HEIGHT, CUP_WIDTH } from "@/shared/constants";
import type { EditorCanvas } from "../canvas/use-editor-canvas";
import type { Tool } from "../model/document";

// 笔刷光标：直径 = 笔刷粗细的圆圈跟随指针。
// 位置与直径用画布占比存取——外层带 CSS zoom，用像素坐标会被二次缩放
export interface BrushCursor {
  fx: number;
  fy: number;
  sizeFrac: number;
}

export interface InkPointerHandlers {
  onPointerDown: PointerEventHandler<HTMLCanvasElement>;
  onPointerMove: PointerEventHandler<HTMLCanvasElement>;
  // 抬起与取消
  onPointerEnd: PointerEventHandler<HTMLCanvasElement>;
  onPointerLeave: PointerEventHandler<HTMLCanvasElement>;
  onDoubleClick: MouseEventHandler<HTMLCanvasElement>;
}

interface Props {
  canvas: EditorCanvas;
  zoom: number;
  tool: Tool;
  cursor: BrushCursor | null;
  ink: InkPointerHandlers;
  children: ReactNode;
}

export function CanvasStack({ canvas, zoom, tool, cursor, ink, children }: Props) {
  const { baseRef, eraseRef, textRef, inkRef, ready } = canvas;
  // 浏览时把单指滑动留给浏览器滚动页面；其余工具由画布接管触摸
  const toolCursor =
    tool === "browse"
      ? "touch-pan-x touch-pan-y"
      : tool === "move"
        ? "cursor-grab touch-none"
        : tool === "text"
          ? "cursor-text touch-none"
          : "cursor-none touch-none";

  return (
    <div
      style={{ zoom }}
      className="relative mx-auto aspect-[596/832] h-[40vh] w-max max-w-none lg:h-[560px]"
    >
      <canvas
        ref={baseRef}
        width={CUP_WIDTH}
        height={CUP_HEIGHT}
        style={{ backgroundColor: BACKGROUND_COLOR }}
        className={`pointer-events-none absolute inset-0 h-full w-full rounded-lg border border-neutral-200 ${ready ? "" : "opacity-60"}`}
      />
      <canvas
        ref={eraseRef}
        width={CUP_WIDTH}
        height={CUP_HEIGHT}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      <canvas
        ref={textRef}
        width={CUP_WIDTH}
        height={CUP_HEIGHT}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      <canvas
        ref={inkRef}
        width={CUP_WIDTH}
        height={CUP_HEIGHT}
        onDoubleClick={ink.onDoubleClick}
        onPointerDown={ready ? ink.onPointerDown : undefined}
        onPointerMove={ready ? ink.onPointerMove : undefined}
        onPointerUp={ink.onPointerEnd}
        onPointerCancel={ink.onPointerEnd}
        onPointerLeave={ink.onPointerLeave}
        className={`absolute inset-0 h-full w-full ${ready ? toolCursor : ""}`}
      />
      {children}
      {cursor && (tool === "brush" || tool === "eraser") && (
        <div
          aria-hidden
          className="pointer-events-none absolute aspect-square rounded-full mix-blend-difference"
          style={{
            width: `${cursor.sizeFrac * 100}%`,
            left: `${(cursor.fx - cursor.sizeFrac / 2) * 100}%`,
            top: `${(cursor.fy - cursor.sizeFrac / 2) * 100}%`,
            border: "1.5px solid #fff",
          }}
        />
      )}
    </div>
  );
}
