import { useEffect, useState } from "react";
import { Shield } from "lucide-react";
import { fetchLeaderboard, fetchMe } from "../lib/api";
import { useAuth } from "../auth/auth-context";
import { EmptyState } from "./empty-state";
import type { LeaderboardRow, Me } from "../lib/types";

export function LeaderboardScreen() {
  const { isAuthenticated } = useAuth();
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetchLeaderboard().then(setRows).catch(() => setRows([]));
    if (isAuthenticated) fetchMe().then(setMe).catch(() => setMe(null));
  }, [isAuthenticated]);

  if (!rows) return <p className="empty-state">Loading leaderboard…</p>;

  if (rows.length === 0) {
    return (
      <div className="screen leaderboard-screen">
        <h2>Leaderboard</h2>
        <EmptyState icon={Shield}>
          No fans on the board yet. Make the call and claim the first spot.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="screen leaderboard-screen">
      <h2>Leaderboard</h2>
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
            const isMe = me && row.displayName && row.displayName === me.displayName;
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
                  {isMe ? <span className="leaderboard-you">you</span> : null}
                </td>
                <td className="leaderboard-num tabular">{row.points}</td>
                <td className="leaderboard-num tabular">{row.currentStreak}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
