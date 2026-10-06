import { isHealthFaulty } from "../../lib/fault";

export function GET() {
  const environment = process.env.APP_ENV ?? "local";
  if (isHealthFaulty()) {
    return Response.json({ status: "fault", environment }, { status: 503 });
  }
  return Response.json({ status: "ok", environment });
}
