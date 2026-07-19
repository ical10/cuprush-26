/**
 * Ingest-side competition filter for the TxLINE feed.
 *
 * The devnet feed replays real World Cup matches (CompetitionId 72) alongside
 * junk from other competitions (e.g. Friendlies, CompetitionId 430). The old
 * World Cup fixtures ARE wanted content — agents predict on them — so the
 * correct gate is "this competition, not that team". `TXLINE_COMPETITION_ID`
 * is a single integer; a fixture is ingested only if its CompetitionId matches.
 * An empty, unset, or non-integer value means allow all — the default that
 * preserves dev/replay behavior.
 */

// `null` means "no competition filter configured" — allow every fixture.
export type CompetitionFilter = number | null;

export function parseCompetitionId(raw: string | undefined): CompetitionFilter {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) {
    console.warn(
      `TXLINE_COMPETITION_ID="${raw}" is not an integer — ignoring the filter (allowing all competitions)`,
    );
    return null;
  }
  return parsed;
}

export function isFixtureInCompetition(
  filter: CompetitionFilter,
  competitionId: number | null,
): boolean {
  if (filter === null) return true;
  return competitionId === filter;
}
