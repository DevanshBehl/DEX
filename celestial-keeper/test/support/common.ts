/** Shared helpers for the local integration tests. */
import { type ChildProcess, spawn } from "node:child_process";
import http from "node:http";

import { createLogger, type Logger } from "../../src/log.ts";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll `fn` until it returns a truthy value or `timeoutMs` passes. */
export async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs: number, label: string, everyMs = 200): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v as T;
    } catch (e) {
      lastErr = e;
    }
    await sleep(everyMs);
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for ${label}${lastErr ? `: ${(lastErr as Error).message}` : ""}`);
}

/** A logger that keeps every JSON line (and echoes warnings+ when KEEPER_TEST_VERBOSE is set). */
export function captureLogger(): { log: Logger; lines: any[] } {
  const lines: any[] = [];
  const log = createLogger({
    level: "debug",
    sink: (l) => {
      const o = JSON.parse(l);
      lines.push(o);
      if (process.env.KEEPER_TEST_VERBOSE || ["error", "alert"].includes(o.level)) console.log(l);
    },
  });
  return { log, lines };
}

/**
 * A JSON-RPC HTTP proxy that can be switched off and on — simulates an RPC outage for the keeper
 * while the test itself keeps talking to the node directly.
 */
export class ToggleProxy {
  private server?: http.Server;
  constructor(
    readonly port: number,
    private target: string,
  ) {}

  get url() {
    return `http://127.0.0.1:${this.port}`;
  }

  async start() {
    this.server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      try {
        const upstream = await fetch(this.target, { method: "POST", headers: { "content-type": "application/json" }, body: Buffer.concat(chunks) });
        res.writeHead(upstream.status, { "content-type": "application/json" });
        res.end(Buffer.from(await upstream.arrayBuffer()));
      } catch {
        res.writeHead(502);
        res.end();
      }
    });
    await new Promise<void>((r) => this.server!.listen(this.port, "127.0.0.1", r));
  }

  async stop() {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server!.close(() => r()));
    this.server = undefined;
  }
}

export function spawnQuiet(cmd: string, args: string[]): ChildProcess {
  return spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
}
