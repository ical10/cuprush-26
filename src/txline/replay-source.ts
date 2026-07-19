import { fixtureStage, type FixtureStage, type FixtureStats } from "../db/schema";
import {
  createAuthorizedFetch,
  readLiveConfig,
  type FetchLike,
} from "./live-client";
import {
  parseScoreSnapshot,
  txLineFixtureListSchema,
  type TxLineFixtureSnapshot,
} from "./schema";

/**
 * Replay fixtures reuse a finished TxLINE match as their settlement source:
 * seed:replays clones the local fixture row (teams/competition) under a new
 * `replay-<sourceId>-<counter>` id, and the scheduler's tick finisher fetches
 * that source id's live scores snapshot AT FINISH TIME to attach stats. TxLINE
 * stays the sole stats authority — nothing is cached at seed time.
 *
 * This module owns the replay-id encoding, the REPLAY_SOURCE_IDS / _INCLUDE /
 * _EXCLUDE / _STAGE parsing, and the one TxLINE HTTP boundary the finisher
 * needs (reusing live-client's guest-JWT + X-Api-Token auth).
 */

export const REPLAY_ID_PREFIX = "replay-";

/** `replay-<sourceId>-<counter>`; counter lets the same match be re-replayed. */
export function encodeReplayId(sourceId: string, counter = 0): string {
  return `${REPLAY_ID_PREFIX}${sourceId}-${counter}`;
}

/**
 * Recovers the TxLINE source id (and re-replay counter) from a replay fixture
 * id, or null if the id isn't a replay id. The counter is the trailing
 * `-<digits>` segment, so a source id may itself contain dashes.
 */
export function parseReplayId(id: string): { sourceId: string; counter: number } | null {
  if (!id.startsWith(REPLAY_ID_PREFIX)) return null;
  const body = id.slice(REPLAY_ID_PREFIX.length);
  const lastDash = body.lastIndexOf("-");
  if (lastDash <= 0) return null;
  const sourceId = body.slice(0, lastDash);
  const counterText = body.slice(lastDash + 1);
  if (!/^\d+$/.test(counterText)) return null;
  return { sourceId, counter: Number(counterText) };
}

/** Splits a comma-separated env list into trimmed tokens; null when unset/empty. */
export function parseIdList(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  const tokens = raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  return tokens.length > 0 ? tokens : null;
}

/**
 * Applies REPLAY_INCLUDE (keep only these source ids; null = keep all) then
 * REPLAY_EXCLUDE (drop these; null = drop none). A key matching no source id
 * is a typo, not a silent no-op — this throws so the operator learns.
 */
export function applySelection(
  sourceIds: string[],
  include: string[] | null,
  exclude: string[] | null,
): string[] {
  const known = new Set(sourceIds);
  for (const key of [...(include ?? []), ...(exclude ?? [])]) {
    if (!known.has(key)) {
      throw new Error(
        `REPLAY_INCLUDE/REPLAY_EXCLUDE references unknown source id "${key}". ` +
          `REPLAY_SOURCE_IDS: ${sourceIds.join(", ")}.`,
      );
    }
  }
  const includeSet = include === null ? null : new Set(include);
  const excludeSet = exclude === null ? null : new Set(exclude);
  return sourceIds.filter(
    (id) => (!includeSet || includeSet.has(id)) && !(excludeSet && excludeSet.has(id)),
  );
}

export const DEFAULT_REPLAY_STAGE: FixtureStage = "early_knockout";

/** REPLAY_STAGE (env) → validated FixtureStage; defaults to early_knockout. */
export function parseReplayStage(env: NodeJS.ProcessEnv): FixtureStage {
  const raw = env.REPLAY_STAGE;
  if (raw === undefined || raw === "") return DEFAULT_REPLAY_STAGE;
  if ((fixtureStage.enumValues as readonly string[]).includes(raw)) {
    return raw as FixtureStage;
  }
  throw new Error(
    `REPLAY_STAGE must be one of ${fixtureStage.enumValues.join(", ")} (got "${raw}")`,
  );
}

// --- finisher TxLINE boundary -----------------------------------------------

/** Whether TxLINE live creds are present — the finisher no-ops without them. */
export function hasTxLineCreds(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.TXLINE_BASE_URL && env.TXLINE_API_KEY);
}

// CompetitionId 72 = World Cup — the only competition replays are drawn from.
export const REPLAY_COMPETITION_ID = 72;

/** Resolves finished source fixtures' metadata (teams, competition) from TxLINE. */
export type ReplayMetaFetcher = (signal?: AbortSignal) => Promise<TxLineFixtureSnapshot[]>;

/**
 * Builds the seed-path metadata fetcher: `GET /api/fixtures/snapshot` filtered
 * server-side by the 2026 WC window (REPLAY_START_EPOCH_DAY = epoch ms /
 * 86_400_000) and competitionId 72. This endpoint DOES resolve past/finished
 * fixtures by day, so seed:replays reads teams straight from the feed — TxLINE
 * is the sole metadata source, nothing is cloned from local rows. Throws if
 * creds or the epoch day are absent (both are required to seed).
 */
export function createReplayMetaFetcher(
  env: NodeJS.ProcessEnv,
  fetchImpl?: FetchLike,
): ReplayMetaFetcher {
  const config = readLiveConfig(env);
  const startEpochDay = env.REPLAY_START_EPOCH_DAY;
  if (!startEpochDay || !/^\d+$/.test(startEpochDay)) {
    throw new Error(
      "seed:replays needs REPLAY_START_EPOCH_DAY (epoch ms / 86_400_000) to " +
        "query the TxLINE fixtures snapshot for the source matches' metadata.",
    );
  }
  const authorizedFetch = createAuthorizedFetch(config, fetchImpl ?? fetch);

  return async (signal) => {
    const res = await authorizedFetch(
      `/api/fixtures/snapshot?startEpochDay=${startEpochDay}&competitionId=${REPLAY_COMPETITION_ID}`,
      { signal },
    );
    if (!res.ok) {
      throw new Error(
        `TxLINE fixtures snapshot failed: ${res.status} ${res.statusText}`,
      );
    }
    return txLineFixtureListSchema.parse(await res.json());
  };
}

export type ReplayFinalStats = { stats: FixtureStats; lastSeq: number };

/** Fetches a finished source fixture's final cumulative stats from TxLINE. */
export type ReplayStatsFetcher = (
  sourceId: string,
  signal?: AbortSignal,
) => Promise<ReplayFinalStats>;

/**
 * Builds the finisher's stats fetcher from env creds, or returns null when
 * they're absent (dev/stub setups) so the finisher can no-op instead of
 * crashing the tick. Fetches `/api/scores/snapshot/<sourceId>`, parses it
 * through the shared toFixtureStats path, and takes the max-Seq event's
 * cumulative totals (Score is cumulative, so the last event is the final state).
 */
export function createReplayStatsFetcher(
  env: NodeJS.ProcessEnv,
  fetchImpl?: FetchLike,
): ReplayStatsFetcher | null {
  if (!hasTxLineCreds(env)) return null;
  const config = readLiveConfig(env);
  const authorizedFetch = createAuthorizedFetch(config, fetchImpl ?? fetch);

  return async (sourceId, signal) => {
    const res = await authorizedFetch(`/api/scores/snapshot/${sourceId}`, { signal });
    if (!res.ok) {
      throw new Error(
        `TxLINE scores snapshot failed for ${sourceId}: ${res.status} ${res.statusText}`,
      );
    }
    const events = parseScoreSnapshot(await res.json());
    const last = events.at(-1);
    if (!last) {
      throw new Error(`TxLINE scores snapshot for ${sourceId} had no score events`);
    }
    return { stats: last.stats, lastSeq: last.seq };
  };
}
