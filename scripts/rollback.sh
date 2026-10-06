#!/usr/bin/env bash
# prod를 ECR에 남아 있는 이전 이미지로 되돌린다. 빌드하지 않는다.
#   rollback.sh previous   # 직전 성공 배포 전에 돌던 이미지. 두 번 실행하면 롤백을 되돌린다
#   rollback.sh <SHA>      # 지정한 commit 이미지. ECR은 최근 5개만 남긴다
set -euo pipefail
source "$(dirname "$0")/lib/ecs-deploy.sh"

target="${1:-}"
[[ "${GITHUB_EVENT_NAME:-}" == workflow_dispatch && "${GITHUB_REF:-}" == refs/heads/main ]] || exit 2
[[ "$target" == previous || "$target" =~ ^[a-f0-9]{40}$ ]] || {
  echo 'usage: rollback.sh previous|<40-char commit SHA>' >&2
  exit 2
}

ecs_init prod
current_tag="${current_image##*:}"

revision_task_definition() {
  aws ecs describe-service-revisions --service-revision-arns "$1" \
    --query 'serviceRevisions[0].taskDefinition' --output text
}

if [[ "$target" == previous ]]; then
  # circuit breaker·alarm 롤백은 ROLLBACK_SUCCESSFUL이므로 SUCCESSFUL만 사람이 의도한 배포다.
  latest="$(aws ecs list-service-deployments --cluster "$cluster" --service web --status SUCCESSFUL --output json \
    | jq -r '.serviceDeployments | sort_by(.createdAt) | last // empty | .serviceDeploymentArn')"
  [[ -n "$latest" ]] || { echo 'no successful deployment found; pass a commit SHA' >&2; exit 1; }
  deployment="$(aws ecs describe-service-deployments --service-deployment-arns "$latest" --output json)"
  [[ "$(revision_task_definition "$(jq -r '.serviceDeployments[0].targetServiceRevision.arn' <<<"$deployment")")" == "$current_revision" ]] || {
    echo 'the service is not running its latest successful deployment; pass a commit SHA' >&2
    exit 1
  }
  source_arn="$(jq -r '.serviceDeployments[0].sourceServiceRevisions[0].arn // empty' <<<"$deployment")"
  [[ -n "$source_arn" ]] || { echo 'the latest deployment has no previous revision; pass a commit SHA' >&2; exit 1; }
  target="$(image_of "$(revision_task_definition "$source_arn")")"
  target="${target##*:}"
  [[ "$target" =~ ^[a-f0-9]{40}$ ]] || { echo "previous image tag is not a commit SHA: $target" >&2; exit 1; }
fi

echo "rollback: $current_tag -> $target"
{
  echo '### prod rollback'
  echo "- from: \`$current_tag\`"
  echo "- requested by: @$GITHUB_ACTOR"
} >> "$GITHUB_STEP_SUMMARY"
deploy_image "$target"
