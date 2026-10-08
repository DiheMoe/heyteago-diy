// 自动保存：画布有值得保留的内容时，编辑停下约 0.5 秒（或页面切到后台时）把文档写进本机；
// 没有内容（空白画布、全新开始）时删掉记录。打开页面时若找到上次的编辑，先由用户决定恢复或丢弃，
// 决定之前暂停自动保存，免得覆盖它。IndexedDB 不可用（如部分隐私模式）时自动保存静默失效。
import { useEffect, useRef, useState } from "react";
import { decodeImage, imageSource } from "@/features/editor/canvas/image-source";
import { hasContent, type EditorState, type EditorStore } from "@/features/editor/model/document";
import { isBlankText } from "@/features/editor/model/text";
import { deleteSaved, readSaved, writeSaved } from "./draft-db";
import { parseSavedDraft, serializeDraft, type SavedDraft } from "./saved-draft";

const SAVE_DELAY_MS = 500;

export interface Autosave {
  // 打开页面时找到、还没决定恢复或丢弃的上次编辑的保存时间；没有为 null
  savedAt: number | null;
  restore(): Promise<void>;
  discard(): void;
}

function toRecord(s: EditorState): SavedDraft {
  const { image, imageName, tone, view, strokes, texts } = s.doc;
  return {
    savedAt: Date.now(),
    image: imageSource(image!),
    imageName: imageName!,
    tone,
    view,
    strokes,
    // 正在输入、还没有内容的文字不存
    texts: texts.filter((t) => !isBlankText(t)),
  };
}

// onError 收到整理好的错误文案（上次的编辑损坏、无法恢复）
export function useAutosave(store: EditorStore, onError: (text: string) => void): Autosave {
  const [found, setFound] = useState<SavedDraft | null>(null);
  const paused = useRef(true);
  // 写入排队执行，后一次一定覆盖前一次
  const writes = useRef<Promise<unknown>>(Promise.resolve());

  const persist = (s: EditorState) => {
    const task = hasContent(s) ? async () => writeSaved(await serializeDraft(toRecord(s))) : deleteSaved;
    writes.current = writes.current.then(task).catch(() => {
      // 本机存不了（隐私模式、空间不足等）时不影响编辑
    });
  };

  useEffect(() => {
    let cancelled = false;
    readSaved()
      .then((raw) => {
        if (cancelled) return;
        const draft = parseSavedDraft(raw);
        if (draft) {
          setFound(draft);
          return;
        }
        if (raw !== undefined) void deleteSaved().catch(() => {});
        paused.current = false;
      })
      .catch(() => {
        paused.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let doc = store.getState().doc;
    const flush = () => {
      timer = null;
      if (!paused.current) persist(store.getState());
    };
    const unsubscribe = store.subscribe(() => {
      const next = store.getState().doc;
      if (next === doc) return;
      doc = next;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DELAY_MS);
    });
    const onHide = () => {
      if (document.visibilityState !== "hidden" || !timer) return;
      clearTimeout(timer);
      flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onHide);
      if (timer) clearTimeout(timer);
    };
  }, [store]);

  const resume = () => {
    setFound(null);
    paused.current = false;
  };

  return {
    savedAt: found?.savedAt ?? null,
    async restore() {
      if (!found) return;
      try {
        const image = await decodeImage(found.image);
        const { imageName, tone, view, strokes, texts } = found;
        store.dispatch({ type: "restore", doc: { image, imageName, tone, view, strokes, texts } });
      } catch {
        onError("上次的编辑已损坏，无法恢复");
        void deleteSaved().catch(() => {});
      }
      resume();
    },
    discard() {
      resume();
      persist(store.getState());
    },
  };
}
