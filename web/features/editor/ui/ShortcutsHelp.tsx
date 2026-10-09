import { SHORTCUTS } from "./shortcuts";

export function ShortcutsHelp() {
  return (
    <div className="space-y-1.5 text-xs">
        {SHORTCUTS.map(({ keys, desc }) => (
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
