import { useCallback, useState } from "react";
import { useAuth } from "../auth/context";
import { errorMessage, isAppError } from "./api";

type BackendAction<A extends unknown[], T> = {
  /** Runs the action. Resolves to the result, or `null` if it failed. */
  run: (...args: A) => Promise<T | null>;
  running: boolean;
  error: string | null;
  result: T | null;
  reset: () => void;
};

/**
 * Runs a user-triggered backend command (as opposed to `useBackendData`,
 * which loads on mount). Session expiry returns the app to the login screen.
 *
 * `action` must be stable (defined at module level).
 */
export function useBackendAction<A extends unknown[], T>(action: (...args: A) => Promise<T>): BackendAction<A, T> {
  const { refreshSession } = useAuth();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<T | null>(null);

  const run = useCallback(
    async (...args: A) => {
      setRunning(true);
      setError(null);
      try {
        const value = await action(...args);
        setResult(value);
        return value;
      } catch (e) {
        if (isAppError(e) && (e.code === "unauthenticated" || e.code === "password_change_required")) {
          await refreshSession();
        } else {
          setError(errorMessage(e));
        }
        return null;
      } finally {
        setRunning(false);
      }
    },
    [action, refreshSession],
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { run, running, error, result, reset };
}
