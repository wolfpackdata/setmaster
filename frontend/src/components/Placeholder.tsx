/** Minimal placeholder body for screens delivered by a later build phase. */
export function Placeholder({
  title,
  phase,
  note,
}: {
  title: string;
  phase: string;
  note?: string;
}) {
  return (
    <div className="screen">
      <h1 className="screen-title">{title}</h1>
      <div className="panel" style={{ maxWidth: 520 }}>
        <p style={{ fontSize: "var(--type-body-size)", lineHeight: 1.5 }}>
          This screen arrives in <strong>{phase}</strong> of build&nbsp;#1.
        </p>
        {note && (
          <p className="small" style={{ marginTop: 8 }}>
            {note}
          </p>
        )}
      </div>
    </div>
  );
}
