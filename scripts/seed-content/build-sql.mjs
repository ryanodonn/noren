#!/usr/bin/env node
// Validates hand-authored dialogue JSON files and emits a single SQL file
// that inserts them into generated_dialogues/generated_lines, sharing the
// exact same pool as live-Gemini-generated rows (docs/services.md §2.3).
//
// Usage:
//   node scripts/seed-content/build-sql.mjs scripts/seed-content/data/*.json > out.sql
//
// Each input file is one dialogue: { scenario_slug, variant_id, level, setting, lines: [...] }
// Each line: { speaker: "a"|"b", ja, kana, romaji, en, gist, key_ja, key_romaji, key_en,
//              tokens: [{ja,kana,romaji,en}], acceptable_en?: string[] }
//
// Validation (hard-fails the whole run on any violation, so a bad entry
// never silently ships):
//   - 6-8 lines, speakers alternate starting with "a"
//   - every required field present and non-empty
//   - each line's tokens[].ja concatenate to exactly reconstruct that line's ja
//     (this is what makes the post-answer "tap any word" reveal work at all)

import { readFileSync } from "node:fs";

const REQUIRED_LINE_FIELDS = ["speaker", "ja", "kana", "romaji", "en", "gist", "tokens"];
const MODEL = "claude-authored";
const PROMPT_VERSION = "claude-manual-v1";

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
}

function validateDialogue(d, file) {
  const errors = [];
  if (!d.scenario_slug) errors.push("missing scenario_slug");
  if (!d.variant_id) errors.push("missing variant_id");
  if (!d.level) errors.push("missing level");
  if (!d.setting) errors.push("missing setting");
  if (!Array.isArray(d.lines) || d.lines.length < 6 || d.lines.length > 8) {
    errors.push(`lines must be 6-8, got ${d.lines?.length}`);
  }
  (d.lines ?? []).forEach((line, i) => {
    const expectedSpeaker = i % 2 === 0 ? "a" : "b";
    if (line.speaker !== expectedSpeaker) {
      errors.push(`line ${i}: expected speaker "${expectedSpeaker}", got "${line.speaker}"`);
    }
    for (const field of REQUIRED_LINE_FIELDS) {
      if (!line[field] || (Array.isArray(line[field]) && line[field].length === 0)) {
        errors.push(`line ${i}: missing/empty required field "${field}"`);
      }
    }
    if (Array.isArray(line.tokens)) {
      const reconstructed = line.tokens.map((t) => t.ja ?? "").join("");
      if (reconstructed !== line.ja) {
        errors.push(
          `line ${i}: tokens do not reconstruct ja exactly.\n    ja:  ${line.ja}\n    got: ${reconstructed}`,
        );
      }
    }
  });
  if (errors.length) {
    throw new Error(`Validation failed for ${file}:\n  ${errors.join("\n  ")}`);
  }
}

function buildSql(d) {
  const lines = d.lines
    .map((line, seq) => {
      const acceptableEn = line.acceptable_en ?? [];
      return `  (v_dialogue_id, ${seq}, ${sqlString(line.speaker)}, ${sqlString(line.ja)}, ${sqlString(line.kana)}, ${sqlString(line.romaji)}, ${sqlString(line.en)}, ${sqlString(line.gist)}, ${sqlString(line.key_ja ?? null)}, ${sqlString(line.key_romaji ?? null)}, ${sqlString(line.key_en ?? null)}, ${sqlJson(line.tokens)}, ${sqlJson(acceptableEn)})`;
    })
    .join(",\n");

  return `
do $$
declare
  v_scenario_id uuid;
  v_dialogue_id uuid;
begin
  select id into v_scenario_id from scenarios where slug = ${sqlString(d.scenario_slug)};
  if v_scenario_id is null then
    raise exception 'unknown scenario slug: %', ${sqlString(d.scenario_slug)};
  end if;

  insert into generated_dialogues (scenario_id, variant_id, level, setting, model, prompt_version)
  values (v_scenario_id, ${sqlString(d.variant_id)}, ${sqlString(d.level)}, ${sqlString(d.setting)}, ${sqlString(MODEL)}, ${sqlString(PROMPT_VERSION)})
  returning id into v_dialogue_id;

  insert into generated_lines
    (dialogue_id, seq, speaker, ja, kana, romaji, en, gist, key_ja, key_romaji, key_en, tokens, acceptable_en)
  values
${lines};
end $$;
`;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node build-sql.mjs <file.json> [more files...]");
  process.exit(1);
}

let out = "";
let count = 0;
for (const file of files) {
  const raw = readFileSync(file, "utf8");
  const dialogues = JSON.parse(raw);
  const list = Array.isArray(dialogues) ? dialogues : [dialogues];
  for (const d of list) {
    validateDialogue(d, file);
    out += buildSql(d);
    count++;
  }
}

process.stderr.write(`Validated and generated SQL for ${count} dialogues.\n`);
process.stdout.write(out);
