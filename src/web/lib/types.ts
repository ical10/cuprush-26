export type Outcome = "yes" | "no" | "higher" | "lower";

export type QuestionStatus =
  | "scheduled"
  | "open"
  | "locked"
  | "live"
  | "settling"
  | "settled"
  | "void";

export type FixtureGameState =
  | "scheduled"
  | "live"
  | "finished"
  | "postponed"
  | "cancelled"
  | "abandoned";

export type FixtureTeamStats = {
  goals: number;
  yellowCards: number;
  redCards: number;
  corners: number;
};

export type FixturePeriodKey = "full_time" | "first_half" | "second_half";

export type FixtureStats = Partial<
  Record<FixturePeriodKey, { home: FixtureTeamStats; away: FixtureTeamStats }>
>;

export type FixtureInfo = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  startsAt: string;
  gameState: FixtureGameState;
  stats: FixtureStats;
};

export type QuestionRule = {
  statKey1: string;
  statKey2: string;
  period: string | null;
  operator: "add" | "subtract";
  comparison: "equal" | "greater_than" | "less_than";
  threshold: number | null;
  benchmarkValue: number | null;
};

export type Question = {
  id: string;
  template: string;
  status: QuestionStatus;
  result: Outcome | "push" | null;
  opensAt: string;
  locksAt: string;
  settledAt: string | null;
  question: string;
  outcomes: readonly string[];
  rule: QuestionRule;
  fixture: FixtureInfo;
};

export type ChainStatus = "pending" | "confirmed" | "failed";

export type Prediction = {
  id: string;
  questionId: string;
  outcome: Outcome;
  chainStatus: ChainStatus;
  predictionPda: string | null;
  signature: string | null;
  submittedAt: string | null;
  confirmedAt: string | null;
};

export type Me = {
  displayName: string | null;
  points: number;
  currentStreak: number;
  bestStreak: number;
  walletAddress: string | null;
};

export type LeaderboardRow = {
  displayName: string | null;
  points: number;
  currentStreak: number;
  bestStreak: number;
};

export type FixtureUpdate = {
  fixtureId: string;
  seq: number;
  gameState: FixtureGameState;
  stats: FixtureStats;
};
