// High-frequency function words excluded from automatic card creation
// (services.md §2.7 "Noise control"). Addable manually later; not a v1
// concern since manual card creation isn't in this build round.
export const STOPLIST = new Set([
  "は", "が", "を", "に", "で", "と", "も", "の", "や", "へ", "から", "まで",
  "です", "ます", "だ", "である", "ね", "よ", "な", "か", "けど", "し",
]);

export function isStopword(tokenJa: string) {
  return STOPLIST.has(tokenJa.trim());
}
