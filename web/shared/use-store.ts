import { useSyncExternalStore } from "react";
import type { ReadableStore } from "./store";

// 订阅 store 的一部分。selector 只能返回 store 里已有的引用或原始值，不能每次新建对象，
// 否则 useSyncExternalStore 会认为状态一直在变
export function useStore<S, T>(store: ReadableStore<S>, selector: (state: S) => T): T {
  const read = () => selector(store.getState());
  return useSyncExternalStore(store.subscribe, read, read);
}
