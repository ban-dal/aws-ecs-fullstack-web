# AWS ECS 웹 앱

Next.js 인프라 관측 대시보드다. 앱 코드와 앱 배포는 이 저장소에서 관리한다. VPC, ALB, ECS 서비스, ECR, IAM과 Terraform은 [인프라 저장소](https://github.com/ban-dal/aws-ecs-fullstack-app)에서 관리한다.

## 로컬 실행

Node.js 22와 pnpm 11.27.0이 필요하다.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

`http://localhost:3000`에서 대시보드를, `/api/health`에서 상태를 확인한다. 로컬에는 ECS·EC2 메타데이터가 없어 호스트 식별 정보가 표시되지 않는다. `pnpm typecheck`와 `pnpm build`로 검사한다.

## 배포

| 대상 | 트리거 | 동작 |
| --- | --- | --- |
| PR → `main`·`preprod` | PR 생성·갱신 | 타입 검사, arm64 이미지 빌드, 컨테이너 health 확인 |
| `preprod` | push | 이미지 빌드·health 확인 → preprod ECR push → ECS 서비스 배포·안정화 확인 |
| `prod` | `main` push | 이미지 빌드·health 확인 → prod ECR push → ECS 서비스 배포·HTTPS health 확인 |

이미지 태그는 정확한 commit SHA이며 환경별 ECR 저장소에 저장된다. 서비스가 꺼져 있거나 원하는 태스크 수가 맞지 않으면 배포가 실패한다. preprod는 단일 호스트의 고정 포트를 사용하므로 교체 중 잠시 중단될 수 있다. prod는 ALB 뒤의 두 호스트에 순차 배포하며, 배포가 끝나면 서로 다른 EC2 두 대의 ALB 정상 대상과 포트를 Actions 로그에 남긴다. ECS circuit breaker는 실패한 배포를 되돌린다. prod는 배포 중과 직후에 ALB 대상 5xx가 1분에 5건 이상이면 alarm으로도 되돌린다. 자동 롤백되면 Deploy app이 실패하고 서비스 이벤트를 로그에 남긴다.

### 수동 롤백

배포가 끝난 뒤 문제를 발견하면 Actions → **Rollback prod** → Run workflow(`main`)에서 실행한다. 빌드 없이 ECR에 남은 이미지로 새 revision을 배포하고 Deploy app과 같은 검증을 한다.

| `target` | 대상 |
| --- | --- |
| `previous` | 직전 성공 배포 전에 돌던 이미지. 두 번 실행하면 롤백을 되돌린다 |
| 40자 commit SHA | 해당 commit 이미지. ECR은 최근 5개만 남긴다 |

롤백해도 `main`에는 문제 코드가 남아 다음 push가 다시 배포한다. 이어서 revert나 수정 PR을 merge한다.

### 롤백 연습

[`fault.ts`](apps/web/app/lib/fault.ts)의 `fault`를 바꾼 commit을 preprod를 거쳐 main에 배포하고, 연습이 끝나면 revert한다.

| 값 | 결함 | 되돌리는 주체 |
| --- | --- | --- |
| `health` | ECS에서만 `/api/health`가 503 | circuit breaker. 배포 전 로컬 컨테이너 검사는 통과한다 |
| `api` | `/api/backend`가 500 | 5xx alarm. 요청이 있어야 울리므로 배포 중 아래 명령으로 요청을 보낸다 |

```bash
for _ in $(seq 1 60); do curl -s -o /dev/null -w '%{http_code}\n' https://aws.bandal.dev/api/backend; sleep 2; done
```

배포 중 요청을 보내지 않으면 `api` 결함이 그대로 배포된다. 이 상태에서 Rollback prod로 수동 롤백을 연습한다.

저장소 secret `AWS_ACCOUNT_ID`가 필요하다. 리전은 workflow에서 `ap-northeast-2`로 지정한다. `prod-deploy` 환경은 `main` 브랜치만 허용하고 필수 승인자는 두지 않는다. AWS OIDC 역할과 ECR push 정책은 인프라 저장소의 Terraform에 있다. 장기 AWS 키는 사용하지 않는다.

배포 순서는 인프라 저장소의 [운영 문서](https://github.com/ban-dal/aws-ecs-fullstack-app/blob/main/docs/operations.md)를 따른다. 최초 설정 시 인프라 bootstrap IAM 변경과 환경별 ECR 정책을 먼저 적용한 후 `preprod` 브랜치를 만든다.

## 환경 접근

| 환경 | 주소 | 접근 조건 |
| --- | --- | --- |
| preprod | `http://<호스트 사설 IP>:3000` | AWS Client VPN 연결. 공개 주소와 HTTPS는 없다 |
| prod | <https://aws.bandal.dev> | 공개 HTTPS. HTTP는 HTTPS로 이동한다 |

두 환경 모두 `/api/health`가 `{"status":"ok","environment":"<환경>"}`을 반환한다. 응답한 EC2 인스턴스·가용 영역·ECS 태스크는 prod의 홈 화면과 `/api/backend`에만 나온다.

아래 스크립트는 [인프라 저장소](https://github.com/ban-dal/aws-ecs-fullstack-app)에 있고 [MFA 운영 역할](https://github.com/ban-dal/aws-ecs-fullstack-app/blob/main/docs/operations.md#1-로컬-인증) 세션이 필요하다.

### preprod

1. `scripts/preprod-client-vpn.sh config`로 `preprod.ovpn`을 만든다. 처음이면 `prepare`로 인증서부터 만든다. 이 파일에는 클라이언트 개인 키가 들어 있으므로 저장소나 메시지에 올리지 않는다.
2. [AWS VPN Client](https://aws.amazon.com/vpn/client-vpn-download/)에 `preprod.ovpn`을 가져와 연결한다.
3. `scripts/preprod-client-vpn.sh check`가 출력한 `앱 주소`를 브라우저에서 연다. 호스트가 교체되면 사설 IP가 바뀌므로 접속할 때마다 `check`로 확인한다.

비용을 줄이려고 preprod를 중지해 두기도 한다. VPN 연결이나 `check`가 실패하면 [preprod 접속 절차](https://github.com/ban-dal/aws-ecs-fullstack-app/blob/main/docs/operations.md#preprod-앱과-aws-client-vpn-접속)에 따라 `scripts/infra.sh preprod`로 복구한다.

### prod

브라우저에서 <https://aws.bandal.dev>를 연다. 홈 화면의 **8회 요청 검사**는 요청마다 응답한 호스트를 비교하지만, 브라우저의 표본일 뿐 서비스 전체 상태가 아니다. ECS 태스크와 ALB 정상 대상이 2/2인지는 `scripts/prod-service.sh check`로 확인한다.

사이트가 응답하지 않으면 prod가 중지됐을 수 있다. [prod 절차](https://github.com/ban-dal/aws-ecs-fullstack-app/blob/main/docs/operations.md#prod-공개-https-앱)에 따라 `scripts/infra.sh prod`로 복구한다.

## 문서

- [제품](docs/product.md)
- [디자인](docs/design.md)
