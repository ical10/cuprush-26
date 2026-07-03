import { useEffect, useState } from "react";
import { fetchLeaderboard, fetchMe } from "../lib/api";
import { useAuth } from "../auth/auth-context";
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

  return (
    <div className="screen leaderboard-screen">
      <h2>Leaderboard</h2>
      <ol className="leaderboard-list">
        {rows.map((row, i) => {
          const isMe = me && row.displayName && row.displayName === me.displayName;
          return (
            <li
              key={`${row.displayName}-${i}`}
              className={isMe ? "leaderboard-row leaderboard-row-me" : "leaderboard-row"}
            >
              <span className="leaderboard-rank">{i + 1}</span>
              <span className="leaderboard-name">
                {row.displayName ?? "Anonymous"} {isMe ? "(you)" : ""}
              </span>
              <span className="leaderboard-points">{row.points} pts</span>
              <span className="leaderboard-streak">streak {row.currentStreak}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
