export type ShareInput = {
  won: boolean | null;
  streak: number;
  question: string;
};

/** PRODUCT.md share line + brand name; celebrates the call, never shames a miss. */
export function buildShareText(input: ShareInput): string {
  const outcome =
    input.won === null ? "Result pending" : input.won ? "Called it" : "Not this time";
  return `${outcome}: "${input.question}" — streak: ${input.streak}. I made the call. Can you beat it? Play CupRush 26.`;
}
