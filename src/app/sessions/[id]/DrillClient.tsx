"use client";
import { useMemo, useState, useTransition } from "react";
import { useSpeech } from "@/modules/speech";
import { hintsUpTo, MAX_HINT_TIER, type HintLine } from "@/modules/content-generation/client";
import { submitAttempt, skipAttempt, lookupToken, finishSession } from "./actions";

type Token = { ja: string; kana?: string; romaji?: string; en?: string };
type Line = HintLine & {
  id: string;
  seq: number;
  speaker: "a" | "b";
  ja: string;
  romaji: string | null;
  en: string;
  tokens: Token[];
};

export function DrillClient(props: {
  sessionId: string;
  scenarioNameJa: string;
  lineLabel: string | null;
  levelLabelEn: string;
  levelRate: number;
  speakerA: string;
  speakerB: string;
  setting: string | null;
  voiceA: string | null;
  voiceB: string | null;
  lines: Line[];
}) {
  const {
    sessionId,
    scenarioNameJa,
    lineLabel,
    levelLabelEn,
    levelRate,
    speakerA,
    speakerB,
    setting,
    voiceA,
    voiceB,
    lines,
  } = props;
  const { speak } = useSpeech();
  const [isPending, startTransition] = useTransition();

  const [index, setIndex] = useState(0);
  const [hintTier, setHintTier] = useState(0);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<{ verdict: string; note: string | null } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [scores, setScores] = useState<string[]>([]);
  const [selected, setSelected] = useState<Token | null>(null);
  const [playedOnce, setPlayedOnce] = useState(false);
  const [startedAt, setStartedAt] = useState(() => Date.now());

  const line = lines[index];
  const done = !line;

  const speakerLabel = line?.speaker === "a" ? speakerA : speakerB;
  const speakerColor = line?.speaker === "a" ? "var(--noren-amber)" : "var(--noren-cyan)";

  const tokensReconstructLine = useMemo(() => {
    if (!line || !line.tokens?.length) return false;
    const joined = line.tokens.map((t) => t.ja).join("");
    return joined.replace(/\s/g, "") === line.ja.replace(/\s/g, "");
  }, [line]);

  function speakLine(rate: number) {
    if (!line) return;
    const wanted = line.speaker === "a" ? voiceA : voiceB;
    const samevoice = voiceA && voiceA === voiceB;
    speak(line.ja, {
      lang: "ja-JP",
      voiceName: wanted ?? undefined,
      rate,
      pitch: samevoice ? (line.speaker === "a" ? 0.9 : 1.12) : undefined,
    });
    setPlayedOnce(true);
  }

  function resetForNextLine() {
    setAnswer("");
    setHintTier(0);
    setResult(null);
    setRevealed(false);
    setSelected(null);
    setPlayedOnce(false);
    setStartedAt(Date.now());
  }

  function goNext() {
    setIndex((i) => i + 1);
    resetForNextLine();
  }

  function onSubmit() {
    if (!answer.trim() || isPending) return;
    startTransition(async () => {
      const res = await submitAttempt({
        sessionId,
        lineId: line.id,
        seq: line.seq,
        userAnswer: answer,
        hintsUsed: hintTier,
        latencyMs: Date.now() - startedAt,
      });
      setResult(res);
      setScores((s) => [...s, res.verdict]);
      setRevealed(true);
    });
  }

  function onSkip() {
    startTransition(async () => {
      const res = await skipAttempt({
        sessionId,
        lineId: line.id,
        seq: line.seq,
        hintsUsed: hintTier,
        latencyMs: Date.now() - startedAt,
      });
      setResult(res);
      setScores((s) => [...s, res.verdict]);
      setRevealed(true);
    });
  }

  async function onLookup(token: Token) {
    setSelected(token);
    speak(token.ja, { lang: "ja-JP" });
    await lookupToken({ sessionId, ja: token.ja, kana: token.kana, romaji: token.romaji, en: token.en });
  }

  function onFinish() {
    startTransition(async () => {
      await finishSession({ sessionId });
    });
  }

  if (done) {
    return (
      <div className="screen items-center justify-center">
        <div className="text-center rise">
          <p className="mb-4 text-noren-dim">That&apos;s the end of the conversation.</p>
          <button
            onClick={onFinish}
            disabled={isPending}
            className="py-4 px-8 font-semibold uppercase tracking-[0.2em] disabled:opacity-50 bg-noren-amber text-noren-bg"
          >
            Finish
          </button>
        </div>
      </div>
    );
  }

  const hints = hintsUpTo(line, hintTier);

  return (
    <div className="board screen">
      <div
        className="px-4 sm:px-6 py-3 flex items-center gap-3 border-b shrink-0 bg-noren-panel"
        style={{ borderColor: "var(--noren-edge)" }}
      >
        {lineLabel && (
          <div className="text-[10px] tracking-[0.2em] px-2 py-1 bg-noren-amber text-noren-bg">
            {lineLabel}
          </div>
        )}
        <div className="leading-tight min-w-0">
          <div className="jp text-base truncate">{scenarioNameJa}</div>
          <div className="text-[11px] uppercase tracking-[0.15em] text-noren-dim">
            {levelLabelEn}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {lines.map((_, i) => (
            <div
              key={i}
              className="w-2 h-2"
              style={{
                background:
                  i < scores.length
                    ? scores[i] === "got_it"
                      ? "var(--noren-cyan)"
                      : scores[i] === "close"
                        ? "var(--noren-amber)"
                        : "var(--noren-rose)"
                    : i === index
                      ? "var(--noren-ink)"
                      : "var(--noren-edge)",
              }}
            />
          ))}
        </div>
        <button
          onClick={onFinish}
          className="text-[11px] uppercase tracking-[0.15em] px-3 py-2 border border-noren-edge text-noren-dim"
        >
          End
        </button>
      </div>

      {setting && (
        <div
          className="px-4 sm:px-6 py-2 text-sm border-b shrink-0 text-noren-dim"
          style={{ borderColor: "var(--noren-edge)" }}
        >
          {setting}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        <div className="max-w-2xl mx-auto">
          <div className="text-[10px] tracking-[0.2em] mb-4 text-noren-dim">
            LINE {index + 1} OF {lines.length} ·{" "}
            <span className="jp" style={{ color: speakerColor }}>
              {speakerLabel}
            </span>{" "}
            IS SPEAKING
          </div>

          <div className="flex gap-3 mb-8">
            <button
              onClick={() => speakLine(levelRate)}
              className="flex-1 py-6 text-lg font-semibold uppercase tracking-[0.2em] bg-noren-edge"
              style={{ borderLeft: `3px solid ${speakerColor}` }}
            >
              ▸ Play
            </button>
            <button
              onClick={() => speakLine(levelRate * 0.6)}
              className="px-6 py-6 text-xs uppercase tracking-[0.15em] border border-noren-edge text-noren-dim"
            >
              Slower
            </button>
          </div>

          {!revealed && (
            <div className="mb-8">
              <div className="text-[10px] tracking-[0.2em] mb-2 text-noren-dim">STUCK?</div>
              <div className="space-y-px grid-list">
                {hints.map((h) => (
                  <div key={h.tier} className="px-4 py-3 text-sm rise bg-noren-panel">
                    {h.tier === 1 && (
                      <>
                        <span className="text-noren-dim">What it&apos;s about · </span>
                        {h.gist}
                      </>
                    )}
                    {h.tier === 2 && (
                      <>
                        <span className="text-noren-dim">Key word · </span>
                        <span className="jp">{h.keyJa}</span>
                        <span className="text-noren-dim"> ({h.keyRomaji}) </span>
                        {h.keyEn}
                      </>
                    )}
                    {h.tier === 3 && (
                      <div>
                        <div className="text-[10px] tracking-[0.2em] mb-1 text-noren-dim">
                          WHAT WAS SAID
                        </div>
                        <div className="jp text-lg">{h.kana}</div>
                        <div className="text-sm text-noren-dim">{h.romaji}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {hintTier < MAX_HINT_TIER && (
                <button
                  onClick={() => setHintTier((t) => t + 1)}
                  disabled={!playedOnce}
                  className="mt-2 text-xs uppercase tracking-[0.2em] px-3 py-2 disabled:opacity-30 border border-noren-edge text-noren-amber"
                >
                  {hintTier === 0
                    ? "Hint · what it's about"
                    : hintTier === 1
                      ? "Hint · key word"
                      : "Hint · show the Japanese"}
                </button>
              )}
            </div>
          )}

          {revealed && (
            <div className="mb-8 rise">
              {result && (
                <div
                  className="px-4 py-3 mb-px bg-noren-panel"
                  style={{
                    borderLeft: `3px solid ${
                      result.verdict === "got_it"
                        ? "var(--noren-cyan)"
                        : result.verdict === "close"
                          ? "var(--noren-amber)"
                          : "var(--noren-rose)"
                    }`,
                  }}
                >
                  <div
                    className="text-[10px] tracking-[0.2em] mb-1"
                    style={{
                      color:
                        result.verdict === "got_it"
                          ? "var(--noren-cyan)"
                          : result.verdict === "close"
                            ? "var(--noren-amber)"
                            : "var(--noren-rose)",
                    }}
                  >
                    {result.verdict === "got_it"
                      ? "GOT IT"
                      : result.verdict === "close"
                        ? "CLOSE"
                        : "MISSED"}
                  </div>
                  <div className="text-sm">{result.note}</div>
                </div>
              )}
              <div className="px-4 py-4 bg-noren-panel">
                <div className="text-[10px] tracking-[0.2em] mb-2 text-noren-dim">
                  {tokensReconstructLine ? "TAP ANY WORD" : "WHAT WAS SAID"}
                </div>
                <div className="jp text-2xl leading-loose" style={{ wordBreak: "break-word" }}>
                  {tokensReconstructLine
                    ? line.tokens.map((tok, j) => (
                        <span
                          key={j}
                          className={tok.en ? "tok" : undefined}
                          onClick={() => tok.en && onLookup(tok)}
                        >
                          {tok.ja}
                        </span>
                      ))
                    : line.ja}
                </div>
                <div className="text-sm mt-2 text-noren-dim">{line.romaji}</div>
                <div className="text-base mt-2">{line.en}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {selected && (
        <div
          className="px-4 sm:px-6 py-3 border-t rise shrink-0"
          style={{ background: "#0B1A18", borderColor: "var(--noren-amber)" }}
        >
          <div className="max-w-2xl mx-auto flex items-start gap-4">
            <div>
              <div className="jp text-2xl">{selected.ja}</div>
              <div className="text-sm text-noren-amber">
                {selected.kana} · {selected.romaji}
              </div>
              <div className="text-base mt-1">{selected.en}</div>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="ml-auto text-xs uppercase tracking-[0.15em] px-3 py-2 border border-noren-edge text-noren-dim"
            >
              Close
            </button>
          </div>
        </div>
      )}

      <div
        className="shrink-0 border-t px-4 sm:px-6 py-4 bg-noren-panel"
        style={{ borderColor: "var(--noren-edge)" }}
      >
        <div className="max-w-2xl mx-auto">
          {!revealed ? (
            <>
              <div className="flex gap-2">
                <input
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onSubmit();
                    }
                  }}
                  placeholder="What did they say, in English?"
                  disabled={isPending}
                  className="flex-1 px-3 py-3 outline-none bg-noren-bg text-noren-ink border border-noren-edge"
                />
                <button
                  onClick={onSubmit}
                  disabled={isPending || !answer.trim()}
                  className="px-6 text-sm font-semibold uppercase tracking-[0.15em] disabled:opacity-30 bg-noren-amber text-noren-bg"
                >
                  {isPending ? "…" : "Check"}
                </button>
              </div>
              <button
                onClick={onSkip}
                disabled={isPending}
                className="w-full mt-3 py-2 text-xs uppercase tracking-[0.2em] border border-noren-edge text-noren-dim"
              >
                I don&apos;t know — show me
              </button>
            </>
          ) : (
            <button
              onClick={goNext}
              className="w-full py-4 font-semibold uppercase tracking-[0.2em] bg-noren-amber text-noren-bg"
            >
              {index + 1 >= lines.length ? "See results" : "Next line"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
