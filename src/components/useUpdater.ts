import { useCallback, useEffect, useRef, useState } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { open as openInBrowser } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date'; checkedAt: number }
  | { kind: 'available'; update: Update; checkedAt: number }
  | { kind: 'downloading'; update: Update; progress: number }
  | { kind: 'ready-to-install'; update: Update }
  | { kind: 'installing'; update: Update }
  | { kind: 'failed'; message: string; fallbackUrl?: string };

const POLL_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6 hours

interface UseUpdaterOptions {
  checkOnMount?: boolean;
  backgroundPoll?: boolean;
  /** Override the fallback URL we open when an update can't auto-install. */
  releasesUrl?: string;
}

export function useUpdater(opts: UseUpdaterOptions = {}): {
  state: UpdateState;
  checkNow: () => Promise<void>;
  install: () => Promise<void>;
  openReleases: () => Promise<void>;
} {
  const { checkOnMount = true, backgroundPoll = true, releasesUrl } = opts;
  const [state, setState] = useState<UpdateState>({ kind: 'idle' });
  const inFlight = useRef<Promise<void> | null>(null);

  const fallbackUrl = useCallback(async (): Promise<string> => {
    if (releasesUrl) return releasesUrl;
    try {
      const repo = await invoke<string>('github_repo_url');
      return `${repo}/releases/latest`;
    } catch {
      return 'https://github.com/Herra-Atlas/project-m/releases/latest';
    }
  }, [releasesUrl]);

  const checkNow = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    inFlight.current = (async () => {
      setState((s) => (s.kind === 'downloading' || s.kind === 'installing' ? s : { kind: 'checking' }));
      try {
        const update = await check();
        if (update === null) {
          setState({ kind: 'up-to-date', checkedAt: Date.now() });
        } else {
          setState({ kind: 'available', update, checkedAt: Date.now() });
        }
      } catch (e) {
        const url = await fallbackUrl();
        setState({ kind: 'failed', message: String(e), fallbackUrl: url });
      } finally {
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }, [fallbackUrl]);

  const install = useCallback(async () => {
    if (state.kind === 'installing' || state.kind === 'downloading') return;
    setState((s) => {
      if (s.kind === 'available' || s.kind === 'ready-to-install') {
        return { kind: 'downloading', update: s.update, progress: 0 };
      }
      return s;
    });

    try {
      const update =
        state.kind === 'available' || state.kind === 'ready-to-install'
          ? state.update
          : await check();
      if (update === null) {
        setState({ kind: 'up-to-date', checkedAt: Date.now() });
        return;
      }

      let total = 0;
      let downloaded = 0;

      // Tauri calls the callback synchronously when the download starts,
      // while downloading, and when the bytes are received. We must NOT
      // await inside the callback — that would block progress reporting
      // and risk starving the runtime.
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            total = event.data.contentLength ?? 0;
            downloaded = 0;
            setState({ kind: 'downloading', update, progress: 0 });
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            setState({
              kind: 'downloading',
              update,
              progress: total ? downloaded / total : 0,
            });
            break;
          case 'Finished':
            setState({ kind: 'ready-to-install', update });
            break;
        }
      });

      // downloadAndInstall returns AFTER it has spawned the installer and
      // scheduled the app exit. If we got here without throwing, the
      // installer is launching.
      setState({ kind: 'installing', update });
    } catch (e) {
      const url = await fallbackUrl();
      setState({ kind: 'failed', message: String(e), fallbackUrl: url });
    }
  }, [state, fallbackUrl]);

  const openReleases = useCallback(async () => {
    const url = await fallbackUrl();
    try {
      await openInBrowser(url);
    } catch {
      // ignore — the URL is in state for the user to copy
    }
  }, [fallbackUrl]);

  useEffect(() => {
    if (!checkOnMount) return;
    void checkNow();
    if (!backgroundPoll) return;
    const t = setInterval(() => {
      void checkNow();
    }, POLL_THROTTLE_MS);
    return () => clearInterval(t);
  }, [checkOnMount, backgroundPoll, checkNow]);

  return { state, checkNow, install, openReleases };
}