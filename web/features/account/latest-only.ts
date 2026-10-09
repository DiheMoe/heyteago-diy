// 只采纳最近一次调用的结果：之后发起了新调用或调用过 invalidate()，旧调用作废——
// 成功的结果返回 null，失败也不再抛出（同样返回 null）。当前调用的失败照常抛出。
// 用于账号验证：token 变化后，迟到的旧结果（无论成败）都不能影响新账号。
export function createLatestOnly() {
  let seq = 0;
  return {
    invalidate() {
      seq++;
    },
    async run<T>(task: () => Promise<T>): Promise<T | null> {
      const mine = ++seq;
      try {
        const result = await task();
        return mine === seq ? result : null;
      } catch (err) {
        if (mine !== seq) return null;
        throw err;
      }
    },
  };
}
