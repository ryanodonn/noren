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
      <div className="p-6 text-center text-noren-dim bg-noren-panel">
        Nothing due right now. Come back later.
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 p-8 text-center bg-noren-panel">
      <p className="text-xs text-noren-dim">
        Card {index + 1} of {cards.length}
      </p>

      <p className="jp text-3xl">{card.token_ja}</p>

      <button
        onClick={() => speak(card.token_ja, { lang: "ja-JP" })}
        className="px-3 py-1 text-sm border border-noren-edge text-noren-dim"
      >
        ▶ Play
      </button>

      {!revealed ? (
        <button
          onClick={() => setRevealed(true)}
          className="px-4 py-2 text-sm font-semibold uppercase tracking-[0.15em] bg-noren-amber text-noren-bg"
        >
          Reveal
        </button>
      ) : (
        <div className="flex flex-col items-center gap-4 rise">
          <div className="text-sm text-noren-dim">
            {card.kana && <p className="jp">{card.kana}</p>}
            {card.romaji && <p>{card.romaji}</p>}
            {card.en && <p className="font-medium text-noren-ink">{card.en}</p>}
            {card.context_sentence_ja && (
              <p className="jp mt-2">&ldquo;{card.context_sentence_ja}&rdquo;</p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onRate("again")}
              className="px-3 py-1.5 text-xs uppercase tracking-[0.15em]"
              style={{ background: "#3a1414", color: "var(--noren-rose)" }}
            >
              Again
            </button>
            <button
              onClick={() => onRate("hard")}
              className="px-3 py-1.5 text-xs uppercase tracking-[0.15em]"
              style={{ background: "#3a2f0e", color: "var(--noren-amber)" }}
            >
              Hard
            </button>
            <button
              onClick={() => onRate("good")}
              className="px-3 py-1.5 text-xs uppercase tracking-[0.15em]"
              style={{ background: "#123a35", color: "var(--noren-cyan)" }}
            >
              Good
            </button>
            <button
              onClick={() => onRate("easy")}
              className="px-3 py-1.5 text-xs uppercase tracking-[0.15em] bg-noren-amber text-noren-bg"
            >
              Easy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
