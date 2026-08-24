import type { NodeTypeMeta } from './types';

export const NODE_TYPES: NodeTypeMeta[] = [
  // Start
  {
    type: 'manual-start',
    label: 'Starting point',
    color: '#22c55e',
    group: 'Start',
    description: 'Macro starts here when you run it.',
    fields: [],
    outputs: [
      { name: 'status', type: 'text', description: 'Always "started" once the node fires.' },
    ],
  },
  {
    type: 'hotkey-trigger',
    label: 'Hotkey trigger',
    color: '#3b82f6',
    group: 'Start',
    description: 'Blocks until a global key press matching the configured key. Accepts a single character ("6", "E", "space") or a name ("enter", "f5", "tab", "shift"). The matched keypress is swallowed and does not reach the focused app.',
    fields: [{ key: 'key', label: 'Key', type: 'text', default: '6' }],
    outputs: [
      { name: 'status', type: 'text', description: '"pressed" once the hotkey fires, "cancelled" if the macro was stopped first, "error" if the key is unrecognised.' },
    ],
  },
  {
    type: 'timer-trigger',
    label: 'Timer trigger',
    color: '#8b5cf6',
    group: 'Start',
    description: 'Delay or clock time.',
    fields: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['interval', 'clock'], default: 'interval' },
      { key: 'intervalMs', label: 'Interval (ms)', type: 'number', default: '500', showWhen: { field: 'mode', equals: 'interval' } },
      { key: 'clockTime', label: 'Clock time', type: 'text', default: '22:00', showWhen: { field: 'mode', equals: 'clock' } },
    ],
    outputs: [
      { name: 'status', type: 'text', description: '"fired" once the timer triggers.' },
    ],
  },

  // If
  {
    type: 'if',
    label: 'If',
    color: '#ec4899',
    group: 'If',
    description: 'Block until the condition becomes true, then continue. Reference any $variable from a prior node and compare it to a value.',
    fields: [
      { key: 'variable', label: 'Variable', type: 'text', default: '$status' },
      { key: 'operator', label: 'Operator', type: 'select', options: ['equals', 'not equals', 'contains', 'greater than', 'less than'], default: 'equals' },
      { key: 'value', label: 'Value', type: 'text', default: '' },
      { key: 'pollMs', label: 'Poll (ms)', type: 'number', default: '50' },
    ],
    outputs: [
      { name: 'status', type: 'text', description: '"matched" once the condition became true.' },
    ],
  },
  {
    type: 'while',
    label: 'While',
    color: '#ec4899',
    group: 'If',
    description: 'Block while the condition is true; continue as soon as it becomes false. Reference any $variable from a prior node and compare it to a value.',
    fields: [
      { key: 'variable', label: 'Variable', type: 'text', default: '$status' },
      { key: 'operator', label: 'Operator', type: 'select', options: ['equals', 'not equals', 'contains', 'greater than', 'less than'], default: 'equals' },
      { key: 'value', label: 'Value', type: 'text', default: '' },
      { key: 'pollMs', label: 'Poll (ms)', type: 'number', default: '50' },
    ],
    outputs: [
      { name: 'status', type: 'text', description: '"exited" once the condition became false.' },
    ],
  },
  {
    type: 'pixel-scan',
    label: 'Pixel scan',
    color: '#ec4899',
    group: 'If',
    description: 'Scan a region for a color with tolerance. Returns "found" when at least one matching pixel exists, "not found" otherwise.',
    fields: [
      { key: 'fromX', label: 'From X', type: 'number', default: '0', icon: 'x₁', compact: true },
      { key: 'fromY', label: 'From Y', type: 'number', default: '0', icon: 'y₁', compact: true },
      { key: 'toX', label: 'To X', type: 'number', default: '100', icon: 'x₂', compact: true },
      { key: 'toY', label: 'To Y', type: 'number', default: '100', icon: 'y₂', compact: true },
      { key: 'color', label: 'Color', type: 'text', default: '#FF0000' },
      { key: 'rTol', label: 'R tolerance', type: 'number', default: '10', compact: true },
      { key: 'gTol', label: 'G tolerance', type: 'number', default: '10', compact: true },
      { key: 'bTol', label: 'B tolerance', type: 'number', default: '10', compact: true },
      { key: 'centerXVar', label: 'Center X var', type: 'text', default: '' },
      { key: 'centerYVar', label: 'Center Y var', type: 'text', default: '' },
    ],
    outputs: [
      { name: 'status', type: 'text', description: '"found" if any pixel matched, "not found" otherwise.' },
      { name: 'whereX', type: 'number', description: 'X coordinate of the first matching pixel (absolute screen coords).' },
      { name: 'whereY', type: 'number', description: 'Y coordinate of the first matching pixel (absolute screen coords).' },
      { name: 'centerX', type: 'number', description: 'Average X of all matching pixels — the blob centroid.' },
      { name: 'centerY', type: 'number', description: 'Average Y of all matching pixels — the blob centroid.' },
    ],
  },
  {
    type: 'pixel-watch',
    label: 'Pixel watch',
    color: '#ec4899',
    group: 'If',
    description: 'Blocks until a matching pixel appears. Spawns a background thread that polls the region at maximum GDI speed (no interval sleep) and resumes the macro the instant a match lands. Use for low-latency triggers like catching a bite window.',
    fields: [
      { key: 'fromX', label: 'From X', type: 'number', default: '0', icon: 'x₁', compact: true },
      { key: 'fromY', label: 'From Y', type: 'number', default: '0', icon: 'y₁', compact: true },
      { key: 'toX', label: 'To X', type: 'number', default: '100', icon: 'x₂', compact: true },
      { key: 'toY', label: 'To Y', type: 'number', default: '100', icon: 'y₂', compact: true },
      { key: 'color', label: 'Color', type: 'text', default: '#FF0000' },
      { key: 'rTol', label: 'R tolerance', type: 'number', default: '10', compact: true },
      { key: 'gTol', label: 'G tolerance', type: 'number', default: '10', compact: true },
      { key: 'bTol', label: 'B tolerance', type: 'number', default: '10', compact: true },
      { key: 'timeoutMs', label: 'Timeout (ms)', type: 'number', default: '5000' },
      { key: 'centerOnXVar', label: 'Center on X var', type: 'text', default: '' },
      { key: 'centerOnYVar', label: 'Center on Y var', type: 'text', default: '' },
    ],
    outputs: [
      { name: 'status', type: 'text', description: '"found" once a matching pixel appeared, or "timeout" if the timeout elapsed without a match.' },
      { name: 'whereX', type: 'number', description: 'X coordinate of the matched pixel (absolute screen coords).' },
      { name: 'whereY', type: 'number', description: 'Y coordinate of the matched pixel (absolute screen coords).' },
    ],
  },
  {
    type: 'logic-gate',
    label: 'AND / OR',
    color: '#f59e0b',
    group: 'If',
    description: 'Combines two boolean inputs into one. Currently a no-op stub.',
    fields: [{ key: 'mode', label: 'Mode', type: 'select', options: ['and', 'or'], default: 'and' }],
    outputs: [
      { name: 'status', type: 'text', description: '"true" or "false".' },
    ],
  },

  // Keyboard
  {
    type: 'key-press',
    label: 'Press key',
    color: '#10b981',
    group: 'Keyboard',
    description: 'Send one key press.',
    fields: [{ key: 'key', label: 'Key', type: 'text', default: 'E' }],
    outputs: [
      { name: 'status', type: 'text', description: '"pressed" after the key press completes.' },
    ],
  },
  {
    type: 'key-hold',
    label: 'Hold key',
    color: '#059669',
    group: 'Keyboard',
    description: 'Hold for duration.',
    fields: [
      { key: 'key', label: 'Key', type: 'text', default: 'E' },
      { key: 'durationMs', label: 'Duration (ms)', type: 'number', default: '500' },
    ],
    outputs: [
      { name: 'status', type: 'text', description: '"held" after the key is released.' },
    ],
  },
  {
    type: 'ipc-command',
    label: 'IPC command',
    color: '#6366f1',
    group: 'Keyboard',
    description: 'Send a key command to the AHK IPC window. Returns "sent" on success, "error" if AHK is not running.',
    fields: [{ key: 'command', label: 'Command', type: 'text', default: 'E' }],
    outputs: [
      { name: 'status', type: 'text', description: '"sent" if the IPC window accepted the command, "error" otherwise.' },
    ],
  },

  // Mouse
  {
    type: 'mouse-move',
    label: 'Move mouse',
    color: '#06b6d4',
    group: 'Mouse',
    description: 'Move to coordinates.',
    fields: [
      { key: 'x', label: 'X', type: 'number', default: '0', icon: 'x', compact: true },
      { key: 'y', label: 'Y', type: 'number', default: '0', icon: 'y', compact: true },
    ],
    outputs: [
      { name: 'status', type: 'text', description: '"moved" once the cursor reaches the target.' },
    ],
  },
  {
    type: 'mouse-click',
    label: 'Click',
    color: '#14b8a6',
    group: 'Mouse',
    description: 'Click a mouse button at the current cursor position. Chain with Move mouse first to click at specific x/y.',
    fields: [
      { key: 'button', label: 'Button', type: 'select', options: ['left', 'right', 'middle'], default: 'left' },
      { key: 'count', label: 'Count', type: 'number', default: '1' },
      { key: 'delayMs', label: 'Delay (ms)', type: 'number', default: '16' },
    ],
    outputs: [
      { name: 'status', type: 'text', description: '"clicked" after the last click completes.' },
    ],
  },
  {
    type: 'mouse-drag',
    label: 'Drag',
    color: '#0d9488',
    group: 'Mouse',
    description: 'Press, move, release.',
    fields: [
      { key: 'fromX', label: 'From X', type: 'number', default: '0', icon: 'x₁', compact: true },
      { key: 'fromY', label: 'From Y', type: 'number', default: '0', icon: 'y₁', compact: true },
      { key: 'toX', label: 'To X', type: 'number', default: '100', icon: 'x₂', compact: true },
      { key: 'toY', label: 'To Y', type: 'number', default: '100', icon: 'y₂', compact: true },
      { key: 'button', label: 'Button', type: 'select', options: ['left', 'right', 'middle'], default: 'left' },
      { key: 'durationMs', label: 'Duration (ms)', type: 'number', default: '300' },
    ],
    outputs: [
      { name: 'status', type: 'text', description: '"dragged" once the release completes.' },
    ],
  },
  {
    type: 'mouse-hold-sweep',
    label: 'Move + hold',
    color: '#0f766e',
    group: 'Mouse',
    description: 'Sweep while holding button.',
    fields: [
      { key: 'fromX', label: 'From X', type: 'number', default: '0', icon: 'x₁', compact: true },
      { key: 'fromY', label: 'From Y', type: 'number', default: '0', icon: 'y₁', compact: true },
      { key: 'toX', label: 'To X', type: 'number', default: '100', icon: 'x₂', compact: true },
      { key: 'toY', label: 'To Y', type: 'number', default: '100', icon: 'y₂', compact: true },
      { key: 'button', label: 'Button', type: 'select', options: ['left', 'right', 'middle'], default: 'left' },
      { key: 'durationMs', label: 'Duration (ms)', type: 'number', default: '0' },
    ],
    outputs: [
      { name: 'status', type: 'text', description: '"swept" once the move completes.' },
    ],
  },

  // Tools
  {
    type: 'loop',
    label: 'Loop',
    color: '#f97316',
    group: 'Tools',
    description: 'Repeat the body until loopCount iterations complete (0 = infinite).',
    fields: [
      { key: 'intervalMs', label: 'Interval (ms)', type: 'number', default: '100' },
      { key: 'loopCount', label: 'Loop count', type: 'number', default: '1' },
    ],
    outputs: [
      { name: 'status', type: 'text', description: '"running" while iterating, "completed" once the loop finishes.' },
    ],
  },
  {
    type: 'break',
    label: 'Break',
    color: '#ef4444',
    group: 'Tools',
    description: 'Stop nearest loop.',
    fields: [],
    outputs: [
      { name: 'status', type: 'text', description: '"broken" once the nearest loop has exited.' },
    ],
  },
  {
    type: 'variable',
    label: 'Variable',
    color: '#84cc16',
    group: 'Tools',
    description: 'Set a variable. Reference it from other nodes with $name.',
    fields: [
      { key: 'name', label: 'Name', type: 'text', default: 'counter' },
      { key: 'value', label: 'Value', type: 'text', default: '0' },
    ],
    outputs: [
      { name: 'status', type: 'text', description: '"set" once the variable is written.' },
    ],
  },
  {
    type: 'pause',
    label: 'Pause',
    color: '#a855f7',
    group: 'Tools',
    description: 'Wait until resumed.',
    fields: [],
    outputs: [
      { name: 'status', type: 'text', description: '"resumed" once the pause is released.' },
    ],
  },
  {
    type: 'delay',
    label: 'Delay',
    color: '#64748b',
    group: 'Tools',
    description: 'Wait milliseconds.',
    fields: [{ key: 'ms', label: 'Delay (ms)', type: 'number', default: '500' }],
    outputs: [
      { name: 'status', type: 'text', description: '"elapsed" once the delay finishes.' },
    ],
  },
  {
    type: 'log',
    label: 'Log',
    color: '#475569',
    group: 'Tools',
    description: 'Write a message.',
    fields: [{ key: 'message', label: 'Message', type: 'text', default: 'Custom log' }],
    outputs: [
      { name: 'status', type: 'text', description: '"logged" once the message is emitted.' },
    ],
  },
  {
    type: 'script',
    label: 'Script (JS)',
    color: '#a855f7',
    group: 'Tools',
    description: 'Run JavaScript in a sandboxed QuickJS runtime (~1 ms cold-start, no installation). Read/write global variables, write your own outputs, read other nodes\' outputs, log to the editor, sleep, or stop the macro. Use for logic that built-in nodes can\'t express.',
    fields: [
      { key: 'code', label: 'JavaScript code', type: 'textarea', monospace: true, rows: 10, default:
`// $vars.<name>      read/write global variable
// $out.<name>       write this node's output
// $engine.output('nodeId.outputName')  read another node's output
// $log(msg)         write to editor log
// $sleep(ms)        wait (blocking)

// Example:
const gx = $vars.greenX;
const cx = $vars.centerX;
$out.match = Math.abs(cx - gx) < 5;
$log(\`green=\${gx} center=\${cx} match=\${$out.match}\`);` },
      { key: 'timeoutMs', label: 'Timeout (ms)', type: 'number', default: '5000' },
      { key: 'heapMb', label: 'Heap cap (MB)', type: 'number', default: '8' },
    ],
    outputs: [
      { name: 'status', type: 'text', description: '"ok" if the script ran to completion, "error" if it threw or timed out.' },
      { name: 'result', type: 'text', description: 'Whatever the script returns (via `return "..."`) or the string form of the last expression.' },
    ],
  },
];

export const NODE_TYPE_MAP = Object.fromEntries(NODE_TYPES.map((n) => [n.type, n]));

export function getNodeGroups(): Record<string, NodeTypeMeta[]> {
  return NODE_TYPES.reduce<Record<string, NodeTypeMeta[]>>((acc, node) => {
    if (!acc[node.group]) acc[node.group] = [];
    acc[node.group].push(node);
    return acc;
  }, {});
}