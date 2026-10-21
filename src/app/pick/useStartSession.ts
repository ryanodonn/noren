"use client";
import { useState, useTransition } from "react";
import { startSessionAction, type StartSessionResult } from "./actions";

/**
 * Starting a session is now a pool read (~100ms), not a 10-30s Gemini call —
 * generation moved entirely to the nightly cron (services.md §2.3). So the
 * elapsed-second counter and progress bar this hook used to drive are gone;
 * what's left is turning a typed failure into a sentence a learner can act
 * on, shared across every "start a session" entry point.
 *
 * The important case is `pool_empty`: with no live generation, a scene with
 * nothing pooled cannot be fixed by retrying, so the copy has to say "try
 * another scene" rather than "try again".
 */
const FAILURE_COPY: Record<StartSessionResult["reason"], string> = {
  pool_empty:
    "No dialogue is written for this scene at this level yet. New ones are written overnight — try another scene or level in the meantime.",
  no_variants: "This scene has nothing left to play at this level. Try another level.",
  unknown: "Couldn't start the session. Try again in a moment.",
};

export function useStartSession() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function start(params: { scenarioId: string; level: string }) {
    setError("");
    startTransition(async () => {
      try {
        const result = await startSessionAction(params);
        // A successful start redirects and never returns a result.
        if (result) setError(FAILURE_COPY[result.reason]);
      } catch {
        setError(FAILURE_COPY.unknown);
      }
    });
  }

  return { start, isPending, error };
}
