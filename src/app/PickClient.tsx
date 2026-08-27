"use client";
import { useEffect, useState } from "react";
import { useSpeech } from "@/modules/speech";
import { saveVoiceAssignments } from "./actions";
import { useStartSession } from "./useStartSession";

type Level = {
  id: string;
  label_ja: string;
  label_en: string;
  sort_order: number;
  spec: string | null;
};

type Scenario = {
  id: string;
  slug: string;
  nameJa: string;
  nameEn: string;
  lineLabel: string | null;
  speakerA: string;
  speakerB: string;
  timesCompleted: number;
};

const VOICE_RANK = ["google", "kyoko", "o-ren", "oren", "hattori", "otoya", "nanami", "ayumi"];

function rankVoice(v: SpeechSynthesisVoice) {
  const n = v.name.toLowerCase();
  const i = VOICE_RANK.findIndex((r) => n.includes(r));
  const base = i === -1 ? 50 : i;
  return base + (/compact/.test(n) ? 100 : 0);
}

export function PickClient(props: {
  levels: Level[];
  scenarios: Scenario[];
  defaultLevelId: string;
  savedVoiceA: string | null;
  savedVoiceB: string | null;
}) {
  const { levels, scenarios, defaultLevelId, savedVoiceA, savedVoiceB } = props;
  const { speak } = useSpeech();
  const { start: startSession, isPending, error, elapsedSec } = useStartSession();

  const [levelId, setLevelId] = useState(defaultLevelId);
  const [scenarioId, setScenarioId] = useState(scenarios[0]?.id ?? "");
  const [jaVoices, setJaVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceA, setVoiceA] = useState<string | null>(savedVoiceA);
  const [voiceB, setVoiceB] = useState<string | null>(savedVoiceB);

  const scenario = scenarios.find((s) => s.id === scenarioId) ?? scenarios[0];

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => {
      const all = window.speechSynthesis.getVoices();
      const ja = all.filter((v) => v.lang.toLowerCase().startsWith("ja")).sort(
        (a, b) => rankVoice(a) - rankVoice(b),
      );
      if (ja.length === 0) return;
      setJaVoices(ja);
      setVoiceA((prev) => prev || ja[0]?.name || null);
      setVoiceB((prev) => prev || (ja[1] ?? ja[0])?.name || null);
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
  }, []);

  function testVoice(name: string | null) {
    if (!name) return;
    speak("はい、こんにちは。", { voiceName: name, lang: "ja-JP" });
  }

  function onVoiceAChange(name: string) {
    setVoiceA(name);
    saveVoiceAssignments({ voiceA: name, voiceB });
  }
  function onVoiceBChange(name: string) {
    setVoiceB(name);
    saveVoiceAssignments({ voiceA, voiceB: name });
  }

  return (
    <>
      <div className="text-xs tracking-[0.25em] mb-3 text-noren-dim">LEVEL</div>
      <div className="grid-list grid gap-px mb-8">
        {levels.map((l, i) => {
          const on = l.id === levelId;
          return (
            <button
              key={l.id}
              onClick={() => setLevelId(l.id)}
              disabled={isPending}
              className="text-left px-4 py-3 flex items-baseline gap-4 bg-noren-bg"
              style={{
                background: on ? "var(--noren-panel)" : "var(--noren-bg)",
                borderLeft: `3px solid ${on ? "var(--noren-amber)" : "transparent"}`,
              }}
            >
              <span className="text-[10px] w-6 shrink-0 text-noren-dim">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className={`jp text-lg w-16 shrink-0 ${on ? "text-noren-amber" : ""}`}>
                {l.label_ja}
              </span>
              <span className="text-sm uppercase tracking-wide w-28 shrink-0">{l.label_en}</span>
            </button>
          );
        })}
      </div>

      <div className="text-xs tracking-[0.25em] mb-3 text-noren-dim">SCENE</div>
      <div className="grid-list grid gap-px mb-2">
        {scenarios.map((s) => {
          const on = s.id === scenarioId;
          return (
            <button
              key={s.id}
              onClick={() => setScenarioId(s.id)}
              disabled={isPending}
              className="text-left px-4 py-3 flex items-baseline gap-4"
              style={{
                background: on ? "var(--noren-panel)" : "var(--noren-bg)",
                borderLeft: `3px solid ${on ? "var(--noren-amber)" : "transparent"}`,
              }}
            >
              <span
                className="text-[10px] tracking-[0.2em] w-20 shrink-0"
                style={{ color: on ? "var(--noren-amber)" : "var(--noren-dim)" }}
              >
                {s.lineLabel}
              </span>
              <span className="jp text-lg">{s.nameJa}</span>
              <span className="text-sm ml-auto uppercase tracking-wide text-noren-dim">
                {s.nameEn}
                {s.timesCompleted > 0 && (
                  <span className="ml-2 text-noren-cyan">×{s.timesCompleted}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-xs mb-8 text-noren-dim">
        Each run writes a new dialogue — the scene won&apos;t repeat itself.
      </p>

      <div className="text-xs tracking-[0.25em] mb-3 text-noren-dim">VOICES</div>
      {jaVoices.length ? (
        <>
          <div className="grid sm:grid-cols-2 gap-px mb-2 grid-list">
            {(
              [
                ["a", scenario?.speakerA ?? "", voiceA, onVoiceAChange, "var(--noren-amber)"],
                ["b", scenario?.speakerB ?? "", voiceB, onVoiceBChange, "var(--noren-cyan)"],
              ] as const
            ).map(([key, label, val, setter, color]) => (
              <div key={key} className="px-4 py-3 bg-noren-panel">
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-[10px] tracking-[0.2em]" style={{ color }}>
                    SPEAKER {key.toUpperCase()}
                  </span>
                  <span className="jp text-sm text-noren-dim">{label}</span>
                  <button
                    onClick={() => testVoice(val)}
                    className="ml-auto text-[10px] uppercase tracking-[0.15em] px-2 py-1 border border-noren-edge text-noren-dim"
                  >
                    Test
                  </button>
                </div>
                <select
                  value={val ?? ""}
                  onChange={(e) => setter(e.target.value)}
                  className="w-full px-2 py-2 text-sm outline-none bg-noren-bg text-noren-ink border border-noren-edge"
                >
                  {jaVoices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <p className="text-xs mb-8 text-noren-dim">
            Two different voices makes the dialogue far easier to follow. Best first in the list —
            skip anything marked Compact.
          </p>
        </>
      ) : (
        <p className="text-sm mb-8 text-noren-rose">
          No Japanese voice found on this device. Audio will be unintelligible until you install
          one.
        </p>
      )}

      {error && <div className="text-sm mb-4 text-noren-rose">{error}</div>}

      <button
        onClick={() => startSession({ scenarioId, level: levelId })}
        disabled={isPending || !scenarioId}
        className="w-full py-4 text-lg font-semibold uppercase tracking-[0.2em] disabled:opacity-50 bg-noren-amber text-noren-bg"
      >
        {isPending ? (
          <span className="pulse">Writing the dialogue… ({elapsedSec}s)</span>
        ) : (
          "Start listening"
        )}
      </button>
      {isPending && (
        <>
          <div className="h-1 mt-2 overflow-hidden bg-noren-panel">
            <div className="h-full w-1/3 bg-noren-amber loading-bar" />
          </div>
          <p className="text-xs mt-2 text-noren-dim">
            Usually 5–15s for a scene played before, up to 30s the first time. New scenes take
            longer to write than replays.
          </p>
        </>
      )}
    </>
  );
}
