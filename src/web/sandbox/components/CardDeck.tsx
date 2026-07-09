import React, { useState, useRef, useEffect } from "react";
import {
  ThumbsUp,
  ThumbsDown,
  Check,
  X,
  Coins,
  ShieldAlert,
  Award,
  Compass,
} from "lucide-react";
import { Match } from "../types";

interface CardDeckProps {
  key?: React.Key;
  matches: Match[];
  onBetPlaced: (match: Match, prediction: "teamA" | "teamB" | "draw") => void;
  onSkip: (match: Match) => void;
}

export default function CardDeck({
  matches,
  onBetPlaced,
  onSkip,
}: CardDeckProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<"left" | "right" | null>(
    null,
  );
  const [animationClass, setAnimationClass] = useState<string>("");

  const dragStart = useRef({ x: 0, y: 0 });
  const activeMatch = matches[currentIndex] || null;

  // Handle Touch start
  const handleTouchStart = (e: React.TouchEvent) => {
    if (swipeDirection) return;
    setIsDragging(true);
    const touch = e.touches[0];
    if (touch) {
      dragStart.current = {
        x: touch.clientX - dragOffset.x,
        y: touch.clientY - dragOffset.y,
      };
    }
  };

  // Handle Touch move
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || swipeDirection) return;
    const touch = e.touches[0];
    if (touch) {
      const dx = touch.clientX - dragStart.current.x;
      const dy = touch.clientY - dragStart.current.y;
      setDragOffset({ x: dx, y: dy });
    }
  };

  // Handle Touch end
  const handleTouchEnd = () => {
    if (!isDragging || swipeDirection) return;
    setIsDragging(false);
    evaluateSwipe();
  };

  // Handle Mouse start
  const handleMouseDown = (e: React.MouseEvent) => {
    if (swipeDirection) return;
    setIsDragging(true);
    dragStart.current = {
      x: e.clientX - dragOffset.x,
      y: e.clientY - dragOffset.y,
    };
  };

  // Handle Mouse move
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || swipeDirection) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setDragOffset({ x: dx, y: dy });
  };

  // Handle Mouse up/leave
  const handleMouseUp = () => {
    if (!isDragging || swipeDirection) return;
    setIsDragging(false);
    evaluateSwipe();
  };

  // Evaluate if drag meets threshold for swipe
  const evaluateSwipe = () => {
    const threshold = 110;
    if (dragOffset.x > threshold) {
      // Swipe Right -> Agree (Wins)
      triggerSwipe("right");
    } else if (dragOffset.x < -threshold) {
      // Swipe Left -> Skip / Disagree
      triggerSwipe("left");
    } else {
      // Reset position
      setDragOffset({ x: 0, y: 0 });
    }
  };

  // Animate the card completely off-screen and trigger callback
  const triggerSwipe = (direction: "left" | "right") => {
    if (!activeMatch) return;
    setSwipeDirection(direction);

    // Animate card offscreen
    const targetX = direction === "right" ? 600 : -600;
    setDragOffset({ x: targetX, y: dragOffset.y * 1.5 });

    setTimeout(() => {
      if (direction === "right") {
        // Agree: Bet on the team in the question (STADION FC in Stadion vs Club Atletico)
        // Usually, the question asks "WILL [TEAMA] WIN...?"
        onBetPlaced(activeMatch, "teamA");
      } else {
        // Disagree: skips the card (moves to next)
        onSkip(activeMatch);
      }

      // Load next card
      setCurrentIndex((prev) => prev + 1);
      // Reset states
      setDragOffset({ x: 0, y: 0 });
      setSwipeDirection(null);
    }, 280);
  };

  // Button triggers
  const handleAgreeClick = () => {
    if (swipeDirection || !activeMatch) return;
    triggerSwipe("right");
  };

  const handleDisagreeClick = () => {
    if (swipeDirection || !activeMatch) return;
    triggerSwipe("left");
  };

  const handleResetDeck = () => {
    setCurrentIndex(0);
    setDragOffset({ x: 0, y: 0 });
    setSwipeDirection(null);
  };

  // Calculate rotation and overlay opacity based on offsets
  const rotation = dragOffset.x * 0.12;
  const agreeOpacity = Math.min(Math.max(dragOffset.x / 100, 0), 1);
  const disagreeOpacity = Math.min(Math.max(-dragOffset.x / 100, 0), 1);

  return (
    <div className="flex flex-col flex-1 items-center justify-between w-full h-full pb-3 select-none">
      {/* Top Deck Card Area */}
      <div className="relative flex-1 w-full flex items-center justify-center px-4 mt-2 h-[480px]">
        {activeMatch ? (
          <>
            {/* NEXT CARD STACK IN BACKGROUND (if available) */}
            {currentIndex + 1 < matches.length && (
              <div
                className="absolute w-[92%] h-[410px] bg-border-main/40 p-[2px] clip-hero opacity-60 scale-95 translate-y-4 shadow-2xl pointer-events-none"
                style={{ zIndex: 10 }}
              >
                <div className="bg-surface clip-hero w-full h-full flex flex-col justify-between p-6">
                  <div className="h-4 bg-surface-raised rounded w-1/3 mx-auto" />
                  <div className="flex justify-between items-center my-6">
                    <div className="w-12 h-12 rounded-full bg-surface-raised" />
                    <div className="h-6 bg-surface-raised rounded w-12" />
                    <div className="w-12 h-12 rounded-full bg-surface-raised" />
                  </div>
                  <div className="h-10 bg-surface-raised rounded w-4/5 mx-auto" />
                  <div className="h-4 bg-surface-raised rounded w-1/2 mx-auto" />
                </div>
              </div>
            )}

            {/* MAIN INTERACTIVE SWIPE CARD */}
            <div
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              style={{
                transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0) rotate(${rotation}deg)`,
                transition: isDragging
                  ? "none"
                  : "transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                zIndex: 20,
              }}
              className="absolute w-full max-w-[390px] h-[415px] bg-border-main p-[2px] clip-hero shadow-[0_15px_35px_rgba(0,0,0,0.6)] flex flex-col justify-between overflow-hidden cursor-grab active:cursor-grabbing"
            >
              <div className="bg-surface clip-hero w-full h-full flex flex-col justify-between overflow-hidden relative">
                {/* Card Header & Stadium Spotlight Style Graphic with Rush Lines */}
                <div className="relative w-full h-[55%] flex flex-col justify-between p-5 bg-rush-lines">
                  {/* Spotlight glow beam behind text */}
                  <div className="absolute inset-0 bg-radial from-accent/5 via-transparent to-transparent pointer-events-none" />

                  {/* Card Top Details */}
                  <div className="flex justify-between items-center z-10">
                    <span className="text-[10px] tracking-widest font-mono text-accent font-bold bg-surface-raised px-2.5 py-1 clip-control border border-border-main/50">
                      MATCH TODAY: {activeMatch.stadium}
                    </span>
                    <div className="flex items-center space-x-1.5 bg-surface-raised border border-border-main/50 text-live font-mono text-[10px] px-2.5 py-0.5 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-live animate-pulse" />
                      <span>LIVE POOL</span>
                    </div>
                  </div>

                  {/* Team Verses Layout */}
                  <div className="flex justify-around items-center my-1 z-10">
                    {/* Team A */}
                    <div className="flex flex-col items-center w-[38%]">
                      <div className="relative w-14 h-14 rounded-full bg-surface-raised border-2 border-border-main flex items-center justify-center shadow-lg text-3xl">
                        {activeMatch.flagA}
                        <span className="absolute -bottom-1 -right-1 bg-accent text-bg font-mono text-[9px] font-bold px-1.5 rounded border border-bg">
                          {activeMatch.ratingA}
                        </span>
                      </div>
                      <span className="text-sm font-display font-black text-text-main mt-2 text-center truncate w-full">
                        {activeMatch.teamA}
                      </span>
                    </div>

                    {/* VS */}
                    <div className="flex flex-col items-center">
                      <span className="text-xl font-display font-black text-accent italic tracking-wider">
                        VS.
                      </span>
                      <span className="text-[9px] font-mono text-text-dim mt-1">
                        POOL {activeMatch.pool.toLocaleString()} G
                      </span>
                    </div>

                    {/* Team B */}
                    <div className="flex flex-col items-center w-[38%]">
                      <div className="relative w-14 h-14 rounded-full bg-surface-raised border-2 border-border-main flex items-center justify-center shadow-lg text-3xl">
                        {activeMatch.flagB}
                        <span className="absolute -bottom-1 -right-1 bg-accent text-bg font-mono text-[9px] font-bold px-1.5 rounded border border-bg">
                          {activeMatch.ratingB}
                        </span>
                      </div>
                      <span className="text-sm font-display font-black text-text-main mt-2 text-center truncate w-full">
                        {activeMatch.teamB}
                      </span>
                    </div>
                  </div>

                  {/* SWIPE OVERLAY BADGES */}
                  {agreeOpacity > 0 && (
                    <div
                      style={{ opacity: agreeOpacity }}
                      className="absolute inset-0 bg-live/90 flex flex-col items-center justify-center pointer-events-none transition-opacity z-35"
                    >
                      <div className="w-16 h-16 rounded-full bg-bg flex items-center justify-center mb-2 animate-bounce">
                        <Check className="w-9 h-9 text-live stroke-3" />
                      </div>
                      <span className="text-2xl font-display font-black text-bg tracking-wider">
                        AGREE
                      </span>
                      <span className="text-xs text-bg/80 font-mono mt-1">
                        Bet 500 G on {activeMatch.teamA}
                      </span>
                    </div>
                  )}

                  {disagreeOpacity > 0 && (
                    <div
                      style={{ opacity: disagreeOpacity }}
                      className="absolute inset-0 bg-danger/90 flex flex-col items-center justify-center pointer-events-none transition-opacity z-35"
                    >
                      <div className="w-16 h-16 rounded-full bg-bg flex items-center justify-center mb-2 animate-bounce">
                        <X className="w-9 h-9 text-danger stroke-3" />
                      </div>
                      <span className="text-2xl font-display font-black text-bg tracking-wider">
                        SKIP
                      </span>
                      <span className="text-xs text-bg/80 font-mono mt-1">
                        Pass this fixture
                      </span>
                    </div>
                  )}
                </div>

                {/* Lower Card Section (The main question & votes statistics) */}
                <div className="h-[45%] bg-surface-raised p-5 border-t border-border-main flex flex-col justify-between">
                  {/* Prediction Question Prompt */}
                  <div className="text-center my-auto px-1">
                    <h3 className="font-card-question text-text-main leading-tight uppercase">
                      {activeMatch.question}
                    </h3>
                  </div>

                  {/* Vote stats split progress bar */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px] font-mono font-bold">
                      <span className="text-live">
                        AGREE: {activeMatch.agreePercent}%
                      </span>
                      <span className="text-danger">
                        DISAGREE: {100 - activeMatch.agreePercent}%
                      </span>
                    </div>
                    <div className="h-2 w-full bg-surface rounded-full overflow-hidden flex">
                      <div
                        className="bg-live h-full transition-all"
                        style={{ width: `${activeMatch.agreePercent}%` }}
                      />
                      <div
                        className="bg-danger h-full transition-all"
                        style={{ width: `${100 - activeMatch.agreePercent}%` }}
                      />
                    </div>
                    <p className="text-[9.5px] text-center text-text-dim font-mono">
                      🎮 14,249 active players have swiped on this match
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* DECK COMPLETED STATE */
          <div className="bg-border-main p-[2px] w-full max-w-[390px] h-[390px] clip-hero shadow-2xl">
            <div className="bg-surface clip-hero w-full h-full p-6 flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-full bg-surface-raised border border-border-main flex items-center justify-center mb-4 text-3xl">
                ⚽
              </div>
              <h3 className="text-xl font-display font-black text-accent uppercase tracking-wide">
                ALL PICKS SWIPED!
              </h3>
              <p className="text-sm text-text-dim mt-2 mb-6 max-w-xs leading-relaxed font-sans">
                You have completed all daily matches! Check{" "}
                <strong className="text-live font-bold">My Bets</strong> to
                watch your predictions tick live and earn virtual Gold.
              </p>
              <button
                onClick={handleResetDeck}
                className="px-6 py-3 bg-accent hover:bg-accent/90 text-bg font-display font-black clip-control shadow-lg border border-accent transition transform active:scale-95 text-xs uppercase tracking-wider cursor-pointer"
              >
                🔄 Refresh Daily Fixtures
              </button>
            </div>
          </div>
        )}
      </div>

      {/* SWIPE HELPER TEXT INSTRUCTIONS */}
      {activeMatch && (
        <div className="text-center font-mono text-[10px] text-accent/80 tracking-wider uppercase py-1 px-4 bg-surface/80 border border-border-main/50 clip-control">
          👈 Swipe Left to SKIP / Swipe Right to AGREE 👉
        </div>
      )}

      {/* INTERACTIVE CLICK BUTTON FALLBACKS */}
      {activeMatch && (
        <div className="flex justify-center items-center space-x-6 px-4 w-full max-w-sm mt-3">
          {/* Disagree / Skip button */}
          <button
            onClick={handleDisagreeClick}
            className="flex-1! py-3! px-4! bg-surface-raised! hover:bg-surface-raised/80! hover:text-danger! hover:border-danger/50! text-text-main! font-display! font-black! text-xs! clip-control! border! border-border-main! flex! items-center! justify-center! space-x-2! transition! transform! active:scale-95! cursor-pointer!"
          >
            <ThumbsDown className="w-4 h-4 stroke-[2.5]" />
            <span className="uppercase tracking-widest text-[11px]">NO</span>
          </button>

          {/* Agree / Swipes button */}
          <button
            onClick={handleAgreeClick}
            className="flex-1! py-3! px-4! bg-surface-raised! hover:bg-surface-raised/80! hover:text-live! hover:border-live/50! text-text-main! font-display! font-black! text-xs! clip-control! border! border-border-main! flex! items-center! justify-center! space-x-2! transition! transform! active:scale-95! cursor-pointer!"
          >
            <ThumbsUp className="w-4 h-4 stroke-[2.5]" />
            <span className="uppercase tracking-widest text-[11px]">YES</span>
          </button>
        </div>
      )}
    </div>
  );
}
