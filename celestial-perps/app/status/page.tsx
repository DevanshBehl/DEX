// Server entry for /status; the dashboard itself is a client component.
import StatusApp from "@/components/pages/StatusApp";

export const metadata = { title: "Status · Celestial Perps" };

export default function StatusPage() {
  return <StatusApp />;
}
