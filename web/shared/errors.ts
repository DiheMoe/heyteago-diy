// errorText 取异常的提示文案：Error 用其 message，其余情况用 fallback（缺省为异常本身的字符串形式）。
export function errorText(err: unknown, fallback?: string): string {
  return err instanceof Error ? err.message : (fallback ?? String(err));
}
