import "server-only";
import type { DbClient } from "@/lib/supabase/types";
import * as db from "./db";
import type { QuotaLimitKind } from "./classify-error";

/** Why the generator is considered unhealthy right now. */
export type HealthSignal =
  | { kind: "quota_exhausted"; limitKind: QuotaLimitKind; at: string }
  | { kind: "failure_spike"; rate: number; attempts: number }
  | { kind: "stalled"; lastSuccessAt: string | null };

export type GeneratorHealth = {
  /** Empty means healthy, and the UI renders nothing at all. */
  signals: HealthSignal[];
  lastSuccessAt: string | null;
  /**
   * Context, never a trigger. 114 of 198 keys are empty today and the
   * catalog will not reach full depth for months, so a signal on empty
   * pools would fire the day it shipped and never clear — which trains you
   * to ignore the strip and destroys it as an alerting channel.
   */
  poolCoverage: { keys: number; populated: number; belowMin: number };
};

const WINDOW_DAYS = 7;
const QUOTA_WINDOW_HOURS = 24;
/** Two cron cycles, so a single bad night isn't an alert. */
const STALLED_WINDOW_HOURS = 48;
/** Mirrors Session's MIN_ATTEMPTS_FOR_WEAK_SCENARIO: don't alert on 1-of-2. */
const MIN_ATTEMPTS_FOR_RATE = 8;
const FAILURE_RATE_THRESHOLD = 0.5;

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

/**
 * Analytical read for the home page's generator strip.
 *
 * **Never throws** — returns null on any failure. The home page gathers its
 * data in a single `Promise.all`, so one rejection would take down the whole
 * dashboard, and services.md §5 is explicit that a learner-facing page must
 * never depend on an analytical context. Guaranteeing it here rather than
 * with a `.catch()` at the call site means the next caller gets it for free.
 *
 * Reads only this module's own table and view, both already readable by any
 * authenticated user — no service client, no new RLS policy.
 */
export async function getGeneratorHealth(
  supabase: DbClient,
  opts?: { totalPoolKeys?: number },
): Promise<GeneratorHealth | null> {
  try {
    const { data: attempts, error } = await supabase
      .from("generation_attempts")
      .select("outcome, category, occurred_at, details")
      .eq("source", "cron")
      .gte("occurred_at", hoursAgo(WINDOW_DAYS * 24))
      .order("occurred_at", { ascending: false });
    if (error) throw error;

    const depths = await db.fetchAllDialogueCounts(supabase);

    const successes = attempts.filter((a) => a.outcome === "success");
    const failures = attempts.filter((a) => a.outcome === "failure");
    const lastSuccessAt = successes[0]?.occurred_at ?? null;

    const totalKeys = opts?.totalPoolKeys ?? depths.size;
    const signals: HealthSignal[] = [];

    const quotaCutoff = hoursAgo(QUOTA_WINDOW_HOURS);
    const recentQuota = failures.find(
      (a) => a.category === "quota_exceeded" && a.occurred_at >= quotaCutoff,
    );
    if (recentQuota) {
      // Per-minute and per-day mean completely different things — pace the
      // calls versus make fewer of them. Conflating them is what hid the
      // cron's burst problem for three weeks, so the strip names which.
      const details = recentQuota.details as { limitKind?: QuotaLimitKind } | null;
      signals.push({
        kind: "quota_exhausted",
        limitKind: details?.limitKind ?? "unknown",
        at: recentQuota.occurred_at,
      });
    }

    if (attempts.length >= MIN_ATTEMPTS_FOR_RATE) {
      const rate = failures.length / attempts.length;
      if (rate >= FAILURE_RATE_THRESHOLD) {
        signals.push({ kind: "failure_spike", rate, attempts: attempts.length });
      }
    }

    // "Tried and never succeeded", not merely "no successes" — otherwise this
    // would fire whenever the cron simply hasn't run yet.
    const stalledCutoff = hoursAgo(STALLED_WINDOW_HOURS);
    const triedRecently = attempts.some((a) => a.occurred_at >= stalledCutoff);
    const succeededRecently = successes.some((a) => a.occurred_at >= stalledCutoff);
    if (triedRecently && !succeededRecently) {
      signals.push({ kind: "stalled", lastSuccessAt });
    }

    return {
      signals,
      lastSuccessAt,
      poolCoverage: {
        keys: totalKeys,
        populated: depths.size,
        // Keys with content but not enough of it to avoid repeats. Counted
        // against POOL_MIN rather than the cron's shallower GAP_TARGET_DEPTH,
        // since this is the "is this pool thin" question.
        belowMin: totalKeys - [...depths.values()].filter((d) => d >= db.POOL_MIN).length,
      },
    };
  } catch (err) {
    console.error("[content-generation] getGeneratorHealth failed", err);
    return null;
  }
}
