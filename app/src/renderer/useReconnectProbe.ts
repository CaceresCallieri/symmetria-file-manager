import { useEffect, useRef } from "react";

/** Waits between probes of an offline machine. The last value repeats. */
const RECONNECT_DELAYS_MS: readonly number[] = [2_000, 5_000, 10_000, 30_000];

/**
 * Re-probe while `active`, with growing waits, and at once when the network
 * returns. A laptop that sleeps or changes networks, and a Home service that
 * restarts, then recover without a manual selection.
 */
export function useReconnectProbe(
  active: boolean,
  probe: () => Promise<void>,
  delaysMs: readonly number[] = RECONNECT_DELAYS_MS,
): void {
  const latestProbe = useRef(probe);
  useEffect(() => {
    latestProbe.current = probe;
  });
  useEffect(() => {
    if (!active) return;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let probing = false;
    const run = async () => {
      // A network event during a probe must not start a second timer chain.
      if (probing) return;
      probing = true;
      clearTimeout(timer);
      await latestProbe.current().catch(() => {});
      probing = false;
      if (stopped) return;
      attempt += 1;
      schedule();
    };
    const schedule = () => {
      const delay = delaysMs[Math.min(attempt, delaysMs.length - 1)] ?? 30_000;
      timer = setTimeout(() => void run(), delay);
    };
    const onOnline = () => {
      attempt = 0;
      void run();
    };
    schedule();
    window.addEventListener("online", onOnline);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [active, delaysMs]);
}
