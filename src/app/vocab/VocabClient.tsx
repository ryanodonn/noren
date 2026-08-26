"use client";
import { useState } from "react";
import { useSpeech } from "@/modules/speech";
import { reviewCardAction } from "./actions";

type Card = {
  id: string;
  token_ja: string;
  kana: string | null;
  romaji: string | null;
  en: string | null;
  context_sentence_ja: string | null;
  source: string;
};

export function VocabClient({ cards }: { cards: Card[] }) {
  const { speak } = useSpeech();
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const card = cards[index];

  function onRate(rating: "again" | "hard" | "good" | "easy") {
    reviewCardAction(card.id, rating);
    setRevealed(false);
    setIndex((i) => i + 1);
  }

  if (!card) {
    return (
      <div className="rounded border p-6 text-center text-neutral-500">
        Nothing due right now. Come back later.
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 rounded border p-8 text-center">
      <p className="text-xs text-neutral-400">
        Card {index + 1} of {cards.length}
      </p>

      <p className="text-3xl">{card.token_ja}</p>

      <button
        onClick={() => speak(card.token_ja, { lang: "ja-JP" })}
        className="rounded border px-3 py-1 text-sm hover:bg-neutral-50"
      >
        ▶ Play
      </button>

      {!revealed ? (
        <button
          onClick={() => setRevealed(true)}
          className="rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700"
        >
          Reveal
        </button>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="text-sm text-neutral-600">
            {card.kana && <p>{card.kana}</p>}
            {card.romaji && <p>{card.romaji}</p>}
            {card.en && <p className="font-medium">{card.en}</p>}
            {card.context_sentence_ja && (
              <p className="mt-2 text-neutral-400">&ldquo;{card.context_sentence_ja}&rdquo;</p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onRate("again")}
              className="rounded bg-red-100 px-3 py-1.5 text-sm text-red-800 hover:bg-red-200"
            >
              Again
            </button>
            <button
              onClick={() => onRate("hard")}
              className="rounded bg-amber-100 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-200"
            >
              Hard
            </button>
            <button
              onClick={() => onRate("good")}
              className="rounded bg-green-100 px-3 py-1.5 text-sm text-green-800 hover:bg-green-200"
            >
              Good
            </button>
            <button
              onClick={() => onRate("easy")}
              className="rounded bg-blue-100 px-3 py-1.5 text-sm text-blue-800 hover:bg-blue-200"
            >
              Easy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
