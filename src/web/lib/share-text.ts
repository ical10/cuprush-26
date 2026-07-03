export type ShareInput = {
  won: boolean | null;
  streak: number;
  question: string;
};

export function buildShareText(input: ShareInput): string {
  const outcome =
    input.won === null ? "Result pending" : input.won ? "Nailed it" : "Missed it";
  return `${outcome}: "${input.question}" — streak: ${input.streak}. Play World Cup Hi-Lo.`;
}
