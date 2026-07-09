import React from 'react';
import { 
  User, 
  Shield, 
  Zap, 
  Target, 
  Crown, 
  Sparkles, 
  Activity, 
  Compass, 
  Award,
  CircleDot
} from 'lucide-react';

interface PremiumAvatarProps {
  avatar: string; // Accepts emoji (like 🧑‍🎤) or a type name
  size?: 'sm' | 'md' | 'lg' | 'xl';
  glow?: boolean;
}

export default function PremiumAvatar({ avatar, size = 'md', glow = true }: PremiumAvatarProps) {
  // Determine icon and color scheme based on the avatar mapping
  let IconComponent = User;
  let colorClass = 'text-accent border-accent/30';
  let bgGradient = 'from-surface-raised to-bg';
  let glowStyle = '';

  // Mapping configurations
  const normalizedAvatar = avatar ? avatar.trim() : '';

  switch (normalizedAvatar) {
    case '🧑‍🎤': // Rockstar/Default Player
    case 'player':
      IconComponent = Crown;
      colorClass = 'text-accent border-accent/40';
      glowStyle = 'shadow-[0_0_12px_rgba(215,255,63,0.2)]';
      break;

    case '🧑‍✈️': // Pilot/GK
    case 'gk':
      IconComponent = Shield;
      colorClass = 'text-live border-live/40';
      glowStyle = 'shadow-[0_0_12px_rgba(20,240,240,0.2)]';
      break;

    case '👟': // Running shoe / Goldfoot
    case 'goldfoot':
      IconComponent = Zap;
      colorClass = 'text-amber-400 border-amber-500/40';
      glowStyle = 'shadow-[0_0_12px_rgba(245,158,11,0.2)]';
      break;

    case '🦁': // Lion / Netripper
    case 'netripper':
      IconComponent = Award;
      colorClass = 'text-blue-400 border-blue-500/40';
      glowStyle = 'shadow-[0_0_12px_rgba(59,130,246,0.2)]';
      break;

    case '🎯': // Target / Precision
    case 'precision':
      IconComponent = Target;
      colorClass = 'text-emerald-400 border-emerald-500/40';
      glowStyle = 'shadow-[0_0_12px_rgba(16,185,129,0.2)]';
      break;

    case '🧑‍🚀': // Astronaut / Goalgetter
    case 'goalgetter':
      IconComponent = Compass;
      colorClass = 'text-slate-300 border-slate-400/40';
      glowStyle = 'shadow-[0_0_12px_rgba(148,163,184,0.2)]';
      break;

    case '🤵': // Gentleman / Fairplay
    case 'fairplay':
      IconComponent = Sparkles;
      colorClass = 'text-purple-400 border-purple-500/40';
      glowStyle = 'shadow-[0_0_12px_rgba(168,85,247,0.2)]';
      break;

    case '👑': // Crown / Stadion King
    case 'stadion_king':
      IconComponent = Crown;
      colorClass = 'text-amber-300 border-amber-400/50';
      glowStyle = 'shadow-[0_0_12px_rgba(251,191,36,0.25)]';
      break;

    case '🧔': // Beard / Bkoofid
    case 'bkoofid':
      IconComponent = User;
      colorClass = 'text-red-400 border-red-500/40';
      glowStyle = 'shadow-[0_0_12px_rgba(239,68,68,0.2)]';
      break;

    case '🧑‍🦱': // Curly hair / Halmor
    case 'halmor':
      IconComponent = Activity;
      colorClass = 'text-teal-400 border-teal-500/40';
      glowStyle = 'shadow-[0_0_12px_rgba(20,184,166,0.2)]';
      break;

    case '⚡': // Lightning / StrikerSpecialist
    case 'striker':
      IconComponent = Zap;
      colorClass = 'text-orange-400 border-orange-500/40';
      glowStyle = 'shadow-[0_0_12px_rgba(249,115,22,0.2)]';
      break;

    case '⚽': // Soccer ball / TikiTaka
    case 'tikitaka':
      IconComponent = CircleDot;
      colorClass = 'text-sky-400 border-sky-500/40';
      glowStyle = 'shadow-[0_0_12px_rgba(14,165,233,0.2)]';
      break;

    default:
      IconComponent = User;
      colorClass = 'text-text-dim border-border-main';
      glowStyle = '';
      break;
  }

  // Dimension classes
  let sizeClass = 'w-10 h-10';
  let iconSizeClass = 'w-5 h-5';
  
  if (size === 'sm') {
    sizeClass = 'w-8 h-8';
    iconSizeClass = 'w-4 h-4';
  } else if (size === 'lg') {
    sizeClass = 'w-12 h-12';
    iconSizeClass = 'w-6.5 h-6.5';
  } else if (size === 'xl') {
    sizeClass = 'w-20 h-20';
    iconSizeClass = 'w-10 h-10';
  }

  return (
    <div className={`relative flex items-center justify-center ${sizeClass} rounded-full bg-gradient-to-b ${bgGradient} border-2 ${colorClass} ${glow ? glowStyle : ''} overflow-hidden`}>
      {/* Tactical UI Grid overlay for high-tech luxury feel */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.07] pointer-events-none stroke-current" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="46" fill="none" strokeWidth="1" />
        <circle cx="50" cy="50" r="32" fill="none" strokeWidth="1" strokeDasharray="3 3" />
        <line x1="50" y1="0" x2="50" y2="100" strokeWidth="1" />
        <line x1="0" y1="50" x2="100" y2="50" strokeWidth="1" />
      </svg>
      
      {/* Inner Icon */}
      <IconComponent className={`${iconSizeClass} stroke-[1.25] relative z-10 transition-transform duration-300 hover:scale-110`} />
    </div>
  );
}
