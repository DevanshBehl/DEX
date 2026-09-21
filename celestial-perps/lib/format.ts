export const fmtPrice = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtUsd = (n: number) => `$${fmtPrice(n)}`;

export const fmtUsdCompact = (v: number) =>
  v >= 1e9
    ? `$${(v / 1e9).toFixed(2)}B`
    : v >= 1e6
      ? `$${(v / 1e6).toFixed(2)}M`
      : `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export const fmtPct = (n: number, digits = 2) => `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;

// "12s ago", "4m ago", "1h ago"
export const fmtAgo = (unixSeconds: number, now = Date.now() / 1000) => {
  const s = Math.max(0, Math.floor(now - unixSeconds));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};
