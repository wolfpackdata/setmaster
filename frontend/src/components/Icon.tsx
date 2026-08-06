/**
 * Minimal 16px stroke icon set (§10: single 16px stroke set, original
 * vectors — no NI assets). All icons inherit currentColor.
 */

import type { ReactElement } from "react";

const PATHS: Record<string, ReactElement> = {
  home: (
    <>
      <path d="M2.5 7.5 8 2.5l5.5 5" />
      <path d="M4 7v6.5h8V7" />
    </>
  ),
  matrix: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
      <path d="M2.5 6.5h11M6.5 2.5v11" />
    </>
  ),
  compare: (
    <>
      <path d="M2.5 5.5h9l-2-2M13.5 10.5h-9l2 2" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4" />
    </>
  ),
  help: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M6.2 6.2a1.9 1.9 0 1 1 2.6 1.9c-.6.3-.8.7-.8 1.3" />
      <path d="M8 11.4v.2" />
    </>
  ),
  folder: (
    <path d="M2 4.5c0-.6.4-1 1-1h3l1.5 1.5H13c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1v-7.5Z" />
  ),
  playlist: (
    <>
      <path d="M11.5 2.5v8" />
      <circle cx="9.7" cy="11" r="1.8" />
      <path d="M11.5 2.5 13 4" />
      <path d="M2.5 4h5M2.5 7h5M2.5 10h3" />
    </>
  ),
  archive: (
    <>
      <rect x="2" y="3" width="12" height="3" rx="0.5" />
      <path d="M3 6v6.5c0 .3.2.5.5.5h9c.3 0 .5-.2.5-.5V6" />
      <path d="M6.5 8.5h3" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  chevronLeft: <path d="M10 3 5 8l5 5" />,
  chevronRight: <path d="M6 3l5 5-5 5" />,
  external: (
    <>
      <path d="M6.5 3.5H3.5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9.5" />
      <path d="M9.5 2.5h4v4M13 3 8 8" />
    </>
  ),
  // Sliders/faders: adjustable comparison settings — distinct from the gear
  // (settings) and the swap arrows (compare).
  comparisonSettings: (
    <>
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
      <circle cx="5.5" cy="4.5" r="1.4" />
      <circle cx="10.5" cy="8" r="1.4" />
      <circle cx="6.5" cy="11.5" r="1.4" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
