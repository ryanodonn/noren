import "server-only";

// Provenance only, never a pool partition key: hand-authored rows and every
// generation era share one pool (services.md §2.3). Bumped to v2 when
// acceptable_en joined the response shape.
export const PROMPT_VERSION = "gemini-v2";

type ScenarioContext = { nameEn: string; speakerA: string; speakerB: string };
type ExampleLine = { speaker: "a" | "b"; ja: string; romaji: string; en: string };
type LevelContext = {
  labelEn: string;
  labelJa: string;
  spec: string;
  exampleDialogues: ExampleLine[][] | null;
};

function formatExample(lines: ExampleLine[]) {
  return lines
    .map((l) => `  ${l.speaker.toUpperCase()}: ${l.ja} (${l.romaji}) — "${l.en}"`)
    .join("\n");
}

function formatExamples(examples: ExampleLine[][]) {
  return examples
    .map((lines, i) => `Example ${i + 1}:\n${formatExample(lines)}`)
    .join("\n\n");
}

export function dialoguePrompt(
  scenario: ScenarioContext,
  level: LevelContext,
  variant: string,
) {
  const exampleBlock = level.exampleDialogues?.length
    ? `\n\nEXAMPLES OF THIS EXACT DIFFICULTY (different scenes, but match this vocabulary/grammar ceiling and sentence length precisely — vary your phrasing across these patterns rather than copying just one):\n${formatExamples(level.exampleDialogues)}`
    : "";

  return `Write a short scripted Japanese dialogue for a listening comprehension drill.

SCENE: ${scenario.nameEn} — ${variant}
SPEAKER A: ${scenario.speakerA}
SPEAKER B: ${scenario.speakerB}
DIFFICULTY: ${level.labelEn} (${level.labelJa}) — ${level.spec}${exampleBlock}

Write 6 to 8 lines that alternate strictly, turn by turn. Either speaker may open — whichever is natural for walking in on a scene already in progress. The dialogue must be natural for the scene and stay strictly inside the difficulty band — this is the most important constraint. A learner at this level should be able to follow it. Do not slip in vocabulary or grammar above the band.

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
      "tokens": [{"ja":"...","kana":"...","romaji":"...","en":"..."}],
      "acceptable_en": ["another natural English translation", "..."]
    }
  ]
}

"tokens" must split the ENTIRE line into tappable chunks that reconstruct it exactly when concatenated in order — group each word with its trailing particles or inflections, never split into single characters. Punctuation may be its own token with an empty "en". For example, for ja "袋はいりますか。":
  "tokens": [{"ja":"袋は","kana":"ふくろは","romaji":"fukuro wa","en":"bag"},{"ja":"いりますか","kana":"いりますか","romaji":"irimasu ka","en":"do you need"},{"ja":"。","romaji":"","en":""}]

"acceptable_en" must list 3 to 5 ADDITIONAL natural English translations of the same line that a learner could reasonably type and should be counted fully correct. Vary contractions, politeness, and common synonym choices. Do not repeat the "en" value itself, and do not include anything that changes the meaning — these are graded as correct answers.`;
}
