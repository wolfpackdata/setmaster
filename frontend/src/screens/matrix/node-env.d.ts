/**
 * Minimal ambient Node declarations for the matrix real-data test harness
 * (realdata.test.ts). The app tsconfig (shared, frozen for this workstream)
 * carries no @types/node; vitest executes tests in a Node environment where
 * these APIs exist. Only what the harness uses is declared.
 */

declare module "node:fs" {
  export function readFileSync(path: string, encoding: string): string;
  export function existsSync(path: string): boolean;
}

declare const process: { env: Record<string, string | undefined> };
