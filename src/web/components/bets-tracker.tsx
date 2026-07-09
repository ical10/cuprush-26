import React, { useState } from "react";
import {
  ClipboardList,
  Award,
  TrendingUp,
  AlertTriangle,
  PlayCircle,
  Flame,
} from "lucide-react";
import { Bet } from "../lib/mockTypes";

interface BetsTrackerProps {
  bets: Bet[];
}

export default function BetsTracker({ bets }: BetsTrackerProps) {
  const [activeFilter, setActiveFilter] = useState<"progress" | "won" | "lost">(
    "progress",
  );

  const filteredBets = bets.filter((bet) => bet.status === activeFilter);

  return (
    <div className="flex flex-col flex-1 w-full h-full text-text-main select-none">
      {/* Tab Controller Filter (On Progress, Won, Lost) */}
      <div className="grid grid-cols-3 bg-surface border border-border-main p-1.5 clip-control mb-4 shadow-inner">
        {(["progress", "won", "lost"] as const).map((tab) => {
          const isActive = activeFilter === tab;
          const count = bets.filter((b) => b.status === tab).length;

          return (
            <button
              key={tab}
              onClick={() => setActiveFilter(tab)}
              className={`py-2 px-1 text-center font-display font-black text-xs uppercase tracking-wider clip-control transition-all transform active:scale-95 cursor-pointer ${
                isActive
                  ? "bg-accent text-bg font-extrabold"
                  : "text-text-dim hover:text-text-main hover:bg-surface-raised/55"
              }`}
            >
              {tab === "progress" ? "On Progress" : tab}
              <span
                className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-mono ${
                  isActive
                    ? "bg-bg text-accent font-bold"
                    : "bg-surface-raised text-text-dim"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Bets List Container */}
      <div className="flex-1 overflow-y-auto scrollbar-none space-y-3 pb-6 min-h-0">
        {filteredBets.length > 0 ? (
          filteredBets.map((bet) => {
            const potentialWin = Math.floor(bet.amount * bet.odds);
            const progressPercent = Math.min((bet.minute / 90) * 100, 100);

            return (
              <div
                key={bet.id}
                className={`p-px clip-panel transition-all shadow-xl ${
                  bet.status === "progress"
                    ? "bg-accent/40 glow-lime"
                    : bet.status === "won"
                      ? "bg-live/40"
                      : "bg-border-main/20 "
                }`}
              >
                <div className="p-4 bg-surface clip-panel flex flex-col justify-between overflow-hidden relative">
                  {/* Visual glow backdrop inside */}
                  <div
                    className={`absolute inset-0 bg-linear-to-br opacity-5 pointer-events-none ${
                      bet.status === "progress"
                        ? "from-accent via-transparent"
                        : bet.status === "won"
                          ? "from-live via-transparent"
                          : "from-gray-500"
                    }`}
                  />

                  {/* Match Title & Logo Header */}
                  <div className="flex justify-between items-center pb-2.5 border-b border-border-main/40 z-10 relative">
                    <div className="flex items-center space-x-2 truncate pr-2">
                      <span className="text-xl">{bet.flagA}</span>
                      <span className="text-xs font-display font-black text-accent tracking-wide truncate">
                        {bet.teamA}{" "}
                        <span className="text-text-dim font-mono italic font-normal text-[10px] mx-1">
                          vs
                        </span>{" "}
                        {bet.teamB}
                      </span>
                      <span className="text-xl">{bet.flagB}</span>
                    </div>

                    {/* Status Indicator / Score / Minute */}
                    {bet.status === "progress" ? (
                      <div className="flex items-center space-x-1.5 bg-surface-raised border border-live/30 text-live font-mono text-[10px] font-bold px-2 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-live animate-pulse" />
                        <span>{bet.minute}'</span>
                      </div>
                    ) : bet.status === "won" ? (
                      <span className="bg-surface-raised text-live border border-live/30 font-mono text-[9px] font-black uppercase px-2 py-0.5 clip-control">
                        WINNER
                      </span>
                    ) : (
                      <span className="bg-surface-raised text-text-dim border border-border-main/50 font-mono text-[9px] font-black uppercase px-2 py-0.5 clip-control">
                        LOST
                      </span>
                    )}
                  </div>

                  {/* Main Bet Details & Live Score Display */}
                  <div className="grid grid-cols-2 gap-2 py-3 text-xs relative z-10 font-sans">
                    <div>
                      <p className="text-[10px] font-mono text-text-dim">
                        Your Prediction
                      </p>
                      <p className="font-display font-bold text-text-main mt-0.5">
                        🏆 WIN:{" "}
                        <span className="text-accent uppercase">
                          {bet.predictionLabel}
                        </span>
                      </p>
                      <p className="text-[10px] text-text-dim font-mono mt-0.5">
                        Odds: x{bet.odds.toFixed(2)}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-[10px] font-mono text-text-dim">
                        Virtual Bet Stake
                      </p>
                      <p className="font-mono font-black text-text-main mt-0.5 flex items-center justify-end">
                        <span className="text-accent mr-1">🪙</span>{" "}
                        {bet.amount.toLocaleString()} G
                      </p>

                      {/* Live score box */}
                      <div className="mt-1 flex items-center justify-end space-x-1.5">
                        <span className="text-[9px] font-mono text-text-dim">
                          LIVE SCORE
                        </span>
                        <span className="bg-bg px-2 py-0.5 rounded border border-border-main font-mono text-xs font-black text-accent tracking-wider">
                          {bet.scoreA} - {bet.scoreB}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Progress Timeline & Time Stamp */}
                  <div className="pt-2 border-t border-border-main/40 flex flex-col justify-between items-stretch z-10 relative space-y-2">
                    {/* Progress Line Bar for Live Match */}
                    {bet.status === "progress" && (
                      <div className="space-y-1">
                        <div className="h-1.5 w-full bg-surface-raised rounded-full overflow-hidden">
                          <div
                            className="bg-live h-full rounded-full transition-all duration-1000"
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                        <div className="flex justify-between items-center text-[9px] font-mono text-text-dim">
                          <span>STADIUM: {bet.stadium}</span>
                          <span>{Math.floor(progressPercent)}% Played</span>
                        </div>
                      </div>
                    )}

                    <div className="flex justify-between items-center text-[10px] font-mono text-text-dim">
                      <span className="text-[9px]">{bet.betTime}</span>

                      {/* Result details / Payout Card */}
                      {bet.status === "won" ? (
                        <span className="bg-live text-bg font-display font-black text-xs px-3 py-1 clip-control shadow-md flex items-center space-x-1">
                          <span>WON!</span>
                          <span className="font-mono text-[11px] font-black">
                            +{potentialWin} G
                          </span>
                        </span>
                      ) : bet.status === "lost" ? (
                        <span className="bg-surface-raised text-text-dim font-display font-black text-xs px-3 py-1 clip-control border border-border-main">
                          LOST (-{bet.amount} G)
                        </span>
                      ) : (
                        <span className="text-live font-mono font-bold">
                          Est. Payout: +{potentialWin} G
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          /* EMPTY STATE */
          <div className="text-center py-16 px-4 bg-surface-raised rounded-2xl border border-dashed border-border-main flex flex-col items-center clip-panel">
            <ClipboardList className="w-12 h-12 text-text-dim mb-3" />
            <h4 className="text-base font-display font-black text-text-dim uppercase">
              No Predictions Found
            </h4>
            <p className="text-xs text-text-dim/80 mt-1 max-w-xs leading-relaxed font-sans">
              {activeFilter === "progress"
                ? "You don't have any active match predictions running. Swipe on Daily Picks to place a virtual bet!"
                : activeFilter === "won"
                  ? "Your successful predictions will show up here as golden payout tickets."
                  : "Any failed predictions will be tracked here."}
            </p>
          </div>
        )}
      </div>

      {/* FOOTER STATS SLIP SUMMARY */}
      <div className="mt-auto bg-surface border border-border-main p-3 clip-panel flex items-center justify-between text-xs font-mono">
        <div className="flex items-center space-x-2">
          <TrendingUp className="w-4 h-4 text-accent" />
          <span className="text-text-dim">Total Live Stake:</span>
        </div>
        <span className="font-black text-accent">
          🪙{" "}
          {bets
            .filter((b) => b.status === "progress")
            .reduce((acc, curr) => acc + curr.amount, 0)
            .toLocaleString()}{" "}
          G
        </span>
      </div>
    </div>
  );
}
