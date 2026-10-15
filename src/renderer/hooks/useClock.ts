import { useEffect, useState } from 'react';

/** Re-renders the caller every `ms` milliseconds, so time-based views (LIVE, sliding windows) follow the clock. */
export function useClock(ms: number): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}
