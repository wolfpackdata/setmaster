/**
 * UI chrome state: sidebar collapse/width (persisted per user via
 * localStorage, §4) and the app-wide toast queue.
 */

import { create } from "zustand";

const SIDEBAR_KEY = "sm3.sidebar";

export const SIDEBAR_DEFAULT_WIDTH = 260;
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_RAIL_WIDTH = 48;

interface SidebarPersisted {
  collapsed: boolean;
  width: number;
}

function loadSidebar(): SidebarPersisted {
  try {
    const raw = localStorage.getItem(SIDEBAR_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SidebarPersisted>;
      return {
        collapsed: !!parsed.collapsed,
        width: Math.min(
          SIDEBAR_MAX_WIDTH,
          Math.max(SIDEBAR_MIN_WIDTH, parsed.width ?? SIDEBAR_DEFAULT_WIDTH),
        ),
      };
    }
  } catch {
    /* corrupted storage — fall through to defaults */
  }
  return { collapsed: false, width: SIDEBAR_DEFAULT_WIDTH };
}

function saveSidebar(state: SidebarPersisted): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
}

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface UiState {
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarWidth: (width: number) => void;

  toasts: Toast[];
  toast: (message: string, kind?: ToastKind) => void;
  dismissToast: (id: number) => void;
}

let nextToastId = 1;
const initialSidebar = loadSidebar();

export const useUiStore = create<UiState>((set, get) => ({
  sidebarCollapsed: initialSidebar.collapsed,
  sidebarWidth: initialSidebar.width,

  toggleSidebar: () => {
    const collapsed = !get().sidebarCollapsed;
    set({ sidebarCollapsed: collapsed });
    saveSidebar({ collapsed, width: get().sidebarWidth });
  },

  setSidebarCollapsed: (collapsed) => {
    set({ sidebarCollapsed: collapsed });
    saveSidebar({ collapsed, width: get().sidebarWidth });
  },

  setSidebarWidth: (width) => {
    const clamped = Math.min(
      SIDEBAR_MAX_WIDTH,
      Math.max(SIDEBAR_MIN_WIDTH, width),
    );
    set({ sidebarWidth: clamped });
    saveSidebar({ collapsed: get().sidebarCollapsed, width: clamped });
  },

  toasts: [],

  toast: (message, kind = "info") => {
    const id = nextToastId++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    window.setTimeout(() => get().dismissToast(id), 5000);
  },

  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
