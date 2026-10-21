// Pure salvage pass over a freshly generated dialogue, run between
// parseModelJson and validateGeneratedDialogue.
//
// Why it exists: validation requires `tokens.join("") === ja` exactly, while
// DrillClient — validation's only consumer — compares with whitespace
// stripped. Validation was stricter than the thing it protects, so dialogues
// were being thrown away over a stray space. Rather than loosen the
// comparison (which would make every future consumer re-implement the same
// tolerance), we re-slice the tokens out of `ja` itself so exact
// reconstruction holds by construction.
//
// Everything here is deliberately conservative: a real content mismatch
// still fails validation rather than being papered over.
import type { Token } from "@/lib/types";
import { normalize } from "./grading";

/** ASCII whitespace plus the ideographic space, which Gemini emits in JP text. */
const WHITESPACE = /[\s　]/;

function stripWhitespace(text: string): string {
  return text.replace(/[\s　]/g, "");
}

export type RepairNote =
  | { kind: "tokens_realigned"; line: number }
  | { kind: "acceptable_en_normalized"; line: number; from: number; to: number };

/**
 * Re-slices `tokens` directly out of `ja` so they reconstruct it exactly.
 *
 * Succeeds only when the tokens' non-whitespace characters already match
 * `ja`'s, in order — i.e. the model got the content right and only disagreed
 * about whitespace. Returns null for any real mismatch (a dropped or
 * hallucinated morpheme, reordering, a full/half-width difference), so
 * genuinely broken tokenization still fails validation downstream.
 *
 * Because every emitted token is a contiguous slice of `ja` and the slices
 * cover it with no gaps, `out.map(t => t.ja).join("") === ja` always holds
 * on success. Glosses (kana/romaji/en) ride along untouched.
 */
export function realignTokensToJa(ja: string, tokens: readonly Token[]): Token[] | null {
  if (tokens.length === 0) return null;

  const out: Token[] = [];
  let cursor = 0;

  for (const token of tokens) {
    const target = stripWhitespace(token.ja ?? "");

    // A whitespace-only token carries no content to anchor on; drop it
    // rather than guess where it belongs. Its characters are still absorbed
    // into a neighbour by the walk below.
    if (target.length === 0) continue;

    const start = cursor;
    let matched = 0;

    while (matched < target.length && cursor < ja.length) {
      if (WHITESPACE.test(ja[cursor])) {
        cursor++;
        continue;
      }
      if (ja[cursor] !== target[matched]) return null;
      cursor++;
      matched++;
    }

    if (matched < target.length) return null; // ja ran out mid-token
    out.push({ ...token, ja: ja.slice(start, cursor) });
  }

  if (out.length === 0) return null;

  if (cursor < ja.length) {
    const remainder = ja.slice(cursor);
    // Trailing whitespace is harmless — hang it off the last token so the
    // slices still cover `ja`. Trailing *content* means the tokens are
    // missing part of the line.
    if (stripWhitespace(remainder).length > 0) return null;
    out[out.length - 1] = { ...out[out.length - 1], ja: out[out.length - 1].ja + remainder };
  }

  return out;
}

/** Cap on stored phrasings per line — `bestSimilarity` is linear in these. */
const MAX_ACCEPTABLE_EN = 8;

/**
 * Trim, drop blanks, and dedupe on the same normalization grading uses, so
 * `acceptable_en` never carries entries that cannot affect a verdict.
 * Tolerates the model returning a non-array.
 */
export function normalizeAcceptableEn(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const key = normalize(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= MAX_ACCEPTABLE_EN) break;
  }
  return out;
}

type RepairableLine = {
  ja?: string;
  tokens?: Token[];
  acceptable_en?: unknown;
  [key: string]: unknown;
};

type RepairableDialogue = {
  setting?: string;
  lines?: RepairableLine[];
  [key: string]: unknown;
};

/**
 * Whole-dialogue pass. Never touches speaker labels — see validation.ts for
 * why relabeling is unsafe. Returns the repaired value plus notes describing
 * what was changed, which the caller records on the attempt row so "how often
 * does repair save a dialogue" stays a query.
 */
export function repairGeneratedDialogue<T extends RepairableDialogue>(
  parsed: T,
): { value: T; notes: RepairNote[] } {
  const notes: RepairNote[] = [];
  if (!Array.isArray(parsed.lines)) return { value: parsed, notes };

  const lines = parsed.lines.map((line, i) => {
    let next = line;

    if (line.ja && Array.isArray(line.tokens) && line.tokens.length > 0) {
      const joined = line.tokens.map((t) => t?.ja ?? "").join("");
      if (joined !== line.ja) {
        const realigned = realignTokensToJa(line.ja, line.tokens);
        if (realigned) {
          next = { ...next, tokens: realigned };
          notes.push({ kind: "tokens_realigned", line: i });
        }
      }
    }

    if (line.acceptable_en !== undefined) {
      const before = Array.isArray(line.acceptable_en) ? line.acceptable_en.length : 0;
      const cleaned = normalizeAcceptableEn(line.acceptable_en);
      if (cleaned.length !== before) {
        notes.push({ kind: "acceptable_en_normalized", line: i, from: before, to: cleaned.length });
      }
      next = { ...next, acceptable_en: cleaned };
    }

    return next;
  });

  return { value: { ...parsed, lines }, notes };
}
