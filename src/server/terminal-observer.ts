import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";

import type { TerminalFrame } from "../shared/protocol.js";

export class TerminalObserver extends EventEmitter {
  readonly paneId: string;
  readonly cols: number;
  readonly rows: number;
  readonly mode: "observe" | "control";
  private child: ChildProcessWithoutNullStreams | null = null;
  private stopping = false;

  constructor(
    paneId: string,
    cols: number,
    rows: number,
    mode: "observe" | "control" = "observe",
  ) {
    super();
    this.paneId = paneId;
    this.cols = clamp(cols, 20, 400);
    this.rows = clamp(rows, 5, 200);
    this.mode = mode;
  }

  start(): void {
    if (this.child) return;

    const child = spawn(
      "herdr",
      [
        "terminal",
        "session",
        this.mode,
        this.paneId,
        "--cols",
        String(this.cols),
        "--rows",
        String(this.rows),
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    this.child = child;
    child.stdin.on("error", () => {
      // The control process may close between a browser event and this write.
    });

    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      try {
        const frame = JSON.parse(line) as TerminalFrame;
        if (
          typeof frame.seq === "number" &&
          typeof frame.bytes === "string" &&
          typeof frame.full === "boolean"
        ) {
          this.emit("frame", frame);
        }
      } catch {
        this.emit("error", new Error("Herdr terminal returned an invalid frame"));
      }
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 4_096) stderr += chunk;
    });
    child.once("error", (error) => this.emit("error", error));
    child.once("exit", (code) => {
      this.child = null;
      if (!this.stopping && code !== 0) {
        this.emit(
          "error",
          new Error(stderr.trim() || `Terminal observer exited with code ${code}`),
        );
      }
      this.emit("stopped");
    });
  }

  input(text: string): void {
    if (this.mode !== "control" || !this.canWrite()) return;
    this.writeCommand({ type: "terminal.input", text });
  }

  resize(cols: number, rows: number): void {
    if (this.mode !== "control" || !this.canWrite()) return;
    this.writeCommand({
      type: "terminal.resize",
      cols: clamp(cols, 20, 400),
      rows: clamp(rows, 5, 200),
    });
  }

  scroll(direction: "up" | "down", lines: number): void {
    if (this.mode !== "control" || !this.canWrite()) return;
    this.writeCommand({
      type: "terminal.scroll",
      direction,
      lines: clamp(lines, 1, 100),
      source: "wheel",
    });
  }

  release(): void {
    if (this.mode !== "control" || !this.canWrite()) return;
    this.writeCommand({ type: "terminal.release" });
    this.child?.stdin.end();
  }

  private writeCommand(command: object): void {
    this.child?.stdin.write(`${JSON.stringify(command)}\n`);
  }

  private canWrite(): boolean {
    return Boolean(
      this.child &&
        !this.child.stdin.destroyed &&
        !this.child.stdin.writableEnded,
    );
  }

  stop(): void {
    this.stopping = true;
    const child = this.child;
    if (
      this.mode === "control" &&
      child &&
      !child.stdin.destroyed &&
      !child.stdin.writableEnded
    ) {
      this.release();
      const forceStop = setTimeout(() => child.kill("SIGTERM"), 500);
      forceStop.unref();
    } else {
      child?.kill("SIGTERM");
    }
    this.child = null;
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
