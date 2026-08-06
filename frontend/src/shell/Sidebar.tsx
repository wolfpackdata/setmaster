import { useCallback, useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import {
  SIDEBAR_RAIL_WIDTH,
  useUiStore,
} from "../store/uiStore";
import { Icon, type IconName } from "../components/Icon";
import { SetsSection } from "./SetsSection";
import rmlMark from "../assets/rml-mark.svg";

const NAV_ITEMS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/", label: "Home", icon: "home", end: true },
  { to: "/matrix", label: "Track-Playlist Matrix", icon: "matrix" },
  {
    to: "/comparison-settings",
    label: "Spotify®-Traktor® Comparison Settings",
    icon: "comparisonSettings",
  },
  { to: "/compare", label: "Playlist Compare Tool", icon: "compare" },
];

const BOTTOM_ITEMS: { to: string; label: string; icon: IconName }[] = [
  { to: "/settings", label: "Settings", icon: "settings" },
  { to: "/help", label: "Help", icon: "help" },
];

/**
 * App-shell sidebar (§4): 260px, drag-resizable, collapsible to a 48px icon
 * rail via the always-visible toggle beside the lockup or Ctrl/Cmd+B.
 * State persists per user (localStorage). The RML lockup is static chrome —
 * mark + wordmark re-set in the web type stack; collapsed rail shows the
 * mark alone (§1.3.4).
 */
export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const width = useUiStore((s) => s.sidebarWidth);
  const toggle = useUiStore((s) => s.toggleSidebar);
  const setWidth = useUiStore((s) => s.setSidebarWidth);
  const setCollapsed = useUiStore((s) => s.setSidebarCollapsed);
  const dragging = useRef(false);

  // §8: 1024–1439px auto-collapses the sidebar to the icon rail. The user
  // can still expand manually; growing past 1440 restores only auto-collapses.
  const autoCollapsed = useRef(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 1439px)");
    const apply = (matches: boolean) => {
      const state = useUiStore.getState();
      if (matches && !state.sidebarCollapsed) {
        autoCollapsed.current = true;
        state.setSidebarCollapsed(true);
      } else if (!matches && autoCollapsed.current) {
        autoCollapsed.current = false;
        useUiStore.getState().setSidebarCollapsed(false);
      }
    };
    apply(mql.matches);
    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // Ctrl/Cmd+B toggles (§4).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        if (ev.clientX < 120) {
          setCollapsed(true);
        } else {
          setCollapsed(false);
          setWidth(ev.clientX);
        }
      };
      const onUp = () => {
        dragging.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [setCollapsed, setWidth],
  );

  return (
    <aside
      className={`sidebar${collapsed ? " sidebar--collapsed" : ""}`}
      style={{ width: collapsed ? SIDEBAR_RAIL_WIDTH : width }}
      aria-label="Navigation sidebar"
    >
      <div className="sidebar__header">
        <img src={rmlMark} alt="RML" className="sidebar__mark" draggable={false} />
        {!collapsed && (
          <span className="sidebar__wordmark">
            <span className="rml">RML</span>{" "}
            <span className="setmaster">SetMaster</span>
          </span>
        )}
        <button
          type="button"
          className="sidebar__collapse"
          onClick={toggle}
          title={`${collapsed ? "Expand" : "Collapse"} sidebar (Ctrl/Cmd+B)`}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={14} />
        </button>
      </div>

      <nav className="sidebar__nav">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `sidebar__item${isActive ? " active" : ""}`
            }
            title={item.label}
          >
            <Icon name={item.icon} />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {!collapsed && <SetsSection />}
      {collapsed && <div style={{ flex: 1 }} />}

      <div className="sidebar__bottom">
        {BOTTOM_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `sidebar__item${isActive ? " active" : ""}`
            }
            title={item.label}
          >
            <Icon name={item.icon} />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </div>

      {!collapsed && (
        <div
          className="sidebar__resize"
          onMouseDown={onResizeStart}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
        />
      )}
    </aside>
  );
}
