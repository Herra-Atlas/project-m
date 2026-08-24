import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Info, X, ChevronDown, ChevronUp } from 'lucide-react';
import type { NodeOutput } from './types';
import { NODE_TYPE_MAP } from './nodeTypes';

export type NodeOutputValue = string | number | boolean | null;

interface NodeInspectorProps {
  open: boolean;
  nodeId: string | null;
  nodeType: string | null;
  nodeLabel: string | null;
  outputs: NodeOutput[];
  liveOutputs: Record<string, NodeOutputValue>;
  onClose: () => void;
}

export function NodeInspector({
  open,
  nodeId,
  nodeType,
  nodeLabel,
  outputs,
  liveOutputs,
  onClose,
}: NodeInspectorProps) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (open) setCollapsed(false);
  }, [open, nodeId]);

  if (!open || !nodeId || !nodeType) return null;

  const meta = NODE_TYPE_MAP[nodeType];
  const prefix = `${nodeId}.`;
  const scoped: Record<string, NodeOutputValue> = {};
  for (const [key, value] of Object.entries(liveOutputs)) {
    if (key.startsWith(prefix)) {
      scoped[key.slice(prefix.length)] = value;
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 flex flex-col border-t border-neutral-800 bg-neutral-950/95 shadow-[0_-8px_24px_-8px_rgba(0,0,0,0.5)] backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2 border-b border-neutral-800 px-4 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <Info size={13} className="text-blue-400 shrink-0" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-300 shrink-0">
            Inspector
          </span>
          <span
            className="text-[12px] font-semibold truncate"
            style={{ color: meta?.color ?? '#a3a3a3' }}
          >
            {nodeLabel ?? nodeType}
          </span>
          <span className="text-[10px] font-mono text-neutral-600 shrink-0">
            {nodeType}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="h-6 px-2 flex items-center gap-1.5 rounded-md text-[11px] text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            {collapsed ? 'Show' : 'Hide'}
          </button>
          <button
            onClick={onClose}
            className="h-6 w-6 flex items-center justify-center rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
            title="Close inspector"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {outputs.length === 0 ? (
            <div className="text-[12px] text-neutral-600 italic">
              This node produces no outputs.
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {outputs.map((out) => {
                const live = scoped[out.name];
                const hasLive = live !== undefined && live !== null;
                return (
                  <div
                    key={out.name}
                    className="flex flex-col gap-1 rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono text-[12px] font-semibold text-blue-300 truncate">
                          ${nodeId}.{out.name}
                        </span>
                        <span className="text-[9px] font-mono uppercase tracking-wider text-neutral-600 shrink-0">
                          {out.type}
                        </span>
                      </div>
                      <span
                        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                          hasLive ? 'bg-green-500' : 'bg-neutral-700'
                        }`}
                        title={hasLive ? 'Value received' : 'No value yet'}
                      />
                    </div>
                    <div
                      className={`font-mono text-[12px] break-all ${
                        hasLive ? 'text-neutral-100' : 'text-neutral-600 italic'
                      }`}
                    >
                      {hasLive ? formatValue(live) : '—'}
                    </div>
                    <div className="text-[10px] text-neutral-500 leading-snug">
                      {out.description}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatValue(v: NodeOutputValue): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}