import { memo, useEffect, useRef, useState, useCallback } from 'react';
import type { EditorNode } from './types';
import { NODE_TYPE_MAP } from './nodeTypes';
import { X, Crosshair, Eye } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface NodeProps {
  node: EditorNode;
  selected: boolean;
  active: boolean;
  knownVariables: string[];
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, fields: Record<string, string | number>) => void;
  onPortPointerDown: (e: React.PointerEvent, nodeId: string, port: 'in' | 'out') => void;
  onPortPointerEnter: (nodeId: string, port: 'in' | 'out') => void;
  onPortPointerLeave: () => void;
  onPointerDown: (e: React.PointerEvent, nodeId: string) => void;
  onHeightChange: (id: string, height: number) => void;
  highlightPort: { nodeId: string; port: 'in' | 'out' } | null;
}

function getVariableStatus(value: string, known: Set<string>): 'valid' | 'invalid' | 'none' {
  if (!value.includes('$')) return 'none';
  // Match either `$name` or `$nodeId.outputName`. Hyphens are allowed in the
  // nodeId portion so generated IDs like `node-1749123456-a1b2` work; the
  // `.outputName` suffix is optional but must be present as a whole unit.
  const matches = [
    ...value.matchAll(/\$([a-zA-Z_][a-zA-Z0-9_-]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)/g),
  ];
  if (matches.length === 0) return 'none';
  return matches.every((m) => known.has(m[1])) ? 'valid' : 'invalid';
}

const RGB_TOL_KEYS = new Set(['rTol', 'gTol', 'bTol']);
const COLOR_FIELD_KEY = 'color';

function isValidHex(value: string): boolean {
  return /^#?[0-9a-fA-F]{6}$/.test(value.trim());
}

function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  if (!/^#?[0-9a-fA-F]{6}$/.test(trimmed)) return null;
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

function borderClass(status: 'valid' | 'invalid' | 'none', compact: boolean): string {
  if (status === 'valid') {
    return compact
      ? 'border-green-500/50 focus-within:border-green-500/70'
      : 'border-green-500/50 focus:border-green-500/70';
  }
  if (status === 'invalid') {
    return compact
      ? 'border-red-500/50 focus-within:border-red-500/70'
      : 'border-red-500/50 focus:border-red-500/70';
  }
  return compact
    ? 'border-neutral-800 focus-within:border-neutral-600'
    : 'border-neutral-800 focus:border-neutral-700';
}

// Number fields cannot display $variable references (HTML rejects non-numeric
// input). Switch to text rendering whenever a number field's value contains
// a $ so the variable reference stays visible and editable.
function inputType(fieldType: string, value: string): string {
  if (fieldType === 'number' && value.includes('$')) return 'text';
  return fieldType;
}

export const Node = memo(function Node({
  node,
  selected,
  active,
  knownVariables,
  onSelect,
  onDelete,
  onUpdate,
  onPortPointerDown,
  onPortPointerEnter,
  onPortPointerLeave,
  onPointerDown,
  onHeightChange,
  highlightPort,
}: NodeProps) {
  const meta = NODE_TYPE_MAP[node.type];
  const containerRef = useRef<HTMLDivElement>(null);
  const isPixelScan = node.type === 'pixel-scan';
  const isColorTrigger = node.type === 'color-trigger';
  const isRegionNode = isPixelScan || isColorTrigger;
  const [picking, setPicking] = useState(false);
  const [pickStep, setPickStep] = useState<0 | 1 | 2>(0);
  const [showing, setShowing] = useState(false);

  // Measure height and report upward so connection lines align with the visible ports
  useEffect(() => {
    if (!containerRef.current) return;
    const measure = () => {
      if (containerRef.current) {
        onHeightChange(node.id, containerRef.current.offsetHeight);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [node.id, node.fields, onHeightChange]);

  const cancelPick = useCallback(async () => {
    try {
      await invoke('stop_pixel_pick');
    } catch {}
    setPicking(false);
    setPickStep(0);
  }, []);

  const startPick = useCallback(async () => {
    if (picking) {
      await cancelPick();
      return;
    }
    setPicking(true);
    setPickStep(1);
    try {
      await invoke('start_pixel_pick');
    } catch (err) {
      setPicking(false);
      setPickStep(0);
    }
  }, [picking, cancelPick]);

  const toggleShow = useCallback(async () => {
    if (showing) {
      try {
        await invoke('hide_region_overlay');
      } catch {}
      setShowing(false);
      return;
    }
    const fx = Number(node.fields.fromX);
    const fy = Number(node.fields.fromY);
    const tx = Number(node.fields.toX);
    const ty = Number(node.fields.toY);
    if (!Number.isFinite(fx) || !Number.isFinite(fy) || !Number.isFinite(tx) || !Number.isFinite(ty)) {
      return;
    }
    try {
      await invoke('show_region_overlay', { x1: fx, y1: fy, x2: tx, y2: ty });
      setShowing(true);
    } catch {}
  }, [showing, node.fields]);

  // Listen for pick-pixel events. Only act while picking on this node.
  useEffect(() => {
    if (!picking) return;
    const unlistenPromise = listen<{ x: number; y: number; hex: string; count: number }>(
      'pick-pixel',
      (event) => {
        const { x, y, hex, count } = event.payload;
        if (count === 1) {
          if (isColorTrigger) {
            // Single-pixel trigger: first click sets both pairs and stops.
            onUpdate(node.id, {
              ...node.fields,
              fromX: x,
              fromY: y,
              toX: x,
              toY: y,
              color: hex,
            });
            invoke('stop_pixel_pick').catch(() => {});
            setPicking(false);
            setPickStep(0);
          } else {
            onUpdate(node.id, { ...node.fields, fromX: x, fromY: y, color: hex });
            setPickStep(2);
          }
        } else if (count >= 2) {
          onUpdate(node.id, { ...node.fields, toX: x, toY: y });
          setPicking(false);
          setPickStep(0);
        }
      },
    );
    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [picking, node.id, node.fields, onUpdate, isColorTrigger]);

  // Cleanup hook on unmount
  useEffect(() => {
    return () => {
      if (picking) {
        invoke('stop_pixel_pick').catch(() => {});
      }
      if (showing) {
        invoke('hide_region_overlay').catch(() => {});
      }
    };
  }, [picking, showing]);

  if (!meta) return null;

  const ringClass = active
    ? 'ring-1 ring-amber-400/70 shadow-[0_0_0_3px_rgba(245,158,11,0.15)]'
    : selected
      ? 'ring-1 ring-blue-500/70 shadow-[0_0_0_3px_rgba(59,130,246,0.15)]'
      : 'ring-1 ring-neutral-800';

  return (
    <div
      ref={containerRef}
      data-node-id={node.id}
      onPointerDown={(e) => onPointerDown(e, node.id)}
      className={`absolute w-[210px] select-none rounded-xl bg-neutral-900 ${ringClass} shadow-2xl shadow-black/40 cursor-grab active:cursor-grabbing`}
      style={{ left: node.x, top: node.y, borderTop: `2px solid ${meta.color}` }}
    >
      <div
        data-port="in"
        onPointerDown={(e) => onPortPointerDown(e, node.id, 'in')}
        onPointerEnter={() => onPortPointerEnter(node.id, 'in')}
        onPointerLeave={onPortPointerLeave}
        className={`absolute left-[-6px] top-1/2 -translate-y-1/2 h-3 w-3 rounded-full border-2 border-neutral-900 cursor-crosshair transition-all z-10 ${
          highlightPort?.nodeId === node.id && highlightPort.port === 'in'
            ? 'bg-green-500 shadow-[0_0_8px_2px_rgba(34,197,94,0.6)]'
            : 'bg-neutral-600'
        }`}
      />
      <div
        data-port="out"
        onPointerDown={(e) => onPortPointerDown(e, node.id, 'out')}
        onPointerEnter={() => onPortPointerEnter(node.id, 'out')}
        onPointerLeave={onPortPointerLeave}
        className={`absolute right-[-6px] top-1/2 -translate-y-1/2 h-3 w-3 rounded-full border-2 border-neutral-900 cursor-crosshair transition-all z-10 ${
          highlightPort?.nodeId === node.id && highlightPort.port === 'out'
            ? 'bg-green-500 shadow-[0_0_8px_2px_rgba(34,197,94,0.6)]'
            : 'bg-neutral-600'
        }`}
      />

      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-neutral-800">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-neutral-100 truncate" style={{ color: meta.color }}>
            {meta.label}
          </div>
          <div className="text-[10px] font-mono text-neutral-500 uppercase tracking-wide">
            {meta.type}
          </div>
        </div>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(node.id);
          }}
          className="text-neutral-500 hover:text-red-400 hover:bg-red-500/10 rounded-md p-1 transition-colors"
          title="Delete node"
        >
          <X size={14} />
        </button>
      </div>

      <div className="p-3 flex flex-col gap-2.5">
        {(() => {
          const known = new Set(knownVariables);
          const visible = meta.fields.filter((f) =>
            !f.showWhen || node.fields[f.showWhen.field] === f.showWhen.equals,
          );
          const compactFields = visible.filter((f) => f.compact && !RGB_TOL_KEYS.has(f.key));
          const tolFields = visible.filter((f) => RGB_TOL_KEYS.has(f.key));
          const fullFields = visible.filter((f) => !f.compact);
          return (
            <>
              {compactFields.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {compactFields.map((field) => {
                    const value = String(node.fields[field.key] ?? field.default ?? '');
                    const status = getVariableStatus(value, known);
                    return (
                      <div
                        key={field.key}
                        className={`flex flex-1 items-center gap-1.5 min-w-[68px] rounded-md border bg-neutral-950 px-2 py-1 ${borderClass(status, true)}`}
                      >
                        {field.icon && (
                          <span className="text-[10px] font-bold text-neutral-500 shrink-0 select-none tabular-nums">
                            {field.icon}
                          </span>
                        )}
                        <input
                          type={inputType(field.type, value)}
                          value={value}
                          onChange={(e) =>
                            onUpdate(node.id, {
                              ...node.fields,
                              [field.key]: e.target.value,
                            })
                          }
                          onPointerDown={(e) => e.stopPropagation()}
                          aria-label={field.label}
                          className="bg-transparent outline-none text-[12px] text-neutral-200 w-full min-w-0 tabular-nums"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
              {isRegionNode && (
                <div className="mt-0.5 grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={startPick}
                    className={`flex h-7 items-center justify-center gap-1.5 rounded-md border text-[11px] font-medium transition-colors ${
                      picking
                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15'
                        : 'border-neutral-700 bg-neutral-950 text-neutral-300 hover:border-neutral-600 hover:bg-neutral-900 hover:text-white'
                    }`}
                  >
                    <Crosshair size={12} strokeWidth={2} />
                    {picking
                      ? isColorTrigger
                        ? 'Pick: right-click pixel'
                        : pickStep === 1
                          ? 'Pick 1/2'
                          : 'Pick 2/2'
                      : isColorTrigger
                        ? 'Pick pixel'
                        : 'Pick region'}
                  </button>
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={toggleShow}
                    className={`flex h-7 items-center justify-center gap-1.5 rounded-md border text-[11px] font-medium transition-colors ${
                      showing
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15'
                        : 'border-neutral-700 bg-neutral-950 text-neutral-300 hover:border-neutral-600 hover:bg-neutral-900 hover:text-white'
                    }`}
                  >
                    <Eye size={12} strokeWidth={2} />
                    {showing ? 'Hide region' : 'Show region'}
                  </button>
                </div>
              )}
              {fullFields.map((field) => {
                const value = String(node.fields[field.key] ?? field.default ?? '');
                const status = getVariableStatus(value, known);
                const isColorField = field.key === COLOR_FIELD_KEY;
                const swatchHex = isColorField ? normalizeHex(value) : null;
                return (
                  <div key={field.key} className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
                      {field.label}
                    </label>
                    {field.type === 'select' ? (
                      <select
                        value={value}
                        onChange={(e) => onUpdate(node.id, { ...node.fields, [field.key]: e.target.value })}
                        onPointerDown={(e) => e.stopPropagation()}
                        className={`w-full rounded-md border bg-neutral-950 px-2 py-1 text-[12px] text-neutral-200 outline-none ${borderClass(status, false)}`}
                      >
                        {(field.options ?? []).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : field.type === 'textarea' ? (
                      <textarea
                        value={value}
                        onChange={(e) =>
                          onUpdate(node.id, {
                            ...node.fields,
                            [field.key]: e.target.value,
                          })
                        }
                        onPointerDown={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        onWheel={(e) => e.stopPropagation()}
                        rows={field.rows ?? 8}
                        spellCheck={false}
                        wrap="off"
                        aria-label={field.label}
                        className={`w-full resize-y rounded-md border bg-neutral-950 px-2 py-1 text-[12px] text-neutral-200 outline-none ${field.monospace ? 'font-mono' : ''} ${borderClass(status, false)}`}
                      />
                    ) : (
                      <div
                        className={`flex items-stretch rounded-md border bg-neutral-950 overflow-hidden ${borderClass(status, false)}`}
                      >
                        <input
                          type={inputType(field.type, value)}
                          value={value}
                          onChange={(e) =>
                            onUpdate(node.id, {
                              ...node.fields,
                              [field.key]: e.target.value,
                            })
                          }
                          onPointerDown={(e) => e.stopPropagation()}
                          className="flex-1 min-w-0 bg-transparent px-2 py-1 text-[12px] text-neutral-200 outline-none"
                        />
                        {isColorField && (
                          <div
                            className="relative w-7 shrink-0 border-l border-neutral-800"
                            style={{
                              backgroundColor: swatchHex ?? 'transparent',
                            }}
                            title={swatchHex ?? 'Invalid color'}
                          >
                            {!swatchHex && (
                              <div className="absolute inset-0 flex items-center justify-center text-neutral-600">
                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                                  <line x1="0" y1="14" x2="14" y2="0" stroke="currentColor" strokeWidth="1.5" />
                                </svg>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {tolFields.length > 0 && (
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
                    Tolerance
                  </label>
                  <div className="flex gap-1.5">
                    {tolFields.map((field) => {
                      const value = String(node.fields[field.key] ?? field.default ?? '');
                      const status = getVariableStatus(value, known);
                      const channel = field.key === 'rTol' ? 'R' : field.key === 'gTol' ? 'G' : 'B';
                      return (
                        <div
                          key={field.key}
                          className={`flex flex-1 items-center gap-1 min-w-0 rounded-md border bg-neutral-950 px-1.5 py-1 ${borderClass(status, true)}`}
                        >
                          <span className="text-[10px] font-bold text-neutral-500 shrink-0 select-none">
                            {channel}
                          </span>
                          <input
                            type={inputType(field.type, value)}
                            value={value}
                            onChange={(e) =>
                              onUpdate(node.id, {
                                ...node.fields,
                                [field.key]: e.target.value,
                              })
                            }
                            onPointerDown={(e) => e.stopPropagation()}
                            aria-label={field.label}
                            className="bg-transparent outline-none text-[12px] text-neutral-200 w-full min-w-0 tabular-nums"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
});