import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import * as Session from "@/modules/session";
import * as Progression from "@/modules/progression";
import * as Catalog from "@/modules/catalog";
import * as Identity from "@/modules/identity";
import { acceptRecommendation, dismissRecommendation } from "@/app/actions";
import { ScriptRecap } from "./ScriptRecap";
import { RetryButton } from "./RetryButton";

export default async function DonePage({ params }: PageProps<"/sessions/[id]/debrief">) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ session, dialogue, scenario }, { summary }, { levelState, recommendation }, levels, me] =
    await Promise.all([
      Session.getSession(supabase, id),
      Session.getSummary(supabase, id),
      Progression.getStatus(supabase, user.id),
      Catalog.listLevels(supabase),
      Identity.getMe(supabase),
    ]);

  const total = summary.got_it + summary.close + summary.missed;
  const savedVoices = (me?.profile.voice_assignments as { a?: string; b?: string } | null) ?? {};

  let recommendationText: string | null = null;
  if (recommendation) {
    const currentSortOrder = levels.find((l) => l.id === levelState?.level)?.sort_order ?? 0;
    const toLevel = levels.find((l) => l.id === recommendation.to_level);
    const isPromotion = (toLevel?.sort_order ?? 0) > currentSortOrder;
    recommendationText = isPromotion
      ? `You're ready for ${toLevel?.label_ja} — ${recommendation.reason}.`
      : `Want to drop back to ${toLevel?.label_ja} for a bit? (${recommendation.reason})`;
  }

  return (
    <main className="board min-h-screen p-5 sm:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="text-xs tracking-[0.3em] mb-1 text-noren-amber">おつかれさま</div>
        <h1 className="text-4xl font-semibold uppercase tracking-wide mb-6">Session complete</h1>

        <div className="flex gap-px mb-8 grid-list">
          {(
            [
              ["Got it", summary.got_it, "var(--noren-cyan)"],
              ["Close", summary.close, "var(--noren-amber)"],
              ["Missed", summary.missed, "var(--noren-rose)"],
            ] as const
          ).map(([k, v, c]) => (
            <div key={k} className="flex-1 px-4 py-4 bg-noren-panel">
              <div className="text-3xl font-semibold" style={{ color: c }}>
                {v}
              </div>
              <div className="text-xs uppercase tracking-[0.15em] text-noren-dim">{k}</div>
            </div>
          ))}
        </div>

        {recommendation && recommendationText && (
          <div className="mb-8 px-4 py-4 border-l-3 border-noren-amber bg-noren-panel">
            <p className="mb-3 text-sm">{recommendationText}</p>
            <div className="flex gap-2">
              <form action={acceptRecommendation}>
                <input type="hidden" name="eventId" value={recommendation.id} />
                <button className="px-3 py-1.5 text-xs uppercase tracking-[0.15em] bg-noren-amber text-noren-bg">
                  Accept
                </button>
              </form>
              <form action={dismissRecommendation}>
                <input type="hidden" name="eventId" value={recommendation.id} />
                <button className="px-3 py-1.5 text-xs uppercase tracking-[0.15em] border border-noren-edge text-noren-dim">
                  Not now
                </button>
              </form>
            </div>
          </div>
        )}

        <div className="text-xs tracking-[0.25em] mb-3 text-noren-dim">
          FULL SCRIPT{total === 0 && " — nothing graded yet"}
        </div>
        <ScriptRecap
          lines={dialogue.generated_lines.map((l) => ({
            seq: l.seq,
            speaker: l.speaker as "a" | "b",
            ja: l.ja,
            romaji: l.romaji,
            en: l.en,
          }))}
          speakerA={scenario.speaker_a}
          speakerB={scenario.speaker_b}
          voiceA={savedVoices.a ?? null}
          voiceB={savedVoices.b ?? null}
        />

        <div className="flex gap-3 items-start">
          <RetryButton scenarioId={scenario.id} level={session.level} />
          <Link
            href="/"
            className="px-6 py-4 text-xs uppercase tracking-[0.2em] border border-noren-edge text-noren-dim"
          >
            Change
          </Link>
        </div>
      </div>
    </main>
  );
}
