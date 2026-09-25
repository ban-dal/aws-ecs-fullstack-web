import { collectRouteObservation } from "../../lib/collect-route-observation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const observation = await collectRouteObservation(request.headers, "probe");

  return Response.json(observation, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      ...(observation.instanceId ? { "X-Backend-Instance": observation.instanceId } : {}),
    },
  });
}
