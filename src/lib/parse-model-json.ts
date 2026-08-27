import "server-only";

export class ModelJsonParseError extends Error {
  constructor(public readonly raw: string) {
    super("Could not parse JSON out of model output");
    this.name = "ModelJsonParseError";
  }
}

/**
 * Gemini's `responseMimeType: "application/json"` mode is reliable but not
 * guaranteed — occasionally wraps output in ```json fences or adds stray
 * prose. Strip fences, try a straight parse, then fall back to extracting
 * the first {...}/[...] block.
 */
export function parseModelJson<T>(text: string): T {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(stripped) as T;
  } catch {
    // fall through to regex fallback
  }

  const match = stripped.match(/[{[][\s\S]*[}\]]/);
  if (match) {
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      // fall through
    }
  }

  throw new ModelJsonParseError(text);
}
