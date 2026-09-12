"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { startSessionAction } from "./actions";

/** Starting a session means a live Gemini call on a pool miss (10-30s+,
 * longer under load) that can fail (network, parse, free-tier quota -
 * services.md §2.3). Shared so every "start a session" entry point gets
 * the same elapsed-time feedback and the same graceful failure instead
 * of an uncaught server-action error crashing the page. */
export function useStartSession() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [elapsedSec, setElapsedSec] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isPending) {
      timerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPending]);

  function start(params: { scenarioId: string; level: string }) {
    setError("");
    setElapsedSec(0);
    startTransition(async () => {
      try {
        await startSessionAction(params);
      } catch {
        setError(
          "Couldn't build the dialogue — the generator may be rate-limited or briefly down. Try again in a moment.",
        );
      }
    });
  }

  return { start, isPending, error, elapsedSec };
}
