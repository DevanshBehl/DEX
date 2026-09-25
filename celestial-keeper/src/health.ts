/** Alerts: a `level: "alert"` log line, plus an optional JSON POST to ALERT_WEBHOOK_URL. */
import { errMsg, type Fields, type Logger } from "./log.ts";
import { RateLimitedLog } from "./retry.ts";

export class Alerter {
  private limiter = new RateLimitedLog(15 * 60_000);

  constructor(
    private log: Logger,
    private webhookUrl?: string,
  ) {}

  /** Raise an alert; the same `key` fires at most once every 15 minutes. */
  async raise(key: string, msg: string, fields: Fields = {}): Promise<void> {
    if (!this.limiter.should(key)) return;
    this.log.alert(msg, { alert: key, ...fields });
    if (!this.webhookUrl) return;
    try {
      const res = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "celestial-keeper", alert: key, message: msg, ...fields }, (_, v) =>
          typeof v === "bigint" ? v.toString() : v,
        ),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) this.log.warn("alert webhook failed", { status: res.status });
    } catch (e) {
      this.log.warn("alert webhook failed", { err: errMsg(e) });
    }
  }
}
