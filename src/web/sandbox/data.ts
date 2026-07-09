import { Match, LeaderboardEntry, Achievement, PlayerStats, Bet } from './types';

export const INITIAL_MATCHES: Match[] = [
  {
    id: 'm1',
    teamA: 'ARGENTINA',
    teamB: 'FRANCE',
    flagA: '🇦🇷',
    flagB: '🇫🇷',
    logoA: 'from-sky-400 to-sky-100',
    logoB: 'from-blue-800 to-indigo-950',
    pool: 145000,
    agreePercent: 54,
    question: 'WILL ARGENTINA REPEAT THEIR WORLD CUP FINAL TRIUMPH OVER FRANCE?',
    oddsA: 2.20,
    oddsB: 2.35,
    oddsDraw: 3.10,
    ratingA: 93,
    ratingB: 92,
    stadium: 'LUSAIL STADIUM'
  },
  {
    id: 'm2',
    teamA: 'BRAZIL',
    teamB: 'GERMANY',
    flagA: '🇧🇷',
    flagB: '🇩🇪',
    logoA: 'from-yellow-400 to-green-600',
    logoB: 'from-zinc-700 to-zinc-900',
    pool: 92000,
    agreePercent: 62,
    question: 'WILL BRAZIL SECURE AN EIGHTH-FINAL WIN OVER GERMANY?',
    oddsA: 1.95,
    oddsB: 2.90,
    oddsDraw: 3.40,
    ratingA: 90,
    ratingB: 85,
    stadium: 'AL BAYT STADIUM'
  },
  {
    id: 'm3',
    teamA: 'SPAIN',
    teamB: 'PORTUGAL',
    flagA: '🇪🇸',
    flagB: '🇵🇹',
    logoA: 'from-red-600 to-yellow-500',
    logoB: 'from-red-700 to-green-700',
    pool: 105000,
    agreePercent: 48,
    question: 'WILL SPAIN EDGE OUT PORTUGAL IN THIS TIGHT NEIGHBORLY CLASH?',
    oddsA: 2.10,
    oddsB: 2.50,
    oddsDraw: 3.00,
    ratingA: 91,
    ratingB: 89,
    stadium: 'AL THUMAMA STADIUM'
  },
  {
    id: 'm4',
    teamA: 'ENGLAND',
    teamB: 'ITALY',
    flagA: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
    flagB: '🇮🇹',
    logoA: 'from-zinc-100 to-red-500',
    logoB: 'from-blue-700 to-indigo-900',
    pool: 88000,
    agreePercent: 52,
    question: 'WILL ENGLAND SHAKE OFF HISTORY AND DEFEAT ITALY?',
    oddsA: 2.00,
    oddsB: 2.80,
    oddsDraw: 3.15,
    ratingA: 89,
    ratingB: 86,
    stadium: 'KHALIFA INTERNATIONAL STADIUM'
  },
  {
    id: 'm5',
    teamA: 'JAPAN',
    teamB: 'CROATIA',
    flagA: '🇯🇵',
    flagB: '🇭🇷',
    logoA: 'from-blue-900 to-red-500',
    logoB: 'from-red-600 to-zinc-100',
    pool: 64000,
    agreePercent: 43,
    question: 'CAN JAPAN SHOCK THE 2018 RUNNERS-UP CROATIA?',
    oddsA: 3.15,
    oddsB: 1.85,
    oddsDraw: 3.30,
    ratingA: 83,
    ratingB: 86,
    stadium: 'AHMAD BIN ALI STADIUM'
  },
  {
    id: 'm6',
    teamA: 'USA',
    teamB: 'NETHERLANDS',
    flagA: '🇺🇸',
    flagB: '🇳🇱',
    logoA: 'from-blue-800 to-red-600',
    logoB: 'from-orange-500 to-amber-650',
    pool: 58000,
    agreePercent: 39,
    question: 'CAN THE USA CAUSE A HUGE WORLD CUP UPSET AGAINST THE NETHERLANDS?',
    oddsA: 3.55,
    oddsB: 1.70,
    oddsDraw: 3.40,
    ratingA: 80,
    ratingB: 87,
    stadium: 'AL JANOUB STADIUM'
  },
  {
    id: 'm7',
    teamA: 'SENEGAL',
    teamB: 'MOROCCO',
    flagA: '🇸🇳',
    flagB: '🇲🇦',
    logoA: 'from-green-600 to-yellow-500',
    logoB: 'from-red-700 to-emerald-800',
    pool: 71000,
    agreePercent: 47,
    question: 'WILL THE ATLAS LIONS OF MOROCCO SLIP PAST SENEGAL?',
    oddsA: 2.65,
    oddsB: 2.20,
    oddsDraw: 3.00,
    ratingA: 81,
    ratingB: 84,
    stadium: 'EDUCATION CITY STADIUM'
  },
  {
    id: 'm8',
    teamA: 'MEXICO',
    teamB: 'POLAND',
    flagA: '🇲🇽',
    flagB: '🇵🇱',
    logoA: 'from-green-800 to-red-700',
    logoB: 'from-zinc-100 to-red-600',
    pool: 48000,
    agreePercent: 51,
    question: 'WILL MEXICO SECURE THE THREE POINTS AGAINST POLAND?',
    oddsA: 2.30,
    oddsB: 2.60,
    oddsDraw: 3.10,
    ratingA: 82,
    ratingB: 81,
    stadium: 'STADIUM 974'
  }
];

export const INITIAL_LEADERBOARD: LeaderboardEntry[] = [
  {
    rank: 1,
    username: 'GoldFoot_Soccer',
    avatar: '👟',
    avatarBg: 'bg-amber-500',
    countryFlag: '🇧🇷',
    gold: 1500000
  },
  {
    rank: 2,
    username: 'NetRipperr_99',
    avatar: '🦁',
    avatarBg: 'bg-blue-600',
    countryFlag: '🇦🇷',
    gold: 1200000
  },
  {
    rank: 3,
    username: 'PrecisionAce',
    avatar: '🎯',
    avatarBg: 'bg-emerald-600',
    countryFlag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
    gold: 950000
  },
  {
    rank: 4,
    username: 'Goalgetter_X',
    avatar: '🧑‍🚀',
    avatarBg: 'bg-zinc-700',
    countryFlag: '🇧🇷',
    gold: 800000
  },
  {
    rank: 5,
    username: 'FairPlay_Don',
    avatar: '🤵',
    avatarBg: 'bg-indigo-600',
    countryFlag: '🇮🇹',
    gold: 750000
  },
  {
    rank: 6,
    username: 'Stadion_King',
    avatar: '👑',
    avatarBg: 'bg-yellow-500',
    countryFlag: '🇯🇵',
    gold: 500000
  },
  {
    rank: 7,
    username: 'Bkoofid',
    avatar: '🧔',
    avatarBg: 'bg-red-600',
    countryFlag: '🇫🇷',
    gold: 450000
  },
  {
    rank: 8,
    username: 'Halmor_City',
    avatar: '🧑‍🦱',
    avatarBg: 'bg-teal-600',
    countryFlag: '🇲🇦',
    gold: 450000
  },
  {
    rank: 9,
    username: 'StrikerSpecialist',
    avatar: '⚡',
    avatarBg: 'bg-orange-600',
    countryFlag: '🇪🇸',
    gold: 420000
  },
  {
    rank: 10,
    username: 'TikiTakaMaster',
    avatar: '⚽',
    avatarBg: 'bg-sky-600',
    countryFlag: '🇪🇸',
    gold: 410000
  }
];

export const INITIAL_ACHIEVEMENTS: Achievement[] = [
  {
    id: 'a1',
    title: 'First Bet',
    subtitle: 'Place your first virtual prediction',
    unlocked: true,
    iconName: 'Sparkles',
    badgeColor: 'from-emerald-400 to-teal-600'
  },
  {
    id: 'a2',
    title: 'Big Winner',
    subtitle: 'Win a bet of 500G or more',
    unlocked: true,
    iconName: 'Trophy',
    badgeColor: 'from-yellow-400 to-amber-600'
  },
  {
    id: 'a3',
    title: 'Win Streak',
    subtitle: 'Achieve a streak of 3 wins',
    unlocked: true,
    iconName: 'Flame',
    badgeColor: 'from-orange-500 to-red-600'
  },
  {
    id: 'a4',
    title: 'High Roller',
    subtitle: 'Have a balance of over 20,000 Gold',
    unlocked: true,
    iconName: 'Coins',
    badgeColor: 'from-purple-500 to-indigo-700'
  },
  {
    id: 'a5',
    title: 'Social Star',
    subtitle: 'Predict outcome with 10k+ others',
    unlocked: false,
    iconName: 'Users',
    badgeColor: 'from-gray-500 to-slate-700'
  }
];

export const INITIAL_PLAYER_STATS: PlayerStats = {
  username: 'PLAYER_NICKNAME_777',
  level: 'SILVER II',
  gold: 20456,
  totalBetsPlaced: 125,
  wins: 72,
  losses: 53,
  streak: 3,
  xp: 1450,
  xpMax: 2500
};

// We will seed the game with a few pre-completed bets to replicate the screenshot's scroll view
export const PRE_SEED_BETS: Bet[] = [
  {
    id: 'b_seed1',
    matchId: 'seed_m1',
    teamA: 'ARGENTINA',
    teamB: 'CROATIA',
    flagA: '🇦🇷',
    flagB: '🇭🇷',
    prediction: 'teamA',
    predictionLabel: 'Argentina Victory',
    amount: 1000,
    status: 'won',
    minute: 90,
    scoreA: 3,
    scoreB: 0,
    odds: 1.85,
    stadium: 'LUSAIL STADIUM',
    betTime: 'Bet Time: 12/13/2022'
  },
  {
    id: 'b_seed2',
    matchId: 'seed_m2',
    teamA: 'BRAZIL',
    teamB: 'CROATIA',
    flagA: '🇧🇷',
    flagB: '🇭🇷',
    prediction: 'teamA',
    predictionLabel: 'Brazil Victory',
    amount: 500,
    status: 'lost',
    minute: 90,
    scoreA: 1,
    scoreB: 1,
    odds: 1.65,
    stadium: 'EDUCATION CITY STADIUM',
    betTime: 'Bet Time: 12/09/2022'
  }
];
