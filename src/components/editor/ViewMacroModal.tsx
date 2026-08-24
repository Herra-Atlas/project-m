import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Trash2, Variable, Lock, Check, Sparkles } from 'lucide-react';
import type { EditorNode, Macro } from './types';
import {
  MACRO_ICON_OPTIONS,
  MACRO_ICON_MAP,
  AUTO_ICON_KEY,
  detectMacroIcon,
  type MacroIconKey,
} from '../macroIcons';

interface ViewMacroModalProps {
  open: boolean;
  macro: Macro;
  onClose: () => void;
  onSave: (updated: Macro) => void;
}

interface VariableRow {
  rowId: string;
  nodeId: string | null;
  name: string;
  value: string;
}

function makeRowId(): string {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function ViewMacroModal({ open, macro, onClose, onSave }: ViewMacroModalProps) {
  const [title, setTitle] = useState(macro.title);
  const [description, setDescription] = useState(macro.description);
  const [variables, setVariables] = useState<VariableRow[]>([]);
  const [icon, setIcon] = useState<MacroIconKey | typeof AUTO_ICON_KEY>(AUTO_ICON_KEY);
  const [madeByAi, setMadeByAi] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(macro.title);
    setDescription(macro.description);
    setVariables(
      macro.nodes
        .filter((n) => n.type === 'variable')
        .map((n) => ({
          rowId: makeRowId(),
          nodeId: n.id,
          name: String(n.fields.name ?? ''),
          value: String(n.fields.value ?? ''),
        })),
    );
    setIcon((macro.icon as MacroIconKey) ?? AUTO_ICON_KEY);
    setMadeByAi(macro.madeByAi ?? false);
  }, [open, macro.id]);

  const addVariable = () => {
    setVariables((prev) => [...prev, { rowId: makeRowId(), nodeId: null, name: '', value: '' }]);
  };

  const updateRow = (rowId: string, patch: Partial<VariableRow>) => {
    setVariables((prev) => prev.map((v) => (v.rowId === rowId ? { ...v, ...patch } : v)));
  };

  const removeRow = (rowId: string) => {
    setVariables((prev) => prev.filter((v) => v.rowId !== rowId));
  };

  const handleApply = () => {
    const nonVariableNodes = macro.nodes.filter((n) => n.type !== 'variable');
    const variableNodes: EditorNode[] = variables
      .filter((v) => v.name.trim())
      .map((v, i) => {
        if (v.nodeId) {
          const existing = macro.nodes.find((n) => n.id === v.nodeId);
          if (existing) {
            return { ...existing, fields: { name: v.name, value: v.value } };
          }
        }
        return {
          id: `var-${Date.now()}-${i}`,
          type: 'variable',
          x: 200 + i * 30,
          y: 200,
          fields: { name: v.name, value: v.value },
        };
      });

    const updated: Macro = {
      ...macro,
      title,
      description,
      nodes: [...nonVariableNodes, ...variableNodes],
    };
    if (icon === AUTO_ICON_KEY) {
      delete updated.icon;
    } else {
      updated.icon = icon;
    }
    if (madeByAi) {
      updated.madeByAi = true;
    } else {
      delete updated.madeByAi;
    }
    onSave(updated);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Macro details"
      description="Edit title, description, and variables. Use $name in any node field to reference a variable."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleApply}>
            Apply changes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
              Title
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-200 outline-none focus:border-neutral-600"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
              Description
            </span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-200 outline-none focus:border-neutral-600"
            />
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
            Icon
          </span>
          <div className="grid grid-cols-[repeat(11,minmax(0,1fr))] gap-1">
            <button
              onClick={() => setIcon(AUTO_ICON_KEY)}
              className={`relative h-9 flex items-center justify-center rounded-md border transition-colors ${
                icon === AUTO_ICON_KEY
                  ? 'border-neutral-500 bg-neutral-800 text-white'
                  : 'border-neutral-800 bg-neutral-950 text-neutral-500 hover:border-neutral-700 hover:text-neutral-200'
              }`}
              title={`Auto (${detectMacroIcon(macro)})`}
            >
              {(() => {
                const AutoIcon = MACRO_ICON_MAP[detectMacroIcon(macro)];
                return <AutoIcon size={15} strokeWidth={1.75} />;
              })()}
              {icon === AUTO_ICON_KEY && (
                <Check size={9} className="absolute right-1 top-1 text-green-400" />
              )}
            </button>
            {MACRO_ICON_OPTIONS.map(({ key, Icon }) => (
              <button
                key={key}
                onClick={() => setIcon(key)}
                className={`relative h-9 flex items-center justify-center rounded-md border transition-colors ${
                  icon === key
                    ? 'border-neutral-500 bg-neutral-800 text-white'
                    : 'border-neutral-800 bg-neutral-950 text-neutral-500 hover:border-neutral-700 hover:text-neutral-200'
                }`}
                title={key}
              >
                <Icon size={15} strokeWidth={1.75} />
                {icon === key && (
                  <Check size={9} className="absolute right-1 top-1 text-green-400" />
                )}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-3 cursor-pointer select-none">
          <span
            className={`relative inline-block h-5 w-9 rounded-full transition-colors ${
              madeByAi ? 'bg-neutral-500' : 'bg-neutral-800'
            }`}
            onClick={() => setMadeByAi((v) => !v)}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-neutral-200 transition-transform ${
                madeByAi ? 'translate-x-4' : ''
              }`}
            />
          </span>
          <span className="flex items-center gap-1.5 text-[12px] text-neutral-300">
            <Sparkles size={13} className={madeByAi ? 'text-neutral-300' : 'text-neutral-600'} />
            Created with AI
          </span>
        </label>

        <div className="flex items-center gap-2">
          <Variable size={14} className="text-lime-400" />
          <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
            Variables
          </span>
          <span className="text-[10px] text-neutral-600 font-mono">
            {variables.length}
          </span>
        </div>

        {variables.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-800 bg-neutral-950/40 px-4 py-6 text-center">
            <p className="text-[12px] text-neutral-500">
              No variables yet. Add one to use it in other nodes with{' '}
              <code className="rounded bg-neutral-900 px-1.5 py-0.5 font-mono text-neutral-300">
                $name
              </code>
              .
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-neutral-800 overflow-hidden">
            <div className="grid grid-cols-[1fr_1.5fr_auto] gap-0 border-b border-neutral-800 bg-neutral-950/60 px-3 py-2 text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
              <span>Name</span>
              <span>Value</span>
              <span className="w-7" />
            </div>
            {variables.map((v) => (
              <div
                key={v.rowId}
                className="grid grid-cols-[1fr_1.5fr_auto] items-center gap-2 border-b border-neutral-800/60 last:border-b-0 px-3 py-2"
              >
                {v.nodeId ? (
                  <div className="flex items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-950/60 px-2 py-1 font-mono text-[12px] text-neutral-400">
                    <Lock size={10} className="text-neutral-600" />
                    <span className="truncate">{v.name || <span className="italic text-neutral-600">unnamed</span>}</span>
                  </div>
                ) : (
                  <input
                    value={v.name}
                    onChange={(e) => updateRow(v.rowId, { name: e.target.value })}
                    placeholder="counter"
                    className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 font-mono text-[12px] text-neutral-200 outline-none focus:border-neutral-600"
                  />
                )}
                <input
                  value={v.value}
                  onChange={(e) => updateRow(v.rowId, { value: e.target.value })}
                  placeholder="0"
                  className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-[12px] text-neutral-200 outline-none focus:border-neutral-600"
                />
                <button
                  onClick={() => removeRow(v.rowId)}
                  className="h-7 w-7 flex items-center justify-center rounded-md text-neutral-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Remove variable"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-4 text-[11px] text-neutral-500">
          <span>
            Nodes: <strong className="font-mono text-neutral-300">{macro.nodes.length}</strong>
          </span>
          <span>
            Connections:{' '}
            <strong className="font-mono text-neutral-300">{macro.connections.length}</strong>
          </span>
        </div>
      </div>
    </Modal>
  );
}