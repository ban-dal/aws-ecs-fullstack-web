import type { RouteObservation } from "../route-observation";

const imdsBase = "http://169.254.169.254";

type BackendIdentity = Pick<RouteObservation, "instanceId" | "availabilityZone" | "taskId">;

const unavailable: BackendIdentity = {
  instanceId: null,
  availabilityZone: null,
  taskId: null,
};

let cachedIdentity: Promise<BackendIdentity> | undefined;

async function readImdsValue(token: string, path: string): Promise<string | null> {
  try {
    const response = await fetch(`${imdsBase}/latest/meta-data/${path}`, {
      headers: { "X-aws-ec2-metadata-token": token },
      signal: AbortSignal.timeout(1000),
      cache: "no-store",
    });
    return response.ok ? (await response.text()).trim() : null;
  } catch {
    return null;
  }
}

async function readEc2Host(): Promise<Pick<BackendIdentity, "instanceId" | "availabilityZone">> {
  try {
    // prod ECS 호스트는 IMDSv2 필수·hop limit 2다. 토큰과 인스턴스 정보만 읽고
    // 인스턴스 프로필 자격 증명 경로는 요청하지 않는다.
    const response = await fetch(`${imdsBase}/latest/api/token`, {
      method: "PUT",
      headers: { "X-aws-ec2-metadata-token-ttl-seconds": "60" },
      signal: AbortSignal.timeout(1000),
      cache: "no-store",
    });
    if (!response.ok) return { instanceId: null, availabilityZone: null };

    const token = await response.text();
    const [rawInstanceId, rawZone] = await Promise.all([
      readImdsValue(token, "instance-id"),
      readImdsValue(token, "placement/availability-zone"),
    ]);

    return {
      instanceId: rawInstanceId && /^i-[0-9a-f]{8,17}$/.test(rawInstanceId) ? rawInstanceId : null,
      availabilityZone: rawZone && /^[a-z]{2}-[a-z]+-\d[a-z]$/.test(rawZone) ? rawZone : null,
    };
  } catch {
    return { instanceId: null, availabilityZone: null };
  }
}

async function readTaskId(): Promise<string | null> {
  const metadataUri = process.env.ECS_CONTAINER_METADATA_URI_V4;
  if (!metadataUri) return null;

  try {
    const url = new URL(`${metadataUri}/task`);
    if (url.protocol !== "http:" || url.hostname !== "169.254.170.2") return null;

    const response = await fetch(url, { signal: AbortSignal.timeout(1000), cache: "no-store" });
    if (!response.ok) return null;

    const metadata: unknown = await response.json();
    const taskArn =
      metadata && typeof metadata === "object" && "TaskARN" in metadata
        ? metadata.TaskARN
        : null;
    if (typeof taskArn !== "string") return null;

    const taskId = taskArn.split("/").at(-1);
    return taskId && /^[0-9a-f]{32}$/.test(taskId) ? taskId.slice(0, 12) : null;
  } catch {
    return null;
  }
}

async function readBackendIdentity(): Promise<BackendIdentity> {
  const [ec2, taskId] = await Promise.all([readEc2Host(), readTaskId()]);
  return { ...ec2, taskId };
}

function getBackendIdentity(): Promise<BackendIdentity> {
  if (process.env.APP_ENV !== "prod") return Promise.resolve(unavailable);

  cachedIdentity ??= readBackendIdentity().then((identity) => {
    // 시작 직후 메타데이터 요청이 실패한 경우 다음 요청에서 다시 확인한다.
    if (!identity.instanceId || !identity.taskId) cachedIdentity = undefined;
    return identity;
  });
  return cachedIdentity;
}

export async function collectRouteObservation(
  requestHeaders: Pick<Headers, "get">,
  source: RouteObservation["source"],
): Promise<RouteObservation> {
  const identity = await getBackendIdentity();
  const forwardedProto = requestHeaders.get("x-forwarded-proto")?.toLowerCase();
  const rawHost = requestHeaders.get("host")?.toLowerCase() ?? null;

  return {
    requestId: crypto.randomUUID(),
    checkedAt: new Date().toISOString(),
    source,
    environment: process.env.APP_ENV ?? "local",
    host: rawHost && /^[a-z0-9.:-]+$/.test(rawHost) ? rawHost : null,
    forwardedProto: forwardedProto === "http" || forwardedProto === "https" ? forwardedProto : null,
    albTracePresent: requestHeaders.get("x-amzn-trace-id") !== null,
    ...identity,
  };
}
