import { useEffect, useRef, useState } from "react";
import {
  Settings,
  ClipboardList,
  CheckCircle,
  X,
  Plus,
} from "lucide-react";

import { AuthProvider, useAuth } from "./auth/auth-context";
import { AuthScreen } from "./components/auth-screen";
import { CardDeck } from "./components/card-deck";
import { LeaderboardScreen } from "./components/leaderboard-screen";
import { LiveScreen } from "./components/live-screen";
import { NavBar } from "./components/nav-bar";
import { ProfileScreen } from "./components/profile-screen";
import { ResultScreen } from "./components/result-screen";
import { hashForScreen, screenFromHash } from "./lib/routes";
import type { Screen } from "./lib/routes";

import BetsTracker from "./components/bets-tracker";
import PremiumAvatar from "./components/PremiumAvatar";
import { fetchLeaderboard, fetchMe, submitPredictionBatch } from "./lib/api";
import type { BatchAnswer, Question } from "./lib/types";
import {
  INITIAL_ACHIEVEMENTS,
  INITIAL_PLAYER_STATS,
  PRE_SEED_BETS,
} from "./lib/mockData";
import { FIFA_TEAMS } from "./lib/fifaTeams";

import backgroundDesktop from "./assets/background-dekstop.webp";
import backgroundPhone from "./assets/background-phone.webp";

/* ------------------------------------------------------------------ */
/*  Hash-based screen router (unchanged from the original cuprush-26) */
/* ------------------------------------------------------------------ */
function useHashScreen(): [Screen, (screen: Screen) => void] {
  const [screen, setScreen] = useState<Screen>(() =>
    screenFromHash(typeof location !== "undefined" ? location.hash : ""),
  );

  useEffect(() => {
    const onHashChange = () => setScreen(screenFromHash(location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function navigate(next: Screen) {
    location.hash = hashForScreen(next);
    setScreen(next);
  }

  return [screen, navigate];
}

/* ------------------------------------------------------------------ */
/*  AppShell — the combined FootbalGame layout + cuprush-26 backend    */
/* ------------------------------------------------------------------ */
function AppShell() {
  const [screen, navigate] = useHashScreen();
  const { isAuthenticated } = useAuth();
  const afterAuth = useRef<(() => void) | null>(null);

  /* ===================== Gamified Simulator State ===================== */
  const [gold, setGold] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("cuprush:gold");
      return saved ? parseInt(saved) : 15000;
    } catch {
      return 15000;
    }
  });
  useEffect(() => {
    try { localStorage.setItem("cuprush:gold", gold.toString()); } catch {}
  }, [gold]);

  const [stats, setStats] = useState<any>(() => {
    try {
      const saved = localStorage.getItem("cuprush:stats");
      return saved ? JSON.parse(saved) : { ...INITIAL_PLAYER_STATS };
    } catch {
      return { ...INITIAL_PLAYER_STATS };
    }
  });
  useEffect(() => {
    try { localStorage.setItem("cuprush:stats", JSON.stringify(stats)); } catch {}
  }, [stats]);

  const [bets, setBets] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem("cuprush:bets");
      return saved ? JSON.parse(saved) : PRE_SEED_BETS;
    } catch {
      return PRE_SEED_BETS;
    }
  });
  useEffect(() => {
    try { localStorage.setItem("cuprush:bets", JSON.stringify(bets)); } catch {}
  }, [bets]);

  const [achievements, setAchievements] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem("cuprush:achievements");
      return saved ? JSON.parse(saved) : INITIAL_ACHIEVEMENTS;
    } catch {
      return INITIAL_ACHIEVEMENTS;
    }
  });
  useEffect(() => {
    try { localStorage.setItem("cuprush:achievements", JSON.stringify(achievements)); } catch {}
  }, [achievements]);

  /* ===================== Production Batch Predictions ===================== */
  const [answers, setAnswers] = useState<BatchAnswer[]>([]);
  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "done" | "failed">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);

  /* ===================== Game UI Triggers ===================== */
  const [confirmedBet, setConfirmedBet] = useState<{
    fixtureName: string;
    predictionLabel: string;
    betAmount: number;
  } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [tickerSpeed, setTickerSpeed] = useState<number>(5000);
  const [toasts, setToasts] = useState<
    { id: string; message: string; type: "success" | "info" | "error" }[]
  >([]);
  const [deckResetKey, setDeckResetKey] = useState<number>(0);

  /* ===================== Production sidebar data ===================== */
  const [me, setMe] = useState<any | null>(null);
  const [leaderboardRows, setLeaderboardRows] = useState<any[]>([]);
  const [liveViewMode, setLiveViewMode] = useState<"simulated" | "onchain">("simulated");

  useEffect(() => {
    if (isAuthenticated) {
      fetchMe()
        .then((m) => {
          setMe(m);
          if (m.displayName) {
            setStats((prev: any) => ({ ...prev, username: m.displayName }));
          }
        })
        .catch(() => setMe(null));
    } else {
      setMe(null);
    }
    fetchLeaderboard()
      .then((rows) => setLeaderboardRows(rows.slice(0, 3)))
      .catch(() => setLeaderboardRows([]));
  }, [isAuthenticated, screen, submitState]);

  /* ===================== Live Clock (iOS notch) ===================== */
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

  /* ===================== Toast System ===================== */
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

  /* ===================== Background Ticker — Simulated Matches ===================== */
  useEffect(() => {
    const interval = setInterval(() => {
      setBets((prevBets) => {
        const nextBets = prevBets.map((bet) => {
          if (bet.status === "progress") {
            const increment = Math.floor(Math.random() * 6) + 6;
            const nextMinute = Math.min(bet.minute + increment, 90);

            let nextScoreA = bet.scoreA;
            let nextScoreB = bet.scoreB;
            if (nextMinute < 90) {
              if (Math.random() < 0.12) nextScoreA += 1;
              if (Math.random() < 0.12) nextScoreB += 1;
            }

            if (nextMinute >= 90) {
              const finalScoreA = nextScoreA;
              const finalScoreB = nextScoreB;

              let isWin = false;
              if (bet.prediction === "teamA" && finalScoreA > finalScoreB) isWin = true;
              if (bet.prediction === "teamB" && finalScoreB > finalScoreA) isWin = true;
              if (bet.prediction === "draw" && finalScoreA === finalScoreB) isWin = true;

              const payout = isWin ? Math.floor(bet.amount * bet.odds) : 0;
              const nextStatus = isWin ? "won" : "lost";

              const matchText = `${bet.teamA} vs ${bet.teamB}`;
              const toastMessage = isWin
                ? `🏆 BET WON! +${payout.toLocaleString()} G payout on ${matchText} (${finalScoreA}-${finalScoreB})`
                : `❌ Prediction ended. ${matchText} finished ${finalScoreA}-${finalScoreB}`;

              addToast(toastMessage, isWin ? "success" : "info");

              setTimeout(() => {
                setGold((currentGold) => {
                  const finalGold = currentGold + payout;
                  updateAchievementsAndStats(isWin, payout, bet.amount, finalGold);
                  return finalGold;
                });
              }, 0);

              return { ...bet, minute: 90, scoreA: finalScoreA, scoreB: finalScoreB, status: nextStatus };
            }

            return { ...bet, minute: nextMinute, scoreA: nextScoreA, scoreB: nextScoreB };
          }
          return bet;
        });
        return nextBets;
      });
    }, tickerSpeed);

    return () => clearInterval(interval);
  }, [tickerSpeed]);

  const updateAchievementsAndStats = (isWin: boolean, payout: number, stake: number, nextGold: number) => {
    setStats((prev: any) => {
      const nextWins = isWin ? prev.wins + 1 : prev.wins;
      const nextLosses = !isWin ? prev.losses + 1 : prev.losses;
      const nextStreak = isWin ? prev.streak + 1 : 0;
      const nextBetsPlaced = prev.totalBetsPlaced + 1;

      const xpGain = isWin ? 220 : 80;
      let nextXp = prev.xp + xpGain;
      let nextLevel = prev.level;
      let maxXP = prev.xpMax;

      if (nextXp >= maxXP) {
        nextXp -= maxXP;
        if (prev.level === "SILVER II") nextLevel = "SILVER I";
        else if (prev.level === "SILVER I") { nextLevel = "GOLD III"; maxXP = 3000; }
        else nextLevel = "GOLD II";
        addToast(`🎉 PROMOTED! You leveled up to ${nextLevel}!`, "success");
      }

      return { ...prev, totalBetsPlaced: nextBetsPlaced, wins: nextWins, losses: nextLosses, streak: nextStreak, xp: nextXp, xpMax: maxXP, level: nextLevel, gold: nextGold };
    });

    setAchievements((prev) =>
      prev.map((ach) => {
        if (ach.id === "a2" && isWin && stake >= 500) {
          if (!ach.unlocked) addToast(`🏅 Achievement unlocked: ${ach.title}!`, "success");
          return { ...ach, unlocked: true };
        }
        if (ach.id === "a4" && nextGold >= 21000) {
          if (!ach.unlocked) addToast(`🏅 Achievement unlocked: ${ach.title}!`, "success");
          return { ...ach, unlocked: true };
        }
        return ach;
      }),
    );
  };

  /* ===================== Swipe Handlers ===================== */
  const handleBetPlaced = (question: Question, outcome: string) => {
    const betCost = 500;
    if (gold < betCost) {
      addToast("❌ Insufficient Gold! Refill balance in settings.", "error");
      return;
    }

    const nextGold = gold - betCost;
    setGold(nextGold);

    setAnswers((prev) => [...prev, { questionId: question.id, outcome }]);

    const homeTeam = question.fixture.homeTeam;
    const awayTeam = question.fixture.awayTeam;
    const predictionLabel = outcome === "yes" || outcome === "higher" ? "Agree / Yes" : "Disagree / No";

    const newBet = {
      id: `b_${Date.now()}_${question.id}`,
      matchId: question.fixture.id,
      teamA: homeTeam,
      teamB: awayTeam,
      flagA: FIFA_TEAMS.find((t) => t.name.toLowerCase() === homeTeam.toLowerCase())?.flag || "⚽",
      flagB: FIFA_TEAMS.find((t) => t.name.toLowerCase() === awayTeam.toLowerCase())?.flag || "⚽",
      prediction: outcome === "yes" || outcome === "higher" ? "teamA" : "teamB",
      predictionLabel,
      amount: betCost,
      status: "progress",
      minute: 1,
      scoreA: 0,
      scoreB: 0,
      odds: 1.95,
      stadium: "Stadium Night",
      betTime: `Time: ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
    };

    setBets((prev) => [newBet, ...prev]);
    setConfirmedBet({ fixtureName: `${homeTeam} vs ${awayTeam}`, predictionLabel, betAmount: betCost });
    setStats((prev: any) => ({ ...prev, totalBetsPlaced: prev.totalBetsPlaced + 1, gold: nextGold }));
  };

  const handleSkipMatch = (question: Question) => {
    addToast(`⏩ Skipped question for: ${question.fixture.homeTeam} vs ${question.fixture.awayTeam}`, "info");
  };

  const handleClaimFreeGold = () => {
    setGold((g) => g + 10000);
    addToast("🪙 CLAIMED +10,000 G FREE GOLD GIFT!", "success");
  };

  const handleResetAnswers = () => {
    setAnswers([]);
    setSubmitState("idle");
    setSubmitError(null);
  };

  const handleBatchSubmit = async () => {
    setSubmitState("submitting");
    try {
      await submitPredictionBatch(answers);
      setSubmitState("done");
      setSubmitError(null);
      addToast("🏆 Picks locked in on Solana blockchain!", "success");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submit failed.");
      setSubmitState("failed");
      addToast("❌ Blockchain submission failed. Try again.", "error");
    }
  };

  function goToAuth(after: () => void) {
    afterAuth.current = after;
    navigate("auth");
  }

  function handleAuthDone() {
    const callback = afterAuth.current;
    afterAuth.current = null;
    navigate("deck");
    callback?.();
  }

  /* ===================== RENDER ===================== */
  return (
    <div className="min-h-screen w-full bg-bg flex items-center justify-center font-sans p-0 sm:p-4 lg:p-6 text-text relative overflow-x-hidden select-none">
      {/* Background Images */}
      <div
        className="absolute inset-0 w-full h-full bg-cover bg-center bg-no-repeat pointer-events-none select-none z-0 hidden sm:block opacity-60"
        style={{ backgroundImage: `url(${backgroundDesktop})` }}
      />
      <div
        className="absolute inset-0 w-full h-full bg-cover bg-center bg-no-repeat pointer-events-none select-none z-0 block sm:hidden opacity-60"
        style={{ backgroundImage: `url(${backgroundPhone})` }}
      />

      {/* 12-Column Responsive Grid */}
      <div className="grid grid-cols-12 gap-6 w-full max-w-7xl items-center justify-center relative z-10 p-0 sm:p-4 lg:p-0">

        {/* ======== LEFT SIDEBAR: Live Ticker & Volume ======== */}
        <div className="col-span-3 hidden lg:flex flex-col gap-4 self-stretch justify-start">
          {/* Live Ticker Panel */}
          <div className="bg-border p-[1px] clip-panel shadow-xl">
            <div className="p-4 bg-surface clip-panel">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-accent uppercase tracking-widest font-display">Live Ticker</h3>
                <span className="w-1.5 h-1.5 rounded-full bg-live animate-ping" />
              </div>
              <div className="space-y-3 font-sans text-xs">
                {bets.filter((b) => b.status === "progress").length > 0 ? (
                  bets.filter((b) => b.status === "progress").slice(0, 2).map((bet) => (
                    <div key={bet.id} className="flex flex-col border-l-2 border-accent pl-3 py-1">
                      <span className="text-[10px] text-text-dim">{bet.minute}' — Prediction Live</span>
                      <span className="text-xs font-medium uppercase truncate text-text">{bet.teamA} {bet.scoreA} - {bet.scoreB} {bet.teamB}</span>
                      <span className="text-[10px] text-accent font-mono truncate">{bet.predictionLabel}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-[10px] text-text-dim italic">No simulated matches running. Swipe right to start!</p>
                )}
                <div className="flex flex-col border-l-2 border-live pl-3 py-1">
                  <span className="text-[10px] text-text-dim">88' — World Cup Group E</span>
                  <span className="text-xs font-medium uppercase text-text text-left">Spain 2 - 1 Germany</span>
                  <span className="text-[10px] text-live">Goal: Álvaro Morata</span>
                </div>
              </div>
            </div>
          </div>

          {/* Daily Volume Panel */}
          <div className="bg-border p-[1px] clip-panel shadow-xl">
            <div className="p-4 bg-surface-raised clip-panel">
              <h3 className="text-xs font-bold text-text-dim uppercase tracking-widest mb-2 font-display">Daily Volume</h3>
              <div className="text-2xl font-bold font-mono text-text">14.2M <span className="text-accent">G</span></div>
              <div className="w-full bg-surface h-1 mt-3 rounded-full overflow-hidden">
                <div className="bg-accent h-full w-3/4"></div>
              </div>
              <p className="text-[10px] text-text-dim mt-2 font-sans">24,102 Active predictors right now</p>
            </div>
          </div>
        </div>

        {/* ======== CENTER: THE PHONE FRAME ======== */}
        <div className="col-span-12 lg:col-span-6 flex justify-center items-center">
          <div className="w-full max-w-[420px] h-screen sm:h-[840px] bg-bg rounded-none sm:rounded-[3.5rem] border-0 sm:border-8 border-surface-raised shadow-[0_25px_60px_rgba(0,0,0,0.85)] relative flex flex-col overflow-hidden">

            {/* iOS-style top notch */}
            <div className="hidden lg:flex absolute top-0 inset-x-0 h-6 bg-bg z-50 justify-between items-center px-6 pointer-events-none">
              <span className="text-[10px] font-mono text-text-dim font-bold">{currentTime}</span>
              <div className="w-24 h-4 bg-surface rounded-b-xl border-x border-b border-border/80 mx-auto" />
              <div className="flex items-center space-x-1">
                <span className="text-[9px] font-mono text-text-dim font-bold">5G</span>
                <div className="w-4 h-2 bg-text-dim rounded-sm relative flex items-center p-[0.5px]">
                  <div className="h-full w-4/5 bg-bg rounded-xs" />
                </div>
              </div>
            </div>

            {/* HEADER BRANDING & GOLD BALANCE BAR */}
            <header className="absolute top-0 inset-x-0 pt-8 pb-3 px-4 bg-linear-to-b from-bg via-bg/95 to-transparent border-b border-border/10 z-30 flex items-center justify-between backdrop-blur-xs">
              <div className="flex items-center space-x-0 font-display text-2xl font-black tracking-tight">
                <span className="text-text">CUPRUSH</span>
                <span className="text-accent">// 26</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="flex items-center space-x-1.5 bg-surface/90 border border-border p-1.5 pl-2.5 pr-2.5 rounded-full shadow-[0_0_10px_rgba(215,255,63,0.15)] glow-lime">
                  <span className="text-accent font-mono text-xs font-black animate-pulse">🪙</span>
                  <span className="text-xs font-mono font-black text-text">{gold.toLocaleString()}G</span>
                  <button onClick={handleClaimFreeGold} title="Claim Free Gold" className="w-4 h-4 bg-live text-bg rounded-full flex items-center justify-center font-bold text-[10px] hover:bg-live/80 cursor-pointer ml-1 transform active:scale-95 transition-all">
                    <Plus className="w-3 h-3 stroke-3" />
                  </button>
                </div>
                <button onClick={() => setShowSettings(true)} className="p-1.5 bg-surface/85 hover:bg-surface-raised border border-border rounded-xl transition text-text-dim hover:text-text cursor-pointer active:scale-95">
                  <Settings className="w-4 h-4" />
                </button>
              </div>
            </header>

            {/* TOAST SYSTEM */}
            <div className="absolute top-24 inset-x-4 z-50 flex flex-col space-y-2 pointer-events-none">
              {toasts.map((toast) => (
                <div key={toast.id} className="bg-border p-px clip-panel shadow-2xl w-full">
                  <div className={`p-3 bg-surface clip-panel flex items-start space-x-2.5 text-xs font-semibold backdrop-blur-md transition-all ${toast.type === "success" ? "text-live" : toast.type === "error" ? "text-danger" : "text-accent"}`}>
                    <span className="text-sm">{toast.type === "success" ? "🏆" : toast.type === "error" ? "❌" : "⚽"}</span>
                    <p className="flex-1 text-[11px] leading-tight font-sans text-text">{toast.message}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* MAIN CONTENT VIEW */}
            <main className="flex-1 flex flex-col px-4 pt-20 relative z-20 overflow-hidden min-h-0 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: `url(${backgroundPhone})` }}>
              {screen === "deck" && (
                <CardDeck
                  key={deckResetKey}
                  answers={answers}
                  onBetPlaced={handleBetPlaced}
                  onSkip={handleSkipMatch}
                  onNavigateAuth={goToAuth}
                  onSubmit={handleBatchSubmit}
                  onResetAnswers={handleResetAnswers}
                  submitState={submitState}
                  submitError={submitError}
                />
              )}

              {screen === "live" && (
                <div className="flex flex-col flex-1 w-full h-full text-text select-none min-h-0">
                  <div className="grid grid-cols-2 bg-surface-raised border border-border p-1 clip-control mb-3 shadow-inner">
                    <button onClick={() => setLiveViewMode("simulated")} className={`py-1.5 text-center font-display font-black text-[10px] uppercase tracking-wider clip-control transition-all ${liveViewMode === "simulated" ? "bg-accent text-bg" : "text-text-dim hover:text-text"}`}>
                      🏆 Simulated Tickers
                    </button>
                    <button onClick={() => setLiveViewMode("onchain")} className={`py-1.5 text-center font-display font-black text-[10px] uppercase tracking-wider clip-control transition-all ${liveViewMode === "onchain" ? "bg-accent text-bg" : "text-text-dim hover:text-text"}`}>
                      ⛓️ Solana Picks
                    </button>
                  </div>
                  <div className="flex-1 overflow-hidden min-h-0">
                    {liveViewMode === "simulated" ? (
                      <BetsTracker bets={bets} />
                    ) : (
                      <div className="h-full overflow-y-auto scrollbar-none pb-6"><LiveScreen /></div>
                    )}
                  </div>
                </div>
              )}

              {screen === "result" && <div className="flex-1 overflow-y-auto scrollbar-none pb-6 min-h-0"><ResultScreen /></div>}
              {screen === "leaderboard" && <div className="flex-1 overflow-y-auto scrollbar-none pb-6 min-h-0"><LeaderboardScreen /></div>}
              {screen === "profile" && <div className="flex-1 overflow-y-auto scrollbar-none pb-6 min-h-0"><ProfileScreen /></div>}
              {screen === "auth" && <AuthScreen onDone={handleAuthDone} />}
            </main>

            {/* BOTTOM NAV BAR */}
            <NavBar current={screen === "auth" ? "deck" : screen} onNavigate={navigate} />

            {/* BET CONFIRMED MODAL */}
            {confirmedBet && (
              <div className="absolute inset-0 bg-bg/90 flex items-center justify-center p-6 z-50 animate-fade-in backdrop-blur-xs">
                <div className="bg-border p-[2px] clip-panel shadow-2xl w-full max-w-[340px]">
                  <div className="bg-surface clip-panel p-6 relative overflow-hidden flex flex-col items-center text-center">
                    <div className="absolute inset-x-0 top-0 h-32 bg-radial from-accent/10 to-transparent pointer-events-none" />
                    <h3 className="text-xl font-display font-black text-accent tracking-wider uppercase mb-5">BET CONFIRMED!</h3>
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-live to-live/80 border border-live/30 flex items-center justify-center shadow-[0_0_20px_rgba(25,245,210,0.3)] mb-6">
                      <CheckCircle className="w-8 h-8 text-bg stroke-[3]" />
                    </div>
                    <div className="bg-bg border border-border p-4 rounded-xl w-full text-xs font-mono space-y-3 mb-6 text-left">
                      <div className="flex items-start space-x-2">
                        <span className="text-base leading-none">🏟️</span>
                        <div><span className="text-text-dim block text-[9px] leading-none">MATCH</span><span className="text-text font-bold block mt-0.5 uppercase truncate">{confirmedBet.fixtureName}</span></div>
                      </div>
                      <div className="flex items-start space-x-2">
                        <span className="text-base leading-none">🎯</span>
                        <div><span className="text-text-dim block text-[9px] leading-none">PREDICTION</span><span className="text-accent font-extrabold block mt-0.5 uppercase">{confirmedBet.predictionLabel}</span></div>
                      </div>
                      <div className="flex items-start space-x-2">
                        <span className="text-base leading-none">🪙</span>
                        <div><span className="text-text-dim block text-[9px] leading-none">CASUAL STAKE PLACED</span><span className="text-text font-black block mt-0.5">{confirmedBet.betAmount} Gold Coins</span></div>
                      </div>
                    </div>
                    <div className="text-[10px] font-mono text-text-dim leading-tight mb-6">
                      📢 You and <strong className="text-live font-bold">14,249 other players</strong> predicted this exact outcome!
                    </div>
                    <div className="flex flex-col space-y-2.5 w-full">
                      <button onClick={() => { setConfirmedBet(null); setLiveViewMode("simulated"); navigate("live"); }} className="w-full py-3 bg-accent hover:bg-accent/90 text-bg font-display font-black text-xs clip-control flex items-center justify-center space-x-1.5 transition transform active:scale-95 cursor-pointer">
                        <ClipboardList className="w-4 h-4 text-bg" /><span className="uppercase tracking-widest text-[10px]">VIEW MY BETS</span>
                      </button>
                      <button onClick={() => setConfirmedBet(null)} className="w-full py-3 bg-surface-raised hover:bg-surface-raised/80 text-text font-display font-bold text-xs clip-control border border-border flex items-center justify-center space-x-1.5 transition transform active:scale-95 cursor-pointer">
                        <span>CONTINUE PICKING</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SETTINGS DIALOG */}
            {showSettings && (
              <div className="absolute inset-0 bg-bg/95 flex items-center justify-center p-5 z-50">
                <div className="bg-border p-[2px] clip-panel shadow-2xl w-full max-w-[340px]">
                  <div className="bg-surface clip-panel p-5 relative">
                    <button onClick={() => setShowSettings(false)} className="absolute top-4 right-4 p-1 bg-bg hover:bg-surface-raised border border-border rounded-full text-text-dim hover:text cursor-pointer">
                      <X className="w-4 h-4" />
                    </button>
                    <h3 className="text-sm font-display font-black text-accent uppercase tracking-widest mb-4">🔧 DEV PROTOTYPE SETTINGS</h3>
                    <div className="space-y-4 text-xs font-mono">
                      <p className="text-[10px] text-text-dim leading-relaxed">Adjust ticker speeds to simulate match resolutions instantly for grading and playtesting!</p>
                      <div className="space-y-2">
                        <span className="text-[10px] text-text-dim font-bold block">LIVE TICKER SPEED:</span>
                        <div className="grid grid-cols-2 gap-2">
                          <button onClick={() => { setTickerSpeed(5000); addToast("Speed set to Normal Ticks", "info"); }} className={`py-1.5 px-2 clip-control text-[10px] font-bold border transition ${tickerSpeed === 5000 ? "bg-accent text-bg border-accent font-black" : "bg-bg border-border text-text-dim hover:bg-surface-raised"}`}>NORMAL (5s / tick)</button>
                          <button onClick={() => { setTickerSpeed(2500); addToast("HYPER speed enabled!", "success"); }} className={`py-1.5 px-2 clip-control text-[10px] font-bold border transition ${tickerSpeed === 2500 ? "bg-accent text-bg border-accent font-black" : "bg-bg border-border text-text-dim hover:bg-surface-raised"}`}>⚡ HYPER (2.5s / tick)</button>
                        </div>
                      </div>
                      <div className="pt-2 border-t border-border/50 space-y-2">
                        <span className="text-[10px] text-text-dim font-bold block">VIRTUAL GOLD ASSIST:</span>
                        <button onClick={() => { setGold(35000); addToast("Balance recharged to 35,000 G!", "success"); }} className="w-full py-2 bg-live hover:bg-live/90 text-bg font-display font-black rounded-lg clip-control border border-live/50 flex items-center justify-center space-x-1 cursor-pointer">
                          <span>🪙 RECHARGE BALANCE TO 35,000G</span>
                        </button>
                      </div>
                      <div className="pt-2 border-t border-border/50 space-y-2">
                        <span className="text-[10px] text-text-dim font-bold block">SIMULATOR STATE:</span>
                        <button onClick={() => { setBets(PRE_SEED_BETS); setGold(INITIAL_PLAYER_STATS.gold); setStats({ ...INITIAL_PLAYER_STATS }); setDeckResetKey((prev) => prev + 1); handleResetAnswers(); setShowSettings(false); addToast("Game Simulator Reset successfully!", "info"); }} className="w-full py-2 bg-surface-raised hover:bg-surface-raised/85 text-danger font-display font-black clip-control border border-danger/40 text-center cursor-pointer">
                          🔄 FULL RESET TO DEFAULTS
                        </button>
                      </div>
                      <div className="pt-3 border-t border-border/50 text-center">
                        <span className="text-[8.5px] text-text-dim">CUPRUSH // 26 • V1.0.0 PROTOTYPE</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ======== RIGHT SIDEBAR: Profile & Leaderboard ======== */}
        <div className="col-span-3 hidden lg:flex flex-col gap-4 self-stretch justify-start">
          {/* Profile Card */}
          <div className="bg-border p-[1px] clip-panel shadow-xl">
            <div className="p-4 bg-surface-raised clip-panel">
              <div className="flex items-center gap-3 mb-4">
                <PremiumAvatar avatar="🧑‍🎤" size="lg" />
                <div>
                  <div className="text-xs font-bold text-text font-display uppercase truncate max-w-[150px]">{stats.username}</div>
                  <div className="text-[10px] text-accent font-mono">Lvl {stats.level} • Specialist</div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-[10px] uppercase font-bold text-text-dim">
                  <span>XP Progress</span><span>{stats.xp} / {stats.xpMax}</span>
                </div>
                <div className="w-full h-1.5 bg-surface rounded-full overflow-hidden">
                  <div className="h-full bg-accent transition-all duration-300" style={{ width: `${(stats.xp / stats.xpMax) * 100}%` }}></div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 bg-surface/50 border border-border rounded-lg flex flex-col items-center">
                  <span className="text-[10px] text-text-dim uppercase">Win Rate</span>
                  <span className="text-xs font-bold text-live font-mono">{stats.totalBetsPlaced > 0 ? Math.round((stats.wins / (stats.wins + stats.losses || 1)) * 100) : 57}%</span>
                </div>
                <div className="p-2 bg-surface/50 border border-border rounded-lg flex flex-col items-center">
                  <span className="text-[10px] text-text-dim uppercase">Streak</span>
                  <span className="text-xs font-bold text-accent font-mono">🔥 {stats.streak}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Top 3 Predictors */}
          <div className="bg-border p-[1px] clip-panel shadow-xl">
            <div className="p-4 bg-surface-raised clip-panel">
              <h3 className="text-xs font-bold text-accent uppercase tracking-widest mb-4 font-display">Top Predictors</h3>
              <div className="space-y-3 font-sans">
                {leaderboardRows.length > 0 ? (
                  leaderboardRows.map((entry, idx) => (
                    <div key={idx} className="flex items-center gap-3 p-2 bg-surface/40 border border-border rounded-lg">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black italic bg-surface-raised text-text border border-border">{idx + 1}</div>
                      <span className="text-xs font-medium truncate text-text font-sans">{entry.displayName || "Anonymous"}</span>
                      <span className="ml-auto font-mono text-[10px] font-bold text-accent">{entry.points} pts</span>
                    </div>
                  ))
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 p-2 bg-surface/40 border border-border rounded-lg">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black italic bg-surface-raised text-text border border-border">1</div>
                      <span className="text-xs font-medium truncate text-text font-sans">Alex_LOCKED</span>
                      <span className="ml-auto font-mono text-[10px] font-bold text-accent">25 pts</span>
                    </div>
                    <div className="flex items-center gap-3 p-2 bg-surface/40 border border-border rounded-lg">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black italic bg-surface-raised text-text border border-border">2</div>
                      <span className="text-xs font-medium truncate text-text font-sans">Fanatic_9</span>
                      <span className="ml-auto font-mono text-[10px] font-bold text-accent">18 pts</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Coaches Frame */}
          <div className="bg-border p-[1px] clip-panel mt-auto shadow-xl">
            <div className="p-4 bg-surface-raised clip-panel flex gap-4">
              <div className="flex-1 flex flex-col items-center gap-1 opacity-50">
                <PremiumAvatar avatar="gk" size="md" glow={false} />
                <span className="text-[8px] font-bold uppercase text-text-dim mt-1">Selvad (GK)</span>
              </div>
              <div className="flex-1 flex flex-col items-center gap-1 border-b-2 border-accent pb-1">
                <PremiumAvatar avatar="player" size="md" glow={false} />
                <span className="text-[8px] font-bold uppercase text-accent mt-1">Libeig (ST)</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
