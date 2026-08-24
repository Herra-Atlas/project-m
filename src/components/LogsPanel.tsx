import { useEffect, useRef } from 'react';
import { Terminal, Trash2, X, Square } from 'lucide-react';

interface LogsPanelProps {
  open: boolean;
  logs: { message: string; timestamp: number; nodeId?: string }[];
  onClear: () => void;
  onStop?: () => void;
}

export function LogsPanel({ open, logs, onClear, onStop }: LogsPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs]);

  if (!open) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 h-[28vh] min-h-[180px] flex flex-col border-t border-neutral-800 bg-neutral-950/95 shadow-[0_-8px_24px_-8px_rgba(0,0,0,0.5)] backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2 border-b border-neutral-800 px-4 py-2">
        <div className="flex items-center gap-2">
          <Terminal size={13} className="text-green-400" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-300">
            Logs
          </span>
          <span className="text-[10px] font-mono text-neutral-600 tabular-nums">
            {logs.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onClear}
            disabled={logs.length === 0}
            className="h-6 px-2 flex items-center gap-1.5 rounded-md text-[11px] text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Clear logs"
          >
            <Trash2 size={11} />
            Clear
          </button>
          {onStop && (
            <button
              onClick={onStop}
              className="h-6 px-2 flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 text-[11px] font-medium text-red-400 hover:bg-red-500/15 transition-colors"
              title="Stop macro"
            >
              <Square size={10} />
              Stop
            </button>
          )}
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 font-mono text-[11px] leading-relaxed">
        {logs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-neutral-600">
            Waiting for log events…
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {logs.map((log, i) => (
              <div key={i} className="flex items-start gap-2 text-neutral-300">
                <span className="shrink-0 text-neutral-600 tabular-nums">
                  {formatTime(log.timestamp)}
                </span>
                <span className="break-all whitespace-pre-wrap">{log.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}