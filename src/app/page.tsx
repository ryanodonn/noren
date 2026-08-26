import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import * as Catalog from "@/modules/catalog";
import * as Progression from "@/modules/progression";
import { acceptRecommendation, dismissRecommendation } from "./actions";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { levelState, recommendation } = await Progression.getStatus(supabase, user.id);
  const level = levelState?.level ?? "kodomo";

  const [levels, scenarios] = await Promise.all([
    Catalog.listLevels(supabase),
    Catalog.listScenarios(supabase, user.id, level),
  ]);

  const currentLevel = levels.find((l) => l.id === level);
  const currentSortOrder = currentLevel?.sort_order ?? 0;

  let recommendationText: string | null = null;
  if (recommendation) {
    const toLevel = levels.find((l) => l.id === recommendation.to_level);
    const isPromotion = (toLevel?.sort_order ?? 0) > currentSortOrder;
    recommendationText = isPromotion
      ? `You're ready for ${toLevel?.label_ja} — ${recommendation.reason}.`
      : `Want to drop back to ${toLevel?.label_ja} for a bit? (${recommendation.reason})`;
  }

  return (
    <main className="mx-auto max-w-2xl flex-1 px-6 py-10">
      <h1 className="text-xl font-semibold">Scenarios</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Level: {currentLevel?.label_ja} ({currentLevel?.label_en})
      </p>

      {recommendation && recommendationText && (
        <div className="mb-6 rounded border border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="mb-3">{recommendationText}</p>
          <div className="flex gap-2">
            <form action={acceptRecommendation}>
              <input type="hidden" name="eventId" value={recommendation.id} />
              <button className="rounded bg-neutral-900 px-3 py-1 text-white">Accept</button>
            </form>
            <form action={dismissRecommendation}>
              <input type="hidden" name="eventId" value={recommendation.id} />
              <button className="rounded border px-3 py-1">Not now</button>
            </form>
          </div>
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {scenarios.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between rounded border p-4"
          >
            <div>
              <p className="font-medium">
                {s.nameJa} <span className="text-neutral-400">{s.nameEn}</span>
              </p>
              <p className="text-xs text-neutral-500">
                {s.completedVariantCount}/{s.activeVariantCount} complete
              </p>
            </div>
            <Link
              href={`/scenarios/${s.slug}`}
              className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700"
            >
              {s.status === "complete" ? "Replay" : "Enter"}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
