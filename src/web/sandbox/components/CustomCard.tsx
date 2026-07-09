import React from "react";
import { CheckCircle2, ChevronRight } from "lucide-react";

interface CustomCardProps {
  title: string;
  description: string;
  badge?: string;
  onClick?: () => void;
}

/**
 * CustomCard - A sample reusable component for your sandbox playground.
 * Built with Tailwind CSS, custom theme variables, and an elegant clipped-corner cut.
 */
export function CustomCard({ title, description, badge, onClick }: CustomCardProps) {
  return (
    <div 
      onClick={onClick}
      className="group relative bg-surface border border-border-main p-5 rounded-xl clip-cut hover:border-accent transition-all cursor-pointer select-none"
    >
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-surface-raised border border-border-main flex items-center justify-center text-accent group-hover:bg-accent group-hover:text-bg transition-all">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div>
            <h4 className="font-sans font-bold text-sm text-text leading-tight group-hover:text-accent transition-colors">
              {title}
            </h4>
            {badge && (
              <span className="inline-block mt-1 text-[10px] font-bold text-live uppercase tracking-wider">
                {badge}
              </span>
            )}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-text-dim group-hover:text-accent group-hover:translate-x-1 transition-all" />
      </div>
      
      <p className="text-text-dim text-xs leading-relaxed pl-10">
        {description}
      </p>
    </div>
  );
}
