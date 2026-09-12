import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import * as Catalog from "@/modules/catalog";
import * as Progression from "@/modules/progression";
import * as Vocabulary from "@/modules/vocabulary";
import * as Session from "@/modules/session";
import { acceptRecommendation, dismissRecommendation } from "@/app/actions";

function pct(rate: number) {
  return `${Math.round(rate * 100)}%`;
}

function relativeDate(iso: string | null) {
  if (!iso) return "never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [levels, scenarios, { levelState, recommendation }, evidence, vocabStats, sessionStats] =
    await Promise.all([
      Catalog.listLevels(supabase),
      Catalog.listScenarios(supabase, user.id),
      Progression.getStatus(supabase, user.id),
      Progression.getEvidence(supabase, user.id),
      Vocabulary.getStats(supabase, user.id),
      Session.getStats(supabase, user.id),
    ]);

  const currentLevel = levels.find((l) => l.id === levelState?.level);

  let recommendationText: string | null = null;
  if (recommendation) {
    const currentSortOrder = currentLevel?.sort_order ?? 0;
    const toLevel = levels.find((l) => l.id === recommendation.to_level);
    const isPromotion = (toLevel?.sort_order ?? 0) > currentSortOrder;
    recommendationText = isPromotion
      ? `You're ready for ${toLevel?.label_ja} — ${recommendation.reason}.`
      : `Want to drop back to ${toLevel?.label_ja} for a bit? (${recommendation.reason})`;
  }

  const playedScenarios = scenarios.filter((s) => s.timesCompleted > 0);

  return (
    <main className="board min-h-screen p-5 sm:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="border-b pb-4 mb-8 border-noren-edge">
          <div className="text-xs tracking-[0.3em] mb-1 text-noren-amber">しんちょく</div>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-wide uppercase">Progress</h1>
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

        <div className="flex items-baseline justify-between mb-3">
          <div className="text-xs tracking-[0.25em] text-noren-dim">CURRENT LEVEL</div>
          {currentLevel && (
            <div className="text-sm">
              <span className="jp text-noren-amber">{currentLevel.label_ja}</span>{" "}
              <span className="uppercase tracking-wide text-noren-dim">{currentLevel.label_en}</span>
            </div>
          )}
        </div>

        {evidence && evidence.total >= evidence.minAttempts ? (
          <div className="grid grid-cols-3 gap-px mb-2 grid-list">
            <div className="px-4 py-4 bg-noren-panel">
              <div className="text-3xl font-semibold text-noren-cyan">{pct(evidence.unaidedRate)}</div>
              <div className="text-xs uppercase tracking-[0.15em] text-noren-dim">Unaided</div>
            </div>
            <div className="px-4 py-4 bg-noren-panel">
              <div className="text-3xl font-semibold text-noren-rose">{pct(evidence.missedRate)}</div>
              <div className="text-xs uppercase tracking-[0.15em] text-noren-dim">Missed</div>
            </div>
            <div className="px-4 py-4 bg-noren-panel">
              <div className="text-3xl font-semibold text-noren-amber">
                {evidence.meanHints.toFixed(1)}
              </div>
              <div className="text-xs uppercase tracking-[0.15em] text-noren-dim">Avg hints</div>
            </div>
          </div>
        ) : (
          <div className="px-4 py-4 mb-2 bg-noren-panel">
            <p className="text-sm text-noren-dim">
              Collecting data — {evidence?.total ?? 0}/{evidence?.minAttempts ?? 20} lines answered
              at this level before a recommendation can appear.
            </p>
          </div>
        )}
        <p className="text-xs mb-8 text-noren-dim">
          Over your last {evidence?.total ?? 0} lines at this level
          {levelState ? `, across ${levelState.sessions_at_level} session${levelState.sessions_at_level === 1 ? "" : "s"}` : ""}
          .
        </p>

        <div className="text-xs tracking-[0.25em] mb-3 text-noren-dim">ACTIVITY</div>
        <div className="grid grid-cols-3 gap-px mb-8 grid-list">
          <div className="px-4 py-4 bg-noren-panel">
            <div className="text-3xl font-semibold">{sessionStats.totalSessions}</div>
            <div className="text-xs uppercase tracking-[0.15em] text-noren-dim">Sessions</div>
          </div>
          <div className="px-4 py-4 bg-noren-panel">
            <div className="text-3xl font-semibold text-noren-amber">
              {sessionStats.currentStreak}
            </div>
            <div className="text-xs uppercase tracking-[0.15em] text-noren-dim">Day streak</div>
          </div>
          <div className="px-4 py-4 bg-noren-panel">
            <div className="text-3xl font-semibold">{relativeDate(sessionStats.lastSessionAt)}</div>
            <div className="text-xs uppercase tracking-[0.15em] text-noren-dim">Last played</div>
          </div>
        </div>

        <div className="flex items-baseline justify-between mb-3">
          <div className="text-xs tracking-[0.25em] text-noren-dim">VOCABULARY</div>
          <Link href="/vocab" className="text-xs uppercase tracking-[0.15em] text-noren-amber">
            Review →
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-px mb-8 grid-list">
          <div className="px-4 py-4 bg-noren-panel">
            <div className="text-3xl font-semibold text-noren-cyan">{vocabStats.dueCount}</div>
            <div className="text-xs uppercase tracking-[0.15em] text-noren-dim">Due now</div>
          </div>
          <div className="px-4 py-4 bg-noren-panel">
            <div className="text-3xl font-semibold">{vocabStats.totalCards}</div>
            <div className="text-xs uppercase tracking-[0.15em] text-noren-dim">Total cards</div>
          </div>
          <div className="px-4 py-4 bg-noren-panel">
            <div className="text-3xl font-semibold text-noren-amber">
              {vocabStats.masteredCount}
            </div>
            <div className="text-xs uppercase tracking-[0.15em] text-noren-dim">Mastered</div>
          </div>
        </div>

        <div className="text-xs tracking-[0.25em] mb-3 text-noren-dim">SCENES EXPLORED</div>
        {playedScenarios.length === 0 ? (
          <p className="text-sm text-noren-dim">
            Nothing completed yet — head to{" "}
            <Link href="/" className="text-noren-amber">
              Pick
            </Link>{" "}
            to start a scene.
          </p>
        ) : (
          <div className="grid-list grid gap-px">
            {playedScenarios.map((s) => (
              <div key={s.id} className="px-4 py-3 flex items-baseline gap-4 bg-noren-panel">
                <span className="jp text-lg">{s.nameJa}</span>
                <span className="text-sm ml-auto uppercase tracking-wide text-noren-dim">
                  {s.nameEn}
                  <span className="ml-2 text-noren-cyan">×{s.timesCompleted}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
