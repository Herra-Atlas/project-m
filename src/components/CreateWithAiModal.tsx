import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  memo,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import {
  AlertTriangle,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  Edit3,
  FileEdit,
  Loader2,
  PenLine,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Star,
  Trash2,
  Wand2,
  Wrench,
  XCircle,
} from 'lucide-react';
import { Button, Modal } from './index';
import { cn } from './cn';
import type { Connection, EditorNode, Macro } from './editor/types';
import { DEFAULT_AI_SYSTEM_PROMPT } from './ai/prompts';
import {
  parseFences,
  stripFences,
  summarizeMacros,
  verifyMacro,
  type DeleteMacroBody,
  type DuplicateMacroBody,
  type EditMacroBody,
  type MacroSummary,
  type ParsedFence,
  type QuestionBody,
  type QuestionOption,
  type RenameMacroBody,
  type VerifyFinding,
  type VerifyMacroBody,
} from './ai/protocol';
import {
  caches,
  invokeErrorMessage,
  useInvokeCachedValue,
} from './cache';

// ──────────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────────

interface ModelInfo {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { modality?: string };
  top_provider?: { max_completion_tokens?: number };
}

export type ActionKind =
  | 'create_macro'
  | 'edit_macro'
  | 'rename_macro'
  | 'delete_macro'
  | 'duplicate_macro'
  | 'verify_macro'
  | 'question';

export type ActionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'applied'
  | 'failed'
  | 'answered';

export interface ActionCard {
  id: string;
  messageId: string;
  kind: ActionKind;
  raw: string;
  value: unknown;
  status: ActionStatus;
  error?: string;
  answer?: string;
}

export interface AiPermissions {
  allowMutations: boolean;
  autoApproveSafe: boolean;
}

interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  reasoning?: string;
  toolCalls?: ToolCallPart[];
  model?: string;
  reasoningOpen?: boolean;
  actions?: ActionCard[];
}

interface ToolCallPart {
  id: string;
  name: string;
  args: string;
  status: 'streaming' | 'running' | 'done';
}

interface AiChunk {
  kind: 'content' | 'reasoning' | 'tool_start' | 'tool_delta' | 'tool_end' | 'begin' | 'done' | 'error';
  delta?: string;
  id?: string;
  name?: string;
  args?: string;
  args_delta?: string;
  model?: string;
  message?: string;
  finish_reason?: string;
}

export interface CreateWithAiModalProps {
  open: boolean;
  onClose: () => void;
  apiKey: string;
  systemPrompt: string;
  macros: Macro[];
  permissions: AiPermissions;
  onCreateMacro: (macro: Macro) => void;
  onApplyEdit: (id: string, body: EditMacroBody) => void;
  onApplyRename: (id: string, title: string) => void;
  onApplyDelete: (id: string, reason?: string) => void;
  onApplyDuplicate: (id: string, newTitle?: string) => void;
}

// ──────────────────────────────────────────────────────────────────────────
// Module-scope constants (hoisted so identity is stable across renders)
// ──────────────────────────────────────────────────────────────────────────

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

const PLACEHOLDER_PROMPTS = [
  'Click the green button every 30s until red appears, then stop.',
  'Press E twice with a 50ms gap, loop 5 times, then log "done".',
  'Watch a pixel at 960,540 for color #FF0000 with 20ms tolerance, 5s timeout.',
];

const CONVO_STORAGE_KEY = '__aiConvoSnapshot';
const PERSIST_DEBOUNCE_MS = 600;

// ──────────────────────────────────────────────────────────────────────────
// Small shared utilities
// ──────────────────────────────────────────────────────────────────────────

function safeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isActionSafe(kind: ActionKind): boolean {
  return (
    kind === 'create_macro' ||
    kind === 'edit_macro' ||
    kind === 'rename_macro' ||
    kind === 'duplicate_macro' ||
    kind === 'verify_macro'
  );
}

function actionNeedsConfirmation(kind: ActionKind, perms: AiPermissions): boolean {
  if (!perms.allowMutations) {
    return kind !== 'create_macro' && kind !== 'question' && kind !== 'verify_macro';
  }
  if (isActionSafe(kind)) return !perms.autoApproveSafe;
  return true;
}

function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Hook: model catalog (UI state lifted out of the parent)
// ──────────────────────────────────────────────────────────────────────────

interface UseAiModelsResult {
  models: ModelInfo[];
  modelsLoading: boolean;
  modelsError: string | null;
  model: string;
  setModel: (id: string) => void;
  favorites: string[];
  toggleFavorite: (id: string) => void;
  /** Force-refresh the model catalog by invalidating the shared cache. */
  refreshModels: () => Promise<unknown[]>;
}

function useAiModels(open: boolean): UseAiModelsResult {
  // Fetch via the shared cache so duplicate callers share the work.
  const { value, loading, refresh } = useInvokeCachedValue(caches.kiloModels, []);
  const models = useMemo<ModelInfo[]>(() => (Array.isArray(value) ? (value as ModelInfo[]) : []), [value]);
  const [model, setModelState] = useState<string>('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);

  // Load favorites + last model + first error from cache.settings on open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await caches.settings.get();
        if (cancelled) return;
        if (Array.isArray(s.aiFavoriteModels)) {
          setFavorites(s.aiFavoriteModels as string[]);
        }
        if (typeof s.aiModel === 'string') {
          setModelState(s.aiModel as string);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Resolve a sensible default model once the catalog arrives.
  useEffect(() => {
    if (!open || models.length === 0) return;
    setModelState((current) => {
      if (current && models.some((m) => m.id === current)) return current;
      const favHit = models.find((m) => favorites.includes(m.id));
      if (favHit) return favHit.id;
      const free = models.find((m) => m.id === 'openrouter/free');
      if (free) return free.id;
      return models[0].id;
    });
  }, [open, models, favorites]);

  // Translate cache errors into a string.
  useEffect(() => {
    if (!open) return;
    setModelsError(null);
  }, [open, models.length]);

  // Background refresh on open (stale-while-revalidate).
  useEffect(() => {
    if (!open) return;
    void refresh().catch((e) => setModelsError(invokeErrorMessage(e)));
  }, [open, refresh]);

  const setModel = useCallback((id: string) => setModelState(id), []);
  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  return {
    models,
    modelsLoading: loading,
    modelsError,
    model,
    setModel,
    favorites,
    toggleFavorite,
    refreshModels: refresh,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Hook: conversation persistence (debounced, skip while streaming)
// ──────────────────────────────────────────────────────────────────────────

function useConvoPersistence(open: boolean, streaming: boolean, messages: ChatMessage[]) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!open) return;
    if (streaming) {
      // Skip writes during streaming; the snapshot is already in cache.
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void caches.settings.get().then((cur) => {
        const next = {
          ...cur,
          [CONVO_STORAGE_KEY]: { version: 1, messages, savedAt: Date.now() },
        };
        void invoke('save_settings', { payload: JSON.stringify(next) });
      });
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [open, streaming, messages]);
}

// ──────────────────────────────────────────────────────────────────────────
// Streaming protocol helpers (parsers + state machines)
// ──────────────────────────────────────────────────────────────────────────

function applyChunk(
  prev: ChatMessage[],
  chunk: AiChunk,
  assistantId?: string,
): ChatMessage[] {
  const last = prev[prev.length - 1];
  const targetId = assistantId ?? (last?.role === 'assistant' ? last.id : null);
  if (!targetId) return prev;

  return prev.map((m) => {
    if (m.id !== targetId) return m;
    const next: ChatMessage = { ...m };
    switch (chunk.kind) {
      case 'content':
        next.content = (m.content || '') + (chunk.delta ?? '');
        break;
      case 'reasoning':
        next.reasoning = (m.reasoning || '') + (chunk.delta ?? '');
        break;
      case 'tool_start': {
        const calls = [...(m.toolCalls ?? [])];
        calls.push({
          id: chunk.id ?? `tc-${calls.length}`,
          name: chunk.name ?? 'tool',
          args: chunk.args ?? '',
          status: 'streaming',
        });
        next.toolCalls = calls;
        break;
      }
      case 'tool_delta': {
        next.toolCalls = (m.toolCalls ?? []).map((tc) =>
          tc.id === chunk.id ? { ...tc, args: tc.args + (chunk.args_delta ?? '') } : tc,
        );
        break;
      }
      case 'tool_end':
        next.toolCalls = (m.toolCalls ?? []).map((tc) =>
          tc.id === chunk.id ? { ...tc, status: 'done' } : tc,
        );
        break;
      case 'done':
        next.toolCalls = (m.toolCalls ?? []).map((tc) =>
          tc.status === 'streaming' ? { ...tc, status: 'done' } : tc,
        );
        break;
      case 'error':
        next.content = (m.content || '') + `\n\n[error] ${chunk.message ?? 'unknown'}`;
        break;
    }
    return next;
  });
}

/**
 * Parse assistant message content into ActionCards. Memoized at the
 * caller level so we only re-run when content actually changes.
 */
function parseAndAttachActions(
  messages: ChatMessage[],
  messageId: string,
  permissions: AiPermissions,
): ChatMessage[] {
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx < 0) return messages;
  const msg = messages[idx];
  if (msg.role !== 'assistant') return messages;

  const { fences, normalised } = parseFences(msg.content);
  const proseOnly = stripFences(normalised, fences);
  const existingByFenceId = new Map<string, ActionCard>();
  for (const a of msg.actions ?? []) existingByFenceId.set(a.id, a);

  const newActions: ActionCard[] = fences.map((f, i) => {
    const id = `${messageId}-f${i}`;
    const prior = existingByFenceId.get(id);
    if (prior) return { ...prior, raw: f.body, value: f.value };
    return {
      id,
      messageId,
      kind: f.kind,
      raw: f.body,
      value: f.value,
      status: actionNeedsConfirmation(f.kind, permissions) ? 'pending' : 'pending',
    };
  });

  const fenceIds = new Set(newActions.map((a) => a.id));
  const carried: ActionCard[] = [];
  for (const a of msg.actions ?? []) {
    if (!fenceIds.has(a.id)) carried.push(a);
  }

  const updated: ChatMessage = { ...msg, content: proseOnly, actions: [...newActions, ...carried] };
  const out = [...messages];
  out[idx] = updated;
  return out;
}

function normalizeMacro(raw: unknown): Macro | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const nodes = Array.isArray(r.nodes) ? (r.nodes as EditorNode[]) : null;
  const connections = Array.isArray(r.connections) ? (r.connections as Connection[]) : null;
  if (!nodes || !connections) return null;
  if (typeof r.id !== 'string' || typeof r.title !== 'string') return null;
  const cleanNodes: EditorNode[] = nodes.map((n) => ({
    id: String(n.id),
    type: String(n.type),
    x: Math.round(Number(n.x) || 0),
    y: Math.round(Number(n.y) || 0),
    fields:
      n.fields && typeof n.fields === 'object'
        ? { ...(n.fields as Record<string, string | number>) }
        : {},
  }));
  const cleanConns = connections
    .filter((c) => typeof c.from === 'string' && typeof c.to === 'string')
    .map((c) => ({ from: c.from, to: c.to }));
  return {
    id: r.id,
    title: String(r.title).slice(0, 60),
    description: typeof r.description === 'string' ? r.description.slice(0, 280) : '',
    nodes: cleanNodes,
    connections: cleanConns,
    madeByAi: true,
  };
}

function normalizeEdit(raw: unknown): EditMacroBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string') return null;
  const nodes = Array.isArray(r.nodes) ? (r.nodes as EditorNode[]) : undefined;
  const connections = Array.isArray(r.connections) ? (r.connections as Connection[]) : undefined;
  return {
    id: r.id,
    title: typeof r.title === 'string' ? r.title : undefined,
    description: typeof r.description === 'string' ? r.description : undefined,
    nodes,
    connections,
  };
}

function normalizeRename(raw: unknown): RenameMacroBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.title !== 'string') return null;
  return { id: r.id, title: r.title };
}

function normalizeDelete(raw: unknown): DeleteMacroBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string') return null;
  return { id: r.id, reason: typeof r.reason === 'string' ? r.reason : undefined };
}

function normalizeDuplicate(raw: unknown): DuplicateMacroBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string') return null;
  return { id: r.id, newTitle: typeof r.newTitle === 'string' ? r.newTitle : undefined };
}

function normalizeQuestion(raw: unknown): QuestionBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.prompt !== 'string') return null;
  const options: QuestionOption[] = [];
  if (Array.isArray(r.options)) {
    for (const o of r.options) {
      if (
        o &&
        typeof o === 'object' &&
        typeof (o as { id?: unknown }).id === 'string' &&
        typeof (o as { label?: unknown }).label === 'string'
      ) {
        const opt = o as { id: string; label: string; description?: unknown };
        options.push({
          id: opt.id,
          label: opt.label,
          description: typeof opt.description === 'string' ? opt.description : undefined,
        });
      }
    }
  }
  return { id: r.id, prompt: r.prompt, options, allowCustom: r.allowCustom === true };
}

function buildLibraryNote(summaries: MacroSummary[], perms: AiPermissions): string {
  if (summaries.length === 0) return 'Current macro library: empty.';
  const lines = summaries.map(
    (s) =>
      `- id="${s.id}" title="${s.title}" nodes=${s.nodeCount} connections=${s.connectionCount} types=[${s.types.join(', ')}] desc="${(s.description || '').replace(/"/g, '\\"')}"`,
  );
  const mut = perms.allowMutations
    ? 'You MAY emit edit_macro / rename_macro / duplicate_macro / delete_macro blocks — the frontend will request user confirmation.'
    : 'Mutations are DISABLED. You may only emit create_macro, verify_macro, and question blocks.';
  return `Current macro library (${summaries.length}):\n${lines.join('\n')}\n\n${mut}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Main modal
// ──────────────────────────────────────────────────────────────────────────

export function CreateWithAiModal(props: CreateWithAiModalProps) {
  const {
    open,
    apiKey,
    systemPrompt,
    macros,
    permissions,
    onClose,
    onCreateMacro,
    onApplyEdit,
    onApplyRename,
    onApplyDelete,
    onApplyDuplicate,
  } = props;

  const {
    models,
    modelsLoading,
    modelsError,
    model,
    setModel,
    favorites,
    toggleFavorite,
    refreshModels,
  } = useAiModels(open);

  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedMacro, setAcceptedMacro] = useState<Macro | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Always-fresh ref mirror of `messages`. We use it inside async callbacks
  // (timeouts, IPC awaits) so closures don't see stale state — the user
  // may have appended a turn via handleAnswer or a question card between
  // when we built the callback and when it actually runs.
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  // Load conversation snapshot once when the modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await caches.settings.get();
        if (cancelled) return;
        const snapshot = s[CONVO_STORAGE_KEY] as { messages?: ChatMessage[] } | undefined;
        if (Array.isArray(snapshot?.messages)) {
          setMessages(snapshot.messages);
        } else {
          setMessages([]);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Persist (debounced; skipped while streaming).
  useConvoPersistence(open, streaming, messages);

  // Auto-scroll on new messages / streaming chunks.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  // Build O(1) lookup maps for macros (passed to children).
  const macrosById = useMemo(() => {
    const m = new Map<string, Macro>();
    for (const x of macros) m.set(x.id, x);
    return m;
  }, [macros]);
  const macrosByTitle = useMemo(() => {
    const m = new Map<string, Macro>();
    for (const x of macros) m.set(x.title.toLowerCase(), x);
    return m;
  }, [macros]);
  const summaries: MacroSummary[] = useMemo(() => summarizeMacros(macros), [macros]);

  // Persist model + favorites whenever they change (debounced via the
  // shared cache — no per-change IPC storm).
  useEffect(() => {
    if (!open) return;
    void caches.settings.get().then((cur) => {
      void invoke('save_settings', {
        payload: JSON.stringify({ ...cur, aiModel: model, aiFavoriteModels: favorites }),
      });
    });
  }, [open, model, favorites]);

  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  /**
   * Send a turn. Reads the latest `messages` via the ref so we never see
   * a stale snapshot when called from a timeout or async callback.
   * When `overrideText` is provided (e.g. a question-card answer), that
   * text is used instead of the textarea value, and the textarea is NOT
   * cleared (the user never typed there).
   */
  const handleSend = useCallback(
    async (overrideText?: string) => {
      if (!apiKey || !model || streaming) return;
      setError(null);
      setAcceptedMacro(null);

      const text = (overrideText ?? composerTextareaRef.current?.value ?? '').trim();
      if (!text) return;
      if (overrideText === undefined && composerTextareaRef.current) {
        composerTextareaRef.current.value = '';
      }

      const userMsg: ChatMessage = {
        id: `m-${safeId()}-user`,
        role: 'user',
        content: text,
      };
      const assistantId = `m-${safeId()}-assistant`;
      // Use a functional setter so the new turn lands before the next ref read.
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: 'assistant', content: '', reasoning: '', model, actions: [] },
      ]);
      // Keep the ref mirror in sync immediately so subsequent awaits see the new turn.
      messagesRef.current = [...messagesRef.current, userMsg];

      const streamId = `s-${safeId()}`;
      const unlisten = await listen<AiChunk>(`ai-chunk:${streamId}`, (event) => {
        const chunk = event.payload;
        setMessages((prev) => applyChunk(prev, chunk, assistantId));
        if (chunk.kind === 'done' || chunk.kind === 'error') {
          setStreaming(false);
          setMessages((prev) => parseAndAttachActions(prev, assistantId, permissions));
        }
      });

      setStreaming(true);
      try {
        const libraryNote = buildLibraryNote(summaries, permissions);
        const transcript = messagesRef.current.map((m) => ({
          role: m.role,
          content: m.content || undefined,
        }));
        await invoke('kilo_chat_stream', {
          req: {
            apiKey,
            model,
            messages: transcript,
            system: [systemPrompt.trim() || DEFAULT_AI_SYSTEM_PROMPT, libraryNote]
              .filter(Boolean)
              .join('\n\n'),
            streamId,
          },
        });
      } catch (err) {
        setStreaming(false);
        setError(invokeErrorMessage(err));
      } finally {
        unlisten();
      }
    },
    // We deliberately exclude `messages` from deps — we read it through
    // `messagesRef` to avoid closure staleness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiKey, model, streaming, summaries, permissions, systemPrompt],
  );

  // Imperative handle so question-card auto-send and any future caller can
  // trigger a send without going through React state.
  const composerSendRef = useRef<((overrideText?: string) => void) | null>(null);
  composerSendRef.current = handleSend;

  const stop = useCallback(() => {
    setStreaming(false);
  }, []);

  const reset = useCallback(() => {
    setMessages([]);
    setAcceptedMacro(null);
    setError(null);
  }, []);

  const updateAction = useCallback(
    (messageId: string, actionId: string, patch: Partial<ActionCard>) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const actions = (m.actions ?? []).map((a) =>
            a.id === actionId ? { ...a, ...patch } : a,
          );
          return { ...m, actions };
        }),
      );
    },
    [],
  );

  const handleApplyAction = useCallback(
    (action: ActionCard) => {
      const finishOk = (patch: Partial<ActionCard> = {}) =>
        updateAction(action.messageId, action.id, { status: 'applied', ...patch });
      const finishErr = (msg: string) =>
        updateAction(action.messageId, action.id, { status: 'failed', error: msg });
      try {
        switch (action.kind) {
          case 'create_macro': {
            const macro = normalizeMacro(action.value);
            if (!macro) {
              finishErr('invalid create_macro body');
              return;
            }
            onCreateMacro(macro);
            finishOk();
            setAcceptedMacro(macro);
            return;
          }
          case 'edit_macro': {
            const body = normalizeEdit(action.value);
            if (!body) {
              finishErr('invalid edit_macro body');
              return;
            }
            onApplyEdit(body.id, body);
            finishOk();
            return;
          }
          case 'rename_macro': {
            const body = normalizeRename(action.value);
            if (!body) {
              finishErr('invalid rename_macro body');
              return;
            }
            onApplyRename(body.id, body.title);
            finishOk();
            return;
          }
          case 'delete_macro': {
            const body = normalizeDelete(action.value);
            if (!body) {
              finishErr('invalid delete_macro body');
              return;
            }
            onApplyDelete(body.id, body.reason);
            finishOk();
            return;
          }
          case 'duplicate_macro': {
            const body = normalizeDuplicate(action.value);
            if (!body) {
              finishErr('invalid duplicate_macro body');
              return;
            }
            onApplyDuplicate(body.id, body.newTitle);
            finishOk();
            return;
          }
          case 'verify_macro': {
            finishOk();
            return;
          }
          case 'question': {
            finishErr('question handled separately');
            return;
          }
        }
      } catch (e) {
        finishErr(invokeErrorMessage(e));
      }
    },
    [onApplyDelete, onApplyDuplicate, onApplyEdit, onApplyRename, onCreateMacro, updateAction],
  );

  const handleReject = useCallback(
    (action: ActionCard) => {
      updateAction(action.messageId, action.id, { status: 'rejected' });
    },
    [updateAction],
  );

  const handleAnswer = useCallback(
    (action: ActionCard, optionId: string, label: string, custom?: string) => {
      const answerText = (custom?.trim() ? custom.trim() : label).trim();
      if (!answerText) return;
      updateAction(action.messageId, action.id, { status: 'answered', answer: optionId });
      const reply = custom?.trim() ? `Custom answer: ${answerText}` : `Answer: ${answerText}`;
      // Push the user turn immediately and keep the ref mirror in sync,
      // then auto-send via the imperative ref so the option-pick AND the
      // custom-answer paths both reach the model.
      setMessages((prev) => [
        ...prev,
        { id: `m-${safeId()}-user`, role: 'user', content: reply },
      ]);
      messagesRef.current = [
        ...messagesRef.current,
        { id: `m-${safeId()}-user`, role: 'user', content: reply },
      ];
      // Use a microtask so React commits the message update before we send,
      // and pass the reply explicitly so handleSend doesn't need to read
      // the textarea.
      Promise.resolve().then(() => composerSendRef.current?.(reply));
    },
    [updateAction],
  );

  const currentName = useMemo(
    () => models.find((m) => m.id === model)?.id.split('/').pop() ?? 'Pick a model',
    [models, model],
  );

  const groupedModels = useMemo(() => {
    const favs: ModelInfo[] = [];
    const rest: ModelInfo[] = [];
    for (const m of models) (favorites.includes(m.id) ? favs : rest).push(m);
    return { favs, rest };
  }, [models, favorites]);

  // Lazy markdown: only render ReactMarkdown when there's actual content.
  const MarkdownView = useCallback(
    ({ text }: { text: string }) => (
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
        {text}
      </ReactMarkdown>
    ),
    [],
  );

  return (
    <Modal
      open={open}
      onClose={streaming ? () => undefined : onClose}
      closeOnEscape={!streaming}
      closeOnBackdrop={!streaming}
      hideCloseButton={streaming}
      size="2xl"
      title={
        <div className="flex items-center gap-2">
          <Wand2 size={15} className="text-green-500" />
          <span>Create macro with AI</span>
        </div>
      }
      description="Describe what you want the macro to do. The AI returns a ready-to-edit Project M macro."
      footer={
        acceptedMacro ? (
          <div className="flex w-full items-center justify-between">
            <span className="text-xs text-neutral-400">
              Macro generated: <span className="text-neutral-200">{acceptedMacro.title}</span>{' '}
              <span className="text-neutral-500">· {acceptedMacro.nodes.length} nodes</span>
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAcceptedMacro(null)}>
                <PenLine size={14} />
                Keep editing
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  onCreateMacro(acceptedMacro);
                  onClose();
                }}
              >
                Open in editor
              </Button>
            </div>
          </div>
        ) : (
          <ChatComposer
            textareaRef={composerTextareaRef}
            streaming={streaming}
            disabled={!apiKey || !model}
            placeholder={
              !apiKey
                ? 'Set a Kilo API key in Settings → AI to start chatting…'
                : !model
                  ? 'Pick a model to start chatting…'
                  : 'Describe what the macro should do…'
            }
            onSend={handleSend}
            onStop={stop}
            modelPicker={
              <ModelPicker
                models={models}
                currentName={currentName}
                current={model}
                favorites={favorites}
                loading={modelsLoading}
                error={modelsError}
                open={modelPickerOpen}
                onOpenChange={setModelPickerOpen}
                onPick={(id) => {
                  setModel(id);
                  setModelPickerOpen(false);
                }}
                onToggleFavorite={toggleFavorite}
                onRefresh={refreshModels}
                grouped={groupedModels}
                disabled={!apiKey}
              />
            }
          />
        )
      }
    >
      <div className="flex flex-col gap-3">
        {!permissions.allowMutations && (
          <div className="flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">AI is restricted to creating new macros.</div>
              <div className="mt-0.5 text-yellow-400/80">
                Edit / rename / delete / duplicate are disabled in Settings → AI.
                The model can still ask questions and propose new macros.
              </div>
            </div>
          </div>
        )}

        <div
          ref={scrollRef}
          className="min-h-[40vh] flex-1 overflow-y-auto rounded-md border border-white/5 bg-neutral-950/40 p-3"
        >
          {messages.length === 0 ? (
            <EmptyChat
              apiKeySet={!!apiKey}
              suggestions={PLACEHOLDER_PROMPTS}
              onPickSuggestion={(p) => {
                if (composerTextareaRef.current) composerTextareaRef.current.value = p;
              }}
            />
          ) : (
            <MessageList
              messages={messages}
              streaming={streaming}
              macrosById={macrosById}
              macrosByTitle={macrosByTitle}
              onApplyAction={handleApplyAction}
              onReject={handleReject}
              onAnswer={handleAnswer}
              MarkdownView={MarkdownView}
            />
          )}
        </div>

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        {messages.length > 0 && !streaming && !acceptedMacro && (
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={reset}>
              <RefreshCw size={14} />
              Reset conversation
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Subcomponents (memoized)
// ──────────────────────────────────────────────────────────────────────────

interface MessageListProps {
  messages: ChatMessage[];
  streaming: boolean;
  macrosById: Map<string, Macro>;
  macrosByTitle: Map<string, Macro>;
  onApplyAction: (a: ActionCard) => void;
  onReject: (a: ActionCard) => void;
  onAnswer: (a: ActionCard, optionId: string, label: string, custom?: string) => void;
  MarkdownView: (props: { text: string }) => ReactNode;
}

const MessageList = memo(function MessageList({
  messages,
  streaming,
  macrosById,
  macrosByTitle,
  onApplyAction,
  onReject,
  onAnswer,
  MarkdownView,
}: MessageListProps) {
  return (
    <ol className="flex flex-col gap-3">
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          macrosById={macrosById}
          macrosByTitle={macrosByTitle}
          onApplyAction={onApplyAction}
          onReject={onReject}
          onAnswer={onAnswer}
          MarkdownView={MarkdownView}
        />
      ))}
      {streaming && (
        <li className="flex items-center gap-2 pl-2 text-xs text-neutral-500">
          <Loader2 size={12} className="animate-spin" />
          Streaming…
        </li>
      )}
    </ol>
  );
});

interface MessageBubbleProps {
  message: ChatMessage;
  macrosById: Map<string, Macro>;
  macrosByTitle: Map<string, Macro>;
  onApplyAction: (a: ActionCard) => void;
  onReject: (a: ActionCard) => void;
  onAnswer: (a: ActionCard, optionId: string, label: string, custom?: string) => void;
  MarkdownView: (props: { text: string }) => ReactNode;
}

const MessageBubble = memo(function MessageBubble({
  message,
  macrosById,
  macrosByTitle,
  onApplyAction,
  onReject,
  onAnswer,
  MarkdownView,
}: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <li className={cn('flex flex-col gap-1.5', isUser ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500',
          isUser && 'flex-row-reverse',
        )}
      >
        {isUser ? (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-neutral-400" />
            You
          </>
        ) : (
          <>
            <Sparkles size={10} className="text-neutral-500" />
            Assistant
            {message.model && (
              <span className="font-normal normal-case tracking-normal text-neutral-600">
                · {message.model.split('/').pop()}
              </span>
            )}
          </>
        )}
      </div>
      <div
        className={cn(
          'w-full text-sm leading-relaxed',
          isUser ? 'max-w-[85%] text-neutral-200' : 'text-neutral-100',
        )}
      >
        {message.reasoning && message.reasoning.length > 0 && (
          <ReasoningAccordion text={message.reasoning} />
        )}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mb-2 flex flex-col gap-1">
            {message.toolCalls.map((tc) => (
              <ToolCallCard key={tc.id} call={tc} />
            ))}
          </div>
        )}
        {message.content && (
          <div className="ai-markdown">
            <MarkdownView text={message.content} />
          </div>
        )}
        {!isUser && (message.actions ?? []).length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {(message.actions ?? []).map((action) => (
              <ActionCardView
                key={action.id}
                action={action}
                macrosById={macrosById}
                macrosByTitle={macrosByTitle}
                onApply={() => onApplyAction(action)}
                onReject={() => onReject(action)}
                onAnswer={(optionId, label, custom) => onAnswer(action, optionId, label, custom)}
              />
            ))}
          </div>
        )}
      </div>
    </li>
  );
});

const ReasoningAccordion = memo(function ReasoningAccordion({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2 overflow-hidden rounded border border-white/5 bg-neutral-950/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-medium uppercase tracking-wider text-neutral-500 hover:bg-white/[0.03] hover:text-neutral-300"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Brain size={11} />
        Thinking
        <span className="font-normal normal-case tracking-normal text-neutral-600">
          ({text.length} chars)
        </span>
      </button>
      {open && (
        <pre className="border-t border-white/5 px-2.5 py-2 text-xs leading-relaxed text-neutral-400 whitespace-pre-wrap">
          {text}
        </pre>
      )}
    </div>
  );
});

const ToolCallCard = memo(function ToolCallCard({ call }: { call: ToolCallPart }) {
  const [open, setOpen] = useState(call.status === 'done');
  return (
    <div className="overflow-hidden rounded border border-white/5 bg-neutral-950/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-medium uppercase tracking-wider text-neutral-500 hover:bg-white/[0.03] hover:text-neutral-300"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Wrench size={11} />
        <span className="font-mono normal-case tracking-normal text-neutral-300">{call.name}</span>
        {call.status === 'streaming' && (
          <Loader2 size={11} className="ml-auto animate-spin text-neutral-500" />
        )}
        {call.status === 'done' && <Check size={11} className="ml-auto text-green-500" />}
      </button>
      {open && (
        <pre className="border-t border-white/5 px-2.5 py-2 text-xs leading-relaxed text-neutral-300 whitespace-pre-wrap font-mono">
          {call.args || <span className="text-neutral-600">no args</span>}
        </pre>
      )}
    </div>
  );
});

// ─── Action cards ─────────────────────────────────────────────────────────

const ACTION_META: Record<
  ActionKind,
  { label: string; icon: typeof Wand2; tone: string; destructive: boolean }
> = {
  create_macro: { label: 'Create macro', icon: Sparkles, tone: 'text-green-400', destructive: false },
  edit_macro: { label: 'Edit macro', icon: FileEdit, tone: 'text-blue-400', destructive: false },
  rename_macro: { label: 'Rename macro', icon: Edit3, tone: 'text-blue-400', destructive: false },
  duplicate_macro: { label: 'Duplicate macro', icon: Copy, tone: 'text-blue-400', destructive: false },
  delete_macro: { label: 'Delete macro', icon: Trash2, tone: 'text-red-400', destructive: true },
  verify_macro: { label: 'Verify report', icon: ShieldCheck, tone: 'text-yellow-400', destructive: false },
  question: { label: 'Question', icon: CircleHelp, tone: 'text-purple-400', destructive: false },
};

interface ActionCardViewProps {
  action: ActionCard;
  macrosById: Map<string, Macro>;
  macrosByTitle: Map<string, Macro>;
  onApply: () => void;
  onReject: () => void;
  onAnswer: (optionId: string, label: string, custom?: string) => void;
}

const ActionCardView = memo(function ActionCardView({
  action,
  macrosById,
  macrosByTitle,
  onApply,
  onReject,
  onAnswer,
}: ActionCardViewProps) {
  const meta = ACTION_META[action.kind];
  const Icon = meta.icon;

  const lookup = useMemo<Macro | null>(() => {
    if (
      action.kind === 'question' ||
      action.kind === 'create_macro' ||
      action.kind === 'verify_macro'
    )
      return null;
    const body = action.value as { id?: string; title?: string } | null;
    if (!body || typeof body !== 'object') return null;
    const byId = typeof body.id === 'string' ? macrosById.get(body.id) : null;
    if (byId) return byId;
    if (typeof body.title === 'string' && body.title.length > 0) {
      return macrosByTitle.get(body.title.toLowerCase()) ?? null;
    }
    return null;
  }, [action.kind, action.value, macrosById, macrosByTitle]);

  const verifyFindings = useMemo<VerifyFinding[] | null>(() => {
    if (action.kind !== 'verify_macro') return null;
    const body = action.value as Partial<VerifyMacroBody> | null;
    return Array.isArray(body?.findings) ? body!.findings : [];
  }, [action.kind, action.value]);

  const questionBody = useMemo<QuestionBody | null>(() => {
    if (action.kind !== 'question') return null;
    return normalizeQuestion(action.value);
  }, [action.kind, action.value]);

  const prettyValue = useMemo(() => prettyJson(action.value), [action.value]);
  const previewMacro = useMemo(
    () => (action.kind === 'create_macro' ? normalizeMacro(action.value) : null),
    [action.kind, action.value],
  );
  const previewEdit = useMemo(
    () => (action.kind === 'edit_macro' ? normalizeEdit(action.value) : null),
    [action.kind, action.value],
  );

  const isApplied = action.status === 'applied';
  const isFailed = action.status === 'failed';
  const isRejected = action.status === 'rejected';
  const isAnswered = action.status === 'answered';

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border',
        isApplied
          ? 'border-green-500/30 bg-green-500/5'
          : isFailed
            ? 'border-red-500/30 bg-red-500/5'
            : isRejected
              ? 'border-neutral-700 bg-neutral-900/40 opacity-60'
              : isAnswered
                ? 'border-purple-500/30 bg-purple-500/5'
                : meta.destructive
                  ? 'border-red-500/30 bg-red-500/5'
                  : 'border-white/10 bg-neutral-950/40',
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <Icon size={14} className={meta.tone} />
        <span className="text-[12px] font-medium text-neutral-200">{meta.label}</span>
        {lookup && (
          <span className="ml-1 truncate text-[11px] text-neutral-500">
            · <span className="text-neutral-300">{lookup.title}</span>
          </span>
        )}
        {action.kind === 'question' && questionBody && (
          <span className="ml-1 text-[11px] text-neutral-500">· {questionBody.prompt}</span>
        )}
        <span className="ml-auto">
          <StatusBadge status={action.status} error={action.error} />
        </span>
      </div>

      {action.kind === 'question' && questionBody ? (
        <QuestionCardBody
          body={questionBody}
          disabled={isAnswered || isApplied || isFailed || isRejected}
          onAnswer={onAnswer}
        />
      ) : action.kind === 'verify_macro' && verifyFindings ? (
        <VerifyReportBody findings={verifyFindings} macro={lookup} />
      ) : (
        <div className="border-t border-white/5 px-3 py-2">
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-neutral-300">
            {prettyValue}
          </pre>
          {previewMacro && (
            <div className="mt-2 text-[11px] text-neutral-400">
              Mechanical preview:{' '}
              <span className="text-neutral-200">
                {previewMacro.nodes.length} nodes · {previewMacro.connections.length} connections
              </span>
            </div>
          )}
          {action.kind === 'edit_macro' && lookup && previewEdit && (
            <div className="mt-2 text-[11px] text-neutral-400">
              Will replace macro <span className="text-neutral-200">{lookup.title}</span>{' '}
              with{' '}
              <span className="text-neutral-200">
                {previewEdit.nodes?.length ?? lookup.nodes.length} nodes
              </span>{' '}
              ·{' '}
              <span className="text-neutral-200">
                {previewEdit.connections?.length ?? lookup.connections.length} connections
              </span>
            </div>
          )}
        </div>
      )}

      <ActionCardFooter
        action={action}
        onApply={onApply}
        onReject={onReject}
      />
    </div>
  );
});

function ActionCardFooter({
  action,
  onApply,
  onReject,
}: {
  action: ActionCard;
  onApply: () => void;
  onReject: () => void;
}) {
  if (
    action.status === 'applied' ||
    action.status === 'rejected' ||
    action.status === 'answered'
  ) {
    return null;
  }
  if (action.status === 'failed') {
    return (
      <div className="border-t border-red-500/20 px-3 py-2 text-[11px] text-red-400">
        {action.error || 'Failed.'}
      </div>
    );
  }
  if (action.kind === 'question' || action.kind === 'verify_macro') return null;

  return (
    <div className="flex items-center justify-end gap-2 border-t border-white/5 px-3 py-2">
      <Button variant="ghost" size="sm" onClick={onReject}>
        <XCircle size={13} />
        Reject
      </Button>
      <Button variant="primary" size="sm" onClick={onApply}>
        <CheckCircle2 size={13} />
        {action.kind === 'delete_macro'
          ? 'Approve & delete'
          : action.kind === 'create_macro'
            ? 'Create'
            : action.kind === 'rename_macro'
              ? 'Apply rename'
              : action.kind === 'duplicate_macro'
                ? 'Duplicate'
                : 'Apply edit'}
      </Button>
    </div>
  );
}

function StatusBadge({ status, error }: { status: ActionStatus; error?: string }) {
  if (status === 'applied') {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm border border-green-500/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-green-400">
        <Check size={9} />
        Applied
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm border border-neutral-700 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-neutral-400">
        <XCircle size={9} />
        Rejected
      </span>
    );
  }
  if (status === 'answered') {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm border border-purple-500/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-purple-400">
        <Check size={9} />
        Answered
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span
        title={error}
        className="inline-flex items-center gap-1 rounded-sm border border-red-500/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-red-400"
      >
        <AlertTriangle size={9} />
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-yellow-500/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-yellow-400">
      Pending
    </span>
  );
}

function QuestionCardBody({
  body,
  disabled,
  onAnswer,
}: {
  body: QuestionBody;
  disabled: boolean;
  onAnswer: (optionId: string, label: string, custom?: string) => void;
}) {
  const [custom, setCustom] = useState('');
  return (
    <div className="border-t border-white/5 px-3 py-2">
      <p className="text-[12px] text-neutral-300">{body.prompt}</p>
      <div className="mt-2 flex flex-col gap-1.5">
        {body.options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            disabled={disabled}
            onClick={() => onAnswer(opt.id, opt.label)}
            className={cn(
              'flex w-full items-start gap-2 rounded-md border border-white/5 bg-neutral-900 px-2.5 py-2 text-left text-[12px] text-neutral-200 transition-colors',
              !disabled && 'hover:border-purple-500/40 hover:bg-purple-500/5',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <span className="mt-0.5 font-mono text-[10px] text-purple-400">{opt.id}</span>
            <span className="flex-1">
              <div>{opt.label}</div>
              {opt.description && (
                <div className="mt-0.5 text-[11px] text-neutral-500">{opt.description}</div>
              )}
            </span>
          </button>
        ))}
      </div>
      {body.allowCustom && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Custom answer…"
            disabled={disabled}
            className="flex-1 rounded-md border border-white/10 bg-neutral-900 px-2.5 py-1.5 text-[12px] text-neutral-200 focus:border-purple-500/60 focus:outline-none focus:ring-1 focus:ring-purple-500/30"
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || !custom.trim()}
            onClick={() => onAnswer('custom', 'Custom', custom)}
          >
            Send
          </Button>
        </div>
      )}
    </div>
  );
}

const VerifyReportBody = memo(function VerifyReportBody({
  findings,
  macro,
}: {
  findings: VerifyFinding[];
  macro: Macro | null | null | undefined;
}) {
  const merged = useMemo(() => {
    const mechanical = macro ? verifyMacro(macro).findings : [];
    const all = [...findings, ...mechanical];
    const seen = new Set<string>();
    const out: VerifyFinding[] = [];
    for (const f of all) {
      const key = `${f.severity}|${f.nodeId ?? ''}|${f.field ?? ''}|${f.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
    return out.sort((a, b) => sev(a.severity) - sev(b.severity));
  }, [findings, macro]);

  const counts = useMemo(() => {
    const errors: VerifyFinding[] = [];
    const warnings: VerifyFinding[] = [];
    const infos: VerifyFinding[] = [];
    for (const f of merged) {
      (f.severity === 'error'
        ? errors
        : f.severity === 'warning'
          ? warnings
          : infos
      ).push(f);
    }
    return { errors, warnings, infos };
  }, [merged]);

  return (
    <div className="border-t border-white/5 px-3 py-2">
      <div className="mb-2 flex items-center gap-2 text-[11px]">
        <span className="rounded-sm border border-red-500/40 px-1.5 py-0.5 font-bold uppercase tracking-wider text-red-400">
          {counts.errors.length} error{counts.errors.length === 1 ? '' : 's'}
        </span>
        <span className="rounded-sm border border-yellow-500/40 px-1.5 py-0.5 font-bold uppercase tracking-wider text-yellow-400">
          {counts.warnings.length} warning{counts.warnings.length === 1 ? '' : 's'}
        </span>
        <span className="rounded-sm border border-neutral-700 px-1.5 py-0.5 font-bold uppercase tracking-wider text-neutral-400">
          {counts.infos.length} info
        </span>
      </div>
      {merged.length === 0 ? (
        <div className="text-[12px] text-green-400">No issues found.</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {merged.map((f, i) => (
            <li
              key={i}
              className={cn(
                'flex items-start gap-2 rounded border px-2 py-1 text-[11px]',
                f.severity === 'error'
                  ? 'border-red-500/30 bg-red-500/5 text-red-300'
                  : f.severity === 'warning'
                    ? 'border-yellow-500/30 bg-yellow-500/5 text-yellow-200'
                    : 'border-white/5 bg-neutral-900 text-neutral-400',
              )}
            >
              <span className="mt-0.5 font-mono text-[10px] uppercase tracking-wider opacity-70">
                {f.severity}
              </span>
              <span className="flex-1">
                {f.nodeId && (
                  <span className="mr-1 rounded bg-black/40 px-1 font-mono text-[10px] text-neutral-300">
                    {f.nodeId}
                  </span>
                )}
                {f.line !== undefined && (
                  <span className="mr-1 font-mono text-[10px] text-neutral-500">L{f.line}</span>
                )}
                {f.field && (
                  <span className="mr-1 font-mono text-[10px] text-neutral-500">{f.field}</span>
                )}
                <span>{f.message}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

function sev(s: VerifyFinding['severity']): number {
  return s === 'error' ? 0 : s === 'warning' ? 1 : 2;
}

// ──────────────────────────────────────────────────────────────────────────
// Chat composer (owns its own DOM state — keystrokes never reach the parent)
// ──────────────────────────────────────────────────────────────────────────

interface ChatComposerProps {
  textareaRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  streaming: boolean;
  disabled: boolean;
  placeholder: string;
  onSend: () => void;
  onStop: () => void;
  modelPicker: ReactNode;
}

const ChatComposer = memo(function ChatComposer({
  textareaRef,
  streaming,
  disabled,
  placeholder,
  onSend,
  onStop,
  modelPicker,
}: ChatComposerProps) {
  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      textareaRef.current = el;
    },
    [textareaRef],
  );

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex w-full items-end gap-2 rounded-md border border-white/10 bg-neutral-900 px-3 py-2 focus-within:border-green-500/60 focus-within:ring-1 focus-within:ring-green-500/30">
        <textarea
          ref={setRef}
          rows={2}
          placeholder={placeholder}
          disabled={disabled && !streaming}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!disabled) onSend();
            }
          }}
          className="min-w-0 flex-1 resize-none bg-transparent text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none"
        />
        <div className="flex shrink-0 items-center gap-1.5 self-end pb-0.5">
          {modelPicker}
          {streaming ? (
            <Button variant="danger" size="sm" onClick={onStop}>
              <Square size={13} />
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={onSend}
              disabled={disabled}
            >
              <Send size={13} />
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
});

// ──────────────────────────────────────────────────────────────────────────
// Model picker (memoized, ref-based outside-click)
// ──────────────────────────────────────────────────────────────────────────

interface ModelPickerProps {
  models: ModelInfo[];
  current: string;
  currentName: string;
  favorites: string[];
  loading: boolean;
  error: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onRefresh: () => Promise<unknown[]>;
  grouped: { favs: ModelInfo[]; rest: ModelInfo[] };
  disabled?: boolean;
}

const ModelPicker = memo(function ModelPicker({
  models,
  current,
  currentName,
  favorites,
  loading,
  error,
  open,
  onOpenChange,
  onPick,
  onToggleFavorite,
  onRefresh,
  grouped,
  disabled,
}: ModelPickerProps) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number; width: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useLayoutEffect(() => {
    if (!open || disabled) return;
    const measure = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({
        left: r.left,
        bottom: window.innerHeight - r.top + 6,
        width: Math.max(288, r.width),
      });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, disabled]);

  useEffect(() => {
    if (!open || disabled) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (dropdownRef.current?.contains(t)) return;
      onOpenChange(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onOpenChange, disabled]);

  const dropdown =
    open && !disabled && pos
      ? createPortal(
          <div
            ref={dropdownRef}
            style={{ position: 'fixed', left: pos.left, bottom: pos.bottom, width: pos.width }}
            className="z-[1000] max-h-80 overflow-y-auto rounded-md border border-neutral-700/70 bg-neutral-900 shadow-2xl shadow-black/60"
          >
            {error && (
              <div className="border-b border-white/5 px-3 py-2 text-xs text-red-400">{error}</div>
            )}
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-white/5 bg-neutral-900 px-3 py-1.5 text-[11px] text-neutral-400">
              <span className="font-medium uppercase tracking-wider text-neutral-500">
                {models.length} model{models.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                disabled={refreshing}
                onClick={async (e) => {
                  e.stopPropagation();
                  setRefreshing(true);
                  try {
                    await onRefresh();
                  } finally {
                    setRefreshing(false);
                  }
                }}
                className={cn(
                  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors',
                  refreshing
                    ? 'cursor-not-allowed text-neutral-600'
                    : 'text-neutral-300 hover:bg-white/5 hover:text-white',
                )}
                title="Re-fetch the model catalog from the Kilo API"
              >
                {refreshing ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <RefreshCw size={11} />
                )}
                Search models
              </button>
            </div>
            {grouped.favs.length > 0 && (
              <>
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  Favorites
                </div>
                {grouped.favs.map((m) => (
                  <ModelRow
                    key={m.id}
                    model={m}
                    isCurrent={m.id === current}
                    isFavorite
                    onPick={onPick}
                    onToggleFavorite={onToggleFavorite}
                  />
                ))}
              </>
            )}
            {grouped.rest.length > 0 && (
              <>
                <div className="border-t border-white/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  All models
                </div>
                {grouped.rest.map((m) => (
                  <ModelRow
                    key={m.id}
                    model={m}
                    isCurrent={m.id === current}
                    isFavorite={false}
                    onPick={onPick}
                    onToggleFavorite={onToggleFavorite}
                  />
                ))}
              </>
            )}
            {!loading && models.length === 0 && !error && (
              <div className="px-3 py-3 text-xs text-neutral-500">No models returned.</div>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={triggerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          onOpenChange(!open);
        }}
        className={cn(
          'flex items-center gap-1.5 rounded-md border border-white/10 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-300 transition-colors',
          disabled
            ? 'cursor-not-allowed opacity-50'
            : 'hover:border-white/20 hover:bg-neutral-800',
        )}
        title={
          disabled
            ? 'Add a Kilo API key in Settings → AI'
            : loading
              ? 'Loading models…'
              : currentName
        }
      >
        <Bot size={12} className="text-neutral-500" />
        <span className="max-w-[180px] truncate">
          {disabled
            ? 'No model'
            : loading
              ? 'Loading…'
              : models.length === 0
                ? 'Pick a model'
                : currentName}
        </span>
        <ChevronDown size={11} className={cn('transition-transform text-neutral-500', open && 'rotate-180')} />
      </button>
      {dropdown}
    </div>
  );
});

function ModelRow({
  model,
  isCurrent,
  isFavorite,
  onPick,
  onToggleFavorite,
}: {
  model: ModelInfo;
  isCurrent: boolean;
  isFavorite: boolean;
  onPick: (id: string) => void;
  onToggleFavorite: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-2 px-3 py-1.5 text-sm transition-colors',
        isCurrent ? 'bg-green-500/10 text-neutral-100' : 'text-neutral-300 hover:bg-white/5',
      )}
    >
      <button
        type="button"
        onClick={() => onPick(model.id)}
        className="flex flex-1 items-center gap-2 truncate text-left"
      >
        <span className="truncate">{model.id.split('/').pop()}</span>
        {isCurrent && <Check size={12} className="text-green-500" />}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(model.id);
        }}
        className={cn(
          'rounded p-1 transition-colors',
          isFavorite
            ? 'text-yellow-400 hover:text-yellow-300'
            : 'text-neutral-600 opacity-0 hover:text-yellow-400 group-hover:opacity-100',
        )}
        title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Star size={12} fill={isFavorite ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
}

interface EmptyChatProps {
  apiKeySet: boolean;
  suggestions: string[];
  onPickSuggestion: (s: string) => void;
}

const EmptyChat = memo(function EmptyChat({
  apiKeySet,
  suggestions,
  onPickSuggestion,
}: EmptyChatProps) {
  return (
    <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-3 px-4 text-center">
      <Bot size={26} className="text-neutral-700" />
      <div className="space-y-1">
        <p className="text-sm text-neutral-300">
          {apiKeySet
            ? 'Start a conversation to design a macro.'
            : 'Add a Kilo API key in Settings → AI to begin.'}
        </p>
        <p className="max-w-md text-xs text-neutral-600">
          The model sees the full node registry, your existing macros, and is constrained
          to emit valid Project M JSON or confirmation requests.
        </p>
      </div>
      {apiKeySet && (
        <div className="mt-2 flex max-w-md flex-wrap justify-center gap-1.5">
          {suggestions.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPickSuggestion(p)}
              className="rounded-full border border-white/5 bg-neutral-900 px-2.5 py-1 text-[11px] text-neutral-400 transition-colors hover:border-white/10 hover:bg-neutral-800 hover:text-neutral-200"
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
