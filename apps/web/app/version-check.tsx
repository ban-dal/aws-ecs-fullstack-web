"use client";

import { unstable_isUnrecognizedActionError } from "next/navigation";
import { useState } from "react";
import { changedAction, unchangedAction, type VersionCheckResult } from "./version-check-actions";

type Props = { deploymentId: string | null };

type Outcome = { label: string; result: VersionCheckResult };

// 새 배포가 이전 Action ID를 모르면 Next는 UnrecognizedActionError를 던진다. ID가 유지되어
// 새 서버에서 실행된 경우는 응답의 deploymentId가 화면을 연 배포와 다른 것으로 알아챈다.
export default function VersionCheck({ deploymentId }: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [newVersion, setNewVersion] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, action: () => Promise<VersionCheckResult>) {
    setPending(label);
    setError(null);
    try {
      const result = await action();
      setOutcome({ label, result });
      if (deploymentId && result.deploymentId !== deploymentId) setNewVersion(true);
    } catch (caught) {
      if (unstable_isUnrecognizedActionError(caught)) setNewVersion(true);
      else setError("Action을 실행하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section id="version-check" className="version-section" aria-labelledby="version-title">
      {newVersion ? (
        <div className="version-alert" role="alert">
          <p>새 버전 앱이 배포되어 새로고침합니다.</p>
          <button type="button" onClick={() => window.location.reload()}>새로고침</button>
        </div>
      ) : null}
      <div className="section-heading">
        <div><h2 id="version-title">Server Actions 버전 검사</h2><p>화면을 연 뒤 새 버전이 배포되면 버튼이 새로고침을 안내합니다.</p></div>
        <div className="sample-actions">
          <button type="button" onClick={() => run("대조군", unchangedAction)} disabled={pending !== null}>대조군 Action</button>
          <button className="primary-button" type="button" onClick={() => run("수정 대상", changedAction)} disabled={pending !== null}>수정 대상 Action</button>
        </div>
      </div>
      <div className="sample-feedback" aria-live="polite">
        {pending ? `${pending} Action 실행 중` : error ?? (outcome ? `${outcome.label}: ${outcome.result.message}` : "버튼을 눌러 Action을 실행합니다.")}
      </div>
      <div className="panel verification-panel">
        <ul className="verification-list">
          <li className="verification-row"><span className="verification-name">화면을 연 배포</span><span className="verification-value identifier">{deploymentId ?? "미설정"}</span><span /></li>
          <li className="verification-row"><span className="verification-name">Action을 처리한 배포</span><span className="verification-value identifier">{outcome?.result.deploymentId ?? "미확인"}</span><span /></li>
        </ul>
      </div>
    </section>
  );
}
