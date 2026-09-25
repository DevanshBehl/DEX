/**
 * JSON-lines logger: one object per line with `ts`, `level`, `msg` and the bound fields
 * (`chain`, `job`, …). bigints are written as strings. Secrets are never passed in — callers
 * log addresses, ids and signatures only; `redact` is a last line of defence for known keys.
 */

export type Level = "debug" | "info" | "warn" | "error" | "alert";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40, alert: 50 };

export type Fields = Record<string, unknown>;
export type Sink = (line: string) => void;

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  alert(msg: string, fields?: Fields): void;
  child(bindings: Fields): Logger;
}

const SECRET_KEYS = /private|secret|mnemonic|seed|password|keypair$/i;

function replacer(key: string, value: unknown) {
  if (key && SECRET_KEYS.test(key)) return "[redacted]";
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return { name: value.name, message: value.message };
  return value;
}

export function createLogger(opts: { level?: Level; sink?: Sink; bindings?: Fields } = {}): Logger {
  const min = ORDER[opts.level ?? "info"];
  const sink: Sink = opts.sink ?? ((line) => process.stdout.write(line + "\n"));
  const bindings = opts.bindings ?? {};

  const write = (level: Level, msg: string, fields?: Fields) => {
    if (ORDER[level] < min) return;
    sink(JSON.stringify({ ts: new Date().toISOString(), level, ...bindings, msg, ...fields }, replacer));
  };

  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    alert: (m, f) => write("alert", m, f),
    child: (b) => createLogger({ level: opts.level, sink, bindings: { ...bindings, ...b } }),
  };
}

/** Short, secret-free description of an error for logs. */
export function errMsg(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // RPC errors can echo the request URL (which may embed an API key): strip URLs.
  return msg.replace(/https?:\/\/[^\s"')]+/g, "<url>").slice(0, 500);
}
