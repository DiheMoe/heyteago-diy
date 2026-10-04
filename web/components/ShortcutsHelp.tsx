// 快捷键与手势一览（静态内容；新增快捷键时同步维护）。
const ITEMS: Array<[string, string]> = [
  ["Ctrl/⌘+Z · Ctrl/⌘+Shift+Z", "撤销 / 重做"],
  ["B / E", "画笔 / 橡皮擦"],
  ["[ / ]", "调细 / 调粗"],
  ["Shift+点击", "从上一笔终点画直线"],
  ["Ctrl/⌘+滚轮", "缩放画布"],
  ["双指轻点画布", "撤销一笔（触屏）"],
];

export function ShortcutsHelp() {
  return (
    <div className="space-y-1.5 text-xs">
        {ITEMS.map(([keys, desc]) => (
          <div key={keys} className="flex items-center gap-3">
            <kbd className="shrink-0 rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 font-mono text-[11px] text-neutral-700">
              {keys}
            </kbd>
            <span className="text-neutral-500">{desc}</span>
          </div>
        ))}
    </div>
  );
}
