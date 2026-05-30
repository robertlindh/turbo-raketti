/// <reference types="vite/client" />

// Build identifiers injected by Vite at compile time. The GitHub Actions
// workflow passes its `run_number` (auto-incremented per deploy) and the
// commit SHA as VITE_BUILD_NUMBER / VITE_BUILD_SHA env vars, so each
// production build ends up stamped with a unique version. Local dev gets
// the placeholders "dev" / "local".

const envNumber = (import.meta.env as Record<string, string | undefined>)
  .VITE_BUILD_NUMBER;
const envSha = (import.meta.env as Record<string, string | undefined>)
  .VITE_BUILD_SHA;

export const BUILD_NUMBER: string = envNumber ?? "dev";
export const BUILD_SHA: string = envSha ? envSha.slice(0, 7) : "local";
