import type { Connection, EditorNode, Macro } from '../editor/types';

// ──────────────────────────────────────────────────────────────────────────
// AI protocol
//
// All structured instructions from the assistant are emitted as fenced
// blocks. The protocol is deliberately model-agnostic: any chat-completions
// endpoint can be used. The frontend (CreateWithAiModal + App.tsx) parses
// these blocks, validates them, and surfaces them to the user as cards.
//
// Supported fence types:
//
//   ```create_macro
//   { "id": "...", "title": "...", "description": "...", "nodes": [...], "connections": [...] }
//   ```
//
//   ```edit_macro
//   { "id": "existing-macro-id", "title": "...", "description": "...", "nodes": [...], "connections": [...] }
//   ```
//
//   ```rename_macro
//   { "id": "existing-macro-id", "title": "new name" }
//   ```
//
//   ```delete_macro
//   { "id": "existing-macro-id", "reason": "why" }
//   ```
//
//   ```duplicate_macro
//   { "id": "existing-macro-id", "newTitle": "copy name" }
//   ```
//
//   ```verify_macro
//   { "id": "existing-macro-id",
//     "findings": [
//       { "severity": "error"|"warning"|"info",
//         "nodeId": "n1",
//         "field": "fields.key",
//         "line": 2,
//         "message": "human description" }
//     ] }
//   ```
//
//   ```question
//   { "id": "q1",
//     "prompt": "...",
//     "options": [ { "id": "a", "label": "..." }, ... ],
//     "allowCustom": true }
//   ```
// ──────────────────────────────────────────────────────────────────────────

export type FenceKind =
  | 'create_macro'
  | 'edit_macro'
  | 'rename_macro'
  | 'delete_macro'
  | 'duplicate_macro'
  | 'verify_macro'
  | 'question';

export interface ParsedFence {
  kind: FenceKind;
  /** Raw JSON body as the model emitted it. */
  body: string;
  /** Parsed object (best-effort). */
  value: unknown;
  /** Match start index in source text. */
  start: number;
  /** Match end index in source text. */
  end: number;
}

const FENCE_RE =
  /```(create_macro|edit_macro|rename_macro|delete_macro|duplicate_macro|verify_macro|question)\s*([\s\S]*?)```/g;

// Models occasionally emit tool-call syntax in two non-canonical forms.
// We normalise both into real ```<kind> … ``` fences before parsing so
// the rest of the pipeline never has to care.
//
//   1. Qwen / Hermes style:
//        <|tool_call_start|>name(args)<|tool_call_end|>
//      where `args` is a Python-ish dict literal (single quotes, tuples).
//
//   2. OpenRouter / Mistral tool-invoke style:
//        <|message_model|>name<|content_invoke_tool_json|>{json}<|end_message|>
//
// Anything we can't parse stays as-is — the user will see the literal text.

function parsePythonishDict(s: string): unknown | null {
  // Convert Python literal to JSON. Cheap heuristic, sufficient for our
  // well-formed tool calls (single-quoted strings, no comments, no
  // trailing commas inside the captured window).
  let out = s;
  // Replace Python booleans / None.
  out = out.replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null');
  // Replace single-quoted strings with double-quoted ones. Iterative
  // passes because the regex can't easily handle nested quotes; in our
  // payloads we only ever have one level.
  for (let i = 0; i < 6; i++) {
    const next = out.replace(/'((?:\\.|[^'\\])*)'/g, (_, body: string) => {
      return JSON.stringify(body.replace(/\\'/g, "'"));
    });
    if (next === out) break;
    out = next;
  }
  // Remove trailing commas inside arrays/objects.
  out = out.replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

const TOOL_CALL_START_RE =
  /<\|tool_call_start\|>\s*([a-zA-Z_][a-zA-Z0-9_-]*)\s*\(([\s\S]*?)\)\s*<\|tool_call_end\|>/g;

const TOOL_INVOKE_JSON_RE =
  /<\|message_model\|>\s*([a-zA-Z_][a-zA-Z0-9_-]*)\s*<\|content_invoke_tool_json\|>\s*([\s\S]*?)\s*<\|end_message\|>/g;

const KNOWN_TOOL_NAMES = new Set<FenceKind>([
  'create_macro',
  'edit_macro',
  'rename_macro',
  'delete_macro',
  'duplicate_macro',
  'verify_macro',
  'question',
]);

export function normalizeToolSyntax(text: string): string {
  let out = text;

  // 1) <|tool_call_start|>name(python_args)<|tool_call_end|>
  out = out.replace(TOOL_CALL_START_RE, (_full, nameRaw: string, argsRaw: string) => {
    const name = nameRaw.toLowerCase();
    if (!KNOWN_TOOL_NAMES.has(name as FenceKind)) return _full;
    const parsed = parsePythonishDict(argsRaw);
    const body = parsed === null ? argsRaw.trim() : JSON.stringify(parsed, null, 2);
    return '\n```' + name + '\n' + body + '\n```\n';
  });

  // 2) <|message_model|>name<|content_invoke_tool_json|>{json}<|end_message|>
  out = out.replace(TOOL_INVOKE_JSON_RE, (_full, nameRaw: string, jsonRaw: string) => {
    const name = nameRaw.toLowerCase();
    if (!KNOWN_TOOL_NAMES.has(name as FenceKind)) return _full;
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonRaw);
    } catch {
      return _full;
    }
    const body = JSON.stringify(parsed, null, 2);
    return '\n```' + name + '\n' + body + '\n```\n';
  });

  return out;
}

export function parseFences(text: string): { fences: ParsedFence[]; normalised: string } {
  const normalised = normalizeToolSyntax(text);
  const out: ParsedFence[] = [];
  let m: RegExpExecArray | null;
  FENCE_RE.lastIndex = 0;
  while ((m = FENCE_RE.exec(normalised)) !== null) {
    const kind = m[1] as FenceKind;
    const body = (m[2] ?? '').trim();
    let value: unknown = null;
    try {
      value = JSON.parse(body);
    } catch {
      value = null;
    }
    out.push({
      kind,
      body,
      value,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return { fences: out, normalised };
}

export function stripFences(text: string, fences: ParsedFence[]): string {
  if (fences.length === 0) return text;
  let out = '';
  let cursor = 0;
  for (const f of fences) {
    if (f.start > cursor) out += text.slice(cursor, f.start);
    cursor = f.end;
  }
  if (cursor < text.length) out += text.slice(cursor);
  return out.trim();
}

// ─── Schema helpers ──────────────────────────────────────────────────────

export interface CreateMacroBody {
  id: string;
  title: string;
  description: string;
  nodes: EditorNode[];
  connections: Connection[];
  madeByAi?: boolean;
}

export interface EditMacroBody {
  id: string;
  title?: string;
  description?: string;
  nodes?: EditorNode[];
  connections?: Connection[];
}

export interface RenameMacroBody {
  id: string;
  title: string;
}

export interface DeleteMacroBody {
  id: string;
  reason?: string;
}

export interface DuplicateMacroBody {
  id: string;
  newTitle?: string;
}

export interface QuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface QuestionBody {
  id: string;
  prompt: string;
  options: QuestionOption[];
  allowCustom?: boolean;
}

export interface VerifyFinding {
  severity: 'error' | 'warning' | 'info';
  nodeId?: string;
  field?: string;
  line?: number;
  message: string;
}

export interface VerifyMacroBody {
  id: string;
  findings: VerifyFinding[];
}

const ALLOWED_FIELDS: Record<string, Set<string>> = {
  'manual-start': new Set(),
  'hotkey-trigger': new Set(['key']),
  'timer-trigger': new Set(['intervalMs']),
  'key-press': new Set(['key', 'count']),
  'key-hold': new Set(['key', 'durationMs']),
  'mouse-click': new Set(['button', 'count', 'delayMs']),
  'mouse-move': new Set(['x', 'y', 'durationMs']),
  'mouse-drag': new Set(['fromX', 'fromY', 'toX', 'toY', 'durationMs', 'button']),
  'mouse-hold-sweep': new Set(['fromX', 'fromY', 'toX', 'toY', 'durationMs', 'button']),
  loop: new Set(['intervalMs', 'loopCount']),
  break: new Set(),
  if: new Set(['variable', 'operator', 'value', 'pollMs']),
  while: new Set(['variable', 'operator', 'value', 'pollMs']),
  'logic-gate': new Set(['mode']),
  variable: new Set(['name', 'value']),
  pause: new Set(['durationMs']),
  delay: new Set(['ms']),
  log: new Set(['message']),
  'pixel-scan': new Set([
    'fromX',
    'fromY',
    'toX',
    'toY',
    'color',
    'rTol',
    'gTol',
    'bTol',
    'firstMatchXVar',
    'firstMatchYVar',
    'centerXVar',
    'centerYVar',
  ]),
  'pixel-watch': new Set([
    'fromX',
    'fromY',
    'toX',
    'toY',
    'color',
    'rTol',
    'gTol',
    'bTol',
    'timeoutMs',
    'centerOnXVar',
    'centerOnYVar',
  ]),
  'ipc-command': new Set(['command']),
  script: new Set(['code', 'language']),
};

export interface VerifyReport {
  ok: boolean;
  findings: VerifyFinding[];
}

export function verifyMacro(macro: Macro): VerifyReport {
  const findings: VerifyFinding[] = [];
  const seenIds = new Set<string>();
  const dupIds = new Set<string>();

  if (!macro.id) {
    findings.push({ severity: 'error', line: 1, message: 'macro is missing required field `id`' });
  }
  if (!macro.title || macro.title.trim().length === 0) {
    findings.push({ severity: 'error', line: 1, message: 'macro is missing required field `title`' });
  }
  if (!macro.description || macro.description.trim().length === 0) {
    findings.push({ severity: 'warning', line: 1, message: 'macro has no description (helpful for the AI later)' });
  }

  for (let i = 0; i < macro.nodes.length; i++) {
    const n = macro.nodes[i];
    const line = i + 2; // model-side convention: line 1 = macro header
    if (!n.id) {
      findings.push({ severity: 'error', line, message: 'node missing `id`' });
      continue;
    }
    if (seenIds.has(n.id)) {
      dupIds.add(n.id);
      findings.push({ severity: 'error', nodeId: n.id, line, message: `duplicate node id "${n.id}"` });
    }
    seenIds.add(n.id);
    const allowed = ALLOWED_FIELDS[n.type];
    if (!allowed) {
      findings.push({
        severity: 'error',
        nodeId: n.id,
        line,
        message: `unknown node type "${n.type}"`,
      });
      continue;
    }
    const fields = (n.fields ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(fields)) {
      if (!allowed.has(k)) {
        findings.push({
          severity: 'warning',
          nodeId: n.id,
          field: `fields.${k}`,
          line,
          message: `unknown field "${k}" for node type "${n.type}"`,
        });
      }
    }
    for (const req of requiredFields(n.type)) {
      if (!(req in fields)) {
        findings.push({
          severity: 'error',
          nodeId: n.id,
          field: `fields.${req}`,
          line,
          message: `missing required field "${req}" for node type "${n.type}"`,
        });
      }
    }
  }

  for (let i = 0; i < macro.connections.length; i++) {
    const c = macro.connections[i];
    const line = macro.nodes.length + i + 3;
    if (!c.from || !seenIds.has(c.from)) {
      findings.push({
        severity: 'error',
        line,
        message: `connection.from references unknown node id "${c.from}"`,
      });
    }
    if (!c.to || !seenIds.has(c.to)) {
      findings.push({
        severity: 'error',
        line,
        message: `connection.to references unknown node id "${c.to}"`,
      });
    }
  }

  const starts = macro.nodes.filter((n) => n.type === 'manual-start');
  if (starts.length === 0) {
    findings.push({
      severity: 'warning',
      message: 'macro has no `manual-start` node; user must trigger it another way',
    });
  }
  if (starts.length > 1) {
    findings.push({
      severity: 'warning',
      message: `macro has ${starts.length} \`manual-start\` nodes; only the first is wired as the entry point`,
    });
  }

  const orphans = macro.nodes
    .filter((n) => n.type !== 'manual-start')
    .filter((n) => !macro.connections.some((c) => c.to === n.id))
    .filter((n) => !macro.connections.some((c) => c.from === n.id));
  for (const n of orphans) {
    findings.push({
      severity: 'info',
      nodeId: n.id,
      message: `node "${n.id}" (${n.type}) is orphaned — not connected to any other node`,
    });
  }

  return {
    ok: findings.every((f) => f.severity !== 'error'),
    findings,
  };
}

function requiredFields(type: string): string[] {
  switch (type) {
    case 'hotkey-trigger':
      return ['key'];
    case 'timer-trigger':
      return ['intervalMs'];
    case 'key-press':
      return ['key'];
    case 'key-hold':
      return ['key', 'durationMs'];
    case 'mouse-click':
      return ['button'];
    case 'mouse-move':
      return ['x', 'y'];
    case 'mouse-drag':
      return ['fromX', 'fromY', 'toX', 'toY'];
    case 'mouse-hold-sweep':
      return ['fromX', 'fromY', 'toX', 'toY'];
    case 'loop':
      return ['intervalMs', 'loopCount'];
    case 'if':
    case 'while':
      return ['variable', 'operator', 'value'];
    case 'logic-gate':
      return ['mode'];
    case 'variable':
      return ['name', 'value'];
    case 'delay':
      return ['ms'];
    case 'log':
      return ['message'];
    case 'pixel-scan':
    case 'pixel-watch':
      return ['fromX', 'fromY', 'toX', 'toY', 'color'];
    case 'ipc-command':
      return ['command'];
    case 'script':
      return ['code', 'language'];
    default:
      return [];
  }
}

// ─── Compact macro summary (for AI context) ──────────────────────────────

export interface MacroSummary {
  id: string;
  title: string;
  description: string;
  nodeCount: number;
  connectionCount: number;
  types: string[];
}

export function summarizeMacros(macros: Macro[]): MacroSummary[] {
  return macros.map((m) => {
    const types = Array.from(new Set(m.nodes.map((n) => n.type))).sort();
    return {
      id: m.id,
      title: m.title,
      description: m.description,
      nodeCount: m.nodes.length,
      connectionCount: m.connections.length,
      types,
    };
  });
}
