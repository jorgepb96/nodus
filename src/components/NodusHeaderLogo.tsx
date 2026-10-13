import { useId, type HTMLAttributes } from 'react';
import geometry from '@shared/nodusMark.json';

/** Keep the vault artwork for the default palette and use live theme tokens otherwise. */
export function NodusHeaderLogo({ src, className = '', ...props }: HTMLAttributes<HTMLSpanElement> & { src: string }) {
  const id = useId();
  const gradientId = `${id}-mark`;
  const shadowId = `${id}-shadow`;
  const { viewBoxSize, leftX, rightX, topY, bottomY, strokeWidth, nodeRadius, gradient } = geometry;
  return (
    <span {...props} className={`nodus-header-logo ${className}`} aria-hidden="true">
      <img src={src} alt="" className="nodus-header-logo-vault" />
      <svg className="nodus-header-logo-theme" viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}>
        <defs>
          <linearGradient id={gradientId} {...gradient} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--chrome-accent-300)" />
            <stop offset="0.45" stopColor="var(--chrome-accent-400)" />
            <stop offset="1" stopColor="var(--chrome-accent-600)" />
          </linearGradient>
          <filter id={shadowId} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="1.8" floodColor="var(--n-950)" floodOpacity="0.35" />
          </filter>
        </defs>
        <g filter={`url(#${shadowId})`}>
          <path d={`M${leftX} ${bottomY}V${topY}L${rightX} ${bottomY}V${topY}`} fill="none" stroke={`url(#${gradientId})`} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={leftX} cy={topY} r={nodeRadius} fill="var(--chrome-accent-300)" />
          <circle cx={leftX} cy={bottomY} r={nodeRadius} fill="var(--chrome-accent-400)" />
          <circle cx={rightX} cy={bottomY} r={nodeRadius} fill="var(--chrome-accent-500)" />
          <circle cx={rightX} cy={topY} r={nodeRadius} fill="var(--chrome-accent-600)" />
        </g>
      </svg>
    </span>
  );
}
