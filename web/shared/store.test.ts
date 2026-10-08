import { describe, expect, it, vi } from "vitest";
import { createStore } from "./store";

type Action = { type: "add"; n: number } | { type: "noop" };
const reducer = (state: { total: number }, action: Action) =>
  action.type === "add" ? { total: state.total + action.n } : state;

describe("createStore", () => {
  it("dispatch 同步生效，订阅者在 dispatch 返回前收到通知", () => {
    const store = createStore(reducer, { total: 0 });
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.getState().total));
    store.dispatch({ type: "add", n: 2 });
    expect(seen).toEqual([2]);
    expect(store.getState()).toEqual({ total: 2 });
  });

  it("reducer 返回同一个状态时不通知", () => {
    const store = createStore(reducer, { total: 0 });
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch({ type: "noop" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("退订后不再通知", () => {
    const store = createStore(reducer, { total: 0 });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.dispatch({ type: "add", n: 1 });
    expect(listener).not.toHaveBeenCalled();
  });
});
