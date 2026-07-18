import { useEffect, useState } from "react";
import { Bot, Shield } from "lucide-react";
import { fetchLeaderboard, fetchMe } from "../lib/api";
import { useAuth } from "../auth/auth-context";
import { EmptyState } from "./empty-state";
import type { LeaderboardRow, Me, ParticipantKind } from "../lib/types";

type LeaderboardFilter = "overall" | ParticipantKind;

const FILTERS: { value: LeaderboardFilter; label: string }[] = [
  { value: "overall", label: "Overall" },
  { value: "human", label: "Humans" },
  { value: "agent", label: "AI" },
];

/** Small, unmistakable tag next to an agent's name — never render an agent
 * row without it, in any filter view (DESIGN.md badge grammar: icon + plain
 * word, never color alone). */
function AiBadge({ cohortName }: { cohortName: string | null }) {
  return (
    <span className="kind-badge-ai" title={cohortName ? `AI · ${cohortName}` : "AI"}>
      <Bot className="badge-icon" size={12} strokeWidth={2} aria-hidden="true" />
      AI
    </span>
  );
}

export function LeaderboardScreen() {
  const { isAuthenticated } = useAuth();
  const [filter, setFilter] = useState<LeaderboardFilter>("overall");
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    setRows(null);
    fetchLeaderboard(filter === "overall" ? undefined : filter)
      .then(setRows)
      .catch(() => setRows([]));
  }, [filter]);

  useEffect(() => {
    if (isAuthenticated) fetchMe().then(setMe).catch(() => setMe(null));
  }, [isAuthenticated]);

  return (
    <div className="screen leaderboard-screen">
      <h2>Leaderboard</h2>
      <div className="leaderboard-filter" role="tablist" aria-label="Filter leaderboard by player kind">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={filter === f.value}
            className={
              filter === f.value
                ? "leaderboard-filter-tab leaderboard-filter-tab-active"
                : "leaderboard-filter-tab"
            }
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {!rows ? (
        <p className="empty-state">Loading leaderboard…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={Shield}>
          No fans on the board yet. Make the call and claim the first spot.
        </EmptyState>
      ) : (
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th scope="col" className="leaderboard-rank">
                Rank
              </th>
              <th scope="col" className="leaderboard-name">
                Fan
              </th>
              <th scope="col" className="leaderboard-num">
                Points
              </th>
              <th scope="col" className="leaderboard-num">
                Streak
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isMe =
                row.kind === "human" &&
                me &&
                row.displayName &&
                row.displayName === me.displayName;
              return (
                <tr
                  key={`${row.displayName}-${i}`}
                  className={isMe ? "leaderboard-row leaderboard-row-me" : "leaderboard-row"}
                >
                  <td className="leaderboard-rank tabular">
                    {i < 3 ? (
                      <span className="leaderboard-rank-tab clip-cut">{i + 1}</span>
                    ) : (
                      i + 1
                    )}
                  </td>
                  <td className="leaderboard-name">
                    <span className="leaderboard-name-text">
                      {row.displayName ?? "Anonymous"}
                    </span>{" "}
                    {row.kind === "agent" ? <AiBadge cohortName={row.cohortName} /> : null}{" "}
                    {isMe ? <span className="leaderboard-you">you</span> : null}
                  </td>
                  <td className="leaderboard-num tabular">{row.points}</td>
                  <td className="leaderboard-num tabular">{row.currentStreak}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
