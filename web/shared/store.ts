// 最小的外部状态容器：dispatch 同步执行 reducer；状态引用没变就不通知；
// 订阅者在 dispatch 返回前收到通知，画布这类非 React 订阅者因此能和状态同步更新，
// 事件处理和异步回调里用 getState() 读到的也总是最新状态。
// 只读视图：读状态、订阅变化（useStore 只需要这些）
export interface ReadableStore<S> {
  getState(): S;
  subscribe(listener: () => void): () => void;
}

export interface Store<S, A> extends ReadableStore<S> {
  dispatch(action: A): void;
}

export function createStore<S, A>(reducer: (state: S, action: A) => S, initial: S): Store<S, A> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch(action) {
      const next = reducer(state, action);
      if (next === state) return;
      state = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
