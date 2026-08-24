import { useCallback, useEffect, useRef, useState } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date'; checkedAt: number }
  | { kind: 'available'; update: Update; checkedAt: number }
  | { kind: 'downloading'; update: Update; progress: number }
  | { kind: 'downloaded'; update: Update }
  | { kind: 'error'; message: string };

const POLL_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6 hours between background checks

interface UseUpdaterOptions {
  /** When true, runs `check()` once on mount. Default true. */
  checkOnMount?: boolean;
  /** When true, schedules a background check every POLL_THROTTLE_MS while mounted. Default true. */
  backgroundPoll?: boolean;
}

export function useUpdater(opts: UseUpdaterOptions = {}): {
  state: UpdateState;
  checkNow: () => Promise<void>;
  install: () => Promise<void>;
} {
  const { checkOnMount = true, backgroundPoll = true } = opts;
  const [state, setState] = useState<UpdateState>({ kind: 'idle' });
  const inFlight = useRef<Promise<void> | null>(null);

  const checkNow = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    inFlight.current = (async () => {
      setState((s) => (s.kind === 'downloading' ? s : { kind: 'checking' }));
      try {
        const update = await check();
        if (update === null) {
          setState({ kind: 'up-to-date', checkedAt: Date.now() });
        } else {
          setState({ kind: 'available', update, checkedAt: Date.now() });
        }
      } catch (e) {
        setState({ kind: 'error', message: String(e) });
      } finally {
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }, []);

  const install = useCallback(async () => {
    setState((s) => {
      if (s.kind !== 'available') return s;
      return { kind: 'downloading', update: s.update, progress: 0 };
    });
    try {
      const update =
        state.kind === 'available' || state.kind === 'downloaded'
          ? state.update
          : await check();
      if (update === null) {
        setState({ kind: 'up-to-date', checkedAt: Date.now() });
        return;
      }
      let downloaded = 0;
      let total = 0;
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
            setState({ kind: 'downloaded', update });
            break;
        }
      });
      // installAndInstall() schedules a restart on success; if it returns
      // we may already be on the new version.
      setState({ kind: 'downloaded', update });
    } catch (e) {
      setState({ kind: 'error', message: String(e) });
    }
  }, [state]);

  useEffect(() => {
    if (!checkOnMount) return;
    void checkNow();
    if (!backgroundPoll) return;
    const t = setInterval(() => {
      void checkNow();
    }, POLL_THROTTLE_MS);
    return () => clearInterval(t);
  }, [checkOnMount, backgroundPoll, checkNow]);

  return { state, checkNow, install };
}