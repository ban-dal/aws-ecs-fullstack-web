export type RouteObservation = {
  requestId: string;
  checkedAt: string;
  source: "page" | "probe";
  environment: string;
  host: string | null;
  forwardedProto: "http" | "https" | null;
  albTracePresent: boolean;
  instanceId: string | null;
  availabilityZone: string | null;
  taskId: string | null;
};
