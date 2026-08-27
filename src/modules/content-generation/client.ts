// Client-safe subset of Content Generation's public surface — no
// "server-only" import here (unlike index.ts), because hint logic is pure
// and DrillClient (a client component) needs to call it directly without
// pulling in the Gemini client/DB access.
export { hintsUpTo, MAX_HINT_TIER, type Hint, type HintLine } from "./hints";
