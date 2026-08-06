/**
 * S3-local 16px stroke icons, matching the shared Icon.tsx style (original
 * vectors, currentColor). Local because shared components are frozen for this
 * workstream — kept visually identical (1.3 stroke, round caps).
 */

import type { ReactElement } from "react";

const PATHS: Record<string, ReactElement> = {
  funnel: (
    <path d="M2.5 3.5h11l-4.2 5v4l-2.6 1v-5l-4.2-5Z" />
  ),
  funnelOff: (
    <>
      <path d="M2.5 3.5h11l-4.2 5v4l-2.6 1v-5l-4.2-5Z" />
      <path d="M2 14 14 2" />
    </>
  ),
  columns: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
      <path d="M6.2 2.5v11M9.8 2.5v11" />
    </>
  ),
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  pencil: (
    <>
      <path d="M11 2.5 13.5 5 5.5 13H3v-2.5L11 2.5Z" />
      <path d="M9.5 4 12 6.5" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2 13.5 13.5" />
    </>
  ),
  grip: (
    <path d="M6 4h.01M6 8h.01M6 12h.01M10 4h.01M10 8h.01M10 12h.01" strokeWidth="1.8" />
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.2v3.6M8 5.1v.01" />
    </>
  ),
  list: (
    <>
      <path d="M6 4h7.5M6 8h7.5M6 12h7.5" />
      <path d="M2.6 4h.01M2.6 8h.01M2.6 12h.01" strokeWidth="1.8" />
    </>
  ),
  download: (
    <>
      <path d="M8 2.5v7.5M4.8 7l3.2 3 3.2-3" />
      <path d="M2.75 12.5v1h10.5v-1" />
    </>
  ),
};

export type MatrixIconName = keyof typeof PATHS;

export function MatrixIcon({
  name,
  size = 16,
}: {
  name: MatrixIconName;
  size?: number;
}) {
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
