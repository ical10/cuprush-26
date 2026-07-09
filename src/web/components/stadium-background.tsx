import React from 'react';

export default function StadiumBackground() {
  return (
    <div className="absolute inset-0 w-full h-full bg-slate-950 overflow-hidden pointer-events-none select-none">
      {/* Stadium Spotlight Beams */}
      <div className="absolute top-0 left-0 w-full h-1/2 opacity-35 mix-blend-screen overflow-hidden">
        {/* Left floodlights beam */}
        <div 
          className="absolute top-[-10%] left-[5%] w-[40%] h-[120%] bg-gradient-to-b from-cyan-300 via-sky-500/20 to-transparent origin-top-left"
          style={{ transform: 'rotate(15deg) skewX(20deg)', filter: 'blur(15px)' }}
        />
        {/* Right floodlights beam */}
        <div 
          className="absolute top-[-10%] right-[5%] w-[40%] h-[120%] bg-gradient-to-b from-cyan-300 via-indigo-500/20 to-transparent origin-top-right"
          style={{ transform: 'rotate(-15deg) skewX(-20deg)', filter: 'blur(15px)' }}
        />
        {/* Center stadium lights glow */}
        <div 
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-[60%] bg-radial from-cyan-500/30 to-transparent"
          style={{ filter: 'blur(20px)' }}
        />
      </div>

      {/* Crowd / Stadium Seating Silhouette Overlay */}
      <div className="absolute inset-x-0 top-[35%] h-[15%] bg-gradient-to-b from-transparent via-slate-900/60 to-slate-950" />

      {/* Ground Grass / Pitch */}
      <div className="absolute inset-x-0 bottom-0 h-[45%] bg-gradient-to-t from-emerald-950 via-emerald-900/80 to-slate-950">
        {/* Pitch Green Line Markings (recreating real stadium feel) */}
        <div className="absolute inset-x-0 bottom-0 h-full opacity-15">
          {/* Strips */}
          <div className="h-full w-full flex flex-col justify-between">
            <div className="h-[12.5%] bg-emerald-800" />
            <div className="h-[12.5%] bg-transparent" />
            <div className="h-[12.5%] bg-emerald-800" />
            <div className="h-[12.5%] bg-transparent" />
            <div className="h-[12.5%] bg-emerald-800" />
            <div className="h-[12.5%] bg-transparent" />
            <div className="h-[12.5%] bg-emerald-800" />
            <div className="h-[12.5%] bg-transparent" />
          </div>
          {/* Halfway / Center Circle */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 border border-white rounded-full translate-y-24 opacity-60" />
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-white translate-y-48 opacity-60" />
          {/* Goal post marking */}
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-72 h-24 border-t border-x border-white opacity-40" />
        </div>
      </div>

      {/* Floating dust particles / light sparkles to enhance atmosphere */}
      <div className="absolute top-[10%] left-[20%] w-1.5 h-1.5 rounded-full bg-cyan-200/50 animate-pulse" />
      <div className="absolute top-[25%] right-[25%] w-1 h-1 rounded-full bg-sky-200/40 animate-pulse delay-700" />
      <div className="absolute top-[15%] right-[15%] w-2 h-2 rounded-full bg-indigo-200/30 animate-pulse delay-1000" />
      <div className="absolute top-[35%] left-[10%] w-1 h-1 rounded-full bg-cyan-100/50 animate-pulse delay-500" />
      <div className="absolute top-[5%] left-[45%] w-2 h-2 rounded-full bg-white/30 animate-pulse delay-1500" />

      {/* Vignette dark edges */}
      <div className="absolute inset-0 bg-radial from-transparent via-slate-950/20 to-slate-950/90 pointer-events-none" />
    </div>
  );
}
