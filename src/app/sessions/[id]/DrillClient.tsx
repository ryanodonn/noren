"use client";
import { useMemo, useState, useTransition } from "react";
import { useSpeech } from "@/modules/speech";
import { submitAttempt, requestHint, lookupToken, finishSession } from "./actions";

type Token = { ja: string; kana?: string; romaji?: string; en?: string };
type Line = {
  id: string;
  seq: number;
  speaker: "a" | "b";
  ja: string;
  kana: string | null;
  romaji: string | null;
  en: string;
  tokens: Token[];
};

export function DrillClient(props: {
  sessionId: string;
  speakerA: string;
  speakerB: string;
  lines: Line[];
}) {
  const { sessionId, speakerA, speakerB, lines } = props;
  const { speak, listen, isListening, supported } = useSpeech();
  const [isPending, startTransition] = useTransition();

  const [index, setIndex] = useState(0);
  const [userAnswer, setUserAnswer] = useState("");
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hintText, setHintText] = useState<string | null>(null);
  const [result, setResult] = useState<{ verdict: string; note: string | null } | null>(null);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [lookedUp, setLookedUp] = useState<Set<string>>(new Set());

  const line = lines[index];
  const done = !line;

  const speakerName = useMemo(
    () => (line?.speaker === "a" ? speakerA : speakerB),
    [line, speakerA, speakerB],
  );

  function resetForNextLine() {
    setUserAnswer("");
    setHintsUsed(0);
    setHintText(null);
    setResult(null);
    setStartedAt(Date.now());
  }

  function goNext() {
    setIndex((i) => i + 1);
    resetForNextLine();
  }

  async function onHint() {
    const { hint } = await requestHint({ lineId: line.id, hintsUsedSoFar: hintsUsed });
    setHintText(hint);
    setHintsUsed((h) => h + 1);
  }

  async function onMic() {
    try {
      const transcript = await listen({ lang: "en-US" });
      setUserAnswer(transcript);
    } catch {
      // mic not available/denied — the text input still works
    }
  }

  function onSubmit() {
    if (!userAnswer.trim()) return;
    startTransition(async () => {
      const res = await submitAttempt({
        sessionId,
        lineId: line.id,
        seq: line.seq,
        userAnswer,
        hintsUsed,
        latencyMs: Date.now() - startedAt,
      });
      setResult(res);
    });
  }

  async function onLookup(token: Token) {
    setLookedUp((s) => new Set(s).add(token.ja));
    await lookupToken({ sessionId, ja: token.ja, kana: token.kana, romaji: token.romaji, en: token.en });
  }

  function onFinish() {
    startTransition(async () => {
      await finishSession({ sessionId });
    });
  }

  if (done) {
    return (
      <div className="rounded border p-6 text-center">
        <p className="mb-4 text-neutral-600">That&apos;s the end of the conversation.</p>
        <button
          onClick={onFinish}
          disabled={isPending}
          className="rounded bg-neutral-900 px-4 py-2 text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          Finish
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-neutral-400">
        Line {index + 1} of {lines.length}
      </p>

      <div className="rounded border p-4">
        <p className="mb-1 text-xs font-medium text-neutral-500">{speakerName}</p>

        <p className="text-lg">{line.ja}</p>
        {line.kana && <p className="text-sm text-neutral-500">{line.kana}</p>}
        {line.romaji && <p className="text-sm text-neutral-400">{line.romaji}</p>}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={() => speak(line.ja, { lang: "ja-JP" })}
            className="rounded border px-2 py-1 text-xs hover:bg-neutral-50"
          >
            ▶ Play
          </button>
          {line.tokens.map((t) => (
            <button
              key={t.ja}
              onClick={() => onLookup(t)}
              className={`rounded px-2 py-1 text-xs ${
                lookedUp.has(t.ja)
                  ? "bg-blue-50 text-blue-700"
                  : "border text-neutral-500 hover:bg-neutral-50"
              }`}
              title={t.en}
            >
              {t.ja}
            </button>
          ))}
        </div>

        {!result ? (
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                value={userAnswer}
                onChange={(e) => setUserAnswer(e.target.value)}
                placeholder="Type (or speak) the English translation"
                className="flex-1 rounded border px-3 py-2"
                onKeyDown={(e) => e.key === "Enter" && onSubmit()}
              />
              {supported && (
                <button
                  onClick={onMic}
                  disabled={isListening}
                  className="rounded border px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
                >
                  🎤
                </button>
              )}
            </div>

            {hintText && <p className="text-sm text-amber-700">{hintText}</p>}

            <div className="flex gap-2">
              <button
                onClick={onSubmit}
                disabled={isPending || !userAnswer.trim()}
                className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                Submit
              </button>
              <button
                onClick={onHint}
                className="rounded border px-3 py-1.5 text-sm hover:bg-neutral-50"
              >
                Hint
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <p
              className={`text-sm font-medium ${
                result.verdict === "got_it"
                  ? "text-green-700"
                  : result.verdict === "close"
                    ? "text-amber-700"
                    : "text-red-700"
              }`}
            >
              {result.verdict === "got_it"
                ? "Got it!"
                : result.verdict === "close"
                  ? "Close"
                  : "Missed"}
            </p>
            <p className="text-sm text-neutral-600">{result.note}</p>
            <p className="mt-2 text-sm text-neutral-500">Translation: {line.en}</p>
            <button
              onClick={goNext}
              className="mt-3 rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700"
            >
              Continue
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
