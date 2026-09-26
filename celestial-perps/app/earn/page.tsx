// Server entry for /earn; the liquidity page itself is a client component.
import EarnApp from "@/components/pages/EarnApp";

export const metadata = { title: "Earn · Celestial Perps" };

export default function EarnPage() {
  return <EarnApp />;
}
