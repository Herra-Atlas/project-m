import {
  Mouse,
  Keyboard,
  Workflow,
  Gamepad2,
  Timer,
  Folder,
  Sparkles,
  Wrench,
  Zap,
  CircleDot,
  type LucideIcon,
} from 'lucide-react';
import type { Macro } from './editor/types';

export const MOUSE_NODE_TYPES = new Set([
  'mouse-move',
  'mouse-click',
  'mouse-drag',
  'mouse-hold-sweep',
]);

export const KEYBOARD_NODE_TYPES = new Set([
  'key-press',
  'key-hold',
  'ipc-command',
]);

export const TRIGGER_NODE_TYPES = new Set([
  'manual-start',
  'hotkey-trigger',
  'timer-trigger',
]);

export type MacroIconKey =
  | 'mouse'
  | 'keyboard'
  | 'workflow'
  | 'gamepad'
  | 'timer'
  | 'folder'
  | 'sparkles'
  | 'wrench'
  | 'zap'
  | 'circle';

export const MACRO_ICON_OPTIONS: { key: MacroIconKey; label: string; Icon: LucideIcon }[] = [
  { key: 'mouse', label: 'Mouse', Icon: Mouse },
  { key: 'keyboard', label: 'Keyboard', Icon: Keyboard },
  { key: 'workflow', label: 'Workflow', Icon: Workflow },
  { key: 'gamepad', label: 'Gamepad', Icon: Gamepad2 },
  { key: 'timer', label: 'Timer', Icon: Timer },
  { key: 'wrench', label: 'Wrench', Icon: Wrench },
  { key: 'zap', label: 'Zap', Icon: Zap },
  { key: 'circle', label: 'Circle', Icon: CircleDot },
  { key: 'folder', label: 'Folder', Icon: Folder },
  { key: 'sparkles', label: 'Sparkles', Icon: Sparkles },
];

export const MACRO_ICON_MAP: Record<MacroIconKey, LucideIcon> = Object.fromEntries(
  MACRO_ICON_OPTIONS.map((o) => [o.key, o.Icon]),
) as Record<MacroIconKey, LucideIcon>;

export const AUTO_ICON_KEY = 'auto' as const;

export function detectMacroIcon(macro: Macro): MacroIconKey {
  if (macro.madeByAi) return 'sparkles';
  let mouse = 0;
  let keyboard = 0;
  let other = 0;
  for (const node of macro.nodes) {
    if (TRIGGER_NODE_TYPES.has(node.type)) continue;
    if (MOUSE_NODE_TYPES.has(node.type)) mouse += 1;
    else if (KEYBOARD_NODE_TYPES.has(node.type)) keyboard += 1;
    else other += 1;
  }

  if (mouse > keyboard) return 'mouse';
  if (keyboard > mouse) return 'keyboard';

  if (other > 0) return 'workflow';
  return 'folder';
}

export function getMacroIconKey(macro: Macro): MacroIconKey {
  const override = macro.icon as MacroIconKey | undefined;
  if (override && MACRO_ICON_MAP[override]) return override;
  return detectMacroIcon(macro);
}

export function getMacroIcon(macro: Macro): LucideIcon {
  return MACRO_ICON_MAP[getMacroIconKey(macro)];
}