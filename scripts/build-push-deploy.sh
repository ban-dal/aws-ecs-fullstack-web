#!/usr/bin/env bash
# 지정한 브랜치의 SHA 이미지를 해당 환경에만 배포한다. 기반 리소스는 만들지 않는다.
set -euo pipefail

environment="${1:-}"
case "$environment" in
  preprod)
    [[ "${GITHUB_EVENT_NAME:-}" == push && "${GITHUB_REF:-}" == refs/heads/preprod ]] || exit 2
    expected_count=1
    ;;
  prod)
    [[ "${GITHUB_EVENT_NAME:-}" == workflow_dispatch && "${GITHUB_REF:-}" == refs/heads/main ]] || exit 2
    expected_count=2
    ;;
  *) echo 'usage: build-push-deploy.sh preprod|prod' >&2; exit 2 ;;
esac

[[ "${GITHUB_SHA:-}" =~ ^[a-f0-9]{40}$ ]] || { echo 'invalid commit SHA' >&2; exit 2; }
[[ "${AWS_ACCOUNT_ID:-}" =~ ^[0-9]{12}$ ]] || { echo 'AWS_ACCOUNT_ID is missing' >&2; exit 2; }
[[ -n "${AWS_REGION:-}" ]] || { echo 'AWS_REGION is missing' >&2; exit 2; }

actual_account="$(aws sts get-caller-identity --query Account --output text)"
[[ "$actual_account" == "$AWS_ACCOUNT_ID" ]] || { echo 'AWS account mismatch' >&2; exit 1; }

name_prefix="aws-fullstack-lab-$environment"
cluster="$name_prefix-cluster"
family="$name_prefix-web"
repository="$family"
registry="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
image="$registry/$repository:$GITHUB_SHA"

service_json="$(aws ecs describe-services --cluster "$cluster" --services web --output json)"
jq -e --argjson count "$expected_count" '
  (.failures | length) == 0 and (.services | length) == 1 and
  .services[0].status == "ACTIVE" and
  .services[0].desiredCount == $count and
  .services[0].runningCount == $count and
  (.services[0].deployments | length) == 1
' <<<"$service_json" >/dev/null || {
  echo "$environment ECS service is missing, suspended, or already deploying" >&2
  exit 1
}

current_revision="$(jq -r '.services[0].taskDefinition' <<<"$service_json")"
current_image="$(aws ecs describe-task-definition --task-definition "$current_revision" --query 'taskDefinition.containerDefinitions[?name==`web`].image | [0]' --output text)"
if [[ "$current_image" == "$image" ]]; then
  echo "$environment already runs this image"
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
digest="$(aws ecr describe-images --repository-name "$repository" --image-ids "imageTag=$GITHUB_SHA" --query 'imageDetails[0].imageDigest' --output text)"
[[ "$digest" == sha256:* ]] || { echo 'ECR image verification failed' >&2; exit 1; }

# 최신 ACTIVE family를 바탕으로 신규 revision을 만들어 Terraform이 바꾼 태스크
# 설정도 다음 앱 배포에 반영한다. ECS API의 등록 가능 필드만 골라 보낸다.
latest_json="$(aws ecs describe-task-definition --task-definition "$family" --output json)"
jq -e --arg image "$image" --arg environment "$environment" '
  .taskDefinition as $task |
  if ($task.containerDefinitions | length) != 1 or $task.containerDefinitions[0].name != "web" then
    error("unexpected task definition containers")
  else
    {
      family: $task.family,
      taskRoleArn: $task.taskRoleArn,
      executionRoleArn: $task.executionRoleArn,
      networkMode: $task.networkMode,
      containerDefinitions: ($task.containerDefinitions | map(.image = $image)),
      volumes: $task.volumes,
      placementConstraints: $task.placementConstraints,
      requiresCompatibilities: $task.requiresCompatibilities,
      cpu: $task.cpu,
      memory: $task.memory,
      runtimePlatform: $task.runtimePlatform,
      pidMode: $task.pidMode,
      ipcMode: $task.ipcMode,
      proxyConfiguration: $task.proxyConfiguration,
      ephemeralStorage: $task.ephemeralStorage,
      tags: [
        {key: "Project", value: "aws-fullstack-lab"},
        {key: "Environment", value: $environment},
        {key: "ManagedBy", value: "github-actions"}
      ]
    } | with_entries(select(.value != null))
  end
' <<<"$latest_json" > "$RUNNER_TEMP/task-definition.json"

new_revision="$(aws ecs register-task-definition --cli-input-json "file://$RUNNER_TEMP/task-definition.json" --query 'taskDefinition.taskDefinitionArn' --output text)"
aws ecs update-service --cluster "$cluster" --service web --task-definition "$new_revision" --query 'service.status' --output text >/dev/null
aws ecs wait services-stable --cluster "$cluster" --services web
service_json="$(aws ecs describe-services --cluster "$cluster" --services web --output json)"
jq -e --arg revision "$new_revision" --argjson count "$expected_count" '
  (.failures | length) == 0 and
  .services[0].taskDefinition == $revision and
  .services[0].desiredCount == $count and
  .services[0].runningCount == $count and
  (.services[0].deployments | length) == 1 and
  .services[0].deployments[0].rolloutState == "COMPLETED"
' <<<"$service_json" >/dev/null || { echo "$environment deployment did not complete" >&2; exit 1; }

if [[ "$environment" == prod ]]; then
  health="$(curl --retry 5 --retry-delay 3 -fsS https://aws.bandal.dev/api/health)"
  jq -e '.status == "ok"' <<<"$health" >/dev/null
fi
{
  echo "### $environment deployment"
  echo "- commit: \`$GITHUB_SHA\`"
  echo "- digest: \`$digest\`"
  echo "- ECS running tasks: $expected_count/$expected_count"
} >> "$GITHUB_STEP_SUMMARY"
