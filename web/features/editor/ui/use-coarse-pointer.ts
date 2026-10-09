import { useSyncExternalStore } from "react";

const COARSE = "(pointer: coarse)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(COARSE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// 主要指针是不是手指（触屏设备）。服务端渲染和水合时按非触屏算，水合后按实际设备更新
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(COARSE).matches,
    () => false,
  );
}
