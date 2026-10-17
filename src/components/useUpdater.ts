import { useCallback, useEffect, useRef, useState } from 'react';
import { open as openInBrowser } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date'; checkedAt: number }
  | { kind: 'available'; version: string; url: string; notes: string; checkedAt: number }
  | { kind: 'failed'; message: string; fallbackUrl?: string };

const POLL_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6 hours

interface UseUpdaterOptions {
  checkOnMount?: boolean;
  backgroundPoll?: boolean;
  /** Default fallback URL we open when we can't resolve the release page. */
  releasesUrl?: string;
}

interface GithubRelease {
  tag_name: string;
  html_url: string;
  body: string | null;
  prerelease: boolean;
  draft: boolean;
}

function parseVersion(tag: string): number[] | null {
  const m = tag.match(/v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function isNewer(a: number[], b: number[]): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export function useUpdater(opts: UseUpdaterOptions = {}): {
  state: UpdateState;
  checkNow: () => Promise<void>;
  openReleases: () => Promise<void>;
} {
  const { checkOnMount = true, backgroundPoll = true, releasesUrl } = opts;
  const [state, setState] = useState<UpdateState>({ kind: 'idle' });
  const inFlight = useRef<Promise<void> | null>(null);
  const baseUrl = releasesUrl ?? 'https://github.com/Herra-Atlas/project-m/releases/latest';

  const checkNow = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    inFlight.current = (async () => {
      setState({ kind: 'checking' });
      try {
        // Plain HTTPS fetch of the latest GitHub release — no updater
        // plugin, no signing keys involved.
        const release = await invoke<GithubRelease>('check_github_release');
        const latestParts = parseVersion(release.tag_name);
        if (!latestParts) throw new Error(`Unparseable tag: ${release.tag_name}`);
        const currentParts = parseVersion(__APP_VERSION__);

        if (currentParts && isNewer(latestParts, currentParts)) {
          setState({
            kind: 'available',
            version: latestParts.join('.'),
            url: release.html_url,
            notes: release.body ?? '',
            checkedAt: Date.now(),
          });
        } else {
          setState({ kind: 'up-to-date', checkedAt: Date.now() });
        }
      } catch (e) {
        setState({ kind: 'failed', message: String(e), fallbackUrl: baseUrl });
      } finally {
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }, [baseUrl]);

  const openReleases = useCallback(async () => {
    try {
      if (state.kind === 'available') {
        await openInBrowser(state.url);
      } else {
        await openInBrowser(baseUrl);
      }
    } catch {
      // ignore — URL is visible in the UI for the user to copy
    }
  }, [state, baseUrl]);

  useEffect(() => {
    if (!checkOnMount) return;
    void checkNow();
    if (!backgroundPoll) return;
    const t = setInterval(() => void checkNow(), POLL_THROTTLE_MS);
    return () => clearInterval(t);
  }, [checkOnMount, backgroundPoll, checkNow]);

  return { state, checkNow, openReleases };
}
