"use server";
import { createClient } from "@/lib/supabase/server";
import * as Vocabulary from "@/modules/vocabulary";

export async function reviewCardAction(
  cardId: string,
  rating: "again" | "hard" | "good" | "easy",
) {
  const supabase = await createClient();
  await Vocabulary.review(supabase, cardId, rating);
}
