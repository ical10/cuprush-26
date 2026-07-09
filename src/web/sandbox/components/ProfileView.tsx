import React, { useState } from 'react';
import { Edit2, Award, Flame, Coins, ShieldCheck, Dumbbell, UserCheck, Star, Users, CheckCircle, HelpCircle, Search, Activity, Shield, Globe } from 'lucide-react';
import { PlayerStats, Achievement } from '../types';
import { FIFA_TEAMS } from '../fifaTeams';
import PremiumAvatar from './PremiumAvatar';

interface ProfileViewProps {
  stats: PlayerStats;
  achievements: Achievement[];
  onStatsUpdate: (updated: PlayerStats) => void;
}

export default function ProfileView({ stats, achievements, onStatsUpdate }: ProfileViewProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState(stats.username);
  const [showFifaDirectory, setShowFifaDirectory] = useState(false);
  const [fifaSearch, setFifaSearch] = useState('');

  // Compute accuracy rate
  const totalCompleted = stats.wins + stats.losses;
  const accuracy = totalCompleted > 0 ? Math.round((stats.wins / totalCompleted) * 100) : 57;

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    if (newName.trim()) {
      onStatsUpdate({ ...stats, username: newName.trim() });
      setIsEditingName(false);
    }
  };

      // Filtered FIFA teams for search directory
      const filteredFifaTeams = FIFA_TEAMS.filter((team) =>
        team.name.toLowerCase().includes(fifaSearch.toLowerCase())
      );

      return (
        <div className="flex flex-col flex-1 w-full h-full text-text-main select-none overflow-y-auto scrollbar-none pb-6 min-h-0">
          
          {/* Profile Header Avatar & Username Block */}
          <div className="relative flex flex-col items-center pt-2 pb-4 text-center">
            {/* Large Avatar container */}
            <div className="relative">
              <PremiumAvatar avatar="🧑‍🎤" size="xl" />
              {/* Level Badge Overlay */}
              <div className="absolute -bottom-1 -right-1 bg-surface border border-border-main text-accent text-[9px] font-mono font-black px-2 py-0.5 clip-control shadow">
                {stats.level}
              </div>
            </div>

            {/* Username form / display */}
            {isEditingName ? (
              <form onSubmit={handleSaveName} className="mt-3 flex items-center space-x-1 max-w-[280px]">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="px-2.5 py-1 bg-surface border border-border-main clip-control text-sm text-center font-display font-bold text-text-main focus:outline-none focus:border-accent"
                  maxLength={20}
                  autoFocus
                />
                <button 
                  type="submit" 
                  className="bg-accent text-bg text-xs px-3 py-1 clip-control font-display font-black hover:bg-accent/80 cursor-pointer"
                >
                  OK
                </button>
              </form>
            ) : (
              <div className="mt-3 flex items-center space-x-2">
                <h3 className="text-lg font-display font-black text-text-main tracking-wide uppercase">
                  {stats.username}
                </h3>
                <button 
                  onClick={() => setIsEditingName(true)}
                  className="p-1 hover:bg-surface-raised rounded-full transition text-text-dim hover:text-accent cursor-pointer"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* GENERAL STATS SECTION */}
          <div className="bg-border-main p-px clip-panel mb-4 shadow-xl">
            <div className="bg-surface clip-panel p-4">
              <h4 className="text-[10px] font-mono tracking-widest text-accent font-bold uppercase mb-3 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" /> GENERAL STATS
              </h4>
              
              <div className="grid grid-cols-2 gap-4">
                {/* Left col stats list */}
                <div className="space-y-3.5 text-xs font-mono text-text-dim">
                  <div>
                    <span className="text-[10px]">TOTAL BETS PLACED:</span>
                    <p className="font-display font-black text-base text-text-main mt-0.5">{stats.totalBetsPlaced}</p>
                  </div>
                  
                  <div>
                    <span className="text-[10px]">PRED RESULTS:</span>
                    <p className="font-display font-black text-sm text-text-main mt-0.5">
                      WINS: <span className="text-live">{stats.wins}</span> / LOSSES: <span className="text-danger">{stats.losses}</span>
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Flame className="w-4 h-4 text-accent animate-pulse" />
                    <div>
                      <span className="text-[9px] block leading-none">CURRENT WIN STREAK:</span>
                      <span className="font-display font-black text-sm text-accent">{stats.streak} Matches</span>
                    </div>
                  </div>
                </div>

                {/* Right col custom circular meter */}
                <div className="flex flex-col items-center justify-center border-l border-border-main/55 pl-2">
                  <div className="relative w-20 h-20 flex items-center justify-center">
                    {/* SVG Ring */}
                    <svg className="w-full h-full transform -rotate-90">
                      <circle
                        cx="40"
                        cy="40"
                        r="34"
                        className="stroke-bg fill-none stroke-6"
                      />
                      <circle
                        cx="40"
                        cy="40"
                        r="34"
                        className="stroke-live fill-none stroke-6 transition-all"
                        strokeDasharray={`${2 * Math.PI * 34}`}
                        strokeDashoffset={`${2 * Math.PI * 34 * (1 - accuracy / 100)}`}
                      />
                    </svg>
                    {/* Inner Label */}
                    <div className="absolute flex flex-col items-center text-center">
                      <span className="text-sm font-display font-black text-text-main leading-none">{accuracy}%</span>
                      <span className="text-[7.5px] font-mono text-text-dim mt-0.5 uppercase tracking-tight">Accuracy</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* PLAYER ROSTER COACH SLOTS */}
          <div className="bg-border-main p-px clip-panel mb-4 shadow-xl">
            <div className="bg-surface clip-panel p-4">
              <h4 className="text-[10px] font-mono tracking-widest text-accent font-bold uppercase mb-3 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5" /> ACTIVE PLAYER ROSTER
              </h4>

              <div className="grid grid-cols-2 gap-3.5">
                {/* Active GK - Coach Selvad */}
                <div className="bg-border-main p-px clip-panel w-full">
                  <div className="p-3 bg-surface-raised clip-panel flex flex-col items-center text-center">
                    <span className="text-[9.5px] font-mono font-bold text-live uppercase tracking-widest mb-1.5">
                      Active GK
                    </span>
                    <div className="mb-1.5">
                      <PremiumAvatar avatar="🧑‍✈️" size="lg" />
                    </div>
                    <p className="text-xs font-display font-black text-text-main truncate w-full">
                      Coach Selvad
                    </p>
                    <p className="text-[9px] font-mono text-text-dim mt-0.5">
                      #1 • GK Specialist
                    </p>
                  </div>
                </div>

                {/* Active Player - Coach Libeig / Winger */}
                <div className="bg-border-main p-px clip-panel w-full">
                  <div className="p-3 bg-surface-raised clip-panel flex flex-col items-center text-center">
                    <span className="text-[9.5px] font-mono font-bold text-accent uppercase tracking-widest mb-1.5">
                      Active Player
                    </span>
                    <div className="mb-1.5">
                      <PremiumAvatar avatar="🧑‍🎤" size="lg" />
                    </div>
                    <p className="text-xs font-display font-black text-text-main truncate w-full">
                      Coach Libeig
                    </p>
                    <p className="text-[9px] font-mono text-text-dim mt-0.5">
                      #7 • Winger Tactician
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ACHIEVEMENTS GRID */}
          <div className="bg-border-main p-px clip-panel mb-4 shadow-xl">
            <div className="bg-surface clip-panel p-4">
              <h4 className="text-[10px] font-mono tracking-widest text-accent font-bold uppercase mb-3 flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5" /> ACHIEVEMENTS
              </h4>

              <div className="grid grid-cols-5 gap-2">
                {achievements.map((ach) => {
                  return (
                    <div
                      key={ach.id}
                      className="group relative flex flex-col items-center cursor-help"
                    >
                      {/* Badge Circle */}
                      <div 
                        className={`w-10 h-10 rounded-full flex items-center justify-center border text-base shadow transition ${
                          ach.unlocked
                            ? 'bg-surface-raised border-accent text-accent scale-100 hover:scale-105'
                            : 'bg-bg border-border-main text-text-dim/30 scale-95 opacity-60'
                        }`}
                      >
                        {ach.title === 'First Bet' ? '🔥' : 
                         ach.title === 'Big Winner' ? '🏆' :
                         ach.title === 'Win Streak' ? '⚡' :
                         ach.title === 'High Roller' ? '💎' : '👥'}
                      </div>
                      
                      {/* Badge Label */}
                      <span className={`text-[8.5px] font-display font-medium mt-1.5 text-center truncate w-full ${
                        ach.unlocked ? 'text-text-main' : 'text-text-dim/60'
                      }`}>
                        {ach.title}
                      </span>

                      {/* Micro tooltip descriptions */}
                      <div className="absolute bottom-11 scale-0 group-hover:scale-100 transition origin-bottom bg-surface border border-border-main text-text-main text-[9px] p-2 rounded-lg w-28 text-center pointer-events-none z-20 shadow-xl">
                        <p className="font-bold text-accent">{ach.title}</p>
                        <p className="text-[8px] text-text-dim mt-0.5 leading-tight">{ach.subtitle}</p>
                        <p className="text-[7.5px] text-live font-mono mt-1 uppercase font-bold">
                          {ach.unlocked ? 'Unlocked' : 'Locked'}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* FIFA WORLD CUP DIRECTORY */}
          <div className="bg-border-main p-px clip-panel mb-4 shadow-xl">
            <div className="bg-surface clip-panel p-4">
              <button 
                onClick={() => setShowFifaDirectory(!showFifaDirectory)}
                className="w-full flex items-center justify-between text-left focus:outline-none cursor-pointer"
              >
                <h4 className="text-[10px] font-mono tracking-widest text-accent font-bold uppercase flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5" /> FIFA NATIONS DIRECTORY
                </h4>
                <span className="text-[9px] text-text-dim font-mono bg-bg px-2 py-0.5 rounded border border-border-main hover:text-accent transition">
                  {showFifaDirectory ? 'COLLAPSE' : 'EXPAND'}
                </span>
              </button>

              {showFifaDirectory && (
                <div className="mt-4 space-y-3">
                  <p className="text-[10px] font-sans text-text-dim leading-relaxed">
                    Explore all 211 official FIFA member associations and their corresponding flags.
                  </p>
                  
                  {/* Search Box */}
                  <div className="relative font-sans">
                    <input
                      type="text"
                      value={fifaSearch}
                      onChange={(e) => setFifaSearch(e.target.value)}
                      placeholder="Search 211 countries..."
                      className="w-full py-1.5 pl-8 pr-3 bg-bg border border-border-main clip-control text-[11px] font-sans placeholder-text-dim/50 text-text-main focus:outline-none focus:border-accent"
                    />
                    <Search className="absolute left-2.5 top-2 w-3 h-3 text-text-dim" />
                  </div>

                  {/* Grid of Teams */}
                  <div className="grid grid-cols-2 gap-2 max-h-[180px] overflow-y-auto scrollbar-none pr-1 mt-2">
                    {filteredFifaTeams.length > 0 ? (
                      filteredFifaTeams.map((team) => (
                        <div 
                          key={team.name}
                          className="flex items-center space-x-2 p-1.5 bg-bg/50 border border-border-main/50 rounded hover:border-accent/40 transition"
                        >
                          <span className="text-base">{team.flag}</span>
                          <span className="text-[9.5px] font-mono font-medium truncate text-text-main uppercase">
                            {team.name}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="col-span-2 text-center py-4 text-text-dim text-[10px] font-mono">
                        No matching FIFA teams.
                      </div>
                    )}
                  </div>
                  
                  <div className="text-right text-[8px] font-mono text-text-dim uppercase">
                    showing {filteredFifaTeams.length} of 211 associations
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ACCOUNT ACTIONS */}
      <div className="grid grid-cols-2 gap-3 mt-1 px-1">
        {/* Edit profile (Secondary button layout) */}
        <button
          onClick={() => setIsEditingName(true)}
          className="py-2.5! bg-surface-raised! hover:bg-surface-raised/80! text-text-main! font-display! font-black! text-xs! clip-control border! border-border-main! flex! items-center! justify-center! space-x-1.5! transition! transform! active:scale-95! cursor-pointer!"
        >
          <UserCheck className="w-3.5 h-3.5 text-text-main" />
          <span className="uppercase tracking-wider">EDIT PROFILE</span>
        </button>

        {/* Settings (Primary button layout) */}
        <div className="relative">
          <button
            onClick={() => alert('Virtual Account Settings: Level, theme options and local progression are saved successfully in browser memory.')}
            className="w-full! py-2.5! bg-accent! hover:bg-accent/90! text-bg! font-display! font-black! text-xs! clip-control flex! items-center! justify-center! space-x-1.5! transition! transform! active:scale-95! cursor-pointer!"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-bg" />
            <span className="uppercase tracking-wider">SETTINGS</span>
          </button>
        </div>
      </div>

    </div>
  );
}
