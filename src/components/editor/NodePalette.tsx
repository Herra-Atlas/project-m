import { useState, useEffect } from 'react';
import { getNodeGroups } from './nodeTypes';
import type { NodeTypeMeta } from './types';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../cn';

interface NodePaletteProps {
  onSelect: (type: string) => void;
}

const DEFAULT_OPEN: Record<string, boolean> = {
  Start: true,
  If: false,
  Keyboard: false,
  Mouse: false,
  Tools: false,
};

const STORAGE_KEY = 'project-m:palette-open';

function loadOpen(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_OPEN, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_OPEN;
}

export function NodePalette({ onSelect }: NodePaletteProps) {
  const groups = getNodeGroups();
  const [open, setOpen] = useState<Record<string, boolean>>(loadOpen);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(open));
    } catch {}
  }, [open]);

  const toggle = (group: string) => setOpen((prev) => ({ ...prev, [group]: !prev[group] }));

  return (
    <aside className="palette-scroll flex flex-col overflow-y-auto border-r border-neutral-800/60 bg-neutral-950/40 p-3 w-60 shrink-0">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-500 px-1 pb-3">
        Node Palette
      </div>
      {Object.entries(groups).map(([group, nodes]) => {
        const isOpen = open[group] ?? true;
        return (
          <div key={group} className="flex flex-col">
            <button
              onClick={() => toggle(group)}
              className="flex items-center justify-between gap-1 px-1 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                {group}
                <span className="text-neutral-600 font-normal">({nodes.length})</span>
              </span>
            </button>
            {isOpen && (
              <div className="flex flex-col gap-1.5 pb-3">
                {nodes.map((node) => (
                  <PaletteItem key={node.type} node={node} onClick={() => onSelect(node.type)} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </aside>
  );
}

function PaletteItem({ node, onClick }: { node: NodeTypeMeta; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex flex-col gap-0.5 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-left transition-all',
        'hover:bg-neutral-800/80 hover:border-neutral-700 hover:shadow-lg hover:shadow-black/30',
      )}
      style={{ borderLeftWidth: '2px', borderLeftColor: node.color }}
    >
      <span className="text-[12px] font-semibold text-neutral-100">{node.label}</span>
      <span className="text-[11px] text-neutral-500 leading-tight">{node.description}</span>
    </button>
  );
}