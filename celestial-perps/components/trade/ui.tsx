// Small shared building blocks for the trade terminal.

export const PANEL =
  "rounded-xl border border-white/[0.07] bg-gradient-to-b from-[#131313]/90 to-[#0d0d0d]/90 backdrop-blur-sm shadow-[inset_0_1px_0_0_rgba(255,255,255,0.035),0_10px_30px_-18px_rgba(0,0,0,0.9)]";

export const GREEN = "#22c55e";
export const RED = "#ef4444";

export function Stat({
  label,
  value,
  color = "text-white",
  className = "",
  title,
}: {
  label: string;
  value: string;
  color?: string;
  className?: string;
  title?: string;
}) {
  return (
    <div className={`flex flex-col leading-tight ${className}`} title={title}>
      <span className="text-[10px] uppercase tracking-wide text-[#888]">{label}</span>
      <span className={`font-mono text-sm tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

export function SummaryRow({
  label,
  value,
  color = "text-white",
  title,
}: {
  label: string;
  value: string;
  color?: string;
  title?: string;
}) {
  return (
    <div className="flex items-center justify-between text-xs" title={title}>
      <span className="text-[#888]">{label}</span>
      <span className={`font-mono tabular-nums ${color}`}>{value}</span>
    </div>
  );
}
