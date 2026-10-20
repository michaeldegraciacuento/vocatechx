import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/context";
import { errorMessage, isAppError } from "./api";

export type BackendData<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

/**
 * Loads data from a protected backend command, optionally polling. If the
 * backend reports the session is gone, the auth state is refreshed so the
 * app returns to the login screen.
 *
 * `fetcher` must be stable (defined at module level), or it reloads every render.
 */
export function useBackendData<T>(fetcher: () => Promise<T>, pollMs?: number): BackendData<T> {
  const { refreshSession } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setData(await fetcher());
      setError(null);
    } catch (e) {
      if (isAppError(e) && (e.code === "unauthenticated" || e.code === "password_change_required")) {
        await refreshSession();
        return;
      }
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [fetcher, refreshSession]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      await load();
      if (!cancelled && pollMs) timer = window.setTimeout(tick, pollMs);
    };
    tick();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [load, pollMs]);

  return { data, error, loading, reload: load };
}
