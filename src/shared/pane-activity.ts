import type { AgentStatus } from "./protocol";

/**
 * The single source of truth for "this pane's agent is still busy".
 *
 * `blocked` means the agent stopped to ask the user something; the turn is not
 * over. Treating it as inactive made Chat collapse a running turn into
 * `Worked for` while the agent was still waiting for an answer (see
 * `.agents/tasks/20260917-worked-for-premature-group-bug.md`).
 *
 * It lives in `src/shared` because both the server and the web client need it
 * and because `src/server/index.ts` starts listening on import time, so a
 * predicate exported from there could never be unit-tested.
 */
export function isPaneActive(status: AgentStatus | null | undefined): boolean {
  return status === "working" || status === "blocked";
}
