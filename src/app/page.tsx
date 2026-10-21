import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import * as Catalog from "@/modules/catalog";
import * as Progression from "@/modules/progression";
import * as Session from "@/modules/session";
import * as Vocabulary from "@/modules/vocabulary";
import * as ContentGeneration from "@/modules/content-generation";
import { acceptRecommendation, dismissRecommendation } from "./actions";

function pct(rate: number) {
  return `${Math.round(rate * 100)}%`;
}

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [levels, scenarios, { levelState, recommendation }, evidence, weakestScenario, sessionStats, vocabStats, topMissed, variants] =
    await Promise.all([
      Catalog.listLevels(supabase),
      Catalog.listScenarios(supabase, user.id),
      Progression.getStatus(supabase, user.id),
      Progression.getEvidence(supabase, user.id),
      Session.getWeakestScenario(supabase, user.id),
      Session.getStats(supabase, user.id),
      Vocabulary.getStats(supabase, user.id),
      Vocabulary.getTopMissed(supabase, user.id, 3),
      Catalog.listAllVariants(supabase),
    ]);

  // Analytical, and getGeneratorHealth never throws — the dashboard must not
  // depend on it (services.md §5). Sequenced after the batch above so it can
  // be told the catalog's full key count, which only Catalog knows.
  const generatorHealth = await ContentGeneration.getGeneratorHealth(supabase, {
    totalPoolKeys: variants.length * levels.length,
  });

  const currentLevel = levels.find((l) => l.id === levelState?.level);
  const weakScenario = weakestScenario
    ? scenarios.find((s) => s.id === weakestScenario.scenarioId)
    : undefined;

  let recommendationText: string | null = null;
  if (recommendation) {
    const currentSortOrder = currentLevel?.sort_order ?? 0;
    const toLevel = levels.find((l) => l.id === recommendation.to_level);
    const isPromotion = (toLevel?.sort_order ?? 0) > currentSortOrder;
    recommendationText = isPromotion
      ? `You're ready for ${toLevel?.label_ja} — ${recommendation.reason}.`
      : `Want to drop back to ${toLevel?.label_ja} for a bit? (${recommendation.reason})`;
  }

  const hasAreasToImprove = !!weakScenario || topMissed.length > 0 || vocabStats.dueCount > 0;

  return (
    <main className="board min-h-screen p-5 sm:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="border-b pb-4 mb-8 border-noren-edge">
          <div className="text-xs tracking-[0.3em] mb-1 text-noren-amber">おかえりなさい</div>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-wide uppercase">
            Your progress
          </h1>
          <p className="text-sm mt-2 text-noren-dim">
            Here&apos;s where you stand, and what to work on next.
          </p>
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

        {generatorHealth && generatorHealth.signals.length > 0 && (
          <section className="mb-8 rise">
            <div className="text-xs tracking-[0.25em] mb-3 text-noren-dim">GENERATOR</div>
            <div className="grid-list flex flex-col gap-px">
              {generatorHealth.signals.map((signal) => (
                <div
                  key={signal.kind}
                  className={`px-4 py-3 text-sm bg-noren-panel border-l-3 ${
                    signal.kind === "quota_exhausted" ? "border-noren-amber" : "border-noren-rose"
                  }`}
                >
                  {signal.kind === "quota_exhausted" &&
                    (signal.limitKind === "per_minute"
                      ? "The writer hit Gemini's per-minute request limit in the last day. Calls are being paced; this should clear itself."
                      : signal.limitKind === "per_day"
                        ? "The writer used up Gemini's daily request quota in the last day. No new dialogues until it resets."
                        : "The writer hit a Gemini quota limit in the last day.")}
                  {signal.kind === "failure_spike" &&
                    `${pct(signal.rate)} of the last ${signal.attempts} dialogue-writing attempts failed.`}
                  {signal.kind === "stalled" &&
                    (signal.lastSuccessAt
                      ? `No dialogue has been written successfully in two days. Last one: ${new Date(signal.lastSuccessAt).toLocaleDateString()}.`
                      : "No dialogue has been written successfully yet.")}
                </div>
              ))}
              <div className="px-4 py-3 text-xs bg-noren-panel text-noren-dim">
                {generatorHealth.poolCoverage.populated} of {generatorHealth.poolCoverage.keys}{" "}
                scene/level combinations have dialogues written;{" "}
                {generatorHealth.poolCoverage.belowMin} still have fewer than a full set.
              </div>
            </div>
          </section>
        )}

        {evidence && currentLevel ? (
          <div className="grid grid-cols-3 gap-px mb-8 grid-list">
            <div className="px-4 py-4 bg-noren-panel">
              <div className="flex items-baseline gap-2">
                <span className="jp text-xl text-noren-amber">{currentLevel.label_ja}</span>
                <span className="text-[11px] uppercase tracking-[0.15em] text-noren-dim">
                  {currentLevel.label_en}
                </span>
              </div>
              <div className="h-1 mt-3 bg-noren-edge">
                <div
                  className="h-full bg-noren-amber"
                  style={{
                    width: `${Math.min(100, (evidence.total / evidence.windowSize) * 100)}%`,
                  }}
                />
              </div>
              <div className="text-[11px] mt-1.5 text-noren-dim">
                {evidence.total} of {evidence.windowSize} attempts at this level
              </div>
            </div>
            <div className="px-4 py-4 bg-noren-panel">
              <div className="text-[28px] font-semibold text-noren-cyan">
                {pct(evidence.unaidedRate)}
              </div>
              <div className="text-[11px] uppercase tracking-[0.15em] mt-1 text-noren-dim">
                Unaided, last {evidence.windowSize} lines
              </div>
            </div>
            <div className="px-4 py-4 bg-noren-panel">
              <div className="text-[28px] font-semibold">{sessionStats.currentStreak}</div>
              <div className="text-[11px] uppercase tracking-[0.15em] mt-1 text-noren-dim">
                Day streak
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-8 px-4 py-6 text-center bg-noren-panel">
            <p className="text-sm text-noren-dim">
              Play your first scene and your stats will show up here.
            </p>
          </div>
        )}

        {hasAreasToImprove && (
          <div className="mb-8">
            <div className="text-xs tracking-[0.25em] mb-3 text-noren-dim">AREAS TO IMPROVE</div>
            <div className="grid-list flex flex-col gap-px">
              {weakScenario && weakestScenario && (
                <div className="px-4 py-4 flex items-center gap-4 bg-noren-panel border-l-3 border-noren-rose">
                  <div className="flex-grow">
                    <div className="flex items-baseline gap-2">
                      <span className="jp text-base">{weakScenario.nameJa}</span>
                      <span className="text-xs uppercase tracking-[0.1em] text-noren-dim">
                        {weakScenario.nameEn}
                      </span>
                    </div>
                    <div className="text-xs mt-0.5 text-noren-dim">
                      {pct(weakestScenario.gotItRate)} got-it rate over your last{" "}
                      {weakestScenario.total} attempts
                    </div>
                  </div>
                  <Link
                    href={`/pick?scenario=${weakScenario.slug}`}
                    className="text-[11px] uppercase tracking-[0.15em] whitespace-nowrap"
                  >
                    Practice →
                  </Link>
                </div>
              )}

              {topMissed.length > 0 && (
                <div className="px-4 py-4 bg-noren-panel">
                  <div className="text-xs mb-2.5 text-noren-dim">Words missed most often</div>
                  <div className="flex flex-col gap-2.5">
                    {topMissed.map((w) => (
                      <div key={w.token_ja} className="flex items-baseline gap-2.5">
                        <span className="jp text-base shrink-0 whitespace-nowrap">
                          {w.token_ja}
                        </span>
                        <span className="text-[13px] w-28 shrink-0 truncate text-noren-dim">
                          {w.romaji}
                        </span>
                        <span className="text-[13px] flex-grow">{w.en}</span>
                        <span className="text-xs whitespace-nowrap text-noren-rose">
                          missed ×{w.times_missed}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {vocabStats.dueCount > 0 && (
                <div className="px-4 py-3.5 flex items-center justify-between bg-noren-panel">
                  <span className="text-[13px] text-noren-dim">
                    {vocabStats.dueCount} flashcard{vocabStats.dueCount === 1 ? "" : "s"} due today
                  </span>
                  <Link href="/vocab" className="text-[11px] uppercase tracking-[0.15em]">
                    Review →
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="mb-10">
          <div className="text-xs tracking-[0.25em] mb-3 text-noren-dim">SCENES EXPLORED</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px grid-list">
            {scenarios.map((s) => {
              const played = s.timesCompleted > 0;
              return (
                <div
                  key={s.id}
                  className="px-3.5 py-3.5 bg-noren-panel"
                  style={{ opacity: played ? 1 : 0.5 }}
                >
                  <div
                    className="text-[10px] tracking-[0.2em]"
                    style={{ color: played ? "var(--noren-amber)" : "var(--noren-dim)" }}
                  >
                    {s.lineLabel}
                  </div>
                  <div className="jp text-base mt-1">{s.nameJa}</div>
                  <div
                    className="text-[11px] mt-0.5"
                    style={{ color: played ? "var(--noren-cyan)" : "var(--noren-dim)" }}
                  >
                    {played ? `×${s.timesCompleted}` : "not yet"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <Link
          href="/pick"
          className="block w-full py-4 text-center text-lg font-semibold uppercase tracking-[0.2em] bg-noren-amber text-noren-bg"
        >
          Start listening
        </Link>
      </div>
    </main>
  );
}
