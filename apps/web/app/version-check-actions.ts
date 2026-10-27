"use server";

// Server Actions 버전 차이 검사용 함수다. 두 번째 배포에서는 changedAction만 고쳐 배포한다.
// 응답에 처리한 서버의 deploymentId를 담아 화면을 연 배포와 비교한다.

export type VersionCheckResult = {
  deploymentId: string | null;
  message: string;
  handledAt: string;
};

function serverDeploymentId() {
  return process.env.NEXT_DEPLOYMENT_ID || null;
}

export async function changedAction(): Promise<VersionCheckResult> {
  return { deploymentId: serverDeploymentId(), message: "수정 대상 Action 응답 v1", handledAt: new Date().toISOString() };
}

export async function unchangedAction(): Promise<VersionCheckResult> {
  return { deploymentId: serverDeploymentId(), message: "대조군 Action 응답", handledAt: new Date().toISOString() };
}
