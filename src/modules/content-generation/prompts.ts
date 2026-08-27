import "server-only";

export const PROMPT_VERSION = "gemini-v1";

type ScenarioContext = { nameEn: string; speakerA: string; speakerB: string };
type ExampleLine = { speaker: "a" | "b"; ja: string; romaji: string; en: string };
type LevelContext = {
  labelEn: string;
  labelJa: string;
  spec: string;
  exampleDialogue: ExampleLine[] | null;
};

function formatExample(lines: ExampleLine[]) {
  return lines
    .map((l) => `  ${l.speaker.toUpperCase()}: ${l.ja} (${l.romaji}) — "${l.en}"`)
    .join("\n");
}

export function dialoguePrompt(
  scenario: ScenarioContext,
  level: LevelContext,
  variant: string,
) {
  const exampleBlock = level.exampleDialogue?.length
    ? `\n\nEXAMPLE OF THIS EXACT DIFFICULTY (different scene, but match this vocabulary/grammar ceiling and sentence length precisely):\n${formatExample(level.exampleDialogue)}`
    : "";

  return `Write a short scripted Japanese dialogue for a listening comprehension drill.

SCENE: ${scenario.nameEn} — ${variant}
SPEAKER A: ${scenario.speakerA}
SPEAKER B: ${scenario.speakerB}
DIFFICULTY: ${level.labelEn} (${level.labelJa}) — ${level.spec}${exampleBlock}

Write 6 to 8 alternating lines starting with speaker A. The dialogue must be natural for the scene and stay strictly inside the difficulty band — this is the most important constraint. A learner at this level should be able to follow it. Do not slip in vocabulary or grammar above the band.

Respond with ONLY a JSON object of the form:
{
  "setting": "one sentence in English setting the scene for the listener",
  "lines": [
    {
      "speaker": "a" | "b",
      "ja": "the line in kanji/kana",
      "kana": "the same line in kana only",
      "romaji": "the same line in Hepburn romaji",
      "en": "natural English translation",
      "gist": "a 3-6 word nudge about what this line is about, e.g. 'asking about the price' — must NOT give away the translation",
      "key_ja": "the single most load-bearing word in the line, glossed — the one that unlocks comprehension",
      "key_romaji": "romaji of that word",
      "key_en": "English gloss of that word",
      "tokens": [{"ja":"...","kana":"...","romaji":"...","en":"..."}]
    }
  ]
}

"tokens" must split the ENTIRE line into tappable chunks that reconstruct it exactly when concatenated in order — group each word with its trailing particles or inflections, never split into single characters. Punctuation may be its own token with an empty "en".`;
}

export function gradePrompt(params: { ja: string; expectedEn: string; userAnswer: string }) {
  return `A Japanese learner heard this line and translated it into English. Grade generously — meaning matters, exact wording does not.

JAPANESE: ${params.ja}
CORRECT MEANING: ${params.expectedEn}
THEIR ANSWER: ${params.userAnswer}

Respond with ONLY a JSON object:
{"verdict":"got_it"|"close"|"missed","note":"one short sentence. If close or missed, say specifically what they misread — a wrong tense, a confused word, a missed question marker. If they got it, say nothing longer than a few words."}`;
}
