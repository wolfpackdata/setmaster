import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { ToastHost } from "../components/ToastHost";
import { useSettingsStore } from "../store/settingsStore";

const TOO_SMALL_QUERY = "(max-width: 1023px)";

/** App shell (§4): persistent sidebar + main content pane. */
export function Layout() {
  const load = useSettingsStore((s) => s.load);
  const [tooSmall, setTooSmall] = useState(
    () => window.matchMedia(TOO_SMALL_QUERY).matches,
  );

  useEffect(() => {
    void load();
  }, [load]);

  // §8: <1024px is out of scope for v1 — show a notice, not a broken layout.
  useEffect(() => {
    const mql = window.matchMedia(TOO_SMALL_QUERY);
    const onChange = (e: MediaQueryListEvent) => setTooSmall(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  if (tooSmall) {
    return (
      <div className="too-small">
        <div className="panel too-small__panel">
          <h1 className="section-heading" style={{ color: "var(--brand-purple)" }}>
            RML SetMaster
          </h1>
          <p style={{ fontSize: "var(--type-body-size)", lineHeight: 1.5 }}>
            SetMaster works best on a larger screen. Please widen the window
            or use a display at least 1024px wide.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <Sidebar />
      <main className="shell__main">
        <Outlet />
      </main>
      <ToastHost />
    </div>
  );
}
