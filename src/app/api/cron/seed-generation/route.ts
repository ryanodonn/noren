import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import * as Catalog from "@/modules/catalog";
import * as ContentGeneration from "@/modules/content-generation";
import * as Progression from "@/modules/progression";

export const maxDuration = 60;

/**
 * Two independent budgets, both enforced, because two different ceilings
 * bite here.
 *
 * Wall clock: Vercel Hobby kills the invocation at 60s. We stop at 50s to
 * leave room for cold start and the Supabase round-trips either side.
 *
 * Requests: the Gemini free tier allows 5 requests per minute, and a 60s
 * invocation *is* one minute — so six calls cannot succeed no matter how they
 * are arranged. This is what the old `Promise.all` over six picks was
 * actually hitting: it fired all six at once and 4-6 of them came back 429
 * every single day, with the body naming the per-minute cap each time. Four
 * picks plus one retry uses the budget exactly.
 *
 * The stagger matters even though the cap is a per-minute counter rather than
 * a concurrency limit: the observed rejection pattern was 3-4 of 6 rather
 * than exactly 1 of 6, so admission is burstier than a clean rolling window.
 * Spreading four calls over 24s costs nothing and stays well inside the
 * envelope. Last call starts at 24s and its p95 lands at 49s.
 */
const WALL_BUDGET_MS = 50_000;
const STAGGER_MS = 8_000;
const MAX_PICKS = 4;
const MAX_GEMINI_REQUESTS = 5;

type PickResult =
  | { ok: true; scenarioSlug: string; level: string; variantId: string }
  | { ok: false; level: string; variantId: string; reason: string }
  | { ok: false; level: string; variantId: string; skipped: "budget" };

/**
 * Daily cron: tops the dialogue pool up ahead of real traffic. Since Gemini
 * is cron-only (services.md §2.3), this is the only thing in the app that
 * fills the pool at all, and an empty key is a dead end for a learner until
 * it runs — so which gaps it picks matters more than how many it gets
 * through. planGenerationGaps puts levels someone is actually playing, and
 * depth-0 keys within them, first.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  let requestsIssued = 0;

  /**
   * A retry is affordable only if it fits both budgets. Passed down into the
   * Gemini wrapper so the decision is made with real elapsed time rather than
   * guessed at up front.
   */
  const admit = (needMs: number) =>
    requestsIssued < MAX_GEMINI_REQUESTS && elapsed() + needMs <= WALL_BUDGET_MS;

  const supabase = createServiceClient();

  const [levels, variants, depths, activeLevels] = await Promise.all([
    Catalog.listLevels(supabase),
    Catalog.listAllVariants(supabase),
    ContentGeneration.getPoolDepths(supabase),
    Progression.listActiveLevels(supabase),
  ]);

  const candidates = variants.flatMap((variant) =>
    levels.map((level) => ({
      scenarioId: variant.scenario_id,
      variantId: variant.id,
      level: level.id,
      depth:
        depths.get(ContentGeneration.poolDepthKey(variant.scenario_id, variant.id, level.id)) ?? 0,
      // Deliberately not fetched: ordering by last failure/attempt is a
      // fairness refinement, and reading it would mean a second scan of
      // generation_attempts on every run. Depth and active level carry
      // essentially all of the value.
      lastFailureAt: null,
      lastAttemptAt: null,
    })),
  );

  const picks = ContentGeneration.planGenerationGaps(candidates, {
    targetDepth: ContentGeneration.GAP_TARGET_DEPTH,
    maxPicks: MAX_PICKS,
    priorityLevels: activeLevels,
    now: new Date(),
  });

  if (picks.length === 0) {
    return NextResponse.json({
      picked: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      results: [],
      message: `Every (scenario, variant, level) is already at depth >= ${ContentGeneration.GAP_TARGET_DEPTH}.`,
    });
  }

  // Staggered starts rather than Promise.all. Never rejects: a lookup or
  // generation failure resolves to an {ok:false} entry so one bad pick can't
  // abort the batch. generateDialogue has already written a categorized
  // generation_attempts row by then; this only shapes the response.
  const results = await Promise.all(
    picks.map(async (pick, i): Promise<PickResult> => {
      const delay = i * STAGGER_MS;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

      // Guard against latency regression rather than an expected path: with
      // four picks and an 8s stagger this should never fire.
      //
      // A skipped pick writes NO generation_attempts row, on purpose —
      // nothing was attempted, and logging it would inflate the failure rate
      // the table exists to make queryable and trip the health strip's
      // failure-spike trigger.
      if (!admit(ContentGeneration.ESTIMATED_CALL_MS)) {
        return { ok: false, level: pick.level, variantId: pick.variantId, skipped: "budget" };
      }

      try {
        const [scenario, variant, level] = await Promise.all([
          Catalog.getScenario(supabase, pick.scenarioId),
          Catalog.getVariant(supabase, pick.variantId),
          Catalog.getLevel(supabase, pick.level),
        ]);
        requestsIssued++;
        await ContentGeneration.generateDialogue(supabase, scenario, variant, level, {
          admit: (needMs) => {
            if (!admit(needMs)) return false;
            requestsIssued++;
            return true;
          },
        });
        return {
          ok: true,
          scenarioSlug: scenario.slug,
          level: pick.level,
          variantId: pick.variantId,
        };
      } catch (err) {
        return {
          ok: false,
          level: pick.level,
          variantId: pick.variantId,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  const succeeded = results.filter((r) => r.ok).length;
  const skipped = results.filter((r) => !r.ok && "skipped" in r).length;
  const failed = results.length - succeeded - skipped;

  console.log(
    `[seed-generation cron] picked=${picks.length} succeeded=${succeeded} ` +
      `failed=${failed} skipped=${skipped} requests=${requestsIssued} elapsed=${elapsed()}ms ` +
      `priorityLevels=${activeLevels.join(",") || "(none)"}`,
  );

  return NextResponse.json({ picked: picks.length, succeeded, failed, skipped, results });
}
