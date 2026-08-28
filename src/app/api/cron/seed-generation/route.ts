import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import * as Catalog from "@/modules/catalog";
import * as ContentGeneration from "@/modules/content-generation";

// Each pick is one live Gemini call (10-30s+ observed); six in parallel
// stays well under Hobby's 60s ceiling since it's bounded by the slowest
// call, not the sum. Keep this if the pick count ever grows past ~6-8.
export const maxDuration = 60;

/** Below this pooled depth for a (variant, level), it counts as a gap. */
const TARGET_DEPTH = 2;

type PickResult =
  | { ok: true; scenarioSlug: string; level: string; variantId: string }
  | { ok: false; level: string; reason: string };

/**
 * Daily cron: for every difficulty level, pick one random under-filled
 * (scenario, variant) and generate a dialogue for it — building out the
 * pool ahead of real traffic instead of relying on pool misses during a
 * session (docs/services.md §2.3). Bounded to one pick per level so a
 * single run never risks the free-tier daily quota (~20 requests) even
 * before real usage for the day.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  const [levels, variants, depths] = await Promise.all([
    Catalog.listLevels(supabase),
    Catalog.listAllVariants(supabase),
    ContentGeneration.getPoolDepths(supabase),
  ]);

  const picks: { scenarioId: string; variantId: string; levelId: string }[] = [];
  for (const level of levels) {
    const gaps = variants.filter(
      (v) => (depths.get(`${v.id}::${level.id}`) ?? 0) < TARGET_DEPTH,
    );
    if (gaps.length === 0) continue;
    const pick = gaps[Math.floor(Math.random() * gaps.length)];
    picks.push({ scenarioId: pick.scenario_id, variantId: pick.id, levelId: level.id });
  }

  if (picks.length === 0) {
    return NextResponse.json({
      picked: 0,
      succeeded: 0,
      failed: 0,
      results: [],
      message: `Every (scenario, variant, level) is already at depth >= ${TARGET_DEPTH}.`,
    });
  }

  // Never rejects — a lookup or generation failure resolves to an
  // {ok:false} entry so one bad pick can't abort the rest of the batch.
  // generateDialogue already wrote a categorized generation_errors row
  // for generation/validation failures before rethrowing; this just turns
  // whatever it (or the lookup) threw into the response shape.
  const results = await Promise.all(
    picks.map(async (pick): Promise<PickResult> => {
      try {
        const [scenario, variant, level] = await Promise.all([
          Catalog.getScenario(supabase, pick.scenarioId),
          Catalog.getVariant(supabase, pick.variantId),
          Catalog.getLevel(supabase, pick.levelId),
        ]);
        await ContentGeneration.generateDialogue(supabase, scenario, variant, level);
        return { ok: true, scenarioSlug: scenario.slug, level: pick.levelId, variantId: pick.variantId };
      } catch (err) {
        return {
          ok: false,
          level: pick.levelId,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;

  console.log(
    `[seed-generation cron] picked=${picks.length} succeeded=${succeeded} failed=${failed}`,
  );

  return NextResponse.json({ picked: picks.length, succeeded, failed, results });
}
