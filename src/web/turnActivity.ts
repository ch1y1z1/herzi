import { useRef } from "react";

import { isPaneActive } from "../shared/pane-activity";
import type {
  AgentStatus,
  ChatMessage,
  ChatRealtimeStatus,
} from "../shared/protocol";

/**
 * Monotone ("sticky") running judgement for the latest assistant turn.
 *
 * The old judgement was one boolean per render — `running === false` collapsed
 * the whole turn into `Worked for` immediately — and every source behind that
 * boolean can produce a false negative (see
 * `.agents/tasks/20260917-worked-for-premature-group-bug.md`):
 *
 * - `pane.agentStatus === "blocked"` used to mean "not running", although the
 *   agent is only waiting for the user;
 * - `realtime.status` is `idle` both before the first bridge status event and
 *   after a `session` reset, not only after `agent_settled`;
 * - a turn in the gap between two model outputs has no `{type:"running"}`
 *   message, and a persisted transcript never has one.
 *
 * The judgement is therefore fail-open in one direction only: **any** source
 * can keep the latest turn running, and the turn is only released when every
 * source agrees it is idle *and* the pane is not reported active. The sticky
 * marker records that release per turn: a turn that was observed running stays
 * marked until a unanimous idle is observed, while a turn that was never
 * observed running is an ordinary finished turn and collapses exactly as
 * before. Because the release condition is "every source idle", the marker
 * cannot by itself delay a fold beyond the signals available here; it exists so
 * that the latch and its clearing points (pane switch, new session, new turn)
 * are explicit and testable instead of being implied by four inline
 * `=== "working"` checks.
 */

/** The trailing run of assistant messages, i.e. the turn that may still grow. */
export interface LatestTurn {
  /** Stable id of the turn's first assistant message (used as its React key). */
  id: string;
  hasRunningMessage: boolean;
}

/**
 * The latest turn only exists while the thread still ends with assistant
 * output; once a user message is appended, that turn is history and behaves
 * like every other finished turn.
 */
export function latestAssistantTurn(messages: ChatMessage[]): LatestTurn | null {
  // Mirrors `groupAssistantTurns`: a turn only counts as the latest one while
  // the thread still ends with its assistant output.
  if (messages.at(-1)?.role !== "assistant") return null;

  let start = messages.length;
  while (start > 0 && messages[start - 1]!.role === "assistant") start -= 1;
  const turn = messages.slice(start);
  return {
    id: turn[0]!.id,
    hasRunningMessage: turn.some((message) => message.status?.type === "running"),
  };
}

export interface TurnActivitySignals {
  /** Trailing assistant turn; `null` when the thread ends with a user message. */
  latestTurn: LatestTurn | null;
  /** Pane id plus realtime runtime id; any change clears the sticky marker. */
  sessionKey: string;
  /** `chat.running` from the polled /chat snapshot (server-side F-B predicate). */
  chatRunning: boolean;
  /** `null` when this pane has no realtime state at all (bridge missing). */
  realtimeStatus: ChatRealtimeStatus | null;
  /** Herdr-reported pane status, when the client has it. */
  paneStatus: AgentStatus | null | undefined;
}

export interface TurnActivityObservation {
  /** Whether the latest turn must still be treated as running. */
  running: boolean;
  /** Whether this observation released a previously running turn. */
  settled: boolean;
}

export interface TurnActivityTracker {
  observe(signals: TurnActivitySignals): TurnActivityObservation;
  reset(): void;
  /** Whether the current turn has ever been observed running. */
  readonly sawRunning: boolean;
}

export function createTurnActivityTracker(): TurnActivityTracker {
  let sessionKey: string | null = null;
  let turnId: string | null = null;
  let sawRunning = false;

  const forget = () => {
    sawRunning = false;
  };

  return {
    observe(signals) {
      const turn = signals.latestTurn;
      const nextTurnId = turn?.id ?? null;
      // A new pane, a new realtime session or a new turn all start from a clean
      // latch: the previous turn's history must not keep the new one expanded.
      if (signals.sessionKey !== sessionKey || nextTurnId !== turnId) {
        sessionKey = signals.sessionKey;
        turnId = nextTurnId;
        forget();
      }
      if (!turn) return { running: false, settled: false };

      const active =
        turn.hasRunningMessage ||
        signals.chatRunning ||
        isPaneActive(signals.paneStatus) ||
        (signals.realtimeStatus !== null && signals.realtimeStatus !== "idle");

      if (active) {
        sawRunning = true;
        return { running: true, settled: false };
      }
      if (!sawRunning) return { running: false, settled: false };
      return { running: false, settled: true };
    },
    reset() {
      sessionKey = null;
      turnId = null;
      forget();
    },
    get sawRunning() {
      return sawRunning;
    },
  };
}

/**
 * Tracks the latest turn across renders. `observe` is idempotent for repeated
 * identical signals, so the double render of React StrictMode cannot change the
 * result.
 */
export function useLatestTurnActivity(signals: TurnActivitySignals): boolean {
  const trackerRef = useRef<TurnActivityTracker | null>(null);
  trackerRef.current ??= createTurnActivityTracker();
  return trackerRef.current.observe(signals).running;
}
