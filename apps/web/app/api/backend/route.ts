import { collectRouteObservation } from "../../lib/collect-route-observation";
import { fault } from "../../lib/fault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (fault === "api") {
    return Response.json({ error: "injected fault" }, { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } });
  }

  const observation = await collectRouteObservation(request.headers, "probe");

  return Response.json(observation, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      ...(observation.instanceId ? { "X-Backend-Instance": observation.instanceId } : {}),
    },
  });
}
