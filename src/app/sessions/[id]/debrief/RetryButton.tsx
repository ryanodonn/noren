"use client";
import { useStartSession } from "@/app/pick/useStartSession";

export function RetryButton(props: { scenarioId: string; level: string }) {
  const { start, isPending, error } = useStartSession();

  return (
    <div className="flex-1">
      <button
        onClick={() => start({ scenarioId: props.scenarioId, level: props.level })}
        disabled={isPending}
        className="w-full py-4 font-semibold uppercase tracking-[0.2em] disabled:opacity-50 bg-noren-amber text-noren-bg"
      >
        {/* "Another dialogue", not "new": this draws a different pooled
            dialogue rather than writing one. */}
        {isPending ? <span className="pulse">Starting…</span> : "Another dialogue, same level"}
      </button>
      {error && <p className="text-sm mt-2 text-noren-rose">{error}</p>}
    </div>
  );
}
