#!/usr/bin/env bash
# 지정한 브랜치의 SHA 이미지를 해당 환경에만 배포한다. 기반 리소스는 만들지 않는다.
set -euo pipefail
source "$(dirname "$0")/lib/ecs-deploy.sh"

environment="${1:-}"
case "$environment" in
  preprod) [[ "${GITHUB_EVENT_NAME:-}" == push && "${GITHUB_REF:-}" == refs/heads/preprod ]] || exit 2 ;;
  prod) [[ "${GITHUB_EVENT_NAME:-}" == push && "${GITHUB_REF:-}" == refs/heads/main ]] || exit 2 ;;
  *) echo 'usage: build-push-deploy.sh preprod|prod' >&2; exit 2 ;;
esac
[[ "${GITHUB_SHA:-}" =~ ^[a-f0-9]{40}$ ]] || { echo 'invalid commit SHA' >&2; exit 2; }

ecs_init "$environment"
image="$registry/$repository:$GITHUB_SHA"
echo "### $environment deployment" >> "$GITHUB_STEP_SUMMARY"

if [[ "$current_image" == "$image" ]]; then
  deploy_image "$GITHUB_SHA"
  exit 0
fi

docker build --platform linux/arm64 -f apps/web/Dockerfile -t "web:$GITHUB_SHA" .
docker run -d --name web-check -p 3000:3000 -e APP_ENV="$environment" "web:$GITHUB_SHA" >/dev/null
trap 'docker rm -f web-check >/dev/null 2>&1 || true' EXIT
healthy=false
for _ in $(seq 1 30); do
  if body="$(curl -fsS http://127.0.0.1:3000/api/health 2>/dev/null)" && jq -e '.status == "ok"' <<<"$body" >/dev/null; then
    healthy=true
    break
  fi
  sleep 1
done
[[ "$healthy" == true ]] || { docker logs web-check; exit 1; }
docker rm -f web-check >/dev/null
trap - EXIT

aws ecr get-login-password | docker login --username AWS --password-stdin "$registry" >/dev/null
if aws ecr describe-images --repository-name "$repository" --image-ids "imageTag=$GITHUB_SHA" >/dev/null 2>&1; then
  echo 'immutable image tag already exists; reusing it'
else
  docker tag "web:$GITHUB_SHA" "$image"
  docker push "$image" >/dev/null
fi
deploy_image "$GITHUB_SHA"
