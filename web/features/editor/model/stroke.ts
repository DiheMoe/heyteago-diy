// 矢量笔画：撤销/重做与重放的存储单元。{工具,粗细,点列} 内存可忽略、深度不限。
export interface StrokePoint {
  x: number;
  y: number;
  // 压感（PointerEvent.pressure，记录时已开启压感开关才有）；缺省 = 恒粗
  p?: number;
}

export interface Stroke {
  tool: "brush" | "eraser";
  size: number;
  points: StrokePoint[];
}
