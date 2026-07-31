/**
 * Local 16px stroke icons for the Exportify-loop screens (§10: single stroke
 * style, original vectors). Kept inside the workstream's own folder — the
 * shared Icon component is read-only for this phase.
 */

const svgProps = (size: number) =>
  ({
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.3,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  }) as const;

/** Matched: small check mark (green via currentColor). */
export function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...svgProps(size)}>
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}

/** No Traktor® match: stop-sign (octagon) icon — 16px stroke, not emoji. */
export function StopSignIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...svgProps(size)}>
      <polygon points="5.3,1.8 10.7,1.8 14.2,5.3 14.2,10.7 10.7,14.2 5.3,14.2 1.8,10.7 1.8,5.3" />
      <path d="M8 5v3.6" />
      <path d="M8 11v.2" />
    </svg>
  );
}

/** Normalize-conflict: alert triangle. */
export function ConflictIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...svgProps(size)}>
      <path d="M8 2.2 14.4 13.3H1.6Z" />
      <path d="M8 6.4v3" />
      <path d="M8 11.5v.2" />
    </svg>
  );
}

/** Reveal-in-file-manager action (S5 Local file column). */
export function RevealIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...svgProps(size)}>
      <path d="M2 4.5c0-.6.4-1 1-1h3l1.5 1.5H13c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1v-7.5Z" />
      <path d="M6 9.5h4M10 9.5 8.5 8M10 9.5 8.5 11" />
    </svg>
  );
}
