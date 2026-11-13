// src/components/shared/DhrishyamLogo.tsx
import React from 'react';
import emblemDark from '../../assets/dhrishyam-emblem-dark.png';
import emblemLight from '../../assets/dhrishyam-emblem-light.png';

interface DhrishyamLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showWordmark?: boolean;
  className?: string;
}

export const DhrishyamLogo: React.FC<DhrishyamLogoProps> = ({
  size = 'md',
  showWordmark = true,
  className = '',
}) => {
  const containerSizeMap = {
    sm: 'w-8 h-8 rounded-lg',
    md: 'w-10 h-10 rounded-xl',
    lg: 'w-14 h-14 rounded-2xl',
    xl: 'w-20 h-20 rounded-3xl',
  };

  const imageSizeMap = {
    sm: 'w-5 h-5',
    md: 'w-7 h-7',
    lg: 'w-10 h-10',
    xl: 'w-14 h-14',
  };

  const textSizeMap = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-2xl',
    xl: 'text-3xl',
  };

  return (
    <div className={`flex items-center gap-3 select-none group cursor-pointer ${className}`}>
      {/* Precision Emblem Frame with tactile depth */}
      <div
        className={`relative ${containerSizeMap[size]} flex items-center justify-center bg-white dark:bg-[#32302f] border border-[#e2ded5] dark:border-[#3c3836] shadow-xs group-hover:border-[#36755a] dark:group-hover:border-[#8ec07c] group-hover:shadow-sm transition-all duration-200 overflow-hidden shrink-0`}
      >
        {/* Dark emblem in light mode */}
        <img
          src={emblemDark}
          alt="Dhrishyam"
          className={`${imageSizeMap[size]} object-contain block dark:hidden group-hover:scale-105 transition-transform duration-300 ease-out`}
        />
        {/* Luminous warm cream emblem in dark mode */}
        <img
          src={emblemLight}
          alt="Dhrishyam"
          className={`${imageSizeMap[size]} object-contain hidden dark:block group-hover:scale-105 transition-transform duration-300 ease-out`}
        />
        {/* Subtle ambient light glow on hover */}
        <div className="absolute inset-0 bg-gradient-to-tr from-[#36755a]/10 dark:from-[#8ec07c]/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
      </div>

      {showWordmark && (
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`font-serif font-bold tracking-tight text-[#282828] dark:text-[#fbf1c7] ${textSizeMap[size]} leading-none group-hover:text-[#36755a] dark:group-hover:text-[#8ec07c] transition-colors`}
            >
              Dhrishyam
            </span>
            <span className="text-[10px] font-sans font-medium px-2 py-0.5 rounded-md bg-[#edeae1] dark:bg-[#3c3836] text-[#4a4440] dark:text-[#ebdbb2] border border-[#ded9ce] dark:border-[#504945] leading-none">
              Console
            </span>
          </div>
          <span className="text-[11px] font-sans text-[#706860] dark:text-[#a89984] mt-1 leading-none truncate">
            Brand & Editorial Governance
          </span>
        </div>
      )}
    </div>
  );
};
