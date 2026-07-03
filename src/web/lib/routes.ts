export type Screen = "deck" | "live" | "result" | "leaderboard" | "profile" | "auth";

const SCREENS: Screen[] = ["deck", "live", "result", "leaderboard", "profile", "auth"];

export function screenFromHash(hash: string): Screen {
  const clean = hash.replace(/^#\/?/, "");
  return (SCREENS as string[]).includes(clean) ? (clean as Screen) : "deck";
}

export function hashForScreen(screen: Screen): string {
  return `#/${screen}`;
}
