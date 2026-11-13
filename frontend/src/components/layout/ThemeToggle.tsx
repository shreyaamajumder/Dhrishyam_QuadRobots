// src/components/layout/ThemeToggle.tsx
import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useApp } from '../../context/AppContext';

interface ThemeToggleProps {
  className?: string;
  showLabel?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = '', showLabel = false }) => {
  const { theme, toggleTheme } = useApp();
  const isDark = theme === 'dark';

  if (showLabel) {
    return (
      <div
        role="group"
        aria-label="Color theme switcher"
        className={`inline-flex items-center p-1 rounded-xl bg-[#edeae1] dark:bg-[#1d2021] border border-[#ded9ce] dark:border-[#3c3836] shadow-2xs select-none ${className}`}
      >
        <button
          type="button"
          onClick={() => isDark && toggleTheme()}
          aria-pressed={!isDark}
          aria-label="Switch to Light Theme"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-sans transition-all duration-150 cursor-pointer ${
            !isDark
              ? 'bg-white text-[#282828] font-semibold shadow-xs'
              : 'text-[#706860] hover:text-[#282828] font-medium'
          }`}
        >
          <Sun className={`w-3.5 h-3.5 ${!isDark ? 'text-[#af3a03]' : ''}`} />
          <span>Light</span>
        </button>

        <button
          type="button"
          onClick={() => !isDark && toggleTheme()}
          aria-pressed={isDark}
          aria-label="Switch to Dark Theme"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-sans transition-all duration-150 cursor-pointer ${
            isDark
              ? 'bg-[#32302f] text-[#fbf1c7] font-semibold shadow-xs'
              : 'text-[#a89984] hover:text-white font-medium'
          }`}
        >
          <Moon className={`w-3.5 h-3.5 ${isDark ? 'text-[#8ec07c]' : ''}`} />
          <span>Dark</span>
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to Light theme' : 'Switch to Dark theme'}
      title={isDark ? 'Switch to Light theme' : 'Switch to Dark theme'}
      className={`relative inline-flex items-center justify-center w-8 h-8 rounded-xl bg-white dark:bg-[#32302f] hover:bg-[#edeae1] dark:hover:bg-[#3c3836] border border-[#ded9ce] dark:border-[#3c3836] text-[#282828] dark:text-[#ebdbb2] transition-all cursor-pointer shadow-2xs active:scale-95 ${className}`}
    >
      <div className="relative w-4 h-4 flex items-center justify-center">
        {isDark ? (
          <Moon className="w-3.5 h-3.5 text-[#8ec07c] transition-transform duration-200" />
        ) : (
          <Sun className="w-3.5 h-3.5 text-[#af3a03] transition-transform duration-200" />
        )}
      </div>
    </button>
  );
};
