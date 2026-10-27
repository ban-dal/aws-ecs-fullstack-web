import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  // 배포 스크립트가 commit SHA를 넣는다. 클라이언트는 이 값이 다른 서버 응답을 받으면
  // 페이지를 새로 불러오고, Server Actions 버전 검사는 이 값으로 새 배포를 알아챈다.
  deploymentId: process.env.NEXT_DEPLOYMENT_ID || undefined,
};

export default config;
