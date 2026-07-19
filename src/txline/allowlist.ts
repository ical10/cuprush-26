/**
 * Ingest-side team allowlist for the TxLINE feed.
 *
 * The devnet feed streams test fixtures (e.g. "Myanmar vs Vietnam") alongside
 * the real World Cup ones. `TXLINE_TEAM_ALLOWLIST` is a comma-separated list of
 * team names; a fixture is ingested only if BOTH its teams appear in the list
 * (case-insensitive, trimmed). An empty or unset value means allow all — the
 * default that preserves dev/replay behavior.
 */

// `null` means "no allowlist configured" — allow every fixture.
export type TeamAllowlist = ReadonlySet<string> | null;

function normalize(team: string): string {
  return team.trim().toLowerCase();
}

export function parseTeamAllowlist(raw: string | undefined): TeamAllowlist {
  if (!raw) return null;
  const names = raw
    .split(",")
    .map(normalize)
    .filter((name) => name.length > 0);
  return names.length > 0 ? new Set(names) : null;
}

export function isFixtureAllowed(
  allowlist: TeamAllowlist,
  homeTeam: string,
  awayTeam: string,
): boolean {
  if (allowlist === null) return true;
  return allowlist.has(normalize(homeTeam)) && allowlist.has(normalize(awayTeam));
}
