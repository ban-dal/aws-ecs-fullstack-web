// 배포 롤백 연습용 결함. 연습할 때만 값을 바꾼 commit을 배포하고 끝나면 revert한다.
// - health: ECS에서만 /api/health가 503을 반환한다. 배포 전 로컬 컨테이너 검사는 통과하고
//   ECS·ALB health check가 실패해 circuit breaker가 되돌린다.
// - api: /api/backend가 500을 반환한다. health는 정상이라 5xx alarm이 되돌린다.
export type Fault = "none" | "health" | "api";

export const fault: Fault = "none";

export function isHealthFaulty(): boolean {
  return fault === "health" && Boolean(process.env.ECS_CONTAINER_METADATA_URI_V4);
}
