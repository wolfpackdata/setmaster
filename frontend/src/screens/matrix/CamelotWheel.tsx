/**
 * Camelot wheel key selector (track-playlist-matrix.md §5 line 3, decision
 * §11.6): two-ring wheel — outer major (B ring) / inner minor (A ring) —
 * each of the 24 segments a toggle, tinted with the key's `load`-tab palette
 * color. Labels follow the global Key Display As notation. Segments are
 * mouse/touch targets excluded from the drawer's Tab order (explicit §5
 * keyboard requirement: Tab visits text-editable fields only).
 */

import { useMemo } from "react";
import { KEY_TABLE, formatKey, type KeyNotation } from "../../lib/keys";
import { KEY_COLORS } from "../../lib/palette";
import type { CanonicalKey } from "../../lib/keys";

const SIZE = 232;
const C = SIZE / 2;
const R_OUTER = 112;
const R_MID = 74;
const R_INNER = 38;

interface Segment {
  key: CanonicalKey;
  path: string;
  labelX: number;
  labelY: number;
  color: string;
}

function polar(r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [C + r * Math.cos(rad), C + r * Math.sin(rad)];
}

function sectorPath(r0: number, r1: number, a0: number, a1: number): string {
  const [x0, y0] = polar(r1, a0);
  const [x1, y1] = polar(r1, a1);
  const [x2, y2] = polar(r0, a1);
  const [x3, y3] = polar(r0, a0);
  return [
    `M ${x0.toFixed(2)} ${y0.toFixed(2)}`,
    `A ${r1} ${r1} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `L ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `A ${r0} ${r0} 0 0 0 ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    "Z",
  ].join(" ");
}

function buildSegments(): Segment[] {
  const segments: Segment[] = [];
  for (let n = 1; n <= 12; n++) {
    // 12 at the top, numbers increasing clockwise; each wedge spans 30°.
    const mid = (n % 12) * 30 - 90;
    const a0 = mid - 15;
    const a1 = mid + 15;
    const major = KEY_TABLE.find((r) => r.camelot === `${n}B`);
    const minor = KEY_TABLE.find((r) => r.camelot === `${n}A`);
    if (major) {
      const [lx, ly] = polar((R_MID + R_OUTER) / 2, mid);
      segments.push({
        key: major.flats,
        path: sectorPath(R_MID, R_OUTER, a0, a1),
        labelX: lx,
        labelY: ly,
        color: KEY_COLORS[major.flats].hex,
      });
    }
    if (minor) {
      const [lx, ly] = polar((R_INNER + R_MID) / 2, mid);
      segments.push({
        key: minor.flats,
        path: sectorPath(R_INNER, R_MID, a0, a1),
        labelX: lx,
        labelY: ly,
        color: KEY_COLORS[minor.flats].hex,
      });
    }
  }
  return segments;
}

export function CamelotWheel({
  selected,
  onToggle,
  notation,
  disabled,
}: {
  selected: readonly string[];
  onToggle: (key: CanonicalKey) => void;
  notation: KeyNotation;
  disabled?: boolean;
}) {
  const segments = useMemo(buildSegments, []);
  const sel = useMemo(() => new Set(selected), [selected]);

  return (
    <svg
      className={`mx-wheel${disabled ? " mx-wheel--disabled" : ""}`}
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="group"
      aria-label="Keys to show — Camelot wheel"
    >
      {segments.map((s) => {
        const on = sel.has(s.key);
        return (
          <g
            key={s.key}
            className={`mx-wheel__seg${on ? " mx-wheel__seg--on" : ""}`}
            tabIndex={-1}
            role="checkbox"
            aria-checked={on}
            aria-label={formatKey(s.key, notation)}
            onClick={() => !disabled && onToggle(s.key)}
          >
            <path
              d={s.path}
              fill={s.color}
              fillOpacity={on ? 0.95 : 0.13}
              stroke="var(--border-subtle)"
              strokeWidth="1"
            />
            <text
              x={s.labelX}
              y={s.labelY}
              textAnchor="middle"
              dominantBaseline="central"
              fill={on ? "#000" : "var(--text-secondary)"}
              fontSize="10"
              fontWeight={on ? 700 : 500}
              style={{ pointerEvents: "none", fontVariantNumeric: "tabular-nums" }}
            >
              {formatKey(s.key, notation)}
            </text>
          </g>
        );
      })}
      <circle cx={C} cy={C} r={R_INNER - 4} fill="var(--bg-input)" stroke="var(--border-subtle)" />
      <text
        x={C}
        y={C}
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--text-secondary)"
        fontSize="11"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {sel.size}/24
      </text>
    </svg>
  );
}
