export function GET() {
  return Response.json({ status: "ok", environment: process.env.APP_ENV ?? "local" });
}
