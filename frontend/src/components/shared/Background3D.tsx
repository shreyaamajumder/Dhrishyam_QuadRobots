// src/components/shared/Background3D.tsx
import React, { useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';

export const Background3D: React.FC = () => {
  const { theme } = useApp();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    // Detect low-power or mobile screens: completely skip continuous canvas loops on mobile for maximum battery & 60fps speed
    const isMobile = typeof window !== 'undefined' && (window.innerWidth < 768 || window.matchMedia('(pointer: coarse)').matches);
    if (isMobile) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let animationFrameId: number;
    let width = 0;
    let height = 0;
    let mouseX = window.innerWidth * 0.5;
    let mouseY = window.innerHeight * 0.3;
    let targetX = mouseX;
    let targetY = mouseY;
    let idleTimeout: number | undefined = undefined;

    const handleResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    const onMouseMove = (e: MouseEvent) => {
      targetX = e.clientX;
      targetY = e.clientY;
      window.clearTimeout(idleTimeout);
    };

    window.addEventListener('mousemove', onMouseMove, { passive: true });

    const isDark = theme === 'dark';

    // Ultra-lightweight ambient lighting renderer (only executes when cursor moves or gently settles)
    const drawAmbient = () => {
      // Smooth interpolation
      mouseX += (targetX - mouseX) * 0.05;
      mouseY += (targetY - mouseY) * 0.05;

      ctx.clearRect(0, 0, width, height);

      // Subtle, tasteful warm Gruvbox ambient light pool (no sci-fi HUD, no reticle, no text overlap)
      const grad = ctx.createRadialGradient(
        mouseX,
        mouseY,
        40,
        mouseX,
        mouseY,
        Math.max(width, height) * 0.6
      );

      if (isDark) {
        // Gruvbox Dark: warm aqua & slate blue ambient caustics
        grad.addColorStop(0, 'rgba(142, 192, 124, 0.04)'); // Gruvbox Aqua #8ec07c
        grad.addColorStop(0.4, 'rgba(131, 165, 152, 0.02)'); // Gruvbox Blue #83a598
        grad.addColorStop(1, 'rgba(29, 32, 33, 0)');
      } else {
        // Gruvbox Light: neutral stone ambient slate aqua (Zero Yellow)
        grad.addColorStop(0, 'rgba(104, 157, 106, 0.035)'); // Gruvbox Aqua #689d6a
        grad.addColorStop(0.4, 'rgba(69, 133, 136, 0.015)'); // Gruvbox Blue #458588
        grad.addColorStop(1, 'rgba(245, 245, 243, 0)');
      }

      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      animationFrameId = requestAnimationFrame(drawAmbient);
    };

    drawAmbient();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.clearTimeout(idleTimeout);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [theme]);

  const isDark = theme === 'dark';

  return (
    <div
      aria-hidden="true"
      className={`fixed inset-0 pointer-events-none z-0 overflow-hidden select-none transition-colors duration-200 ${
        isDark ? 'bg-[#1d2021]' : 'bg-[#f5f5f3]'
      }`}
    >
      {/* Subtle Gruvbox static ambient depth gradient (ultra-performant across all low-end smartphones) */}
      <div
        className={`absolute inset-0 transition-opacity duration-300 ${
          isDark
            ? 'bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(142,192,124,0.05),transparent_70%),radial-gradient(ellipse_60%_50%_at_80%_90%,rgba(131,165,152,0.03),transparent_60%)]'
            : 'bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(104,157,106,0.04),transparent_70%),radial-gradient(ellipse_60%_50%_at_80%_90%,rgba(69,133,136,0.03),transparent_60%)]'
        }`}
      />

      {/* Gentle analog tactile paper grain */}
      <div className="absolute inset-0 bg-noise opacity-30 mix-blend-multiply dark:mix-blend-screen pointer-events-none" />

      {/* Desktop dynamic canvas (inactive on mobile) */}
      <canvas
        ref={canvasRef}
        className="w-full h-full block hidden md:block"
      />
    </div>
  );
};
