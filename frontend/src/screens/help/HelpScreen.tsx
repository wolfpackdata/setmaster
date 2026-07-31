import { useMemo, useState } from "react";
import { FAQ_ENTRIES } from "./faqContent";

/** §1.3.3 attribution/disclaimer line — exact wording, do not edit. */
const ATTRIBUTION =
  "SetMaster 3 is independent fan software and is not affiliated with, endorsed by, or sponsored by Native Instruments®, Spotify®, or Exportify. Traktor® is a registered trademark of Native Instruments GmbH. Spotify® is a registered trademark of Spotify AB.";

/**
 * S7 — Help / Reference (03-ui-design.md §5.7): searchable FAQ (SM2 FAQ text
 * with the §1.3.2 ® rule applied — see faqContent.ts) + the annotated example
 * set section (placeholder card; phase 3 delivers the real S2 grid with coach
 * marks). Footer carries the §1.3.3 attribution line.
 */
export default function HelpScreen() {
  const [query, setQuery] = useState("");

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FAQ_ENTRIES;
    return FAQ_ENTRIES.filter(
      (e) =>
        e.question.toLowerCase().includes(q) ||
        e.answer.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div className="screen">
      <h1 className="screen-title">Help &amp; Reference</h1>

      <div className="help">
        <input
          className="input"
          style={{ maxWidth: 360, marginBottom: 20 }}
          placeholder="Search the FAQ…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search the FAQ"
        />

        {entries.length === 0 && (
          <p className="small">No FAQ entries match “{query}”.</p>
        )}

        {entries.map((entry) => (
          <article key={entry.id} id={entry.id} className="faq__entry">
            <h2 className="faq__question">
              <span aria-hidden>🎧</span> {entry.question}
            </h2>
            <div className="faq__answer">{entry.answer}</div>
          </article>
        ))}

        {/* Annotated example set — phase 3 delivers the real S2 grid with
            dismissible coach marks reproducing the SM2 help sheet's yellow
            annotation boxes (column meanings, the transition-event reading,
            the pro tip). */}
        <section className="panel" style={{ marginTop: 28, maxWidth: 640 }}>
          <h2
            className="section-heading"
            style={{ color: "var(--brand-coral)" }}
          >
            Annotated example set
          </h2>
          <p style={{ fontSize: "var(--type-body-size)", lineHeight: 1.5 }}>
            A real example set with callouts explaining every column — what
            T&nbsp;#, M&nbsp;#, Lows, Level and Swap Lows mean, how a
            transition row reads left-to-right, and the pro tip for scanning a
            line live — arrives in <strong>phase 3</strong> of build&nbsp;#1.
          </p>
        </section>

        <footer className="help__footer small">{ATTRIBUTION}</footer>
      </div>
    </div>
  );
}
