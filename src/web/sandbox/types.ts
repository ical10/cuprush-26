export interface Match {
  id: string;
  teamA: string;
  teamB: string;
  logoA?: string; // Tailwind bg gradient color representation or emoji
  logoB?: string;
  flagA: string; // Emoji flags like 🇧🇷
  flagB: string; // Emoji flags like 🇦🇷
  pool: number; // in-game virtual gold prize pool
  agreePercent: number; // e.g. 68 for 68% vote split
  question: string; // "WILL STADION FC WIN TODAY?"
  oddsA: number;
  oddsB: number;
  oddsDraw: number;
  ratingA: number; // e.g. 84 rating
  ratingB: number; // e.g. 81 rating
  stadium: string;
}

export interface Bet {
  id: string;
  matchId: string;
  teamA: string;
  teamB: string;
  flagA: string;
  flagB: string;
  prediction: 'teamA' | 'teamB' | 'draw';
  predictionLabel: string; // e.g., "Stadion FC Victory" or "Club Atletico Victory"
  amount: number;
  status: 'progress' | 'won' | 'lost';
  minute: number; // 0 to 90 ticking
  scoreA: number;
  scoreB: number;
  odds: number;
  stadium: string;
  betTime: string;
}

export interface LeaderboardEntry {
  rank: number;
  username: string;
  avatar: string; // Emoji representing the profile avatar (e.g. 🏆, 🦁, 🎯)
  avatarBg: string; // Tailwind color class for bg
  countryFlag: string; // Emoji flag
  gold: number;
  isCurrentUser?: boolean;
}

export interface Achievement {
  id: string;
  title: string;
  subtitle: string;
  unlocked: boolean;
  iconName: string; // Lucide icon lookup name
  badgeColor: string; // e.g., "from-yellow-400 to-amber-600"
}

export interface PlayerStats {
  username: string;
  level: string; // e.g. "SILVER II"
  gold: number;
  totalBetsPlaced: number;
  wins: number;
  losses: number;
  streak: number;
  xp: number; // Current XP e.g. 1450 / 2500
  xpMax: number;
}
