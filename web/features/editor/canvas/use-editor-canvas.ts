import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { CUP_HEIGHT, CUP_WIDTH } from "@/shared/constants";
import { errorText } from "@/shared/errors";
import { useStore } from "@/shared/use-store";
import { freshView, selectedTextId, type EditorDoc, type EditorStore } from "../model/document";
import type { TextObj } from "../model/text";
import { ctx2d } from "./context";
import { exportImage } from "./export";
import { autoThreshold, createBlankImage, importImage, renderBase } from "./render";
import { createStrokeLayer, type StrokeLayer } from "./stroke-layer";
import { renderTexts } from "./text-layer";

export interface EditorCanvas {
  baseRef: RefObject<HTMLCanvasElement | null>;
  eraseRef: RefObject<HTMLCanvasElement | null>;
  textRef: RefObject<HTMLCanvasElement | null>;
  inkRef: RefObject<HTMLCanvasElement | null>;
  // 已有原图：可以编辑和导出
  ready: boolean;
  // 正在读取导入的图片
  importing: boolean;
  // 笔画层（画布挂载后可用），供画笔工具实时绘制
  strokes(): StrokeLayer;
  // 导出当前画面；maxBytes 缺省为上传上限
  exportImage(maxBytes?: number): Promise<Blob>;
  // 读入原图文件后换上（保留笔画和文字）
  loadImage(file: File): Promise<void>;
  // 换上空白底图，全新开始：清空笔画、文字与撤销/重做历史
  newBlank(): Promise<void>;
}

// 画布外壳：持有四层画布（底图、擦除、文字、墨迹），各层都订阅 store，每次 dispatch 之后
// 同步重画，不经过 React 渲染：底图在原图、色调或取景变化时重绘，笔画层跟上已提交的笔画，
// 文字层跟上文字与选中。前端只有这里（及其调用的绘制模块）直接画画布。
// onError 收到整理好的错误文案：读图失败、生成空白底图失败。
export function useEditorCanvas(store: EditorStore, onError: (message: string) => void): EditorCanvas {
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const eraseRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef<HTMLCanvasElement | null>(null);
  const inkRef = useRef<HTMLCanvasElement | null>(null);
  const strokeLayer = useRef<StrokeLayer | null>(null);

  const ready = useStore(store, (s) => s.doc.image !== null);
  const [importing, setImporting] = useState(false);

  useLayoutEffect(() => {
    const { doc } = store.getState();
    const layer = createStrokeLayer({ ink: inkRef.current!, erase: eraseRef.current! }, doc.strokes);
    strokeLayer.current = layer;
    const baseCtx = ctx2d(baseRef.current!);
    const textCanvas = textRef.current!;
    // 原图、色调、取景每次变化都换新对象，按引用比较即可
    let shownBase: Pick<EditorDoc, "image" | "tone" | "view"> | null = null;
    let shownTexts: TextObj[] | null = null;
    let shownSelection: number | null = null;
    const sync = () => {
      const s = store.getState();
      const { image, tone, view } = s.doc;
      if (!shownBase || image !== shownBase.image || tone !== shownBase.tone || view !== shownBase.view) {
        if (image) baseCtx.putImageData(renderBase(image, tone, view), 0, 0);
        else baseCtx.clearRect(0, 0, CUP_WIDTH, CUP_HEIGHT);
        shownBase = { image, tone, view };
      }
      layer.sync(s.doc.strokes);
      const selection = selectedTextId(s);
      if (s.doc.texts === shownTexts && selection === shownSelection) return;
      renderTexts(textCanvas, s.doc.texts, selection);
      shownTexts = s.doc.texts;
      shownSelection = selection;
    };
    sync();
    return store.subscribe(sync);
  }, [store]);

  return {
    baseRef,
    eraseRef,
    textRef,
    inkRef,
    ready,
    importing,
    strokes: () => strokeLayer.current!,
    exportImage(maxBytes) {
      const { doc } = store.getState();
      return exportImage(
        {
          base: baseRef.current!,
          erase: eraseRef.current!,
          ink: inkRef.current!,
          texts: doc.texts,
        },
        maxBytes,
      );
    },
    async loadImage(file) {
      setImporting(true);
      try {
        const image = await importImage(file);
        // 按换图后的取景（取景复位、保留适配方式）自动选明暗分界
        const threshold = autoThreshold(image, freshView(store.getState().doc.view.fit));
        store.dispatch({ type: "imageLoaded", image, name: file.name, threshold });
      } catch (err) {
        onError(errorText(err, "图片读取失败"));
      } finally {
        setImporting(false);
      }
    },
    async newBlank() {
      try {
        store.dispatch({ type: "blankCanvas", image: await createBlankImage() });
      } catch (err) {
        onError(errorText(err));
      }
    },
  };
}
