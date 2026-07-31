/** Shared date/time formatting helpers. */

/** SM2 chip style (§5.1): `07-06-2026 12:24 PM`. */
export function fmtChipDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd}-${yyyy} ${h}:${min} ${ampm}`;
}

/** Locale-friendly full date/time for secondary metadata. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "---";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}

/** Relative "x minutes/hours/days ago" for recents. */
export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "---";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `${days} day${days === 1 ? "" : "s"} ago`;
  return d.toLocaleDateString();
}
