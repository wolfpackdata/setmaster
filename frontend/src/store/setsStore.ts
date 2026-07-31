/**
 * Sets store: the sidebar tree, S1 recents, and the archive view all read
 * from here so mutations (create / rename / duplicate / move / archive /
 * restore / delete) refresh every surface at once.
 */

import { create } from "zustand";
import {
  archiveSet,
  createSet,
  deleteSet,
  duplicateSet,
  listSets,
  patchSet,
  restoreSet,
  type SetMeta,
} from "../lib/api";

interface SetsState {
  sets: SetMeta[];
  archivedSets: SetMeta[];
  loaded: boolean;
  loadError: string | null;
  refresh: () => Promise<void>;
  create: (name: string, folder?: string) => Promise<SetMeta>;
  rename: (id: string, name: string) => Promise<void>;
  moveToFolder: (id: string, folder: string | null) => Promise<void>;
  duplicate: (id: string) => Promise<SetMeta>;
  archive: (id: string) => Promise<void>;
  restore: (id: string, newName?: string) => Promise<void>;
  deletePermanently: (id: string) => Promise<void>;
}

export const useSetsStore = create<SetsState>((set, get) => ({
  sets: [],
  archivedSets: [],
  loaded: false,
  loadError: null,

  refresh: async () => {
    try {
      const [active, archived] = await Promise.all([
        listSets(false),
        listSets(true),
      ]);
      set({
        sets: active,
        archivedSets: archived,
        loaded: true,
        loadError: null,
      });
    } catch (err) {
      set({
        loaded: true,
        loadError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  create: async (name, folder) => {
    const meta = await createSet(name, folder);
    await get().refresh();
    return meta;
  },

  rename: async (id, name) => {
    await patchSet(id, { name });
    await get().refresh();
  },

  moveToFolder: async (id, folder) => {
    await patchSet(id, { folder });
    await get().refresh();
  },

  duplicate: async (id) => {
    const meta = await duplicateSet(id);
    await get().refresh();
    return meta;
  },

  archive: async (id) => {
    await archiveSet(id);
    await get().refresh();
  },

  restore: async (id, newName) => {
    await restoreSet(id, newName);
    await get().refresh();
  },

  deletePermanently: async (id) => {
    await deleteSet(id);
    await get().refresh();
  },
}));

/** §4 set-naming rule: trimmed, non-empty, unique among active sets, ≤100 chars. */
export function validateSetName(
  name: string,
  activeSets: SetMeta[],
  ignoreId?: string,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Name cannot be empty.";
  if (trimmed.length > 100) return "Name must be 100 characters or fewer.";
  const collision = activeSets.some(
    (s) => s.id !== ignoreId && s.name === trimmed,
  );
  if (collision) return `A set named "${trimmed}" already exists.`;
  return null;
}
