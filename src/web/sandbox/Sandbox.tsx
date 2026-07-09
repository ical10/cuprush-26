import React, { useState, useEffect } from "react";
import {
  Trophy,
  Coins,
  Settings,
  Compass,
  ClipboardList,
  CheckCircle,
  X,
  ChevronRight,
  Plus,
  HelpCircle,
  TrendingUp,
  User,
  Volume2,
  Sparkles,
} from "lucide-react";

import {
  Match,
  Bet,
  LeaderboardEntry,
  Achievement,
  PlayerStats,
} from "./types";
import {
  INITIAL_MATCHES,
  INITIAL_LEADERBOARD,
  INITIAL_ACHIEVEMENTS,
  INITIAL_PLAYER_STATS,
  PRE_SEED_BETS,
} from "./data";

import CardDeck from "./components/CardDeck";
import BetsTracker from "./components/BetsTracker";
import LeaderboardView from "./components/LeaderboardView";
import ProfileView from "./components/ProfileView";
import PremiumAvatar from "./components/PremiumAvatar";
import backgroundDesktop from "./assets/background-dekstop.webp";
import backgroundPhone from "./assets/background-phone.webp";

export function Sandbox() {
  const [activeTab, setActiveTab] = useState<
    "picks" | "bets" | "leaderboard" | "profile"
  >("picks");
  const [gold, setGold] = useState<number>(INITIAL_PLAYER_STATS.gold);
  const [stats, setStats] = useState<PlayerStats>(INITIAL_PLAYER_STATS);
  const [bets, setBets] = useState<Bet[]>(PRE_SEED_BETS);
  const [matches, setMatches] = useState<Match[]>(INITIAL_MATCHES);
  const [achievements, setAchievements] =
    useState<Achievement[]>(INITIAL_ACHIEVEMENTS);
  const [leaderboard, setLeaderboard] =
    useState<LeaderboardEntry[]>(INITIAL_LEADERBOARD);

  // Custom states for game triggers
  const [confirmedBet, setConfirmedBet] = useState<{
    match: Match;
    predictionLabel: string;
    betAmount: number;
  } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [tickerSpeed, setTickerSpeed] = useState<number>(5000); // Ticker speed in ms (5000ms standard, 2500ms hyper)
  const [toasts, setToasts] = useState<
    { id: string; message: string; type: "success" | "info" | "error" }[]
  >([]);
  const [deckResetKey, setDeckResetKey] = useState<number>(0);

  // Live clock state for iOS-style notch
  const [currentTime, setCurrentTime] = useState<string>(() => {
    const now = new Date();
    let hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${minutes} ${ampm}`;
  });

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      let hours = now.getHours();
      const minutes = now.getMinutes().toString().padStart(2, "0");
      const ampm = hours >= 12 ? "PM" : "AM";
      hours = hours % 12;
      hours = hours ? hours : 12;
      setCurrentTime(`${hours}:${minutes} ${ampm}`);
    };
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Toast notifications trigger helper
  const addToast = (
    message: string,
    type: "success" | "info" | "error" = "success",
  ) => {
    const id = `toast_${Date.now()}_${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  // Background ticker logic to advance "On Progress" live bets
  useEffect(() => {
    const interval = setInterval(() => {
      setBets((prevBets) => {
        let updated = false;
        const nextBets = prevBets.map((bet) => {
          if (bet.status === "progress") {
            updated = true;
            // Advance minute by 5' to 10' per tick
            const increment = Math.floor(Math.random() * 6) + 6;
            const nextMinute = Math.min(bet.minute + increment, 90);

            // Random goal probability (12% chance for each team during the match)
            let nextScoreA = bet.scoreA;
            let nextScoreB = bet.scoreB;
            if (nextMinute < 90) {
              if (Math.random() < 0.12) nextScoreA += 1;
              if (Math.random() < 0.12) nextScoreB += 1;
            }

            if (nextMinute >= 90) {
              // Final score determined!
              const finalScoreA = nextScoreA;
              const finalScoreB = nextScoreB;

              // Evaluate user's prediction success
              let isWin = false;
              if (bet.prediction === "teamA" && finalScoreA > finalScoreB)
                isWin = true;
              if (bet.prediction === "teamB" && finalScoreB > finalScoreA)
                isWin = true;
              if (bet.prediction === "draw" && finalScoreA === finalScoreB)
                isWin = true;

               const payout = isWin ? Math.floor(bet.amount * bet.odds) : 0;
              const nextStatus: "won" | "lost" = isWin ? "won" : "lost";

              // Notify the user via styled toast
              const matchText = `${bet.teamA} vs ${bet.teamB}`;
              const toastMessage = isWin
                ? `🏆 BET WON! +${payout.toLocaleString()} G payout on ${matchText} (${finalScoreA}-${finalScoreB})`
                : `❌ Prediction ended. ${matchText} finished ${finalScoreA}-${finalScoreB}`;

              addToast(toastMessage, isWin ? "success" : "info");

              // Update Gold & Achievements
              setTimeout(() => {
                setGold((currentGold) => {
                  const finalGold = currentGold + payout;
                  updateAchievementsAndStats(
                    isWin,
                    payout,
                    bet.amount,
                    finalGold,
                  );
                  return finalGold;
                });
              }, 0);

              return {
                ...bet,
                minute: 90,
                scoreA: finalScoreA,
                scoreB: finalScoreB,
                status: nextStatus,
              };
            }

            return {
              ...bet,
              minute: nextMinute,
              scoreA: nextScoreA,
              scoreB: nextScoreB,
            };
          }
          return bet;
        });
        return nextBets;
      });
    }, tickerSpeed);

    return () => clearInterval(interval);
  }, [bets, tickerSpeed]);

  // Sync virtual stats and unlock profile badges dynamically
  const updateAchievementsAndStats = (
    isWin: boolean,
    payout: number,
    stake: number,
    nextGold: number,
  ) => {
    setStats((prev) => {
      const nextWins = isWin ? prev.wins + 1 : prev.wins;
      const nextLosses = !isWin ? prev.losses + 1 : prev.losses;
      const nextStreak = isWin ? prev.streak + 1 : 0;
      const nextBetsPlaced = prev.totalBetsPlaced + 1;

      // Level Up calculations (200 XP for wins, 80 XP for losses)
      const xpGain = isWin ? 220 : 80;
      let nextXp = prev.xp + xpGain;
      let nextLevel = prev.level;
      let maxXP = prev.xpMax;

      if (nextXp >= maxXP) {
        nextXp -= maxXP;
        // Silver II -> Silver I -> Gold III -> Gold II etc.
        if (prev.level === "SILVER II") {
          nextLevel = "SILVER I";
        } else if (prev.level === "SILVER I") {
          nextLevel = "GOLD III";
          maxXP = 3000;
        } else {
          nextLevel = "GOLD II";
        }
        addToast(`🎉 PROMOTED! You leveled up to ${nextLevel}!`, "success");
      }

      return {
        ...prev,
        totalBetsPlaced: nextBetsPlaced,
        wins: nextWins,
        losses: nextLosses,
        streak: nextStreak,
        xp: nextXp,
        xpMax: maxXP,
        level: nextLevel,
        gold: nextGold,
      };
    });

    // Check achievement completions
    setAchievements((prev) =>
      prev.map((ach) => {
        if (ach.id === "a2" && isWin && stake >= 500) {
          if (!ach.unlocked)
            addToast(`🏅 Achievement unlocked: ${ach.title}!`, "success");
          return { ...ach, unlocked: true };
        }
        if (ach.id === "a3" && isWin) {
          // Check if win streak reaches 3
          setStats((s) => {
            if (s.streak >= 3) {
              ach.unlocked = true;
            }
            return s;
          });
          return ach;
        }
        if (ach.id === "a4" && nextGold >= 21000) {
          if (!ach.unlocked)
            addToast(`🏅 Achievement unlocked: ${ach.title}!`, "success");
          return { ...ach, unlocked: true };
        }
        return ach;
      }),
    );
  };

  // Triggers when user swiped right on a card
  const handleBetPlaced = (
    match: Match,
    prediction: "teamA" | "teamB" | "draw",
  ) => {
    const betCost = 500; // flat casual bet 500 Gold
    if (gold < betCost) {
      addToast("❌ Insufficient Gold! Refill balance in settings.", "error");
      return;
    }

    // Deduct 500 gold
    const nextGold = gold - betCost;
    setGold(nextGold);

    const predictionLabel =
      prediction === "teamA"
        ? `${match.teamA} Victory`
        : prediction === "teamB"
          ? `${match.teamB} Victory`
          : "Draw";
    const odds =
      prediction === "teamA"
        ? match.oddsA
        : prediction === "teamB"
          ? match.oddsB
          : match.oddsDraw;

    // Create active in-progress bet entry
    const newBet: Bet = {
      id: `b_${Date.now()}_${match.id}`,
      matchId: match.id,
      teamA: match.teamA,
      teamB: match.teamB,
      flagA: match.flagA,
      flagB: match.flagB,
      prediction,
      predictionLabel,
      amount: betCost,
      status: "progress",
      minute: 1, // Start live simulation
      scoreA: 0,
      scoreB: 0,
      odds,
      stadium: match.stadium,
      betTime: `Bet Time: 0h:01m ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
    };

    setBets((prev) => [newBet, ...prev]);

    // Show the confirmation popup
    setConfirmedBet({
      match,
      predictionLabel,
      betAmount: betCost,
    });

    // Update simple count stat
    setStats((prev) => ({
      ...prev,
      totalBetsPlaced: prev.totalBetsPlaced + 1,
      gold: nextGold,
    }));
  };

  // Triggers when user swiped left (skips/disagrees)
  const handleSkipMatch = (match: Match) => {
    addToast(`⏩ Skipped match: ${match.teamA} vs ${match.teamB}`, "info");
  };

  // Claim free gold helper
  const handleClaimFreeGold = () => {
    const giftAmount = 10000;
    setGold((g) => g + giftAmount);
    addToast(`🪙 CLAIMED +10,000 G FREE GOLD GIFT!`, "success");
  };

  return (
    <div className="min-h-screen w-full bg-bg flex items-center justify-center font-sans p-0 sm:p-4 lg:p-6 text-text-main relative overflow-x-hidden select-none">
      {/* Background Image Container */}
      <div
        className="absolute inset-0 w-full h-full bg-cover bg-center bg-no-repeat pointer-events-none select-none z-0 hidden sm:block opacity-60"
        style={{
          backgroundImage: `url(${backgroundDesktop})`,
        }}
      />
      <div
        className="absolute inset-0 w-full h-full bg-cover bg-center bg-no-repeat pointer-events-none select-none z-0 block sm:hidden opacity-60"
        style={{
          backgroundImage: `url(${backgroundPhone})`,
        }}
      />

      {/* 12-Column Responsive Grid */}
      <div className="grid grid-cols-12 gap-6 w-full max-w-7xl items-center justify-center relative z-10 p-0 sm:p-4 lg:p-0">
        {/* LEFT SIDEBAR: Live Ticker & Stats */}
        <div className="col-span-3 hidden lg:flex flex-col gap-4 self-stretch justify-start">
          {/* Live Ticker Panel */}
          <div className="bg-border-main p-[1px] clip-panel shadow-xl">
            <div className="p-4 bg-surface clip-panel">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-accent uppercase tracking-widest font-display">
                  Live Ticker
                </h3>
                <span className="w-1.5 h-1.5 rounded-full bg-live animate-ping" />
              </div>

              <div className="space-y-3 font-sans text-xs">
                {/* If there are progressive bets, show them live */}
                {bets
                  .filter((b) => b.status === "progress")
                  .slice(0, 2)
                  .map((bet) => (
                    <div
                      key={bet.id}
                      className="flex flex-col border-l-2 border-accent pl-3 py-1"
                    >
                      <span className="text-[10px] text-text-dim">
                        {bet.minute}' — Prediction Live
                      </span>
                      <span className="text-xs font-medium uppercase truncate text-text-main">
                        {bet.teamA} {bet.scoreA} - {bet.scoreB} {bet.teamB}
                      </span>
                      <span className="text-[10px] text-accent font-mono truncate">
                        {bet.predictionLabel}
                      </span>
                    </div>
                  ))}

                <div className="flex flex-col border-l-2 border-live pl-3 py-1">
                  <span className="text-[10px] text-text-dim">
                    88' — World Cup Group E
                  </span>
                  <span className="text-xs font-medium uppercase text-text-main text-left">
                    Spain 2 - 1 Germany
                  </span>
                  <span className="text-[10px] text-live">
                    Goal: Álvaro Morata
                  </span>
                </div>

                <div className="flex flex-col border-l-2 border-accent pl-3 py-1">
                  <span className="text-[10px] text-text-dim">
                    42' — World Cup Group C
                  </span>
                  <span className="text-xs font-medium uppercase text-text-main text-left">
                    Argentina 1 - 0 Mexico
                  </span>
                  <span className="text-[10px] text-accent">
                    Goal: Lionel Messi
                  </span>
                </div>

                <div className="flex flex-col border-l-2 border-border-main pl-3 py-1 opacity-50">
                  <span className="text-[10px] text-text-dim">
                    Final — World Cup Final
                  </span>
                  <span className="text-xs font-medium uppercase text-text-main text-left">
                    Argentina 3 - 3 France
                  </span>
                  <span className="text-[10px] text-text-dim">
                    Arg won 4-2 on Penalties
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Daily Volume Panel */}
          <div className="bg-border-main p-[1px] clip-panel shadow-xl">
            <div className="p-4 bg-surface-raised clip-panel">
              <h3 className="text-xs font-bold text-text-dim uppercase tracking-widest mb-2 font-display">
                Daily Volume
              </h3>
              <div className="text-2xl font-bold font-mono text-text-main">
                14.2M <span className="text-accent">G</span>
              </div>
              <div className="w-full bg-surface h-1 mt-3 rounded-full overflow-hidden">
                <div className="bg-accent h-full w-3/4"></div>
              </div>
              <p className="text-[10px] text-text-dim mt-2 font-sans">
                24,102 Active predictors right now
              </p>
            </div>
          </div>
        </div>

        {/* CENTER: THE PHONE MOCK */}
        <div className="col-span-12 lg:col-span-6 flex justify-center items-center">
          <div className="w-full max-w-[420px] h-screen sm:h-[840px] bg-bg rounded-none sm:rounded-[3.5rem] border-0 sm:border-8 border-surface-raised shadow-[0_25px_60px_rgba(0,0,0,0.85)] relative flex flex-col overflow-hidden">
            {/* iOS-style Top Speaker Notch Graphic */}
            <div className="hidden lg:flex absolute top-0 inset-x-0 h-6 bg-bg z-50 justify-between items-center px-6 pointer-events-none">
              <span className="text-[10px] font-mono text-text-dim font-bold">
                {currentTime}
              </span>
              <div className="w-24 h-4 bg-surface rounded-b-xl border-x border-b border-border-main/80 mx-auto" />
              <div className="flex items-center space-x-1">
                <span className="text-[9px] font-mono text-text-dim font-bold">
                  5G
                </span>
                <div className="w-4 h-2 bg-text-dim rounded-sm relative flex items-center p-[0.5px]">
                  <div className="h-full w-4/5 bg-bg rounded-xs" />
                </div>
              </div>
            </div>

            {/* HEADER BRANDING & GOLD BALANCE BAR */}
            <header className="absolute top-0 inset-x-0 pt-8 pb-3 px-4 bg-linear-to-b from-bg via-bg/95 to-transparent border-b border-border-main/10 z-30 flex items-center justify-between backdrop-blur-xs">
              {/* Game Brand Logo Lockup */}
              <div className="flex items-center space-x-0 font-display text-2xl font-black tracking-tight">
                <span className="text-text-main">CUPRUSH</span>
                <span className="text-accent">// 26</span>
              </div>

              {/* Gold balance bar & settings triggers */}
              <div className="flex items-center space-x-2">
                {/* Live Gold Display */}
                <div className="flex items-center space-x-1.5 bg-surface/90 border border-border-main p-1.5 pl-2.5 pr-2.5 rounded-full shadow-[0_0_10px_rgba(215,255,63,0.15)] glow-lime">
                  <span className="text-accent font-mono text-xs font-black animate-pulse">
                    🪙
                  </span>
                  <span className="text-xs font-mono font-black text-text-main">
                    {gold.toLocaleString()}G
                  </span>
                  <button
                    onClick={handleClaimFreeGold}
                    title="Claim Free Gold"
                    className="w-4 h-4 bg-live text-bg rounded-full flex items-center justify-center font-bold text-[10px] hover:bg-live/80 cursor-pointer ml-1 transform active:scale-90 transition-all"
                  >
                    <Plus className="w-3 h-3 stroke-3" />
                  </button>
                </div>

                {/* Settings button */}
                <button
                  onClick={() => setShowSettings(true)}
                  className="p-1.5 bg-surface/85 hover:bg-surface-raised border border-border-main rounded-xl transition text-text-dim hover:text-text-main cursor-pointer active:scale-95"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>
            </header>

            {/* FLOATING SYSTEM TOASTS DISPLAY */}
            <div className="absolute top-24 inset-x-4 z-50 flex flex-col space-y-2 pointer-events-none">
              {toasts.map((toast) => (
                <div
                  key={toast.id}
                  className="bg-border-main p-px clip-panel shadow-2xl w-full"
                >
                  <div
                    className={`p-3 bg-surface clip-panel flex items-start space-x-2.5 text-xs font-semibold backdrop-blur-md transition-all ${
                      toast.type === "success"
                        ? "text-live"
                        : toast.type === "error"
                          ? "text-danger"
                          : "text-accent"
                    }`}
                  >
                    <span className="text-sm">
                      {toast.type === "success"
                        ? "🏆"
                        : toast.type === "error"
                          ? "❌"
                          : "⚽"}
                    </span>
                    <p className="flex-1 text-[11px] leading-tight font-sans text-text-main">
                      {toast.message}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* MAIN GAME VIEW CONTROLLER CONTENT */}
            <main
              className="flex-1 flex flex-col px-4 pt-20 relative z-20 overflow-hidden min-h-0 bg-cover bg-center bg-no-repeat"
              style={{
                backgroundImage: `url(${backgroundPhone})`,
              }}
            >
              {activeTab === "picks" && (
                <CardDeck
                  key={deckResetKey}
                  matches={matches}
                  onBetPlaced={handleBetPlaced}
                  onSkip={handleSkipMatch}
                />
              )}

              {activeTab === "bets" && <BetsTracker bets={bets} />}

              {activeTab === "leaderboard" && (
                <LeaderboardView
                  leaderboard={leaderboard}
                  currentUserGold={gold}
                  currentUsername={stats.username}
                />
              )}

              {activeTab === "profile" && (
                <ProfileView
                  stats={stats}
                  achievements={achievements}
                  onStatsUpdate={setStats}
                />
              )}
            </main>

            {/* BOTTOM NAVIGATION CONTROLLER TABS */}
            <footer className="relative bg-surface border-t border-border-main px-3 py-2 z-30 shadow-[0_-5px_15px_rgba(0,0,0,0.6)]">
              <div className="grid grid-cols-4 gap-1">
                {/* Daily Picks */}
                <button
                  onClick={() => {
                    setActiveTab("picks");
                    setConfirmedBet(null);
                  }}
                  className={`flex flex-col items-center justify-center py-1.5 transition cursor-pointer active:scale-95 ${
                    activeTab === "picks"
                      ? "text-accent font-semibold border-t-2 border-accent"
                      : "text-text-dim hover:text-text-main"
                  }`}
                >
                  <Compass className="w-4.5 h-4.5 mb-1" />
                  <span className="text-[10px] font-sans font-semibold tracking-wide leading-none">
                    Picks
                  </span>
                </button>

                {/* My Bets */}
                <button
                  onClick={() => {
                    setActiveTab("bets");
                    setConfirmedBet(null);
                  }}
                  className={`flex flex-col items-center justify-center py-1.5 transition cursor-pointer active:scale-95 ${
                    activeTab === "bets"
                      ? "text-accent font-semibold border-t-2 border-accent"
                      : "text-text-dim hover:text-text-main"
                  }`}
                >
                  <ClipboardList className="w-4.5 h-4.5 mb-1" />
                  <span className="text-[10px] font-sans font-semibold tracking-wide leading-none">
                    My Bets
                  </span>
                </button>

                {/* Leaderboard */}
                <button
                  onClick={() => {
                    setActiveTab("leaderboard");
                    setConfirmedBet(null);
                  }}
                  className={`flex flex-col items-center justify-center py-1.5 transition cursor-pointer active:scale-95 ${
                    activeTab === "leaderboard"
                      ? "text-accent font-semibold border-t-2 border-accent"
                      : "text-text-dim hover:text-text-main"
                  }`}
                >
                  <Trophy className="w-4.5 h-4.5 mb-1" />
                  <span className="text-[10px] font-sans font-semibold tracking-wide leading-none">
                    Leaderboard
                  </span>
                </button>

                {/* Profile */}
                <button
                  onClick={() => {
                    setActiveTab("profile");
                    setConfirmedBet(null);
                  }}
                  className={`flex flex-col items-center justify-center py-1.5 transition cursor-pointer active:scale-95 ${
                    activeTab === "profile"
                      ? "text-accent font-semibold border-t-2 border-accent"
                      : "text-text-dim hover:text-text-main"
                  }`}
                >
                  <User className="w-4.5 h-4.5 mb-1" />
                  <span className="text-[10px] font-sans font-semibold tracking-wide leading-none">
                    Profile
                  </span>
                </button>
              </div>
            </footer>

            {/* OVERLAY: "BET CONFIRMED!" MODAL (Triggered immediately after Agree Swipe) */}
            {confirmedBet && (
              <div className="absolute! inset-0! bg-bg/90! flex! items-center! justify-center! p-6! z-50! animate-fade-in! backdrop-blur-xs!">
                <div className="bg-border-main! p-[2px]! clip-panel! shadow-2xl! w-full! max-w-[340px]!">
                  <div className="bg-surface! clip-panel! p-6! relative! overflow-hidden! flex! flex-col! items-center! text-center!">
                    {/* Accent Ambient Radial behind checkmark */}
                    <div className="absolute! inset-x-0! top-0! h-32! bg-radial! from-accent/10! to-transparent! pointer-events-none!" />

                    <h3 className="text-xl! font-display! font-black! text-accent! tracking-wider! uppercase! mb-5!">
                      BET CONFIRMED!
                    </h3>

                    {/* Pulsing Cyan Circle with checkmark */}
                    <div className="w-16! h-16! rounded-full! bg-gradient-to-br! from-live! to-live/80! border! border-live/30! flex! items-center! justify-center! shadow-[0_0_20px_rgba(25,245,210,0.3)]! mb-6!">
                      <CheckCircle className="w-10 h-10 text-bg stroke-[3]" />
                    </div>

                    {/* Match prediction details summary */}
                    <div className="bg-bg! border! border-border-main! p-4! rounded-xl! w-full! text-xs! font-mono! space-y-3! mb-6! text-left!">
                      <div className="flex! items-start! space-x-2!">
                        <span className="text-base! leading-none!">🏟️</span>
                        <div>
                          <span className="text-text-dim! block! text-[9px]! leading-none!">
                            MATCH
                          </span>
                          <span className="text-text-main! font-bold! block! mt-0.5! uppercase! truncate!">
                            {confirmedBet.match.teamA} vs{" "}
                            {confirmedBet.match.teamB}
                          </span>
                        </div>
                      </div>

                      <div className="flex! items-start! space-x-2!">
                        <span className="text-base! leading-none!">🎯</span>
                        <div>
                          <span className="text-text-dim! block! text-[9px]! leading-none!">
                            PREDICTION
                          </span>
                          <span className="text-accent! font-extrabold! block! mt-0.5! uppercase!">
                            {confirmedBet.predictionLabel}
                          </span>
                        </div>
                      </div>

                      <div className="flex! items-start! space-x-2!">
                        <span className="text-base! leading-none!">🪙</span>
                        <div>
                          <span className="text-text-dim! block! text-[9px]! leading-none!">
                            CASUAL STAKE PLACED
                          </span>
                          <span className="text-text-main! font-black! block! mt-0.5!">
                            {confirmedBet.betAmount} Gold Coins
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Micro Social Proof feedback */}
                    <div className="text-[10px]! font-mono! text-text-dim! leading-tight! mb-6!">
                      📢 You and{" "}
                      <strong className="text-live! font-bold!">
                        14,249 other players
                      </strong>{" "}
                      predicted this exact outcome!
                    </div>

                    {/* Buttons paths: View my bets & Continue Picking */}
                    <div className="flex! flex-col! space-y-2.5! w-full!">
                      {/* View My Bets */}
                      <button
                        onClick={() => {
                          setActiveTab("bets");
                          setConfirmedBet(null);
                        }}
                        className="w-full! py-3! bg-accent! hover:bg-accent/90! text-bg! font-display! font-black! text-xs! clip-control! flex! items-center! justify-center! space-x-1.5! transition! transform! active:scale-95! cursor-pointer!"
                      >
                        <ClipboardList className="w-4 h-4 text-bg" />
                        <span className="uppercase tracking-widest text-[10px]">
                          VIEW MY BETS
                        </span>
                      </button>

                      {/* Continue Picking */}
                      <button
                        onClick={() => setConfirmedBet(null)}
                        className="w-full! py-3! bg-surface-raised! hover:bg-surface-raised/80! text-text-main! font-display! font-bold! text-xs! clip-control! border! border-border-main! flex! items-center! justify-center! space-x-1.5! transition! transform! active:scale-95! cursor-pointer!"
                      >
                        <span>CONTINUE PICKING</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SETTINGS AND TESTING DIALOG MODAL */}
            {showSettings && (
              <div className="absolute inset-0 bg-bg/95 flex items-center justify-center p-5 z-50">
                <div className="bg-border-main! p-[2px]! clip-panel! shadow-2xl! w-full! max-w-[340px]!">
                  <div className="bg-surface! clip-panel! p-5! relative!">
                    <button
                      onClick={() => setShowSettings(false)}
                      className="absolute! top-4! right-4! p-1! bg-bg! hover:bg-surface-raised! border! border-border-main! rounded-full! text-text-dim! hover:text-text-main!"
                    >
                      <X className="w-4 h-4" />
                    </button>

                    <h3 className="text-sm! font-display! font-black! text-accent! uppercase! tracking-widest! mb-4!">
                      🔧 DEV PROTOTYPE SETTINGS
                    </h3>

                    <div className="space-y-4! text-xs! font-mono!">
                      <p className="text-[10px]! text-text-dim! leading-relaxed!">
                        Adjust ticker speeds to simulate match resolutions
                        instantly for grading and playtesting!
                      </p>

                      {/* Speed adjustment */}
                      <div className="space-y-2!">
                        <span className="text-[10px]! text-text-dim! font-bold! block!">
                          LIVE TICKER SPEED:
                        </span>
                        <div className="grid! grid-cols-2! gap-2!">
                          <button
                            onClick={() => {
                              setTickerSpeed(5000);
                              addToast("Speed set to Normal Ticks", "info");
                            }}
                            className={`py-1.5! px-2! clip-control! text-[10px]! font-bold! border! transition! ${
                              tickerSpeed === 5000
                                ? "bg-accent! text-bg! border-accent! font-black!"
                                : "bg-bg! border-border-main! text-text-dim! hover:bg-surface-raised!"
                            }`}
                          >
                            NORMAL (5s / tick)
                          </button>
                          <button
                            onClick={() => {
                              setTickerSpeed(2500);
                              addToast("HYPER speed enabled!", "success");
                            }}
                            className={`py-1.5! px-2! clip-control! text-[10px]! font-bold! border! transition! ${
                              tickerSpeed === 2500
                                ? "bg-accent! text-bg! border-accent! font-black!"
                                : "bg-bg! border-border-main! text-text-dim! hover:bg-surface-raised!"
                            }`}
                          >
                            ⚡ HYPER (2.5s / tick)
                          </button>
                        </div>
                      </div>

                      {/* Virtual Recharge Action */}
                      <div className="pt-2! border-t! border-border-main/50! space-y-2!">
                        <span className="text-[10px]! text-text-dim! font-bold! block!">
                          VIRTUAL GOLD ASSIST:
                        </span>
                        <button
                          onClick={() => {
                            setGold(35000);
                            addToast(
                              "Balance recharged to 35,000 G!",
                              "success",
                            );
                          }}
                          className="w-full! py-2! bg-live! hover:bg-live/90! text-bg! font-display! font-black! rounded-lg! clip-control! border! border-live/50! flex! items-center! justify-center! space-x-1! cursor-pointer!"
                        >
                          <span>🪙 RECHARGE BALANCE TO 35,000G</span>
                        </button>
                      </div>

                      {/* Reset entire simulator */}
                      <div className="pt-2! border-t! border-border-main/50! space-y-2!">
                        <span className="text-[10px]! text-text-dim! font-bold! block!">
                          SIMULATOR STATE:
                        </span>
                        <button
                          onClick={() => {
                            setBets(PRE_SEED_BETS);
                            setGold(INITIAL_PLAYER_STATS.gold);
                            setStats(INITIAL_PLAYER_STATS);
                            setDeckResetKey((prev) => prev + 1);
                            setMatches(INITIAL_MATCHES);
                            setShowSettings(false);
                            addToast(
                              "Game Simulator Reset successfully!",
                              "info",
                            );
                          }}
                          className="w-full! py-2! bg-surface-raised! hover:bg-surface-raised/85! text-danger! font-display! font-black! clip-control! border! border-danger/40! text-center! cursor-pointer!"
                        >
                          🔄 FULL RESET TO DEFAULTS
                        </button>
                      </div>

                      <div className="pt-3! border-t! border-border-main/50! text-center!">
                        <span className="text-[8.5px]! text-text-dim!">
                          CUPRUSH // 26 • V1.0.0 PROTOTYPE
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT SIDEBAR: Profile & Leaderboard */}
        <div className="col-span-3 hidden lg:flex flex-col gap-4 self-stretch justify-start">
          {/* Profile Card */}
          <div className="bg-border-main p-[1px] clip-panel shadow-xl">
            <div className="p-4 bg-surface-raised clip-panel">
              <div className="flex items-center gap-3 mb-4">
                <PremiumAvatar avatar="🧑‍🎤" size="lg" />
                <div>
                  <div className="text-xs font-bold text-text-main font-display uppercase">
                    {stats.username}
                  </div>
                  <div className="text-[10px] text-accent font-mono">
                    Lvl {stats.level} • Specialist
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-[10px] uppercase font-bold text-text-dim">
                  <span>XP Progress</span>
                  <span>
                    {stats.xp} / {stats.xpMax}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-surface rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent transition-all duration-300"
                    style={{ width: `${(stats.xp / stats.xpMax) * 100}%` }}
                  ></div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 bg-surface/50 border border-border-main rounded-lg flex flex-col items-center">
                  <span className="text-[10px] text-text-dim uppercase">
                    Win Rate
                  </span>
                  <span className="text-xs font-bold text-live font-mono">
                    {stats.totalBetsPlaced > 0
                      ? Math.round(
                          (stats.wins / (stats.wins + stats.losses || 1)) * 100,
                        )
                      : 57}
                    %
                  </span>
                </div>
                <div className="p-2 bg-surface/50 border border-border-main rounded-lg flex flex-col items-center">
                  <span className="text-[10px] text-text-dim uppercase">
                    Streak
                  </span>
                  <span className="text-xs font-bold text-accent font-mono">
                    🔥 {stats.streak}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Leaderboard Top 3 Panel */}
          <div className="bg-border-main p-[1px] clip-panel shadow-xl">
            <div className="p-4 bg-surface-raised clip-panel">
              <h3 className="text-xs font-bold text-accent uppercase tracking-widest mb-4 font-display">
                Top Predictors
              </h3>
              <div className="space-y-3 font-sans">
                {leaderboard.slice(0, 3).map((entry, idx) => (
                  <div
                    key={entry.rank}
                    className="flex items-center gap-3 p-2 bg-surface/40 border border-border-main rounded-lg"
                  >
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black italic bg-surface-raised text-text-main border border-border-main">
                      {idx + 1}
                    </div>
                    <span className="text-xs font-medium truncate text-text-main font-sans">
                      {entry.username}
                    </span>
                    <span className="ml-auto font-mono text-[10px] font-bold text-accent">
                      {entry.gold.toLocaleString()} G
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Coaches Frame */}
          <div className="bg-border-main p-[1px] clip-panel mt-auto shadow-xl">
            <div className="p-4 bg-surface-raised clip-panel flex gap-4">
              <div className="flex-1 flex flex-col items-center gap-1 opacity-50">
                <PremiumAvatar avatar="🧑‍✈️" size="md" glow={false} />
                <span className="text-[8px] font-bold uppercase text-text-dim mt-1">
                  Selvad (GK)
                </span>
              </div>
              <div className="flex-1 flex flex-col items-center gap-1 border-b-2 border-accent pb-1">
                <PremiumAvatar avatar="🧑‍🎤" size="md" glow={false} />
                <span className="text-[8px] font-bold uppercase text-accent mt-1">
                  Libeig (ST)
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
