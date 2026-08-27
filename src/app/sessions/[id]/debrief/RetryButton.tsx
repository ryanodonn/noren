"use client";
import { useStartSession } from "@/app/useStartSession";

export function RetryButton(props: { scenarioId: string; level: string }) {
  const { start, isPending, error, elapsedSec } = useStartSession();

  return (
    <div className="flex-1">
      <button
        onClick={() => start({ scenarioId: props.scenarioId, level: props.level })}
        disabled={isPending}
        className="w-full py-4 font-semibold uppercase tracking-[0.2em] disabled:opacity-50 bg-noren-amber text-noren-bg"
      >
        {isPending ? (
          <span className="pulse">Writing the dialogue… ({elapsedSec}s)</span>
        ) : (
          "New dialogue, same level"
        )}
      </button>
      {isPending && (
        <div className="h-1 mt-2 overflow-hidden bg-noren-panel">
          <div className="h-full w-1/3 bg-noren-amber loading-bar" />
        </div>
      )}
      {error && <p className="text-sm mt-2 text-noren-rose">{error}</p>}
    </div>
  );
}
