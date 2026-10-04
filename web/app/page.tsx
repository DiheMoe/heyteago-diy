"use client";

import { useEffect, useRef, useState } from "react";
import { fetchUser, fileNameFor, saveDraft, uploadSticker, type User } from "@/lib/api";
import { exportEditedCanvas, offsetBounds, readFileAsImage, renderSticker } from "@/lib/canvas/render";
import { CUP_HEIGHT, CUP_WIDTH, DEFAULT_BACKGROUND } from "@/lib/canvas/constants";
import { drawStroke, replayStrokes, type Stroke, type StrokePoint } from "@/lib/canvas/strokes";
import { hitText, renderTexts, type TextObj } from "@/lib/canvas/texts";
import { sha1Hex } from "@/lib/dup-guard";
import { ActionBar, type Status } from "@/components/ActionBar";
import { BackgroundControls, type BackgroundSettings } from "@/components/BackgroundControls";
import { BrushControls } from "@/components/BrushControls";
import { Faq } from "@/components/Faq";
import { ImagePicker } from "@/components/ImagePicker";
import { Modal } from "@/components/Modal";
import { PreviewCanvas, type Tool } from "@/components/PreviewCanvas";
import { ShortcutsHelp } from "@/components/ShortcutsHelp";
import { TokenPanel } from "@/components/TokenPanel";
import { ToneControls, type ToneSettings } from "@/components/ToneControls";

const TOKEN_STORAGE_KEY = "heyteago-diy:token";

// 待确认的直接上传：导出与查重在点击「上传杯贴」时完成，确认态只发请求。
// 任何会改变画布的操作（换图/调参/画笔）都会使它失效。
interface PendingUpload {
  blob: Blob;
  hash: string;
  duplicate: boolean;
  sizeBytes: number;
}

export default function Page() {
  // 三层画布：base 渲染基底（调参/换图重绘）、erase 擦除掩码、ink 画笔笔迹
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const eraseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const textCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const inkCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // 撤销/重做存矢量记录（笔画点列 / 文字对象），内存可忽略、深度不限；重放成本很低
  type HistoryEntry = { kind: "stroke"; stroke: Stroke } | { kind: "text"; text: TextObj };
  const history = useRef<HistoryEntry[]>([]);
  const redoStrokes = useRef<HistoryEntry[]>([]);
  // 渲染序号：异步渲染返回时序号过期则丢弃，避免旧结果覆盖新设置
  const renderSeq = useRef(0);
  const lastUploadHash = useRef<string | null>(null);

  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [tone, setTone] = useState<ToneSettings>({
    toneMode: "binary",
    threshold: 170,
    density: 6,
    pattern: "circle",
    fit: "cover",
    forcePng: true,
  });
  const [bg, setBg] = useState<BackgroundSettings>({ enabled: true, color: DEFAULT_BACKGROUND, tolerance: 250 });
  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(12);
  // 橡皮擦独立记忆粗细，来回切换不用重调
  const [eraserSize, setEraserSize] = useState(40);
  // 压感开关（手写笔），默认关——鼠标/触摸 pressure 恒定不受影响
  const [pressureSensitive, setPressureSensitive] = useState(false);
  // Shift+点击直线的锚点：最后一笔的终点；撤销/重做同步更新
  const [strokeAnchor, setStrokeAnchor] = useState<StrokePoint | null>(null);
  // 贴文字：新放置的默认值与当前选中对象（调整即时生效，不产生历史条目）
  const [textContent, setTextContent] = useState("杯贴");
  const [textSize, setTextSize] = useState(48);
  const [textAngle, setTextAngle] = useState(0);
  const [selectedTextId, setSelectedTextId] = useState<number | null>(null);
  const [texts, setTexts] = useState<TextObj[]>([]);
  const textIdCounter = useRef(0);
  // 取景：90° 步进旋转 + 画布坐标位移（钳制在 offsetBounds 内）；换图重置
  const [view, setView] = useState({ rotate: 0, offsetX: 0, offsetY: 0 });
  // 当前工具的生效粗细：画笔/橡皮擦各自记忆
  const strokeSize = tool === "eraser" ? eraserSize : brushSize;
  const [ready, setReady] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [busy, setBusy] = useState<"render" | "upload" | "draft" | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  // 常见问题/快捷键默认收起，经原图卡片旁的按钮展开
  const [faqOpen, setFaqOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TOKEN_STORAGE_KEY);
      if (saved) {
        // 挂载后从 localStorage 恢复 token：SSR 期间没有 localStorage，
        // 必须放在 effect 里同步外部存储，此处同步 setState 不可避免。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setToken(saved);
        setRemember(true);
        // 恢复的 token 直接查一次用户，免得手动再点「查询用户」；失效则提示重新登录
        fetchUser(saved)
          .then(setUser)
          .catch(() => setStatus({ kind: "error", text: "本地保存的 token 已失效，请重新登录" }));
      }
    } catch {
      // localStorage 不可用（隐私模式等）时仅不持久化
    }
  }, []);

  const handleTokenChange = (next: string, rememberNext: boolean) => {
    setToken(next);
    setRemember(rememberNext);
    setUser(null);
    setPendingUpload(null);
    try {
      if (rememberNext) localStorage.setItem(TOKEN_STORAGE_KEY, next);
      else localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // 同上
    }
  };

  const markRendering = () => {
    setReady(false);
    setBusy("render");
  };

  const handlePick = async (file: File) => {
    try {
      const img = await readFileAsImage(file);
      markRendering();
      setPendingUpload(null);
      setImage(img);
      setImageName(file.name);
      setView({ rotate: 0, offsetX: 0, offsetY: 0 });
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : "图片读取失败" });
    }
  };

  const applyTone = (next: ToneSettings) => {
    // 适配方式切换改变可平移范围，已有位移随之复位
    if (next.fit !== tone.fit) setView((v) => ({ ...v, offsetX: 0, offsetY: 0 }));
    setTone(next);
    setPendingUpload(null);
    if (image) markRendering();
  };

  const clampOffset = (v: number, max: number) => Math.max(-max, Math.min(max, v));

  // move 工具拖动取景：逐段位移经钳制后进 view，由渲染 effect（防抖）重绘。
  // 不 markRendering——拖动途中画布必须保持可交互。
  const panImage = (dx: number, dy: number) => {
    if (!image) return;
    const b = offsetBounds(image, tone.fit, view.rotate);
    setView((v) => ({
      ...v,
      offsetX: clampOffset(v.offsetX + dx, b.maxX),
      offsetY: clampOffset(v.offsetY + dy, b.maxY),
    }));
    // 取景改变导出内容，待确认上传随之失效
    setPendingUpload(null);
  };

  const rotateImage = () => {
    if (!image) return;
    // 旋转后可平移范围变化，位移复位；取景变化使待确认上传失效
    setView((v) => ({ rotate: (v.rotate + 90) % 360, offsetX: 0, offsetY: 0 }));
    setPendingUpload(null);
  };

  // 生效底色变化时给擦除掩码重着色：source-in 只改已有标记的颜色、不动形状
  const effectiveBg = (s: BackgroundSettings) => (s.enabled ? s.color : DEFAULT_BACKGROUND);
  const retintErase = (s: BackgroundSettings) => {
    const ctx = eraseCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = effectiveBg(s);
    ctx.fillRect(0, 0, CUP_WIDTH, CUP_HEIGHT);
    ctx.globalCompositeOperation = "source-over";
  };

  const applyBg = (next: BackgroundSettings) => {
    if (effectiveBg(next) !== effectiveBg(bg)) retintErase(next);
    setBg(next);
    setPendingUpload(null);
    if (image) markRendering();
  };

  // 原图或参数变化 → 重绘基底画布。笔触与擦除标记在独立图层，不受影响；
  // 撤销栈存矢量笔画（点列），跨重渲染依然有效。
  useEffect(() => {
    if (!image) return;
    const seq = ++renderSeq.current;
    const timer = setTimeout(() => {
      renderSticker(image, {
        ...tone,
        background: bg.enabled ? bg.color : null,
        whiteTolerance: bg.tolerance,
        ...view,
      })
        .then(async (blob) => {
          if (seq !== renderSeq.current) return;
          const bitmap = await createImageBitmap(blob);
          const ctx = baseCanvasRef.current?.getContext("2d");
          if (!ctx || seq !== renderSeq.current) return;
          ctx.clearRect(0, 0, CUP_WIDTH, CUP_HEIGHT);
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          setReady(true);
        })
        .catch((err: unknown) => {
          if (seq !== renderSeq.current) return;
          setReady(false);
          setStatus({ kind: "error", text: err instanceof Error ? err.message : "渲染失败" });
        })
        .finally(() => {
          if (seq === renderSeq.current) setBusy(null);
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [image, tone, bg, view]);

  // 撤销/重做存矢量记录（笔画点列 / 文字对象），内存可忽略、深度不限；重放成本很低。
  // 文字对象同时活在 texts state（渲染/面板用）与历史条目（撤销用）里，
  // 调整时同步两处，保证 undo/redo 与所见一致。
  const strokeEntries = () => history.current.filter((e) => e.kind === "stroke").map((e) => e.stroke);

  // applyTexts 同步更新 texts state 与文字层画面（setState 异步，渲染必须直接用新列表）
  const applyTexts = (next: TextObj[], sel: number | null = selectedTextId) => {
    setTexts(next);
    renderTexts(textCanvasRef.current, next, sel);
  };
  // patchTexts 供连续调整（滑块/拖动）：在最新 state 上计算，避免闭包旧值丢补丁
  const patchTexts = (fn: (prev: TextObj[]) => TextObj[], sel: number | null = selectedTextId) => {
    setTexts((prev) => {
      const next = fn(prev);
      renderTexts(textCanvasRef.current, next, sel);
      return next;
    });
  };
  const redrawTexts = () => applyTexts(texts);

  // 一笔完成：记入撤销栈并清空重做栈（新笔画使重做失效是编辑器惯例）
  const recordStroke = (s: Stroke) => {
    history.current.push({ kind: "stroke", stroke: s });
    redoStrokes.current = [];
    setStrokeAnchor(s.points[s.points.length - 1] ?? null);
    setCanUndo(true);
    setCanRedo(false);
    // 画笔改变画布内容，已导出的待确认上传随之失效
    setPendingUpload(null);
  };

  // 双指轻点撤销（PreviewCanvas 手势）：撤销一笔并重放；撤销栈为空时
  // 也要重放——进行中的笔画（已画出但未入栈）需要被抹掉
  const gestureUndo = () => {
    if (history.current.length === 0) {
      replayStrokes({ ink: inkCanvasRef.current, erase: eraseCanvasRef.current }, [], effectiveBg(bg));
      return;
    }
    undo();
  };

  const syncUndoState = () => {
    setCanUndo(history.current.length > 0);
    setCanRedo(redoStrokes.current.length > 0);
  };

  const undo = () => {
    const s = history.current.pop();
    if (!s) return;
    redoStrokes.current.push(s);
    setPendingUpload(null);
    if (s.kind === "text") {
      const sel = s.text.id === selectedTextId ? null : selectedTextId;
      if (s.text.id === selectedTextId) setSelectedTextId(null);
      applyTexts(texts.filter((t) => t.id !== s.text.id), sel);
    } else {
      replayStrokes({ ink: inkCanvasRef.current, erase: eraseCanvasRef.current }, strokeEntries(), effectiveBg(bg));
    }
    const last = [...history.current].reverse().find((e) => e.kind === "stroke");
    setStrokeAnchor(last && last.kind === "stroke" ? last.stroke.points[last.stroke.points.length - 1] : null);
    syncUndoState();
  };

  // 重做只需补画弹出的这一条（顺序与原始一致），无需全量重放
  const redo = () => {
    const s = redoStrokes.current.pop();
    if (!s) return;
    history.current.push(s);
    setPendingUpload(null);
    if (s.kind === "text") {
      applyTexts([...texts.filter((t) => t.id !== s.text.id), s.text]);
    } else {
      drawStroke({ ink: inkCanvasRef.current, erase: eraseCanvasRef.current }, s.stroke, effectiveBg(bg));
      setStrokeAnchor(s.stroke.points[s.stroke.points.length - 1] ?? null);
    }
    syncUndoState();
  };

  // 文字工具按下：命中已有文字则选中（可拖动/面板调整），否则在该点放置新文字
  const textPointerDown = (p: { x: number; y: number }) => {
    const hit = hitText(texts, p.x, p.y);
    if (hit) {
      setSelectedTextId(hit.id);
      redrawTexts();
      return;
    }
    const t: TextObj = {
      id: ++textIdCounter.current,
      content: textContent.trim() || "文字",
      x: p.x,
      y: p.y,
      size: textSize,
      angle: textAngle,
    };
    history.current.push({ kind: "text", text: t });
    redoStrokes.current = [];
    applyTexts([...texts, t], t.id);
    setSelectedTextId(t.id);
    setCanUndo(true);
    setCanRedo(false);
    setPendingUpload(null);
  };

  const selectedText = () => texts.find((t) => t.id === selectedTextId) ?? null;

  // 文字调整：直接改对象（与笔画不可事后编辑的语义一致，不产生新条目）；
  // 同步 texts state 与历史条目，redo 回来的对象保持调整后的值
  const updateText = (id: number, patch: Partial<TextObj>) => {
    history.current = history.current.map((e) =>
      e.kind === "text" && e.text.id === id ? { ...e, text: { ...e.text, ...patch } } : e,
    );
    setPendingUpload(null);
    patchTexts((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const textDrag = (dx: number, dy: number) => {
    const t = selectedText();
    if (!t) return;
    updateText(t.id, {
      x: Math.max(0, Math.min(CUP_WIDTH, t.x + dx)),
      y: Math.max(0, Math.min(CUP_HEIGHT, t.y + dy)),
    });
  };

  const deleteSelectedText = () => {
    if (selectedTextId === null) return;
    history.current = history.current.filter((e) => !(e.kind === "text" && e.text.id === selectedTextId));
    setSelectedTextId(null);
    setPendingUpload(null);
    applyTexts(texts.filter((t) => t.id !== selectedTextId), null);
    syncUndoState();
  };

  // 新建空白画布：纯白底图进渲染管线（二值化后全白，底色替换后就是杯底色）。
  // 视为全新开始：清空笔触与撤销/重做历史。
  const handleBlank = () => {
    const c = document.createElement("canvas");
    c.width = CUP_WIDTH;
    c.height = CUP_HEIGHT;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, CUP_WIDTH, CUP_HEIGHT);
    const img = new Image();
    img.onload = () => {
      markRendering();
      setPendingUpload(null);
      setImage(img);
      setImageName("空白画布");
      setView({ rotate: 0, offsetX: 0, offsetY: 0 });
      history.current = [];
      redoStrokes.current = [];
      setStrokeAnchor(null);
      replayStrokes({ ink: inkCanvasRef.current, erase: eraseCanvasRef.current }, [], effectiveBg(bg));
      setSelectedTextId(null);
      applyTexts([], null);
      syncUndoState();
    };
    img.src = c.toDataURL("image/png");
  };

  // 快捷键：Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z 重做、B/E 切画笔橡皮、[ ] 调粗细。
  // 文本输入框内的按键不劫持（留给输入框自身）。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (faqOpen || shortcutsOpen) return; // 弹窗打开时挂起画布快捷键
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() !== "z") return;
        if (e.shiftKey) {
          if (redoStrokes.current.length === 0) return;
          e.preventDefault();
          redo();
        } else {
          if (history.current.length === 0) return;
          e.preventDefault();
          undo();
        }
        return;
      }
      switch (e.key) {
        case "b":
        case "B":
          setTool("brush");
          break;
        case "e":
        case "E":
          setTool("eraser");
          break;
        case "t":
        case "T":
          setTool("text");
          break;
        case "[":
          (tool === "eraser" ? setEraserSize : setBrushSize)((v) => Math.max(2, v - 2));
          break;
        case "]":
          (tool === "eraser" ? setEraserSize : setBrushSize)((v) => Math.min(80, v + 2));
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // maxBytes 缺省为上传上限；本地下载传 Infinity（本地文件不受上传约束）
  const exportCurrent = (maxBytes?: number) => {
    const base = baseCanvasRef.current;
    const erase = eraseCanvasRef.current;
    const text = textCanvasRef.current;
    const ink = inkCanvasRef.current;
    if (!base || !erase || !text || !ink) throw new Error("画布不可用");
    // 橡皮擦掩码导出时抠回底色（开启背景替换用自定义色，否则默认杯底色），避免发白
    return exportEditedCanvas({ base, erase, text, ink }, bg.enabled ? bg.color : DEFAULT_BACKGROUND, tone.forcePng, maxBytes);
  };

  const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

  // 直接上传第一步：导出并查重，进入确认态（不发请求）
  const handleRequestUpload = async () => {
    if (!token) return setStatus({ kind: "error", text: "请先填入 token" });
    if (!user) return setStatus({ kind: "error", text: "请先点击「查询用户」确认账号" });
    setBusy("upload");
    try {
      const blob = await exportCurrent();
      const hash = await sha1Hex(blob);
      setPendingUpload({ blob, hash, duplicate: hash === lastUploadHash.current, sizeBytes: blob.size });
    } catch (err) {
      setStatus({ kind: "error", text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  // 直接上传第二步：确认后发出请求
  const handleConfirmUpload = async () => {
    const pending = pendingUpload;
    if (!pending) return;
    if (!user) {
      setPendingUpload(null);
      return setStatus({ kind: "error", text: "请先点击「查询用户」确认账号" });
    }
    setBusy("upload");
    try {
      const res = await uploadSticker(pending.blob, {
        token,
        userMainId: user.user_main_id,
        width: CUP_WIDTH,
        height: CUP_HEIGHT,
      });
      lastUploadHash.current = pending.hash;
      setPendingUpload(null);
      setStatus({ kind: "success", text: res.message || "上传成功，去小程序查看吧" });
    } catch (err) {
      setStatus({ kind: "error", text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const handleSaveDraft = async () => {
    if (!token) return setStatus({ kind: "error", text: "请先填入 token" });
    setBusy("draft");
    try {
      const blob = await exportCurrent();
      const res = await saveDraft(blob, token);
      setStatus({ kind: "success", text: res.message || "草稿保存成功" });
    } catch (err) {
      setStatus({ kind: "error", text: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const handleDownload = async () => {
    try {
      const blob = await exportCurrent(Infinity);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileNameFor(blob);
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setStatus({ kind: "error", text: errorText(err) });
    }
  };

  const canSubmit = ready && token.length > 0;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 lg:py-8">
      <header className="mb-6">
        <h1 className="text-xl font-bold text-neutral-900">喜茶杯贴 DIY</h1>
        <p className="mt-1 text-xs text-neutral-500">
          本地处理图片并上传到喜茶账号（App 通道）· 画布 {CUP_WIDTH}×{CUP_HEIGHT} · 输出 ≤ 200KB
        </p>
      </header>

      {/* 预览吸附：桌面端左列 sticky；移动端 sticky 在顶部（限高避免占满视口） */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="sticky top-2 z-10 order-3 lg:col-start-1 lg:row-span-7 lg:row-start-1 lg:self-start lg:top-4">
          <PreviewCanvas
            baseCanvasRef={baseCanvasRef}
            eraseCanvasRef={eraseCanvasRef}
            textCanvasRef={textCanvasRef}
            inkCanvasRef={inkCanvasRef}
            ready={ready}
            tool={tool}
            brushSize={strokeSize}
            eraseColor={bg.enabled ? bg.color : DEFAULT_BACKGROUND}
            pressureSensitive={pressureSensitive}
            strokeAnchor={strokeAnchor}
            onStrokeEnd={recordStroke}
            onPanDelta={panImage}
            onTextPointerDown={textPointerDown}
            onTextDrag={textDrag}
            onGestureUndo={gestureUndo}
          />
        </div>
        <div className="order-1 lg:col-start-2">
          <TokenPanel
            token={token}
            remember={remember}
            user={user}
            onTokenChange={handleTokenChange}
            onUserChange={setUser}
          />
        </div>
        <div className="order-2 lg:col-start-2">
          <ImagePicker
            fileName={imageName}
            onPick={handlePick}
            onError={(text) => setStatus({ kind: "error", text })}
            onBlank={handleBlank}
            faqOpen={faqOpen}
            shortcutsOpen={shortcutsOpen}
            onToggleFaq={() => setFaqOpen((v) => !v)}
            onToggleShortcuts={() => setShortcutsOpen((v) => !v)}
          />
        </div>
        <div className="order-4 lg:col-start-2">
          <ToneControls value={tone} onChange={applyTone} rotate={view.rotate} onRotate={rotateImage} />
        </div>
        <div className="order-5 lg:col-start-2">
          <BackgroundControls value={bg} onChange={applyBg} />
        </div>
        <div className="order-6 lg:col-start-2">
          <BrushControls
            tool={tool}
            size={strokeSize}
            canUndo={canUndo}
            canRedo={canRedo}
            pressureSensitive={pressureSensitive}
            onToolChange={setTool}
            onSizeChange={(v) => (tool === "eraser" ? setEraserSize(v) : setBrushSize(v))}
            onUndo={undo}
            onRedo={redo}
            onTogglePressure={setPressureSensitive}
            textContent={selectedText()?.content ?? textContent}
            textSize={selectedText()?.size ?? textSize}
            textAngle={selectedText()?.angle ?? textAngle}
            textSelected={selectedTextId !== null}
            onTextContent={(v) => {
              const t = selectedText();
              if (t) updateText(t.id, { content: v });
              else setTextContent(v);
            }}
            onTextSize={(v) => {
              const t = selectedText();
              if (t) updateText(t.id, { size: v });
              else setTextSize(v);
            }}
            onTextAngle={(v) => {
              const t = selectedText();
              if (t) updateText(t.id, { angle: v });
              else setTextAngle(v);
            }}
            onDeleteText={deleteSelectedText}
          />
        </div>
        <div className="order-7 lg:col-start-2">
          <ActionBar
            canSubmit={canSubmit}
            busy={busy}
            status={status}
            pendingUpload={pendingUpload}
            onRequestUpload={handleRequestUpload}
            onConfirmUpload={handleConfirmUpload}
            onCancelUpload={() => setPendingUpload(null)}
            onSaveDraft={handleSaveDraft}
            onDownload={handleDownload}
          />
        </div>
        {shortcutsOpen && (
          <Modal title="快捷键与手势" onClose={() => setShortcutsOpen(false)}>
            <ShortcutsHelp />
          </Modal>
        )}
        {faqOpen && (
          <Modal title="常见问题" onClose={() => setFaqOpen(false)}>
            <Faq />
          </Modal>
        )}
      </div>

      <footer className="mt-10 text-center text-xs text-neutral-400">
        仅供学习测试使用 · 开源地址{" "}
        <a
          href="https://github.com/DiheMoe/heyteago-diy"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-dotted hover:text-neutral-600"
        >
          DiheMoe/heyteago-diy
        </a>{" "}
        · 接口思路参考{" "}
        <a
          href="https://github.com/FuQuan233/HeyTea_AutoUpload"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-dotted hover:text-neutral-600"
        >
          FuQuan233/HeyTea_AutoUpload
        </a>
      </footer>
    </main>
  );
}
