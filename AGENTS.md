# 작업 지침

이 저장소는 Next.js 앱과 앱 배포 workflow를 관리한다. AWS 기반 리소스와 IAM은 [인프라 저장소](https://github.com/ban-dal/aws-ecs-fullstack-app)에서 관리한다.

- 공개 저장소다. 계정 ID, 비밀, 자격 증명을 코드와 문서에 쓰지 않는다.
- 테스트 제목은 한국어로 입력·상황과 기대 결과를 모두 쓴다.
- 의미 있는 사용자 동작이나 회귀 위험만 테스트한다.
- 앱을 바꾸면 `pnpm typecheck`, `pnpm build`를 실행한다.
- 배포 권한은 OIDC를 사용하고 AWS 장기 키는 두지 않는다.
