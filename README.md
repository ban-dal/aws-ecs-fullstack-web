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
| `prod` | `main` push | `prod-deploy` 승인 → 이미지 빌드·health 확인 → prod ECR push → ECS 서비스 배포·HTTPS health 확인 |

이미지 태그는 정확한 commit SHA이며 환경별 ECR 저장소에 저장된다. 서비스가 꺼져 있거나 원하는 태스크 수가 맞지 않으면 배포가 실패한다. preprod는 단일 호스트의 고정 포트를 사용하므로 교체 중 잠시 중단될 수 있다. prod는 ALB 뒤의 두 호스트에 순차 배포하며 ECS circuit breaker가 실패한 배포를 되돌린다.

저장소 secret `AWS_ACCOUNT_ID`가 필요하다. 리전은 workflow에서 `ap-northeast-2`로 지정한다. `prod-deploy` 환경은 `main` 브랜치만 허용하고 필수 승인자 `ban-dal`을 지정한다. AWS OIDC 역할과 ECR push 정책은 인프라 저장소의 Terraform에 있다. 장기 AWS 키는 사용하지 않는다.

배포 순서는 인프라 저장소의 [운영 문서](https://github.com/ban-dal/aws-ecs-fullstack-app/blob/main/docs/operations.md)를 따른다. 최초 설정 시 인프라 bootstrap IAM 변경과 환경별 ECR 정책을 먼저 적용한 후 `preprod` 브랜치를 만든다.

## 문서

- [제품](docs/product.md)
- [디자인](docs/design.md)
