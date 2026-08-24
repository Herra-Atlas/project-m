import { useState, useEffect, useMemo, useRef } from 'react';
import { NodePalette } from './NodePalette';
import { EditorCanvas } from './EditorCanvas';
import { SaveMacroModal } from './SaveMacroModal';
import { LogsPanel } from '../LogsPanel';
import { NodeInspector, type NodeOutputValue } from './NodeInspector';
import type { EditorNode, Connection, Macro } from './types';
import { NODE_TYPE_MAP } from './nodeTypes';
import { Save, Download, Upload, Play, Square, ChevronLeft, ChevronDown, Trash2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useError } from '../ErrorProvider';

const NODE_WIDTH = 210;

function estimateNodeHeight(nodeType: string): number {
  const meta = NODE_TYPE_MAP[nodeType];
  const HEADER_H = 45;
  const BODY_PAD = 24;
  const FIELD_H = 44;
  const GAP_H = 10;
  const BORDER = 2;
  const fieldCount = meta?.fields.length ?? 0;
  return BORDER + HEADER_H + BODY_PAD + fieldCount * FIELD_H + Math.max(0, fieldCount - 1) * GAP_H;
}

interface EditorPageProps {
  initialNodes?: EditorNode[];
  initialConnections?: Connection[];
  onSave: (macro: Omit<Macro, 'id'>) => void;
  onExit: () => void;
  macroToEdit?: { id: string; title: string; description: string } | null;
  onUpdateMacro?: (id: string, data: Omit<Macro, 'id'>) => void;
  onDeleteMacro?: (id: string) => void;
  onStartRun?: (data: { nodes: EditorNode[]; connections: Connection[] }) => void | Promise<void>;
  onStopRun?: () => void | Promise<void>;
  isRunning?: boolean;
  logs?: { message: string; timestamp: number; nodeId?: string }[];
  onClearLogs?: () => void;
}

export function EditorPage({
  initialNodes = [],
  initialConnections = [],
  onSave,
  onExit,
  macroToEdit,
  onUpdateMacro,
  onDeleteMacro,
  onStartRun,
  onStopRun,
  isRunning: isRunningProp = false,
  logs = [],
  onClearLogs,
}: EditorPageProps) {
  const { showError } = useError();
  const [nodes, setNodes] = useState<EditorNode[]>(initialNodes);
  const [connections, setConnections] = useState<Connection[]>(initialConnections);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const isRunning = isRunningProp;

  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [liveOutputs, setLiveOutputs] = useState<Record<string, NodeOutputValue>>({});

  // Close actions dropdown on outside click
  useEffect(() => {
    if (!actionsOpen) return;
    const handler = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [actionsOpen]);

  // Listen for active node events from the engine
  useEffect(() => {
    const unlistenExec = listen<{ nodeId: string }>('node-executing', (event) => {
      setActiveNodeId(event.payload.nodeId);
    });
    const unlistenFinish = listen('macro-finished', () => {
      setActiveNodeId(null);
      setLiveOutputs({});
    });
    const unlistenOutputs = listen<{ nodeId: string; outputs: [string, NodeOutputValue][] }>(
      'node-outputs',
      (event) => {
        const map: Record<string, NodeOutputValue> = {};
        for (const [name, value] of event.payload.outputs) {
          map[name] = value as NodeOutputValue;
        }
        setLiveOutputs(map);
      },
    );
    return () => {
      unlistenExec.then((fn) => fn());
      unlistenFinish.then((fn) => fn());
      unlistenOutputs.then((fn) => fn());
    };
  }, []);

  const knownVariables = useMemo(() => {
    const names: string[] = [];
    for (const n of nodes) {
      if (n.type === 'variable') {
        const name = String(n.fields.name ?? '').trim();
        if (name) names.push(name);
        continue;
      }
      if (n.type === 'pixel-scan') {
        for (const key of ['firstMatchXVar', 'firstMatchYVar', 'resultVar', 'centerOnXVar', 'centerOnYVar']) {
          const v = String(n.fields[key] ?? '').trim();
          if (v) names.push(v);
        }
      }
      // Every node's outputs are reachable as $nodeId.outputName so the log
      // node can disambiguate "this specific node's status" vs "any status".
      const meta = NODE_TYPE_MAP[n.type];
      if (meta?.outputs) {
        for (const o of meta.outputs) {
          names.push(`${n.id}.${o.name}`);
        }
      }
    }
    return names;
  }, [nodes]);

  const onAddNode = (type: string, x: number, y: number) => {
    const meta = NODE_TYPE_MAP[type];
    if (!meta) return;
    const id = `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const fields: Record<string, string | number> = {};
    meta.fields.forEach((f) => {
      fields[f.key] = String(f.default ?? '');
    });
    setNodes((prev) => [...prev, { id, type, x, y, fields }]);
  };

  const onPaletteSelect = (type: string) => {
    const x = Math.round(200 + Math.random() * 200);
    const y = Math.round(150 + Math.random() * 150);
    onAddNode(type, x, y);
  };

  const handleSave = (title: string, description: string) => {
    const data = { nodes, connections };
    if (macroToEdit && onUpdateMacro) {
      onUpdateMacro(macroToEdit.id, { ...data, title, description });
    } else {
      onSave({ ...data, title, description });
    }
    setSaveOpen(false);
  };

  const handleDelete = () => {
    setActionsOpen(false);
    if (!macroToEdit || !onDeleteMacro) return;
    if (confirm(`Delete macro "${macroToEdit.title}"?`)) {
      onDeleteMacro(macroToEdit.id);
    }
  };

  const handleExport = () => {
    const data = {
      nodes: nodes.map((n) => ({ id: n.id, type: n.type, x: n.x, y: n.y, fields: n.fields })),
      connections,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'macro.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(String(ev.target?.result));
          if (!data.nodes || !Array.isArray(data.nodes)) {
            showError('Invalid macro file: missing nodes array');
            return;
          }
          setNodes(
            data.nodes.map((n: any) => ({
              id: n.id,
              type: n.type,
              x: n.x,
              y: n.y,
              fields: n.fields || {},
            })),
          );
          setConnections(data.connections || []);
        } catch (err) {
          showError(`Failed to import: ${err}`);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleToggleRun = async () => {
    if (isRunning) {
      if (onStopRun) {
        await onStopRun();
      } else {
        try {
          await invoke('stop_macro');
        } catch (err) {
          showError(`Failed to stop macro: ${err}`);
        }
      }
      setActiveNodeId(null);
      return;
    }

    if (nodes.length === 0) return;

    if (onStartRun) {
      await onStartRun({ nodes, connections });
    } else {
      try {
        await invoke('run_macro', {
          data: {
            nodes: nodes.map((n) => ({
              id: n.id,
              type: n.type,
              x: Math.round(n.x),
              y: Math.round(n.y),
              fields: n.fields,
            })),
            connections,
          },
        });
      } catch (err) {
        showError(`Failed to run macro: ${err}`);
        return;
      }
    }
  };

  return (
    <div className="flex h-full flex-col bg-neutral-950">
      <header className="flex h-14 items-center justify-between gap-3 border-b border-neutral-800/60 bg-neutral-950/60 px-5 backdrop-blur-sm relative z-50">
        <div className="flex items-center gap-3">
          <button
            onClick={onExit}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors"
            title="Back to Macros"
          >
            <ChevronLeft size={16} />
          </button>
          <div>
            <div className="text-sm font-semibold text-neutral-100">
              {macroToEdit ? macroToEdit.title : 'New Macro'}
            </div>
            <div className="text-[11px] text-neutral-500">
              {nodes.length} nodes · {connections.length} connections
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div ref={actionsRef} className="relative flex items-stretch">
            <button
              onClick={() => setSaveOpen(true)}
              disabled={nodes.length === 0}
              className="h-9 px-3 flex items-center gap-1.5 rounded-l-lg border border-r-0 border-neutral-800 text-neutral-300 hover:bg-neutral-800 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors"
            >
              <Save size={14} />
              Save
            </button>
            <button
              onClick={() => setActionsOpen(!actionsOpen)}
              className="h-9 px-2 flex items-center rounded-r-lg border border-neutral-800 text-neutral-300 hover:bg-neutral-800 hover:text-white text-sm font-medium transition-colors"
              title="More actions"
            >
              <ChevronDown size={14} className={`transition-transform ${actionsOpen ? 'rotate-180' : ''}`} />
            </button>
            {actionsOpen && (
              <div className="absolute right-0 top-full mt-2 w-48 overflow-hidden rounded-lg border border-neutral-700/50 bg-neutral-900/95 shadow-2xl shadow-black/40 backdrop-blur-md z-50">
                <button
                  onClick={() => {
                    setActionsOpen(false);
                    handleImport();
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800/70"
                >
                  <Upload size={14} className="text-neutral-500" />
                  Import from file
                </button>
                <div className="mx-3 border-t border-neutral-800" />
                <button
                  onClick={() => {
                    setActionsOpen(false);
                    handleExport();
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800/70"
                >
                  <Download size={14} className="text-neutral-500" />
                  Export to file
                </button>
                {macroToEdit && onDeleteMacro && (
                  <>
                    <div className="mx-3 border-t border-neutral-800" />
                    <button
                      onClick={handleDelete}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-red-400 transition-colors hover:bg-red-500/10"
                    >
                      <Trash2 size={14} />
                      Delete macro
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="h-6 w-px bg-neutral-800" />

          <button
            onClick={handleToggleRun}
            disabled={nodes.length === 0}
            className={`h-9 px-3 flex items-center gap-1.5 rounded-lg border text-sm font-medium transition-colors ${
              isRunning
                ? 'border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/15'
                : 'border-neutral-800 text-neutral-300 hover:bg-neutral-800 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
            title={isRunning ? 'Stop macro' : 'Run macro'}
          >
            {isRunning ? <Square size={14} /> : <Play size={14} />}
            {isRunning ? 'Stop' : 'Start'}
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <NodePalette onSelect={onPaletteSelect} />
        <EditorCanvas
          nodes={nodes}
          connections={connections}
          selectedNodeId={selectedNodeId}
          activeNodeId={activeNodeId}
          knownVariables={knownVariables}
          onNodesChange={setNodes}
          onConnectionsChange={setConnections}
          onSelectNode={setSelectedNodeId}
          onAddNode={onAddNode}
        />
      </div>

      <LogsPanel
        open={isRunning}
        logs={logs}
        onClear={() => onClearLogs?.()}
        onStop={onStopRun}
      />

      {(() => {
        const selected = selectedNodeId
          ? nodes.find((n) => n.id === selectedNodeId)
          : null;
        const meta = selected ? NODE_TYPE_MAP[selected.type] : null;
        return (
          <NodeInspector
            open={!!selected}
            nodeId={selected?.id ?? null}
            nodeType={selected?.type ?? null}
            nodeLabel={meta?.label ?? null}
            outputs={meta?.outputs ?? []}
            liveOutputs={liveOutputs}
            onClose={() => setSelectedNodeId(null)}
          />
        );
      })()}

      <SaveMacroModal
        open={saveOpen}
        initialTitle={macroToEdit?.title}
        initialDescription={macroToEdit?.description}
        onClose={() => setSaveOpen(false)}
        onConfirm={handleSave}
      />
    </div>
  );
}