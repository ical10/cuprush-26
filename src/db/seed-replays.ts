import { fileURLToPath } from "node:url";
import type { Database } from "./client";
import { fixtures, type FixtureStage } from "./schema";
import {
  applySelection,
  createReplayMetaFetcher,
  encodeReplayId,
  parseIdList,
  parseReplayStage,
  REPLAY_COMPETITION_ID,
  type ReplayMetaFetcher,
} from "../txline/replay-source";

/**
 * seed:replays — replay finished 2026 World Cup fixtures from the TxLINE feed
 * under fresh fixture ids so CupRush 26 always has live decks between real
 * matches, for human players and the AI cohort alike. TxLINE remains the sole
 * source for both metadata (fixtures snapshot) and settlement stats (scores
 * snapshot): nothing is cached at seed time.
 *
 * Each REPLAY_SOURCE_IDS entry is looked up in the TxLINE fixtures snapshot
 * (windowed by REPLAY_START_EPOCH_DAY, competition 72) for its teams, then
 * inserted as a new `scheduled` replay fixture (`replay-<sourceId>-<counter>`)
 * with EMPTY stats and a staggered kickoff. The scheduler generates/opens/
 * locks its questions; a tick finisher later fetches the source's TxLINE
 * scores snapshot to attach stats and flip it finished.
 *
 * Strictly idempotent (onConflictDoNothing by stable id) and selectable via
 * REPLAY_INCLUDE / REPLAY_EXCLUDE, so the operator can hold a reserved pair
 * back for a live demo and seed it later without disturbing the seeded rows.
 * A source id absent from the snapshot is skipped with a clear error line.
 */

export const REPLAY_COMPETITION = "World Cup";

export const DEFAULT_REPLAY_START_OFFSET_MS = 50 * 60_000;
export const DEFAULT_REPLAY_SPACING_MS = 25 * 60_000;

export type SeedReplaysOptions = {
  db: Database;
  sourceIds?: string[];
  now?: Date;
  startOffsetMs?: number;
  spacingMs?: number;
  counter?: number;
  stage?: FixtureStage;
  include?: string[] | null;
  exclude?: string[] | null;
  /** Injected in tests; defaults to a TxLINE fetcher built from env creds. */
  metaFetcher?: ReplayMetaFetcher;
  env?: NodeJS.ProcessEnv;
};

export type SeedReplaysSummary = {
  selected: number;
  inserted: number;
  skipped: number;
  missingSources: string[];
  insertedIds: string[];
};

function readNumberEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function seedReplays(options: SeedReplaysOptions): Promise<SeedReplaysSummary> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const startOffsetMs =
    options.startOffsetMs ??
    readNumberEnv(env.REPLAY_START_OFFSET_MS, DEFAULT_REPLAY_START_OFFSET_MS);
  const spacingMs =
    options.spacingMs ?? readNumberEnv(env.REPLAY_SPACING_MS, DEFAULT_REPLAY_SPACING_MS);
  const counter = options.counter ?? readNumberEnv(env.REPLAY_COUNTER, 0);
  const stage = options.stage ?? parseReplayStage(env);
  const include = options.include !== undefined ? options.include : parseIdList(env.REPLAY_INCLUDE);
  const exclude = options.exclude !== undefined ? options.exclude : parseIdList(env.REPLAY_EXCLUDE);

  const sourceIds = options.sourceIds ?? parseIdList(env.REPLAY_SOURCE_IDS);
  if (!sourceIds || sourceIds.length === 0) {
    throw new Error(
      "seed:replays needs REPLAY_SOURCE_IDS — a comma-separated list of " +
        "finished TxLINE fixture ids (competition 72) to replay.",
    );
  }

  const selected = applySelection(sourceIds, include, exclude);
  const metaFetcher = options.metaFetcher ?? createReplayMetaFetcher(env);
  const snapshot = await metaFetcher();
  const metaById = new Map(snapshot.map((fixture) => [fixture.fixtureId, fixture]));

  const insertedIds: string[] = [];
  const missingSources: string[] = [];
  let position = 0;
  for (const sourceId of selected) {
    const meta = metaById.get(sourceId);
    if (!meta) {
      missingSources.push(sourceId);
      console.error(
        `seed:replays — skipping source id ${sourceId}: not in the TxLINE ` +
          `fixtures snapshot for the configured window (wrong REPLAY_START_EPOCH_DAY ` +
          `or not a competition-72 fixture).`,
      );
      continue;
    }

    const id = encodeReplayId(sourceId, counter);
    const inserted = await options.db
      .insert(fixtures)
      .values({
        id,
        homeTeam: meta.homeTeam,
        awayTeam: meta.awayTeam,
        startsAt: new Date(now.getTime() + startOffsetMs + position * spacingMs),
        gameState: "scheduled",
        stage,
        competitionId: meta.competitionId ?? REPLAY_COMPETITION_ID,
        competition: meta.competition ?? REPLAY_COMPETITION,
        lastSeq: 0,
        stats: {},
      })
      .onConflictDoNothing({ target: fixtures.id })
      .returning({ id: fixtures.id });

    if (inserted.length > 0) insertedIds.push(id);
    position += 1;
  }

  return {
    selected: selected.length,
    inserted: insertedIds.length,
    skipped: selected.length - insertedIds.length - missingSources.length,
    missingSources,
    insertedIds,
  };
}

const isEntryPoint =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntryPoint) {
  const { db, queryClient } = await import("./client");
  seedReplays({ db })
    .then((summary) => {
      console.log(
        `seed:replays — selected ${summary.selected}, inserted ` +
          `${summary.inserted}, skipped ${summary.skipped}` +
          (summary.missingSources.length > 0
            ? `, missing ${summary.missingSources.length} (${summary.missingSources.join(", ")})`
            : "") +
          (summary.insertedIds.length > 0
            ? ` (new: ${summary.insertedIds.join(", ")})`
            : ""),
      );
    })
    .catch((error: unknown) => {
      console.error("seed:replays failed", error);
      process.exitCode = 1;
    })
    .finally(() => {
      void queryClient.end({ timeout: 5 });
    });
}
