import React, { useState } from "react";
import { Trophy, Award, Search, User, Shield, ArrowUp } from "lucide-react";
import { LeaderboardEntry } from "../lib/mockTypes";

interface LeaderboardViewProps {
  leaderboard: LeaderboardEntry[];
  currentUserGold: number;
  currentUsername: string;
}

export default function LeaderboardView({
  leaderboard,
  currentUserGold,
  currentUsername,
}: LeaderboardViewProps) {
  const [searchTerm, setSearchTerm] = useState("");

  // Dynamically inject the current user's live statistics into the leaderboard
  const liveLeaderboard = leaderboard
    .map((entry) => {
      if (entry.username === "PLAYER_NICKNAME_777" || entry.isCurrentUser) {
        return { ...entry, gold: currentUserGold };
      }
      return entry;
    })
    .sort((a, b) => b.gold - a.gold);

  // Re-calculate ranks after sorting
  const rankedLeaderboard = liveLeaderboard.map((entry, idx) => ({
    ...entry,
    rank: idx + 1,
  }));

  const firstPlace = rankedLeaderboard.find((e) => e.rank === 1);
  const secondPlace = rankedLeaderboard.find((e) => e.rank === 2);
  const thirdPlace = rankedLeaderboard.find((e) => e.rank === 3);
  const scrollList = rankedLeaderboard.filter((e) => e.rank > 3);

  const filteredScrollList = scrollList.filter((entry) =>
    entry.username.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <div className="flex flex-col flex-1 w-full h-full text-text-main select-none">
      {/* Top Graphic Banner */}
      <div className="bg-border-main p-[1px] clip-panel mb-4 shadow-lg">
        <div className="bg-surface clip-panel p-4 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-radial from-accent/5 via-transparent to-transparent pointer-events-none" />
          <span className="text-[10px] font-mono tracking-widest text-accent font-bold uppercase">
            🏆 SEASON 1 CHAMPIONSHIP 🏆
          </span>
          <h3 className="text-xl font-display font-black text-text-main uppercase tracking-wider mt-1">
            GLOBAL LEADERBOARD
          </h3>
          <p className="text-[9.5px] font-mono text-text-dim mt-0.5">
            Updated live • Join the world's elite predictors
          </p>
        </div>
      </div>

      {/* 3-STEP PODIUM */}
      <div className="flex items-end justify-center pt-10 pb-4 px-3 mb-4 bg-surface border border-border-main clip-panel relative overflow-hidden">
        {/* Decorative ambient gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-accent/5 via-transparent to-transparent pointer-events-none" />

        {/* 2ND PLACE (Left) */}
        {secondPlace && (
          <div className="flex flex-col items-center w-[30%] -mr-[1px] z-0">
            {/* Avatar on top */}
            <div className="relative z-10 -mb-3">
              <div className={`flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-b from-surface-raised to-bg border-2 ${
                secondPlace.username === currentUsername
                  ? "border-accent/40 text-accent shadow-[0_0_12px_rgba(215,255,63,0.2)]"
                  : "border-border-main text-text-main/80"
              } overflow-hidden`}>
                <User className="w-5 h-5 stroke-[1.5] transition-transform duration-300 hover:scale-110" />
              </div>
              {/* Flag Badge */}
              <span className="absolute -bottom-1 right-0 text-[8.5px] bg-bg px-1 rounded border border-border-main shadow">
                {secondPlace.countryFlag}
              </span>
            </div>

            {/* Pillar */}
            <div className="w-full bg-surface-raised border border-border-main clip-control h-24 pt-5 pb-2 px-1 flex flex-col items-center justify-between text-center relative">
              <div>
                <span className="text-[8.5px] font-display font-black text-text-dim/60 block tracking-wider uppercase">2nd</span>
                <span className="text-[10px] font-display font-black text-text-main mt-0.5 block truncate max-w-full px-0.5">
                  {secondPlace.username}
                </span>
              </div>
              <span className="text-[9px] font-mono font-bold text-accent">
                {secondPlace.gold.toLocaleString()}G
              </span>
            </div>
          </div>
        )}

        {/* 1ST PLACE (Center - Elevated) */}
        {firstPlace && (
          <div className="flex flex-col items-center w-[34%] z-10">
            {/* Avatar on top */}
            <div className="relative z-10 -mb-4 flex flex-col items-center">
              {/* Trophy Icon floating above */}
              <Trophy className="w-3.5 h-3.5 text-accent mb-0.5 animate-pulse" />
              <div className="relative">
                <div className={`flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-b from-surface-raised to-bg border-2 ${
                  firstPlace.username === currentUsername
                    ? "border-accent text-accent shadow-[0_0_15px_rgba(215,255,63,0.3)]"
                    : "border-accent/60 text-accent shadow-[0_0_10px_rgba(215,255,63,0.15)]"
                } overflow-hidden`}>
                  <User className="w-6 h-6 stroke-[1.5] transition-transform duration-300 hover:scale-110" />
                </div>
                {/* Flag Badge */}
                <span className="absolute -bottom-1 right-0 text-[9.5px] bg-bg px-1 rounded border border-accent shadow">
                  {firstPlace.countryFlag}
                </span>
              </div>
            </div>

            {/* Pillar */}
            <div className="w-full bg-gradient-to-b from-surface-raised to-surface border-2 border-accent clip-control h-32 pt-6 pb-2.5 px-1 flex flex-col items-center justify-between text-center relative shadow-[0_4px_20px_rgba(215,255,63,0.08)]">
              <div>
                <span className="text-[9.5px] font-display font-black text-accent block tracking-widest uppercase animate-pulse">1st</span>
                <span className="text-[11px] font-display font-black text-text-main mt-0.5 block truncate max-w-full px-0.5">
                  {firstPlace.username}
                </span>
              </div>
              <span className="text-[10px] font-mono font-black text-text-main">
                {firstPlace.gold.toLocaleString()}G
              </span>
            </div>
          </div>
        )}

        {/* 3RD PLACE (Right) */}
        {thirdPlace && (
          <div className="flex flex-col items-center w-[30%] -ml-[1px] z-0">
            {/* Avatar on top */}
            <div className="relative z-10 -mb-3">
              <div className={`flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-b from-surface-raised to-bg border-2 ${
                thirdPlace.username === currentUsername
                  ? "border-accent/40 text-accent shadow-[0_0_12px_rgba(215,255,63,0.2)]"
                  : "border-border-main text-text-dim"
              } overflow-hidden`}>
                <User className="w-5 h-5 stroke-[1.5] transition-transform duration-300 hover:scale-110" />
              </div>
              {/* Flag Badge */}
              <span className="absolute -bottom-1 right-0 text-[8.5px] bg-bg px-1 rounded border border-border-main shadow">
                {thirdPlace.countryFlag}
              </span>
            </div>

            {/* Pillar */}
            <div className="w-full bg-surface-raised border border-border-main clip-control h-18 pt-5 pb-2 px-1 flex flex-col items-center justify-between text-center relative">
              <div>
                <span className="text-[8.5px] font-display font-black text-text-dim/60 block tracking-wider uppercase">3rd</span>
                <span className="text-[10px] font-display font-black text-text-main mt-0.5 block truncate max-w-full px-0.5">
                  {thirdPlace.username}
                </span>
              </div>
              <span className="text-[9px] font-mono font-bold text-text-dim">
                {thirdPlace.gold.toLocaleString()}G
              </span>
            </div>
          </div>
        )}
      </div>

      {/* FILTER SEARCH INPUT */}
      <div className="relative w-full mb-3 font-sans">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search global ranking players..."
          className="w-full py-2 pl-9 pr-4 bg-surface border border-border-main clip-control text-xs font-sans placeholder-text-dim/50 text-text-main focus:outline-none focus:border-accent"
        />
        <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-text-dim" />
      </div>

      {/* GLOBAL SCROLLING RANK LIST */}
      <div className="flex-1 overflow-y-auto scrollbar-none space-y-2 pb-6 min-h-0 font-sans">
        {filteredScrollList.length > 0 ? (
          filteredScrollList.map((entry) => {
            const isMe = entry.username === currentUsername;

            return (
              <div
                key={entry.rank}
                className={`flex items-center justify-between p-2.5 px-3 clip-panel border transition ${
                  isMe
                    ? "bg-surface-raised border-accent shadow-[0_0_10px_rgba(215,255,63,0.15)] font-black text-accent"
                    : "bg-surface border-border-main hover:bg-surface-raised/40"
                }`}
              >
                {/* Left rank and avatar */}
                <div className="flex items-center space-x-3 truncate">
                  <span
                    className={`w-6 text-center font-mono text-xs font-bold ${
                      isMe ? "text-accent" : "text-text-dim"
                    }`}
                  >
                    #{entry.rank}
                  </span>
                  <div className="relative">
                    <div className={`flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-b from-surface-raised to-bg border-2 ${
                      isMe 
                        ? "border-accent/40 text-accent shadow-[0_0_12px_rgba(215,255,63,0.2)]" 
                        : "border-border-main text-text-dim"
                    } overflow-hidden`}>
                      <User className="w-4 h-4 stroke-[1.5] transition-transform duration-300 hover:scale-110" />
                    </div>
                    <span className="absolute -bottom-1 -right-1 text-[10px]">
                      {entry.countryFlag}
                    </span>
                  </div>
                  <span
                    className={`font-display text-xs font-bold truncate ${
                      isMe ? "text-accent font-black" : "text-text-main"
                    }`}
                  >
                    {entry.username}{" "}
                    {isMe && (
                      <span className="text-[8px] font-mono bg-accent text-bg px-1 py-0.5 rounded font-bold ml-1">
                        YOU
                      </span>
                    )}
                  </span>
                </div>

                {/* Right balance */}
                <div className="flex items-center space-x-1.5 pl-2">
                  <span className="font-mono text-[11px] text-text-main font-black">
                    {entry.gold.toLocaleString()} G
                  </span>
                  <span className="text-xs">🪙</span>
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-center py-8 text-text-dim text-xs font-mono">
            No global rankings match your search.
          </div>
        )}
      </div>
    </div>
  );
}
