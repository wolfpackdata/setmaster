/**
 * Color math for the derived key-color contrast rule (03-ui-design.md §9):
 * palette entries that fail 4.5:1 on --bg-row are lightened at render time to
 * the minimum lightness that passes, preserving hue. The §3.1 palette table
 * stays canonical; the adjusted variants are derived here, never hand-picked.
 */

export interface RGB {
  r: number; // 0-255
  g: number;
  b: number;
}

export interface HSL {
  h: number; // 0-360
  s: number; // 0-1
  l: number; // 0-1
}

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Invalid hex color: ${hex}`);
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const to2 = (n: number) => n.toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case rn:
        h = 60 * (((gn - bn) / d) % 6);
        break;
      case gn:
        h = 60 * ((bn - rn) / d + 2);
        break;
      default:
        h = 60 * ((rn - gn) / d + 4);
    }
  }
  if (h < 0) h += 360;
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rn = 0;
  let gn = 0;
  let bn = 0;
  if (hp < 1) [rn, gn, bn] = [c, x, 0];
  else if (hp < 2) [rn, gn, bn] = [x, c, 0];
  else if (hp < 3) [rn, gn, bn] = [0, c, x];
  else if (hp < 4) [rn, gn, bn] = [0, x, c];
  else if (hp < 5) [rn, gn, bn] = [x, 0, c];
  else [rn, gn, bn] = [c, 0, x];
  const m = l - c / 2;
  return {
    r: Math.round((rn + m) * 255),
    g: Math.round((gn + m) * 255),
    b: Math.round((bn + m) * 255),
  };
}

/** WCAG relative luminance. */
export function relativeLuminance({ r, g, b }: RGB): number {
  const chan = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

/** WCAG contrast ratio between two colors (order-independent). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(hexToRgb(a));
  const lb = relativeLuminance(hexToRgb(b));
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Lighten `hex` (preserving hue and saturation) to the minimum HSL lightness
 * at which it reaches `minRatio` contrast against `background`. Colors that
 * already pass are returned unchanged.
 */
export function ensureContrast(
  hex: string,
  background: string,
  minRatio = 4.5,
): string {
  if (contrastRatio(hex, background) >= minRatio) {
    return rgbToHex(hexToRgb(hex)); // normalized form
  }
  const hsl = rgbToHsl(hexToRgb(hex));
  // Binary search the minimum lightness that passes (contrast against a dark
  // background is monotonic in lightness).
  let lo = hsl.l;
  let hi = 1;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    const candidate = rgbToHex(hslToRgb({ ...hsl, l: mid }));
    if (contrastRatio(candidate, background) >= minRatio) hi = mid;
    else lo = mid;
  }
  // Round up: take hi and step until rounding artifacts cannot dip below.
  let result = rgbToHex(hslToRgb({ ...hsl, l: hi }));
  let l = hi;
  while (contrastRatio(result, background) < minRatio && l < 1) {
    l = Math.min(1, l + 0.002);
    result = rgbToHex(hslToRgb({ ...hsl, l }));
  }
  return result;
}
