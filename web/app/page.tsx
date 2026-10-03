"use client";

import { useEffect, useRef, useState } from "react";
import { saveDraft, uploadSticker, type User } from "@/lib/api";
import { exportEditedCanvas, readFileAsImage, renderSticker } from "@/lib/canvas/render";
import { CUP_HEIGHT, CUP_WIDTH, DEFAULT_BACKGROUND } from "@/lib/canvas/constants";
import { sha1Hex } from "@/lib/dup-guard";
import { ActionBar, type Status } from "@/components/ActionBar";
import { BackgroundControls, type BackgroundSettings } from "@/components/BackgroundControls";
import { BrushControls } from "@/components/BrushControls";
import { Faq } from "@/components/Faq";
import { ImagePicker } from "@/components/ImagePicker";
import { PreviewCanvas, type Tool } from "@/components/PreviewCanvas";
import { TokenPanel } from "@/components/TokenPanel";
import { ToneControls, type ToneSettings } from "@/components/ToneControls";

const UNDO_LIMIT = 20;
const TOKEN_STORAGE_KEY = "heyteago-diy:token";

// 待确认的直接上传：导出与查重在点击「上传杯贴」时完成，确认态只发请求。
// 任何会改变画布的操作（换图/调参/画笔）都会使它失效。
interface PendingUpload {
  blob: Blob;
  hash: string;
  duplicate: boolean;
}

export default function Page() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // 撤销栈存 ImageData 快照（每笔一个，上限 UNDO_LIMIT）
  const undoStack = useRef<ImageData[]>([]);
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
  const [brushColor, setBrushColor] = useState("#000000");
  const [brushSize, setBrushSize] = useState(12);
  const [ready, setReady] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [busy, setBusy] = useState<"render" | "upload" | "draft" | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
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
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : "图片读取失败" });
    }
  };

  const applyTone = (next: ToneSettings) => {
    setTone(next);
    setPendingUpload(null);
    if (image) markRendering();
  };

  const applyBg = (next: BackgroundSettings) => {
    setBg(next);
    setPendingUpload(null);
    if (image) markRendering();
  };

  // 原图或参数变化 → 重新渲染并覆盖画布（画笔修改随之清空）
  useEffect(() => {
    if (!image) return;
    const seq = ++renderSeq.current;
    renderSticker(image, {
      ...tone,
      background: bg.enabled ? bg.color : null,
      whiteTolerance: bg.tolerance,
    })
      .then(async (blob) => {
        if (seq !== renderSeq.current) return;
        const bitmap = await createImageBitmap(blob);
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx || seq !== renderSeq.current) return;
        ctx.clearRect(0, 0, CUP_WIDTH, CUP_HEIGHT);
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        undoStack.current = [];
        setCanUndo(false);
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
  }, [image, tone, bg]);

  const pushUndoSnapshot = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    // 画笔改变画布内容，已导出的待确认上传随之失效
    setPendingUpload(null);
    undoStack.current.push(ctx.getImageData(0, 0, CUP_WIDTH, CUP_HEIGHT));
    if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
    setCanUndo(true);
  };

  const undo = () => {
    const snapshot = undoStack.current.pop();
    const ctx = canvasRef.current?.getContext("2d");
    if (!snapshot || !ctx) return;
    setPendingUpload(null);
    ctx.putImageData(snapshot, 0, 0);
    setCanUndo(undoStack.current.length > 0);
  };

  const exportCurrent = () => {
    const canvas = canvasRef.current;
    if (!canvas) throw new Error("画布不可用");
    // 橡皮擦抠出的透明孔洞始终合成回杯贴底色 #EEEEEE，避免导出后发白
    return exportEditedCanvas(canvas, bg.enabled ? bg.color : DEFAULT_BACKGROUND);
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
      setPendingUpload({ blob, hash, duplicate: hash === lastUploadHash.current });
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
      const blob = await exportCurrent();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = blob.type === "image/jpeg" ? "cup.jpg" : "cup.png";
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

      {/* 桌面端：预览左列吸附，操作右列；移动端：选图 → 预览 → 参数 → 操作 */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="order-3 lg:col-start-1 lg:row-start-1 lg:row-span-7 lg:self-start lg:sticky lg:top-4">
          <PreviewCanvas
            canvasRef={canvasRef}
            ready={ready}
            tool={tool}
            brushColor={brushColor}
            brushSize={brushSize}
            onStrokeStart={pushUndoSnapshot}
          />
        </div>
        <div className="order-1 lg:col-start-2">
          <TokenPanel
            token={token}
            remember={remember}
            user={user}
            busy={busy !== null}
            onTokenChange={handleTokenChange}
            onUserChange={setUser}
          />
        </div>
        <div className="order-2 lg:col-start-2">
          <ImagePicker fileName={imageName} onPick={handlePick} onError={(text) => setStatus({ kind: "error", text })} />
        </div>
        <div className="order-4 lg:col-start-2">
          <ToneControls value={tone} onChange={applyTone} />
        </div>
        <div className="order-5 lg:col-start-2">
          <BackgroundControls value={bg} onChange={applyBg} />
        </div>
        <div className="order-6 lg:col-start-2">
          <BrushControls
            tool={tool}
            color={brushColor}
            size={brushSize}
            canUndo={canUndo}
            onToolChange={setTool}
            onColorChange={setBrushColor}
            onSizeChange={setBrushSize}
            onUndo={undo}
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
        <div className="order-8 lg:col-start-2">
          <Faq />
        </div>
      </div>

      <footer className="mt-10 text-center text-xs text-neutral-400">
        仅供学习测试使用 · 接口思路参考{" "}
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
