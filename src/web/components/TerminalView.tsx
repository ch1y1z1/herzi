import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";

import type {
  ClientMessage,
  PaneSummary,
  ServerMessage,
  TerminalFrame,
} from "../../shared/protocol";

export function TerminalView({
  pane,
  connected,
  serverMessage,
  send,
}: {
  pane: PaneSummary;
  connected: boolean;
  serverMessage: ServerMessage | null;
  send: (message: ClientMessage) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const lastSeqRef = useRef<number | null>(null);
  const sessionRef = useRef<"idle" | "pending" | "controlled" | "readonly">(
    "idle",
  );
  const [status, setStatus] = useState("正在连接终端…");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      disableStdin: false,
      fontFamily:
        '"SFMono-Regular", "SF Mono", Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      scrollback: 5_000,
      theme: {
        background: "#151714",
        foreground: "#e8e8e2",
        cursor: "#9ca67e",
        selectionBackground: "#4c543f",
        black: "#20231f",
        brightBlack: "#73776c",
        red: "#d98282",
        green: "#9dbb78",
        yellow: "#d1b875",
        blue: "#8da9c4",
        magenta: "#b89ac8",
        cyan: "#86b6ad",
        white: "#d8d8d2",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fit;

    const syncSizeOrConnect = () => {
      fit.fit();
      if (!connected) return;

      if (sessionRef.current === "controlled") {
        send({
          channel: "terminal",
          type: "resize",
          paneId: pane.id,
          cols: terminal.cols,
          rows: terminal.rows,
        });
        return;
      }
      if (sessionRef.current !== "idle") return;

      sessionRef.current = "pending";
      lastSeqRef.current = null;
      terminal.reset();
      send({
        channel: "terminal",
        type: "control",
        paneId: pane.id,
        cols: terminal.cols,
        rows: terminal.rows,
      });
      setStatus("正在连接终端…");
    };

    const resizeObserver = new ResizeObserver(() => syncSizeOrConnect());
    resizeObserver.observe(host);
    const inputDisposable = terminal.onData((text) => {
      if (sessionRef.current === "controlled") {
        send({ channel: "terminal", type: "input", paneId: pane.id, text });
      }
    });
    let wheelDelta = 0;
    let wheelFrame = 0;
    const onWheel = (event: WheelEvent) => {
      if (sessionRef.current !== "controlled" || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();

      const lineDelta =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? event.deltaY * terminal.rows
            : event.deltaY / 32;
      wheelDelta += lineDelta;
      if (wheelFrame) return;
      wheelFrame = window.requestAnimationFrame(() => {
        const direction = wheelDelta < 0 ? "up" : "down";
        const lines = Math.max(1, Math.min(100, Math.round(Math.abs(wheelDelta))));
        wheelDelta = 0;
        wheelFrame = 0;
        send({
          channel: "terminal",
          type: "scroll",
          paneId: pane.id,
          direction,
          lines,
        });
      });
    };
    host.addEventListener("wheel", onWheel, { passive: false, capture: true });
    const frame = window.requestAnimationFrame(syncSizeOrConnect);

    return () => {
      window.cancelAnimationFrame(frame);
      if (wheelFrame) window.cancelAnimationFrame(wheelFrame);
      resizeObserver.disconnect();
      inputDisposable.dispose();
      host.removeEventListener("wheel", onWheel, { capture: true });
      send({ channel: "terminal", type: "stop" });
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      sessionRef.current = "idle";
    };
  }, [pane.id, connected, send]);

  useEffect(() => {
    if (!connected) {
      setStatus("与 Herzi 服务断开，正在重连…");
      sessionRef.current = "idle";
      return;
    }
    const terminal = terminalRef.current;
    if (!terminal || !serverMessage || serverMessage.channel !== "terminal") return;
    if (serverMessage.paneId !== pane.id) return;

    if (serverMessage.type === "started") {
      if (sessionRef.current === "readonly") {
        setStatus("终端输入暂不可用，当前为只读模式");
      } else {
        setStatus("等待首帧…");
      }
    } else if (serverMessage.type === "control-pending") {
      sessionRef.current = "pending";
      setStatus("正在连接终端…");
    } else if (serverMessage.type === "control-acquired") {
      sessionRef.current = "controlled";
      terminal.options.disableStdin = false;
      terminal.focus();
      send({
        channel: "terminal",
        type: "resize",
        paneId: pane.id,
        cols: terminal.cols,
        rows: terminal.rows,
      });
      setStatus("");
    } else if (serverMessage.type === "control-released") {
      sessionRef.current = "idle";
      lastSeqRef.current = null;
      send({
        channel: "terminal",
        type: "control",
        paneId: pane.id,
        cols: terminal.cols,
        rows: terminal.rows,
      });
      setStatus("正在重新连接终端…");
    } else if (serverMessage.type === "error") {
      if (sessionRef.current !== "readonly") {
        sessionRef.current = "readonly";
        terminal.options.disableStdin = true;
        lastSeqRef.current = null;
        send({
          channel: "terminal",
          type: "observe",
          paneId: pane.id,
          cols: terminal.cols,
          rows: terminal.rows,
        });
      }
      setStatus(serverMessage.message ?? "终端同步失败");
    } else if (serverMessage.type === "stopped") {
      setStatus("终端同步已停止");
    } else if (serverMessage.type === "frame") {
      if (
        lastSeqRef.current !== null &&
        serverMessage.frame.seq !== lastSeqRef.current + 1 &&
        !serverMessage.frame.full
      ) {
        sessionRef.current = "pending";
        lastSeqRef.current = null;
        terminal.reset();
        send({
          channel: "terminal",
          type: "control",
          paneId: pane.id,
          cols: terminal.cols,
          rows: terminal.rows,
        });
        setStatus("检测到帧缺口，正在重新同步…");
        return;
      }
      if (serverMessage.frame.full && lastSeqRef.current !== null) {
        terminal.reset();
      }
      writeFrame(terminal, serverMessage.frame, lastSeqRef);
      setStatus(
        sessionRef.current === "readonly"
          ? "终端输入暂不可用，当前为只读模式"
          : "",
      );
    }
  }, [connected, pane.id, serverMessage]);

  return (
    <div className="terminal-stage">
      <div ref={hostRef} className="terminal-host" />
      {status && <div className="terminal-status">{status}</div>}
    </div>
  );
}

function writeFrame(
  terminal: Terminal,
  frame: TerminalFrame,
  lastSeqRef: React.MutableRefObject<number | null>,
): void {
  if (lastSeqRef.current !== null && frame.seq <= lastSeqRef.current) return;
  lastSeqRef.current = frame.seq;

  const binary = atob(frame.bytes);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  terminal.write(bytes);
}
