// src/components/shared/Interactive3DCard.tsx
import React, { useState, useRef, useCallback } from 'react';

interface Interactive3DCardProps {
  children: React.ReactNode;
  className?: string;
  maxTilt?: number;
  glowColor?: string;
  enableGlow?: boolean;
  onClick?: () => void;
  tabIndex?: number;
  role?: string;
}

export const Interactive3DCard: React.FC<Interactive3DCardProps> = ({
  children,
  className = '',
  maxTilt = 6,
  glowColor = 'rgba(104, 157, 106, 0.12)', // Gruvbox Aqua soft glow
  enableGlow = true,
  onClick,
  tabIndex,
  role,
}) => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [transform, setTransform] = useState<string>(
    'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)'
  );
  const [boxShadow, setBoxShadow] = useState<string>(
    '0 2px 10px -2px rgba(40, 40, 40, 0.05)'
  );
  const [glarePosition, setGlarePosition] = useState<{ x: number; y: number; opacity: number }>({
    x: 50,
    y: 50,
    opacity: 0,
  });

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Disable tilt on touch devices for maximum mobile performance and zero lag
      if (typeof window !== 'undefined' && (window.innerWidth < 768 || window.matchMedia('(pointer: coarse)').matches)) {
        return;
      }

      const card = cardRef.current;
      if (!card) return;

      const rect = card.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;

      const xPct = (clientX / rect.width - 0.5) * 2;
      const yPct = (clientY / rect.height - 0.5) * 2;

      const rotX = -yPct * maxTilt;
      const rotY = xPct * maxTilt;

      setTransform(
        `perspective(1000px) rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg) scale3d(1.01, 1.01, 1.01)`
      );

      const shadowX = (-rotY * 1.5).toFixed(1);
      const shadowY = (rotX * 1.5 + 10).toFixed(1);
      setBoxShadow(
        `${shadowX}px ${shadowY}px 24px -4px rgba(40, 40, 40, 0.16), 0 0 16px ${glowColor}`
      );

      if (enableGlow) {
        setGlarePosition({
          x: (clientX / rect.width) * 100,
          y: (clientY / rect.height) * 100,
          opacity: 1,
        });
      }
    },
    [maxTilt, enableGlow, glowColor]
  );

  const handlePointerLeave = () => {
    setTransform('perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)');
    setBoxShadow('0 2px 10px -2px rgba(40, 40, 40, 0.05)');
    setGlarePosition((prev) => ({ ...prev, opacity: 0 }));
  };

  return (
    <div
      ref={cardRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onClick={onClick}
      tabIndex={tabIndex}
      role={role}
      style={{
        transform,
        boxShadow,
        transformStyle: 'preserve-3d',
        transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
      className={`relative overflow-hidden rounded-2xl will-change-transform ${className}`}
    >
      {/* Subtle Gruvbox Glare Overlay */}
      {enableGlow && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 transition-opacity duration-300 rounded-2xl hidden md:block"
          style={{
            opacity: glarePosition.opacity * 0.12,
            background: `radial-gradient(circle at ${glarePosition.x}% ${glarePosition.y}%, rgba(142, 192, 124, 0.4), transparent 60%)`,
          }}
        />
      )}

      {children}
    </div>
  );
};
