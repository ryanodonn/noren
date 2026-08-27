"use client";
import { useSpeech } from "@/modules/speech";

type Line = { seq: number; speaker: "a" | "b"; ja: string; romaji: string | null; en: string };

export function ScriptRecap(props: {
  lines: Line[];
  speakerA: string;
  speakerB: string;
  voiceA: string | null;
  voiceB: string | null;
}) {
  const { lines, speakerA, speakerB, voiceA, voiceB } = props;
  const { speak } = useSpeech();

  return (
    <div className="space-y-px mb-8 grid-list">
      {lines.map((l) => (
        <div key={l.seq} className="px-4 py-3 bg-noren-panel">
          <div className="flex items-baseline gap-2">
            <span
              className="jp text-xs shrink-0"
              style={{ color: l.speaker === "a" ? "var(--noren-amber)" : "var(--noren-cyan)" }}
            >
              {l.speaker === "a" ? speakerA : speakerB}
            </span>
            <button
              onClick={() =>
                speak(l.ja, { lang: "ja-JP", voiceName: (l.speaker === "a" ? voiceA : voiceB) ?? undefined })
              }
              className="jp text-base text-left"
            >
              {l.ja}
            </button>
          </div>
          <div className="text-xs mt-1 text-noren-dim">{l.romaji}</div>
          <div className="text-sm">{l.en}</div>
        </div>
      ))}
    </div>
  );
}
