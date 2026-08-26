import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { Button, Card, CardTitle, CardDescription, Input, Modal } from './components';
import { EditorPage } from './components/editor/EditorPage';
import { ViewMacroModal } from './components/editor/ViewMacroModal';
import type { AiPermissions } from './components/CreateWithAiModal';
import { DEFAULT_AI_SYSTEM_PROMPT } from './components/ai/prompts';
import { LogsPanel } from './components/LogsPanel';
import { ErrorProvider, useError } from './components/ErrorProvider';
import { useUpdater } from './components/useUpdater';
import type { Macro, MacroData } from './components/editor/types';
import {
  MACRO_ICON_OPTIONS,
  MACRO_ICON_MAP,
  AUTO_ICON_KEY,
  detectMacroIcon,
  getMacroIconKey,
  getMacroIcon,
  type MacroIconKey,
} from './components/macroIcons';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { caches } from './components/cache';
import { cn } from './components/cn';

const CreateWithAiModal = lazy(() =>
  import('./components/CreateWithAiModal').then((m) => ({ default: m.CreateWithAiModal })),
);
import {
  Home,
  Settings,
  ChevronDown,
  Plus,
  Upload,
  Folder,
  Sparkles,
  Eye,
  EyeOff,
  Bot,
  Pencil,
  Download,
  Trash2,
  PencilLine,
  Play,
  Square,
  Check,
  CircleHelp,
  Wand2,
} from 'lucide-react';

type Page = 'home' | 'macros' | 'settings';

export default function App() {
  return (
    <ErrorProvider>
      <AppInner />
    </ErrorProvider>
  );
}

function AppInner() {
  const { showError, error, info, success } = useError();
  const toast = { error, info, success, showError };
  const updater = useUpdater();
  const [page, setPage] = useState<Page>('home');
  const [macros, setMacros] = useState<Macro[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; macroId: string } | null>(null);
  const [iconSubmenuOpen, setIconSubmenuOpen] = useState(false);
  const [selectedMacroId, setSelectedMacroId] = useState<string | null>(null);

  const [editingMacro, setEditingMacro] = useState<Macro | null>(null);
  const [viewingMacro, setViewingMacro] = useState<Macro | null>(null);
  const [runningMacroId, setRunningMacroId] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ message: string; timestamp: number; nodeId?: string }[]>([]);
  const [ahkListening, setAhkListening] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [forceStopKeybind, setForceStopKeybind] = useState<string>('F8');
  const [capturingKeybind, setCapturingKeybind] = useState(false);
  const [keybindError, setKeybindError] = useState<string | null>(null);
  const [aiApiKey, setAiApiKey] = useState<string>('');
  const [aiSystemPrompt, setAiSystemPrompt] = useState<string>('');
  const [aiKeyDraft, setAiKeyDraft] = useState<string>('');
  const [aiKeyEditing, setAiKeyEditing] = useState(false);
  const [aiKeyVisible, setAiKeyVisible] = useState(false);
  const [aiKeyTest, setAiKeyTest] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [aiPromptDraft, setAiPromptDraft] = useState<string>('');
  const [aiPromptEditing, setAiPromptEditing] = useState(false);
  const [settingsTab, setSettingsTab] = useState<
    'common' | 'advanced' | 'ai' | 'security' | 'system'
  >('common');
  const [ahkPrompt, setAhkPrompt] = useState<
    | {
        title: string;
        onConfirm: () => void | Promise<void>;
      }
    | null
  >(null);
  const [ahkPromptBusy, setAhkPromptBusy] = useState(false);
  const [keybindWarnPrompt, setKeybindWarnPrompt] = useState<
    (() => void | Promise<void>) | null
  >(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiPermissions, setAiPermissions] = useState<AiPermissions>({
    allowMutations: true,
    autoApproveSafe: false,
  });
  const [importPrompt, setImportPrompt] = useState<{
    folder: string;
    parsed: { id: string; title: string; description: string };
  } | null>(null);

  // â”€â”€ Load persisted macros + window state on mount â”€â”€
  useEffect(() => {
    (async () => {
      try {
        const raw = await invoke<string>('load_settings');
        const settings = JSON.parse(raw || '{}');
        if (typeof settings.forceStopKeybind === 'string') {
          setForceStopKeybind(settings.forceStopKeybind);
        }
        if (typeof settings.kiloApiKey === 'string') {
          setAiApiKey(settings.kiloApiKey);
        }
        if (typeof settings.aiSystemPrompt === 'string') {
          setAiSystemPrompt(settings.aiSystemPrompt);
        }
        if (settings.aiPermissions && typeof settings.aiPermissions === 'object') {
          const p = settings.aiPermissions as Partial<AiPermissions>;
          setAiPermissions({
            allowMutations: typeof p.allowMutations === 'boolean' ? p.allowMutations : true,
            autoApproveSafe: typeof p.autoApproveSafe === 'boolean' ? p.autoApproveSafe : false,
          });
        }
        if (settings.window) {
          const win = getCurrentWindow();
          if (settings.window.width && settings.window.height) {
            await win.setSize(
              new (await import('@tauri-apps/api/window')).LogicalSize(
                settings.window.width,
                settings.window.height,
              ),
            ).catch(() => {});
          }
          if (settings.window.x !== undefined && settings.window.y !== undefined) {
            await win.setPosition(
              new (await import('@tauri-apps/api/window')).LogicalPosition(
                settings.window.x,
                settings.window.y,
              ),
            ).catch(() => {});
          }
        }
      } catch {}

      try {
        const macroStrings = await invoke<string[]>('list_macros');
        const loaded: Macro[] = [];
        for (const raw of macroStrings) {
          try {
            const data = JSON.parse(raw);
            if (data && data.id) loaded.push(data as Macro);
          } catch {}
        }
        if (loaded.length > 0) setMacros(loaded);
      } catch {}

      setIsLoaded(true);
    })();
  }, []);

  // â”€â”€ Save window size/position whenever it changes â”€â”€
  useEffect(() => {
    if (!isLoaded) return;
    const win = getCurrentWindow();
    const persist = async () => {
      try {
        const size = await win.innerSize();
        const pos = await win.innerPosition();
        // Merge into the existing settings so other fields (forceStopKeybind)
        // are preserved. Falls back to a fresh object if load fails.
        let merged: Record<string, unknown> = {
          window: { width: size.width, height: size.height, x: pos.x, y: pos.y },
          forceStopKeybind,
        };
        try {
          const raw = await invoke<string>('load_settings');
          const parsed = JSON.parse(raw || '{}');
          merged = { ...parsed, ...merged };
        } catch {}
        await invoke('save_settings', {
          payload: JSON.stringify(merged),
        });
      } catch {}
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(persist, 500);
    };
    const unlisten = win.onResized(schedule);
    const unlistenMove = win.onMoved(schedule);
    return () => {
      if (timer) clearTimeout(timer);
      unlisten.then((fn) => fn());
      unlistenMove.then((fn) => fn());
    };
  }, [isLoaded, forceStopKeybind]);

  // â”€â”€ Persist individual macro file on every change â”€â”€
  useEffect(() => {
    if (!isLoaded) return;
    for (const macro of macros) {
      invoke('save_macro', {
        id: macro.id,
        payload: JSON.stringify(macro),
      }).catch((err) => console.error('Failed to save macro:', err));
    }
  }, [macros, isLoaded]);

  // â”€â”€ AHK IPC polling â”€â”€
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const checkAhk = async () => {
      try {
        const result = await invoke<boolean>('check_ahk');
        if (!cancelled) setAhkListening(result);
      } catch {
        if (!cancelled) setAhkListening(false);
      }
    };

    checkAhk();
    timer = setInterval(checkAhk, 1500);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  // â”€â”€ Global log + macro lifecycle subscriptions â”€â”€
  useEffect(() => {
    const unlistenLog = listen<{ message: string; nodeId?: string }>('log', (event) => {
      setLogs((prev) => [
        ...prev,
        { message: event.payload.message, nodeId: event.payload.nodeId, timestamp: Date.now() },
      ]);
    });
    const unlistenStart = listen<string>('macro-started', (event) => {
      setRunningMacroId(event.payload);
    });
    const unlistenFinish = listen<string>('macro-finished', () => {
      setRunningMacroId(null);
    });
    // Recover running-macro state if a previous session left a thread running
    // (e.g. frontend hot-reloaded while the engine was active).
    invoke<string | null>('get_running_macro_id')
      .then((id) => {
        if (id) setRunningMacroId(id);
      })
      .catch(() => {});
    return () => {
      unlistenLog.then((fn) => fn());
      unlistenStart.then((fn) => fn());
      unlistenFinish.then((fn) => fn());
    };
  }, []);

const performRunMacro = useCallback(
    async (
      id: string,
      nodes: import('./components/editor/types').EditorNode[],
      connections: import('./components/editor/types').Connection[],
    ) => {
      setLogs([]);
      setRunningMacroId(id);
      try {
        const payload: MacroData = {
          nodes: nodes.map((n) => ({
            id: n.id,
            type: n.type,
            x: Math.round(n.x),
            y: Math.round(n.y),
            fields: n.fields,
          })),
          connections,
        };
        await invoke('run_macro', { id, data: payload });
      } catch (err) {
        setRunningMacroId(null);
        showError(`Failed to run macro: ${err}`);
      }
    },
    [showError],
  );

  // If a macro uses an AHK IPC node and the listener isn't running, surface
  // a one-click prompt to launch `ipc_listener.exe` before continuing. Once
  // the user confirms we spawn the listener optimistically and then proceed
  // with the actual macro start â€” the listener takes a moment to register
  // its AHK_IPC window, so we also re-check shortly after launch.
  const promptAhkThen = useCallback(
    (title: string, onConfirm: () => void | Promise<void>) => {
      setAhkPrompt({ title, onConfirm });
    },
    [],
  );

  const handleStartMacro = useCallback(async (macro: Macro) => {
    const proceed = () => {
      void performRunMacro(macro.id, macro.nodes, macro.connections);
    };
    if (!forceStopKeybind.trim()) {
      setKeybindWarnPrompt(() => proceed);
      return;
    }
    const usesAhk = macro.nodes.some((n) => n.type === 'ipc-command');
    if (usesAhk && !ahkListening) {
      promptAhkThen(macro.title, proceed);
      return;
    }
    proceed();
  }, [ahkListening, forceStopKeybind, performRunMacro, promptAhkThen]);

  const handleStartFromEditor = useCallback(
    async (
      id: string,
      data: { nodes: import('./components/editor/types').EditorNode[]; connections: import('./components/editor/types').Connection[] },
    ) => {
      const proceed = () => {
        void performRunMacro(id, data.nodes, data.connections);
      };
      if (!forceStopKeybind.trim()) {
        setKeybindWarnPrompt(() => proceed);
        return;
      }
      const usesAhk = data.nodes.some((n) => n.type === 'ipc-command');
      if (usesAhk && !ahkListening) {
        promptAhkThen(id, proceed);
        return;
      }
      proceed();
    },
    [ahkListening, forceStopKeybind, performRunMacro, promptAhkThen],
  );

  const handleStopMacro = useCallback(async () => {
    try {
      await invoke('stop_macro');
    } catch (err) {
      showError(`Failed to stop macro: ${err}`);
    }
    setRunningMacroId(null);
  }, [showError]);

  // Persist the keybind to settings.json (merged with existing payload) and
  // re-register the global hotkey in the backend. Empty string clears it.
  const applyForceStopKeybind = useCallback(
    async (keybind: string) => {
      setForceStopKeybind(keybind);
      setKeybindError(null);
      try {
        let merged: Record<string, unknown> = { forceStopKeybind: keybind };
        try {
          const raw = await invoke<string>('load_settings');
          const parsed = JSON.parse(raw || '{}');
          merged = { ...parsed, ...merged };
        } catch {}
        await invoke('save_settings', { payload: JSON.stringify(merged) });
        await invoke('set_force_stop_shortcut', { shortcut: keybind });
      } catch (err) {
        const msg = `Could not register keybind: ${err}`;
        setKeybindError(msg);
        showError(msg);
      }
    },
    [showError],
  );

  const clearForceStopKeybind = useCallback(async () => {
    await applyForceStopKeybind('');
  }, [applyForceStopKeybind]);

  const applyAiApiKey = useCallback(
    async (key: string) => {
      setAiApiKey(key);
      try {
        let merged: Record<string, unknown> = { kiloApiKey: key };
        try {
          const raw = await invoke<string>('load_settings');
          const parsed = JSON.parse(raw || '{}');
          merged = { ...parsed, ...merged };
        } catch {}
        await invoke('save_settings', { payload: JSON.stringify(merged) });
      } catch (err) {
        showError(`Failed to save API key: ${err}`);
      }
    },
    [showError],
  );

  const applyAiSystemPrompt = useCallback(
    async (prompt: string) => {
      setAiSystemPrompt(prompt);
      try {
        let merged: Record<string, unknown> = { aiSystemPrompt: prompt };
        try {
          const raw = await invoke<string>('load_settings');
          const parsed = JSON.parse(raw || '{}');
          merged = { ...parsed, ...merged };
        } catch {}
        await invoke('save_settings', { payload: JSON.stringify(merged) });
      } catch (err) {
        showError(`Failed to save system prompt: ${err}`);
      }
    },
    [showError],
  );

  const applyAiPermissions = useCallback(
    async (next: AiPermissions) => {
      setAiPermissions(next);
      try {
        let merged: Record<string, unknown> = { aiPermissions: next };
        try {
          const raw = await invoke<string>('load_settings');
          const parsed = JSON.parse(raw || '{}');
          merged = { ...parsed, ...merged };
        } catch {}
        await invoke('save_settings', { payload: JSON.stringify(merged) });
      } catch (err) {
        showError(`Failed to save AI permissions: ${err}`);
      }
    },
    [showError],
  );

  const resetAiSettings = useCallback(async () => {
    setAiApiKey('');
    setAiSystemPrompt('');
    setAiPermissions({ allowMutations: true, autoApproveSafe: false });
    try {
      let merged: Record<string, unknown> = {
        kiloApiKey: '',
        aiSystemPrompt: '',
        aiPermissions: { allowMutations: true, autoApproveSafe: false },
      };
      try {
        const raw = await invoke<string>('load_settings');
        const parsed = JSON.parse(raw || '{}');
        merged = { ...parsed, ...merged };
      } catch {}
      await invoke('save_settings', { payload: JSON.stringify(merged) });
    } catch (err) {
      showError(`Failed to reset AI settings: ${err}`);
    }
  }, [showError]);

  // â”€â”€ Capture keybind while the user is in "Press a keyâ€¦" mode â”€â”€
  useEffect(() => {
    if (!capturingKeybind) return;
    const handler = (e: KeyboardEvent) => {
      // Esc cancels without registering anything.
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setCapturingKeybind(false);
        return;
      }

      // Ignore lone modifier presses; wait for a real key with at least one
      // modifier so the resulting hotkey is OS-global-safe.
      const isModifier =
        e.key === 'Control' ||
        e.key === 'Shift' ||
        e.key === 'Alt' ||
        e.key === 'Meta';
      if (isModifier) return;

      e.preventDefault();
      e.stopPropagation();

      const parts: string[] = [];
      if (e.ctrlKey) parts.push('ctrl');
      if (e.altKey) parts.push('alt');
      if (e.shiftKey) parts.push('shift');
      if (e.metaKey) parts.push('super');

      // Normalize the key name into the format tauri-plugin-global-shortcut
      // understands. e.code gives physical-position names like "KeyK",
      // "Digit1", "F5"; we strip the prefix and lowercase single chars.
      let key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (key === ' ') key = 'Space';
      if (e.code && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
      else if (e.code && /^Digit\d$/.test(e.code)) key = e.code.slice(5);

      parts.push(key);
      const combo = parts.join('+');

      void applyForceStopKeybind(combo);
      setCapturingKeybind(false);
    };
    const opts: AddEventListenerOptions = { capture: true };
    window.addEventListener('keydown', handler, opts);
    return () => window.removeEventListener('keydown', handler, opts);
  }, [capturingKeybind, applyForceStopKeybind]);

  // Global outside-click + selection-clearing listener. We bind ONCE and
  // read the latest state through refs so keystrokes / dropdown toggles
  // never re-bind the listener.
  const outsideStateRef = useRef({
    contextMenu,
    selectedMacroId,
    page,
  });
  outsideStateRef.current = { contextMenu, selectedMacroId, page };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const s = outsideStateRef.current;
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (s.contextMenu && !(e.target as HTMLElement).closest('[data-context-menu]')) {
        setContextMenu(null);
        setIconSubmenuOpen(false);
      }
      if (
        s.selectedMacroId &&
        s.page === 'macros' &&
        !(e.target as HTMLElement).closest('[data-macro-card]') &&
        !(e.target as HTMLElement).closest('[data-top-bar]')
      ) {
        setSelectedMacroId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const navItems: { id: Page; label: string; icon: typeof Home }[] = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'macros', label: 'Macros', icon: Folder },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const editingMacroProps = editingMacro
    ? {
        isNew: editingMacro.id === 'new',
        runId: editingMacro.id === 'new' ? `new-${Date.now()}` : editingMacro.id,
      }
    : null;

  const handleCreate = () => {
    setEditingMacro({ id: 'new', title: '', description: '', nodes: [], connections: [] });
    setDropdownOpen(false);
  };

  const handleImport = () => {
    setDropdownOpen(false);
    (async () => {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const picked = await open({
          directory: true,
          multiple: false,
          title: 'Select a macro folder to import',
        });
        if (!picked) return;
        const folder = String(picked);
        // Peek at the folder's macro.json to know what we're importing.
        let parsed: { id: string; title: string; description: string; nodes: unknown[]; connections: unknown[] } | null = null;
        try {
          const text = await invoke<string>('read_macro_file', { id: '__peek__' }).catch(() => null);
          // Not useful — we read directly via fetch or just let the Rust
          // command parse. Simpler: ask Rust to do the import directly and
          // then reload the library.
          void text;
        } catch {}
        // Use Rust to import. We need the user to choose Copy vs Move.
        setImportPrompt({
          parsed: { id: 'unknown', title: folder.split(/[\\/]/).pop() || folder, description: '' },
          folder,
        });
      } catch (err) {
        showError(`Failed to open picker: ${err}`);
      }
    })();
  };

  const finalizeImportCopy = async (folder: string) => {
    try {
      const newId = await invoke<string>('import_macro_folder', {
        mode: 'copy',
        source: folder,
      });
      // Re-list and reload macros.
      const macroStrings = await invoke<string[]>('list_macros');
      const loaded: Macro[] = [];
      for (const raw of macroStrings) {
        try {
          const data = JSON.parse(raw);
          if (data && data.id) loaded.push(data as Macro);
        } catch {}
      }
      setMacros(loaded);
      const created = loaded.find((m) => m.id === newId);
      if (created) showError(`Imported "${created.title}" as a copy.`);
    } catch (err) {
      showError(`Failed to copy macro: ${err}`);
    }
  };

  const finalizeImportMove = async (folder: string) => {
    try {
      const newId = await invoke<string>('import_macro_folder', {
        mode: 'move',
        source: folder,
      });
      const macroStrings = await invoke<string[]>('list_macros');
      const loaded: Macro[] = [];
      for (const raw of macroStrings) {
        try {
          const data = JSON.parse(raw);
          if (data && data.id) loaded.push(data as Macro);
        } catch {}
      }
      setMacros(loaded);
      const created = loaded.find((m) => m.id === newId);
      if (created) showError(`Moved "${created.title}" into your library.`);
    } catch (err) {
      showError(`Failed to move macro: ${err}`);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, macroId: string) => {
    e.preventDefault();
    setSelectedMacroId(macroId);
    setContextMenu({ x: e.clientX, y: e.clientY, macroId });
  };

  const handleCardClick = (macroId: string) => {
    setSelectedMacroId((prev) => (prev === macroId ? null : macroId));
  };

  const handleStartSelected = () => {
    if (!selectedMacroId || runningMacroId) return;
    const macro = macros.find((m) => m.id === selectedMacroId);
    if (!macro) return;
    handleStartMacro(macro);
  };

  const handleToggleRun = () => {
    if (runningMacroId) {
      handleStopMacro();
      return;
    }
    handleStartSelected();
  };

  const handleAiCreate = useCallback((macro: Macro) => {
    const stamped: Macro = { ...macro, madeByAi: true };
    setMacros((prev) => {
      const without = prev.filter((m) => m.id !== stamped.id);
      return [stamped, ...without];
    });
    setEditingMacro(stamped);
    setAiModalOpen(false);
  }, []);

  const handleAiEdit = useCallback(
    (
      id: string,
      body: {
        title?: string;
        description?: string;
        nodes?: import('./components/editor/types').EditorNode[];
        connections?: import('./components/editor/types').Connection[];
      },
    ) => {
      setMacros((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                title: body.title ?? m.title,
                description: body.description ?? m.description,
                nodes: body.nodes ?? m.nodes,
                connections: body.connections ?? m.connections,
              }
            : m,
        ),
      );
    },
    [],
  );

  const handleAiRename = useCallback((id: string, title: string) => {
    setMacros((prev) => prev.map((m) => (m.id === id ? { ...m, title } : m)));
  }, []);

  const handleAiDelete = useCallback(
    (id: string) => {
      setMacros((prev) => prev.filter((m) => m.id !== id));
      invoke('delete_macro_file', { id }).catch((err) =>
        showError(`Failed to delete macro on disk: ${err}`),
      );
    },
    [showError],
  );

  const handleAiDuplicate = useCallback((id: string, newTitle?: string) => {
    setMacros((prev) => {
      const src = prev.find((m) => m.id === id);
      if (!src) return prev;
      const dup: Macro = {
        ...src,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: newTitle || `${src.title} (copy)`,
        madeByAi: true,
      };
      return [dup, ...prev];
    });
  }, []);

  const setMacroIcon = (id: string, icon: MacroIconKey | typeof AUTO_ICON_KEY) => {
    setMacros((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m;
        if (icon === AUTO_ICON_KEY) {
          const { icon: _drop, ...rest } = m;
          return rest as Macro;
        }
        return { ...m, icon };
      }),
    );
    setIconSubmenuOpen(false);
  };

  const handleMacroAction = (action: 'view' | 'edit' | 'run' | 'download' | 'delete', id: string) => {
    setContextMenu(null);
    const macro = macros.find((m) => m.id === id);
    if (!macro) return;
    if (action === 'delete') {
      if (confirm(`Delete macro "${macro.title}"?`)) {
        invoke('delete_macro_file', { id }).catch(() => {});
        setMacros(macros.filter((m) => m.id !== id));
      }
    } else if (action === 'edit') {
      setEditingMacro(macro);
    } else if (action === 'run') {
      if (runningMacroId) {
        handleStopMacro();
      }
      handleStartMacro(macro);
    } else if (action === 'download') {
      const data = {
        exportedAt: new Date().toISOString(),
        title: macro.title,
        description: macro.description,
        nodes: macro.nodes,
        connections: macro.connections,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${macro.title.replace(/[^a-z0-9_-]/gi, '_') || 'macro'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (action === 'view') {
      setViewingMacro(macro);
    }
  };

  if (editingMacro && editingMacroProps) {
    const m = editingMacro;
    const p = editingMacroProps;
    return (
      <EditorPage
        key={m.id}
        initialNodes={m.nodes}
        initialConnections={m.connections}
        macroToEdit={
          p.isNew
            ? null
            : { id: m.id, title: m.title, description: m.description }
        }
        onStartRun={(data) => handleStartFromEditor(p.runId, data)}
        onStopRun={handleStopMacro}
        isRunning={runningMacroId === p.runId}
        logs={logs}
        onClearLogs={() => setLogs([])}
        onUpdateMacro={(id, data) => {
          setMacros(macros.map((mm) => (mm.id === id ? { ...mm, ...data } : mm)));
          setEditingMacro(null);
        }}
        onDeleteMacro={(id) => {
          invoke('delete_macro_file', { id }).catch(() => {});
          setMacros(macros.filter((mm) => mm.id !== id));
          setEditingMacro(null);
        }}
        onExit={() => setEditingMacro(null)}
        onSave={(data) => {
          const newMacro: Macro = { id: Date.now().toString(), ...data };
          setMacros([newMacro, ...macros]);
          setEditingMacro(null);
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col bg-neutral-950">
      <nav className="flex h-14 items-center justify-between border-b border-neutral-800/80 bg-neutral-950 px-6">
        <div className="flex items-center gap-6">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setPage(id)}
              className={`relative flex h-9 items-center gap-2 px-2 text-sm transition-colors ${
                page === id ? 'text-white' : 'text-neutral-500 hover:text-neutral-200'
              }`}
            >
              <Icon size={14} strokeWidth={2.25} />
              <span className="font-medium">{label}</span>
            </button>
          ))}
        </div>

        {page === 'macros' && (
          <div data-top-bar className="flex items-center gap-2">
            <div ref={dropdownRef} className="relative">
              <Button
                variant="primary"
                size="md"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="h-9"
              >
                <Plus size={16} />
                Add macro
                <ChevronDown size={14} className={`transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
              </Button>
              {dropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-44 overflow-hidden rounded-md border border-neutral-700/70 bg-neutral-900 shadow-xl shadow-black/40 z-10">
                  <button
                    onClick={handleCreate}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
                  >
                    <Sparkles size={15} className="text-neutral-500" />
                    Create
                  </button>
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      setAiModalOpen(true);
                    }}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
                  >
                    <Wand2 size={15} className="text-neutral-500" />
                    Create with AI
                  </button>
                  <div className="mx-3 border-t border-neutral-800" />
                  <button
                    onClick={handleImport}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
                  >
                    <Upload size={15} className="text-neutral-500" />
                    Import
                  </button>
                </div>
              )}
            </div>

            <div className="h-6 w-px bg-neutral-800" />

            <button
              onClick={selectedMacroId || runningMacroId ? handleToggleRun : undefined}
              disabled={!selectedMacroId && !runningMacroId}
              className={`h-9 px-3 flex items-center gap-1.5 rounded-md border text-sm font-medium transition-colors ${
                runningMacroId
                  ? 'border-red-500/40 text-red-400 hover:bg-red-500/10'
                  : selectedMacroId
                    ? 'border-green-500/40 text-green-400 hover:bg-green-500/10'
                    : 'border-neutral-800 text-neutral-600 cursor-not-allowed'
              }`}
              title={
                runningMacroId
                  ? 'Stop running macro'
                  : selectedMacroId
                    ? `Run "${macros.find((m) => m.id === selectedMacroId)?.title ?? ''}"`
                    : 'Select a macro to run'
              }
            >
              {runningMacroId ? <Square size={14} /> : <Play size={14} />}
              {runningMacroId ? 'Stop' : 'Start'}
            </button>
          </div>
        )}
      </nav>

      {(updater.state.kind === 'available' ||
        updater.state.kind === 'downloading' ||
        updater.state.kind === 'ready-to-install' ||
        updater.state.kind === 'installing') && !editingMacro && (
        <div
          className={cn(
            'flex items-center gap-3 border-b px-6 py-2 text-xs',
            updater.state.kind === 'ready-to-install' || updater.state.kind === 'installing'
              ? 'border-green-500/30 bg-green-500/10 text-green-300'
              : 'border-blue-500/30 bg-blue-500/10 text-blue-300',
          )}
        >
          <Download size={14} />
          <span className="flex-1">
            {updater.state.kind === 'available' &&
              `Version ${updater.state.update.version} is available.`}
            {updater.state.kind === 'downloading' &&
              `Downloading ${updater.state.update.version}… ${Math.round(updater.state.progress * 100)}%`}
            {updater.state.kind === 'ready-to-install' &&
              `Version ${updater.state.update.version} ready. Restart to install.`}
            {updater.state.kind === 'installing' &&
              `Launching installer for ${updater.state.update.version}… the app will exit.`}
          </span>
          {updater.state.kind === 'downloading' && (
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-blue-400 transition-[width]"
                style={{ width: `${Math.round(updater.state.progress * 100)}%` }}
              />
            </div>
          )}
          <Button
            variant="primary"
            size="sm"
            disabled={updater.state.kind === 'downloading' || updater.state.kind === 'installing'}
            onClick={() => void updater.install()}
          >
            {updater.state.kind === 'ready-to-install' ? 'Restart now' : 'Download & install'}
          </Button>
        </div>
      )}

      <main className="flex-1 overflow-y-auto px-6 py-6">
        {page === 'home' && (
          <div className="mx-auto max-w-3xl">
            <div className="mb-8">
              <h1 className="text-2xl font-semibold tracking-tight text-white">
                Welcome to Project M
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-neutral-400">
                Build automations with a visual node editor. Chain together triggers,
                inputs, and actions without writing code.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Card
                interactive
                onClick={() => setPage('macros')}
                className="group transition-colors hover:border-neutral-700"
              >
                <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-sm bg-neutral-800 text-neutral-300">
                  <Folder size={15} strokeWidth={1.75} />
                </div>
                <CardTitle className="text-[13px]">My Macros</CardTitle>
                <CardDescription className="mt-1">View and manage your saved automations</CardDescription>
              </Card>
              <Card
                interactive
                onClick={() => {
                  setPage('settings');
                  setSettingsTab('common');
                }}
                className="transition-colors hover:border-neutral-700"
              >
                <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-sm bg-neutral-800 text-neutral-300">
                  <Settings size={15} strokeWidth={1.75} />
                </div>
                <CardTitle className="text-[13px]">Settings</CardTitle>
                <CardDescription className="mt-1">Configure application preferences</CardDescription>
              </Card>
            </div>
          </div>
        )}

        {page === 'macros' && (
          <div className="mx-auto max-w-5xl">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-white">Your Macros</h2>
              <p className="mt-0.5 text-xs text-neutral-500">
                {macros.length} saved · right-click a macro for actions
              </p>
            </div>

            {macros.length === 0 ? (
              <Card className="border-dashed border-neutral-800 bg-transparent">
                <div className="flex flex-col items-center py-8 text-center">
                  <Sparkles size={24} className="text-neutral-600" />
                  <CardTitle className="mt-3">No macros yet</CardTitle>
                  <CardDescription className="mt-1">
                    Click "Add macro" to create your first automation
                  </CardDescription>
                </div>
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {macros.map((macro) => {
                  const isRunning = runningMacroId === macro.id;
                  const isSelected = selectedMacroId === macro.id;
                  const usesAhk = macro.nodes.some((n) => n.type === 'ipc-command');
                  return (
                    <Card
                      key={macro.id}
                      interactive
                      selected={isSelected}
                      onClick={() => handleCardClick(macro.id)}
                      onContextMenu={(e) => handleContextMenu(e, macro.id)}
                      onDoubleClick={() => setEditingMacro(macro)}
                      data-macro-card={macro.id}
                      className={`group cursor-pointer transition-colors ${
                        isRunning
                          ? 'border-neutral-700 bg-neutral-900'
                          : 'border-neutral-800 hover:border-neutral-700'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <MacroIconBadge macro={macro} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <CardTitle className="flex items-center gap-2 min-w-0">
                              <span className="truncate text-[13px]">{macro.title}</span>
                              {usesAhk && (
                                <span
                                  className={`inline-flex shrink-0 items-center rounded-sm border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider font-mono ${
                                    ahkListening
                                      ? 'border-neutral-700 text-neutral-400'
                                      : 'border-red-500/30 text-red-400'
                                  }`}
                                  title={
                                    ahkListening
                                      ? 'AHK IPC listener (AHK_IPC) is running'
                                      : 'AHK IPC listener not found â€” start the .ahk script'
                                  }
                                >
                                  .ahk
                                </span>
                              )}
                              {macro.madeByAi && (
                                <span
                                  className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-neutral-700 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider font-mono text-neutral-400"
                                  title="Created by AI"
                                >
                                  <Sparkles size={9} />
                                  AI
                                </span>
                              )}
                            </CardTitle>
                            {isRunning && (
                              <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                                <span className="relative flex h-1.5 w-1.5">
                                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
                                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
                                </span>
                                Running
                              </span>
                            )}
                          </div>
                          <CardDescription className="mt-0.5 line-clamp-2 text-[11px] text-neutral-500">
                            {macro.description || `${macro.nodes.length} nodes Â· ${macro.connections.length} connections`}
                          </CardDescription>
                        </div>
                      </div>
                    </Card>
                  );
                })}

                {contextMenu && (
                  <div
                    data-context-menu
                    className="fixed z-50 w-44 overflow-hidden rounded-md border border-neutral-700/70 bg-neutral-900 shadow-xl shadow-black/40"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                  >
                    <button
                      onClick={() => handleMacroAction('run', contextMenu.macroId)}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
                    >
                      <Play size={15} className="text-neutral-500" />
                      Run
                    </button>
                    <div className="mx-3 border-t border-neutral-800" />
                    <div data-context-menu>
                      <button
                        onClick={() => setIconSubmenuOpen((v) => !v)}
                        className="flex w-full items-center justify-between gap-2.5 px-4 py-2.5 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
                      >
                        <span className="flex items-center gap-2.5">
                          {(() => {
                            const m = macros.find((x) => x.id === contextMenu.macroId);
                            const CurIcon = m ? getMacroIcon(m) : CircleHelp;
                            return <CurIcon size={15} className="text-neutral-500" />;
                          })()}
                          Change icon
                        </span>
                        <ChevronDown size={13} className={`text-neutral-500 transition-transform ${iconSubmenuOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {iconSubmenuOpen && (
                        <div className="border-y border-neutral-800 bg-neutral-950/60 px-2 py-2">
                          <div className="grid grid-cols-5 gap-1">
                            <button
                              onClick={() => setMacroIcon(contextMenu.macroId, AUTO_ICON_KEY)}
                              className={`relative h-8 w-8 flex items-center justify-center rounded-sm transition-colors ${
                                isIconAuto(macros.find((m) => m.id === contextMenu.macroId)!)
                                  ? 'bg-neutral-800 text-white'
                                  : 'text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200'
                              }`}
                              title={`Auto (${getMacroIconKey(macros.find((m) => m.id === contextMenu.macroId)!)} based on nodes)`}
                            >
                              {(() => {
                                const m = macros.find((x) => x.id === contextMenu.macroId)!;
                                const AutoIcon = MACRO_ICON_MAP[detectMacroIcon(m)];
                                return <AutoIcon size={15} strokeWidth={1.75} />;
                              })()}
                              {isIconAuto(macros.find((m) => m.id === contextMenu.macroId)!) && (
                                <Check size={9} className="absolute -right-0.5 -top-0.5 text-green-400" />
                              )}
                            </button>
                            {MACRO_ICON_OPTIONS.map(({ key, Icon }) => {
                              const m = macros.find((x) => x.id === contextMenu.macroId);
                              const active = m?.icon === key;
                              return (
                                <button
                                  key={key}
                                  onClick={() => setMacroIcon(contextMenu.macroId, key)}
                                  className={`relative h-8 w-8 flex items-center justify-center rounded-sm transition-colors ${
                                    active
                                      ? 'bg-neutral-800 text-white'
                                      : 'text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200'
                                  }`}
                                  title={key}
                                >
                                  <Icon size={15} strokeWidth={1.75} />
                                  {active && (
                                    <Check size={9} className="absolute -right-0.5 -top-0.5 text-green-400" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleMacroAction('view', contextMenu.macroId)}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
                    >
                      <Eye size={15} className="text-neutral-500" />
                      View
                    </button>
                    <button
                      onClick={() => handleMacroAction('edit', contextMenu.macroId)}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
                    >
                      <PencilLine size={15} className="text-neutral-500" />
                      Edit
                    </button>
                    <button
                      onClick={() => handleMacroAction('download', contextMenu.macroId)}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
                    >
                      <Download size={15} className="text-neutral-500" />
                      Download
                    </button>
                    <div className="mx-3 border-t border-neutral-800" />
                    <button
                      onClick={() => handleMacroAction('delete', contextMenu.macroId)}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-red-400 transition-colors hover:bg-red-500/10"
                    >
                      <Trash2 size={15} />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {page === 'settings' && (
          <div className="mx-auto max-w-3xl space-y-4">
            <div>
              <h1 className="text-xl font-semibold text-white">Settings</h1>
              <p className="mt-1 text-sm text-neutral-400">
                Configure application preferences
              </p>
            </div>

            <div role="tablist" className="flex items-center gap-1 border-b border-white/5">
              <SettingsTab
                active={settingsTab === 'common'}
                onClick={() => setSettingsTab('common')}
                label="Common"
              />
              <SettingsTab
                active={settingsTab === 'advanced'}
                onClick={() => setSettingsTab('advanced')}
                label="Advanced"
              />
              <SettingsTab
                active={settingsTab === 'ai'}
                onClick={() => setSettingsTab('ai')}
                label="AI"
              />
              <SettingsTab
                active={settingsTab === 'security'}
                onClick={() => setSettingsTab('security')}
                label="Security"
              />
              <SettingsTab
                active={settingsTab === 'system'}
                onClick={() => setSettingsTab('system')}
                label="System"
              />
            </div>

            {settingsTab === 'common' && (
              <Card>
                <CardTitle className="text-[13px]">Force Stop hotkey</CardTitle>
                <CardDescription className="mt-1">
                  Press this shortcut anywhere on your system to instantly halt
                  the running macro.
                </CardDescription>

                <div className="mt-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    Global hotkey
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <div
                      className={`inline-flex h-9 min-w-[120px] items-center justify-center rounded-md border px-3 text-sm ${
                        capturingKeybind
                          ? 'border-green-500/60 bg-green-500/10 text-green-300'
                          : forceStopKeybind
                            ? 'border-white/10 bg-neutral-800 text-neutral-100'
                            : 'border-dashed border-neutral-700 bg-neutral-900 text-neutral-500'
                      }`}
                    >
                      {capturingKeybind
                        ? 'Press a key…'
                        : forceStopKeybind || 'Not set'}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setKeybindError(null);
                        setCapturingKeybind(true);
                      }}
                    >
                      {forceStopKeybind ? 'Change' : 'Capture'}
                    </Button>
                    {forceStopKeybind && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void clearForceStopKeybind()}
                      >
                        Clear
                      </Button>
                    )}
                  </div>

                  {keybindError && (
                    <p className="mt-2 text-xs text-red-400">{keybindError}</p>
                  )}
                </div>
              </Card>
            )}

            {settingsTab === 'advanced' && (
              <Card>
                <CardTitle className="text-[13px]">Advanced</CardTitle>
                <CardDescription className="mt-1">
                  Low-level options. Most users won't need to touch this.
                </CardDescription>
                <div className="mt-4 rounded-md border border-dashed border-neutral-700 bg-neutral-950/30 px-4 py-6 text-center text-xs text-neutral-500">
                  No advanced settings yet.
                </div>
              </Card>
            )}

            {settingsTab === 'ai' && (
              <Card>
                <CardTitle className="flex items-center gap-2 text-[13px]">
                  <Bot size={14} className="text-green-500" />
                  AI
                </CardTitle>
                <CardDescription className="mt-1">
                  Used by the "Create with AI" macro builder. Stored in settings.json; get a key at kilo.ai.
                </CardDescription>

                <div className="mt-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    Kilo API key
                  </div>

                  {!aiKeyEditing ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <div className="inline-flex h-9 min-w-[180px] items-center rounded-md border border-white/10 bg-neutral-800 px-3 text-sm font-mono text-neutral-200">
                        {aiApiKey ? `${aiApiKey.slice(0, 4)}…${aiApiKey.slice(-3)}` : 'Not set'}
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setAiKeyDraft(aiApiKey);
                          setAiKeyEditing(true);
                          setAiKeyTest('idle');
                        }}
                      >
                        {aiApiKey ? 'Change' : 'Set'}
                      </Button>
                      {aiApiKey && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void applyAiApiKey('')}
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Input
                          type={aiKeyVisible ? 'text' : 'password'}
                          value={aiKeyDraft}
                          onChange={(e) => setAiKeyDraft(e.target.value)}
                          placeholder="kilo_…"
                          className="flex-1 font-mono"
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setAiKeyVisible((v) => !v)}
                          title={aiKeyVisible ? 'Hide' : 'Show'}
                        >
                          {aiKeyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={!aiKeyDraft.trim()}
                          onClick={async () => {
                            await applyAiApiKey(aiKeyDraft.trim());
                            setAiKeyEditing(false);
                          }}
                        >
                          Save
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={aiKeyTest === 'testing'}
                          disabled={!aiKeyDraft.trim() || aiKeyTest === 'testing'}
                          onClick={async () => {
                            setAiKeyTest('testing');
                            try {
                              await invoke('kilo_test_api_key', {
                                req: {
                                  apiKey: aiKeyDraft.trim(),
                                  model: 'openrouter/free',
                                  messages: [],
                                },
                              });
                              setAiKeyTest('ok');
                            } catch {
                              setAiKeyTest('fail');
                            }
                          }}
                        >
                          Test
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setAiKeyEditing(false);
                            setAiKeyTest('idle');
                          }}
                        >
                          Cancel
                        </Button>
                        {aiKeyTest === 'ok' && (
                          <span className="text-xs text-green-400">✓ Key works</span>
                        )}
                        {aiKeyTest === 'fail' && (
                          <span className="text-xs text-red-400">✗ Key rejected</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-6 border-t border-white/5 pt-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    System prompt
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">
                    Sent to the model on every chat. Controls output format, node registry,
                    and style guidelines.
                  </p>

                  {!aiPromptEditing ? (
                    <div className="mt-3 flex items-start gap-2">
                      <pre className="flex-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-white/10 bg-neutral-950/40 px-3 py-2 text-[11px] font-mono leading-relaxed text-neutral-300">
                        {aiSystemPrompt || DEFAULT_AI_SYSTEM_PROMPT}
                      </pre>
                      <div className="flex flex-col gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setAiPromptDraft(aiSystemPrompt);
                            setAiPromptEditing(true);
                          }}
                        >
                          {aiSystemPrompt ? 'Edit' : 'Edit default'}
                        </Button>
                        {aiSystemPrompt && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              void applyAiSystemPrompt('');
                            }}
                          >
                            Reset
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      <textarea
                        value={aiPromptDraft}
                        onChange={(e) => setAiPromptDraft(e.target.value)}
                        rows={16}
                        spellCheck={false}
                        className="w-full resize-y rounded-md border border-white/10 bg-neutral-950/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-neutral-200 focus:border-green-500/60 focus:outline-none focus:ring-1 focus:ring-green-500/30"
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={async () => {
                            await applyAiSystemPrompt(aiPromptDraft);
                            setAiPromptEditing(false);
                          }}
                        >
                          Save
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setAiPromptDraft(DEFAULT_AI_SYSTEM_PROMPT);
                          }}
                        >
                          Reset to default
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setAiPromptEditing(false)}
                        >
                          Cancel
                        </Button>
                        <span className="ml-auto text-[10px] text-neutral-600">
                          {aiPromptDraft.length.toLocaleString()} chars
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-6 border-t border-white/5 pt-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    Permissions
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">
                    Controls what the AI is allowed to do to your macro library.
                  </p>

                  <div className="mt-3 flex flex-col gap-2">
                    <ToggleRow
                      label="Allow AI to mutate your library"
                      description="Edit, rename, duplicate, and delete existing macros. Off = AI can only create new ones."
                      checked={aiPermissions.allowMutations}
                      onChange={(v) => void applyAiPermissions({ ...aiPermissions, allowMutations: v })}
                    />
                    <ToggleRow
                      label="Auto-approve safe edits"
                      description="When on, edit / rename / duplicate skip the confirmation card. Deletes ALWAYS require approval."
                      checked={aiPermissions.autoApproveSafe}
                      disabled={!aiPermissions.allowMutations}
                      onChange={(v) => void applyAiPermissions({ ...aiPermissions, autoApproveSafe: v })}
                    />
                  </div>
                </div>

                <div className="mt-6 border-t border-white/5 pt-4">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                      Reset
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm('Reset all AI settings (API key, system prompt, permissions) to defaults?')) {
                          void resetAiSettings();
                        }
                      }}
                    >
                      Reset AI settings
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            {settingsTab === 'security' && (
              <Card>
                <CardTitle className="text-[13px]">Security</CardTitle>
                <CardDescription className="mt-1">
                  Permissions and isolation for macro execution.
                </CardDescription>
                <div className="mt-4 rounded-md border border-dashed border-neutral-700 bg-neutral-950/30 px-4 py-6 text-center text-xs text-neutral-500">
                  No security settings yet.
                </div>
              </Card>
            )}

            {settingsTab === 'system' && (
              <Card>
                <CardTitle className="text-[13px]">System</CardTitle>
                <CardDescription className="mt-1">
                  Engine diagnostics, log files, and update channel.
                </CardDescription>

                <div className="mt-4 flex items-center justify-between gap-2 rounded-md border border-white/5 bg-neutral-950/40 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-neutral-200">Updates</div>
                    <div className="mt-0.5 text-[11px] text-neutral-500">
                      {updater.state.kind === 'idle' && 'Checking for updates…'}
                      {updater.state.kind === 'checking' && 'Checking for updates…'}
                      {updater.state.kind === 'up-to-date' && `Up to date (checked ${new Date(updater.state.checkedAt).toLocaleTimeString()})`}
                      {updater.state.kind === 'available' && `Version ${updater.state.update.version} is available`}
                      {updater.state.kind === 'downloading' && `Downloading ${updater.state.update.version}… ${Math.round(updater.state.progress * 100)}%`}
                      {updater.state.kind === 'ready-to-install' && `Restart to install ${updater.state.update.version}`}
                      {updater.state.kind === 'installing' && `Launching installer for ${updater.state.update.version}…`}
                      {updater.state.kind === 'failed' && `Update check failed: ${updater.state.message}`}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={
                        updater.state.kind === 'checking' ||
                        updater.state.kind === 'downloading' ||
                        updater.state.kind === 'installing'
                      }
                      onClick={() => void updater.checkNow()}
                    >
                      Check now
                    </Button>
                    {(updater.state.kind === 'available' ||
                      updater.state.kind === 'ready-to-install' ||
                      updater.state.kind === 'failed') && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => void updater.install()}
                      >
                        {updater.state.kind === 'ready-to-install' ? 'Restart' : 'Install update'}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void updater.openReleases()}
                    >
                      Open releases page
                    </Button>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-2 rounded-md border border-white/5 bg-neutral-950/40 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-neutral-200">Bundled presets</div>
                    <div className="mt-0.5 text-[11px] text-neutral-500">
                      Sample macros that ship with the installer. Import skips any whose id already exists in your library.
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      try {
                        const result = await invoke<{
                          imported: string[];
                          skipped: string[];
                          failed: string[];
                          source: string;
                        }>('import_bundled_presets');
                        // Reload library so the new macros appear immediately.
                        const macroStrings = await invoke<string[]>('list_macros');
                        const loaded: Macro[] = [];
                        for (const raw of macroStrings) {
                          try {
                            const data = JSON.parse(raw);
                            if (data && data.id) loaded.push(data as Macro);
                          } catch {}
                        }
                        setMacros(loaded);
                        const parts: string[] = [];
                        if (result.imported.length > 0) {
                          parts.push(`Imported ${result.imported.length}: ${result.imported.join(', ')}.`);
                        }
                        if (result.skipped.length > 0) {
                          parts.push(`Skipped (already present): ${result.skipped.join(', ')}.`);
                        }
                        if (result.failed.length > 0) {
                          parts.push(`Failed: ${result.failed.join('; ')}.`);
                        }
                        if (parts.length === 0) {
                          toast.error(
                            `No presets found at ${result.source}.\nReinstall the app or import macros manually.`,
                            'Bundled presets missing',
                          );
                        } else if (result.failed.length > 0) {
                          toast.error(parts.join('\n'), 'Imported with errors');
                        } else {
                          toast.success(parts.join('\n'), 'Presets imported');
                        }
                      } catch (err) {
                        toast.error(`Failed to import presets: ${err}`);
                      }
                    }}
                  >
                    Import bundled presets
                  </Button>
                </div>
              </Card>
            )}
          </div>
        )}
      </main>

      <Modal
        open={!!keybindWarnPrompt}
        onClose={() => setKeybindWarnPrompt(null)}
        title="No Force Stop keybind set"
        description="You haven't configured a global hotkey to force-stop running macros. The macro will start, but you won't be able to halt it with a keystroke. Set one in Settings â†’ Force Stop hotkey."
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setKeybindWarnPrompt(null)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={async () => {
                const proceed = keybindWarnPrompt;
                setKeybindWarnPrompt(null);
                if (proceed) await proceed();
              }}
            >
              Run anyway
            </Button>
          </>
        }
      />

      <Modal
        open={!!ahkPrompt}
        onClose={() => {
          if (ahkPromptBusy) return;
          setAhkPrompt(null);
        }}
        title="AHK IPC listener not found"
        description={
          ahkPrompt
            ? `This macro uses an AHK node but the IPC listener isn't running. Start "${ahkPrompt.title}" and the listener together?`
            : ''
        }
        size="sm"
        closeOnEscape={!ahkPromptBusy}
        closeOnBackdrop={!ahkPromptBusy}
        hideCloseButton={ahkPromptBusy}
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={ahkPromptBusy}
              onClick={() => setAhkPrompt(null)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={ahkPromptBusy}
              disabled={ahkPromptBusy}
              onClick={async () => {
                if (!ahkPrompt) return;
                setAhkPromptBusy(true);
                try {
                  await invoke('start_ipc_listener');
                  // Re-check after a short delay; the listener registers its
                  // AHK_IPC window asynchronously after launch.
                  for (let i = 0; i < 6; i++) {
                    const listening = await invoke<boolean>('check_ahk');
                    if (listening) {
                      setAhkListening(true);
                      break;
                    }
                    await new Promise((r) => setTimeout(r, 250));
                  }
                  const proceed = ahkPrompt.onConfirm;
                  setAhkPrompt(null);
                  await proceed();
                } catch (err) {
                  showError(`Failed to start AHK listener: ${err}`);
                } finally {
                  setAhkPromptBusy(false);
                }
              }}
            >
              Start .ahk .exe & run
            </Button>
          </>
        }
      />

      <Suspense fallback={null}>
        <CreateWithAiModal
          open={aiModalOpen}
          apiKey={aiApiKey}
          systemPrompt={aiSystemPrompt}
          macros={macros}
          permissions={aiPermissions}
          onClose={() => setAiModalOpen(false)}
          onCreateMacro={handleAiCreate}
          onApplyEdit={handleAiEdit}
          onApplyRename={handleAiRename}
          onApplyDelete={handleAiDelete}
          onApplyDuplicate={handleAiDuplicate}
        />
      </Suspense>

      <ViewMacroModal
        open={!!viewingMacro}
        macro={viewingMacro ?? { id: '', title: '', description: '', nodes: [], connections: [] }}
        onClose={() => setViewingMacro(null)}
        onSave={(updated) => {
          setMacros(macros.map((m) => (m.id === updated.id ? updated : m)));
          setViewingMacro(null);
        }}
      />

      <LogsPanel
        open={!!runningMacroId}
        logs={logs}
        onClear={() => setLogs([])}
        onStop={handleStopMacro}
      />

      <Modal
        open={!!importPrompt}
        onClose={() => setImportPrompt(null)}
        title="Import macro folder"
        size="sm"
        description={
          importPrompt
            ? `Import "${importPrompt.parsed.title}" into your library?`
            : ''
        }
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setImportPrompt(null)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                const folder = importPrompt?.folder;
                setImportPrompt(null);
                if (folder) await finalizeImportMove(folder);
              }}
            >
              Move (no copy)
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={async () => {
                const folder = importPrompt?.folder;
                setImportPrompt(null);
                if (folder) await finalizeImportCopy(folder);
              }}
            >
              Copy
            </Button>
          </>
        }
      >
        <div className="text-sm text-neutral-300 space-y-2">
          <p>
            <strong>Copy</strong> duplicates the folder into your local library
            and keeps the source intact. <strong>Move</strong> transfers the
            folder without duplication. Either way, the folder will be renamed
            if an id collision exists.
          </p>
          {importPrompt?.parsed.description && (
            <p className="text-xs text-neutral-500">{importPrompt.parsed.description}</p>
          )}
        </div>
      </Modal>
    </div>
  );
}

function SettingsTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative -mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
        active
          ? 'border-green-500 text-neutral-100'
          : 'border-transparent text-neutral-500 hover:text-neutral-200'
      }`}
    >
      {label}
    </button>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-md border border-white/5 bg-neutral-950/40 px-3 py-2 ${
        disabled ? 'opacity-50' : 'cursor-pointer'
      }`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative mt-0.5 inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-green-500/60' : 'bg-neutral-700'
        } ${disabled ? 'cursor-not-allowed' : ''}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-neutral-100 transition-transform ${
            checked ? 'translate-x-[16px]' : ''
          }`}
        />
      </button>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-medium text-neutral-200">{label}</span>
        {description && (
          <span className="mt-0.5 block text-[11px] text-neutral-500">{description}</span>
        )}
      </span>
    </label>
  );
}

function MacroIconBadge({ macro, size = 16 }: { macro: Macro; size?: number }) {
  const Icon = getMacroIcon(macro);
  const isAuto = !macro.icon;
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-neutral-400"
      title={isAuto ? `Auto: ${detectMacroIcon(macro)}` : macro.icon}
    >
      <Icon size={size} strokeWidth={1.75} />
    </div>
  );
}

function isIconAuto(macro: Macro): boolean {
  return !macro.icon;
}
