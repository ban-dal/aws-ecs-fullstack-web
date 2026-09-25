import { headers } from "next/headers";
import InfrastructureDashboard from "./infrastructure-dashboard";
import { collectRouteObservation } from "./lib/collect-route-observation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const observation = await collectRouteObservation(await headers(), "page");

  return <InfrastructureDashboard initialObservation={observation} />;
}
