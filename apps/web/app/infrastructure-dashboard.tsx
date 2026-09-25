"use client";

import { useState } from "react";
import type { RouteObservation } from "./route-observation";

type Props = { initialObservation: RouteObservation };

function observedTime(iso: string) {
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

function display(value: string | null) {
  return value ?? "확인되지 않음";
}

function CheckRow({ label, value, confirmed }: { label: string; value: string; confirmed: boolean }) {
  return (
    <li className="verification-row">
      <span className="verification-name">{label}</span>
      <span className="verification-value">{value}</span>
      <span className={confirmed ? "verification-result verified" : "verification-result"}>
        {confirmed ? "관측됨" : "미확인"}
      </span>
    </li>
  );
}

export default function InfrastructureDashboard({ initialObservation }: Props) {
  const [observations, setObservations] = useState<RouteObservation[]>([initialObservation]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const latest = observations[0];
  const isProd = latest.environment === "prod";
  const correctDomain = latest.host === "aws.bandal.dev";
  const https = latest.forwardedProto === "https";
  const routedByAlb = latest.albTracePresent;
  const routeConfirmed = correctDomain && https && routedByAlb && !!latest.taskId && !!latest.instanceId;
  const instanceCounts = new Map<string, { count: number; zone: string | null }>();
  for (const observation of observations) {
    if (!observation.instanceId) continue;
    const current = instanceCounts.get(observation.instanceId);
    instanceCounts.set(observation.instanceId, {
      count: (current?.count ?? 0) + 1,
      zone: observation.availabilityZone ?? current?.zone ?? null,
    });
  }
  const seenInstances = [...instanceCounts.entries()];

  async function probe(count: number) {
    setError(null);
    setProgress({ done: 0, total: count });

    try {
      for (let index = 0; index < count; index += 1) {
        const response = await fetch(`/api/backend?sample=${Date.now()}-${index}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const observation = (await response.json()) as RouteObservation;
        if (!observation.requestId || !observation.checkedAt) {
          throw new Error("응답 형식을 확인할 수 없습니다.");
        }
        setObservations((previous) => [observation, ...previous].slice(0, 12));
        setProgress({ done: index + 1, total: count });
      }
    } catch {
      setError("요청을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">본문으로 이동</a>
      <aside className="sidebar" aria-label="대시보드 메뉴">
        <div className="sidebar-brand"><span className="brand-symbol" aria-hidden="true">A</span><span>AWS 풀스택 실험실</span></div>
        <div className="sidebar-group-label">탐색</div>
        <nav className="sidebar-nav" aria-label="주요 메뉴">
          <a className="active" href="#overview" aria-current="page">인프라 개요</a>
          <a href="#request-path">요청 경로</a>
          <a href="#traffic-sample">요청 기록</a>
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-bottom">
          <span className="sidebar-group-label">환경</span>
          <strong>{latest.environment.toUpperCase()}</strong>
          <small>요청 기반 관측 대시보드</small>
        </div>
      </aside>

      <div className="workspace">
        <header className="workspace-header">
          <div className="breadcrumb">인프라 <span aria-hidden="true">/</span> 개요</div>
          <div className="header-meta"><span className="header-indicator" aria-hidden="true" /> 마지막 관측 <time dateTime={latest.checkedAt}>{observedTime(latest.checkedAt)}</time></div>
        </header>

        <main id="main-content" className="workspace-content">
          <section id="overview" className="overview" aria-labelledby="page-title">
            <div className="page-heading">
              <div>
                <p className="section-context">요청 경로 관측</p>
                <h1 id="page-title">인프라 개요</h1>
                <p>요청 경로와 응답한 ECS·EC2 호스트를 확인합니다.</p>
              </div>
              <div className={routeConfirmed ? "route-state confirmed" : "route-state"}>
                <span className="state-mark" aria-hidden="true">{routeConfirmed ? "✓" : "!"}</span>
                <span>{routeConfirmed ? "현재 요청 경로 관측됨" : isProd ? "경로 일부 미확인" : "로컬 미리보기"}</span>
              </div>
            </div>

            <div className="summary-strip" aria-label="현재 요청 요약">
              <div className="summary-item"><span>서비스 주소</span><strong>{display(latest.host)}</strong></div>
              <div className="summary-item"><span>접속 프로토콜</span><strong>{latest.forwardedProto?.toUpperCase() ?? "미확인"}</strong></div>
              <div className="summary-item"><span>응답 인스턴스</span><strong className="identifier">{display(latest.instanceId)}</strong></div>
              <div className="summary-item"><span>관측된 호스트</span><strong>{seenInstances.length}<em>개 / 최근 {observations.length}개 요청</em></strong></div>
            </div>
          </section>

          <section id="request-path" className="request-section" aria-labelledby="request-title">
            <div className="section-heading">
              <div><h2 id="request-title">현재 요청 경로</h2><p>브라우저 요청 1건에서 확인한 연결 순서입니다.</p></div>
              <span className="section-time">기준 <time dateTime={latest.checkedAt}>{observedTime(latest.checkedAt)}</time></span>
            </div>
            <div className="inspection-grid">
              <div className="panel route-panel">
                <h3>접속 흐름</h3>
                <ol className="route-list">
                  <li><span className="step-index">01</span><div><span className="step-label">도메인</span><strong>{display(latest.host)}</strong><small>요청의 Host 헤더</small></div></li>
                  <li><span className="step-index">02</span><div><span className="step-label">로드 밸런서</span><strong>{https ? "HTTPS" : latest.forwardedProto?.toUpperCase() ?? "미확인"}</strong><small>{routedByAlb ? "ALB 추적 헤더 관측" : "ALB 추적 헤더 미확인"}</small></div></li>
                  <li><span className="step-index">03</span><div><span className="step-label">ECS 태스크</span><strong className="identifier">{display(latest.taskId)}</strong><small>이 요청에 응답한 컨테이너</small></div></li>
                  <li><span className="step-index">04</span><div><span className="step-label">EC2 호스트</span><strong className="identifier">{display(latest.instanceId)}</strong><small>{latest.availabilityZone ?? "가용 영역 미확인"}</small></div></li>
                </ol>
              </div>
              <div className="panel verification-panel">
                <h3>검증 항목</h3>
                <p>헤더와 서버 메타데이터의 관측 결과입니다.</p>
                <ul className="verification-list">
                  <CheckRow label="서비스 도메인" value={display(latest.host)} confirmed={correctDomain} />
                  <CheckRow label="HTTPS 연결" value={https ? "HTTPS" : "미확인"} confirmed={https} />
                  <CheckRow label="ALB 추적 헤더" value={routedByAlb ? "X-Amzn-Trace-Id" : "미확인"} confirmed={routedByAlb} />
                  <CheckRow label="ECS 태스크" value={latest.taskId ?? "미확인"} confirmed={!!latest.taskId} />
                  <CheckRow label="EC2 인스턴스" value={latest.instanceId ?? "미확인"} confirmed={!!latest.instanceId} />
                  <CheckRow label="가용 영역" value={latest.availabilityZone ?? "미확인"} confirmed={!!latest.availabilityZone} />
                </ul>
              </div>
            </div>
          </section>

          <section id="traffic-sample" className="traffic-section" aria-labelledby="traffic-title">
            <div className="section-heading traffic-heading">
              <div><h2 id="traffic-title">요청 표본</h2><p>새 요청을 보내 어떤 호스트가 응답하는지 비교합니다.</p></div>
              <div className="sample-actions">
                <button type="button" onClick={() => probe(1)} disabled={progress !== null}>1회 요청</button>
                <button className="primary-button" type="button" onClick={() => probe(8)} disabled={progress !== null}>8회 요청 검사</button>
              </div>
            </div>
            <div className="sample-feedback" aria-live="polite">
              {progress ? `요청 확인 중 · ${progress.done}/${progress.total}` : error ?? `최근 ${observations.length}개 요청에서 ${seenInstances.length}개 호스트 관측`}
            </div>
            <div className="panel host-panel">
              <div className="table-heading"><h3>응답한 EC2 호스트</h3><span>최근 요청 {observations.length}건 기준</span></div>
              <div className="table-scroll">
                <table>
                  <thead><tr><th scope="col">인스턴스 ID</th><th scope="col">가용 영역</th><th scope="col" className="numeric">응답 횟수</th></tr></thead>
                  <tbody>
                    {seenInstances.length === 0 ? (
                      <tr><td colSpan={3} className="empty-table">prod에서 호스트 정보가 관측되면 여기에 표시됩니다.</td></tr>
                    ) : seenInstances.map(([instanceId, entry]) => (
                      <tr key={instanceId}><th scope="row" className="identifier">{instanceId}</th><td>{entry.zone ?? "미확인"}</td><td className="numeric">{entry.count}회</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="panel history-panel">
              <div className="table-heading"><h3>최근 요청 기록</h3><span>이 브라우저의 최근 {observations.length}건</span></div>
              <div className="table-scroll">
                <table>
                  <thead><tr><th scope="col">관측 시각 (UTC)</th><th scope="col">요청 종류</th><th scope="col">응답 인스턴스</th><th scope="col">가용 영역</th><th scope="col">ECS 태스크</th></tr></thead>
                  <tbody>
                    {observations.map((observation) => (
                      <tr key={observation.requestId}>
                        <td className="identifier">{observedTime(observation.checkedAt)}</td>
                        <td>{observation.source === "page" ? "페이지 로드" : "확인 요청"}</td>
                        <td className="identifier">{observation.instanceId ?? "미확인"}</td>
                        <td>{observation.availabilityZone ?? "미확인"}</td>
                        <td className="identifier">{observation.taskId ?? "미확인"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="scope-note">이 수치는 브라우저에서 보낸 요청의 표본입니다. 전체 ECS 태스크 수와 ALB 대상의 정상 상태는 포함하지 않습니다. <a href="/api/health">헬스 API 열기</a></p>
          </section>
        </main>
      </div>
    </div>
  );
}
