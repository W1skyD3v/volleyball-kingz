import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

/**
 * Runs `load` whenever the screen gains focus. A failure becomes `error` (with `retry`) instead of an unhandled
 * promise rejection, so a dropped connection at the court shows a message instead of a frozen screen.
 */
export function useLoader(load: () => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(async () => {
    setLoading(true);
    try {
      await load();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      void run();
    }, [run]),
  );
  return { error, loading, retry: run };
}
