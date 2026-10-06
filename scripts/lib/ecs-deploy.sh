# build-push-deploy.sh와 rollback.sh가 공유하는 ECS 배포 단계. source해서 쓴다.
# ecs_init <환경>이 대상 이름과 현재 상태를 정하고, deploy_image <SHA>가 ECR에 있는
# 이미지로 새 revision을 등록해 배포·검증한다.

ecs_init() {
  environment="$1"
  case "$environment" in
    preprod) expected_count=1 ;;
    prod) expected_count=2 ;;
    *) echo "unknown environment: $environment" >&2; exit 2 ;;
  esac

  [[ "${AWS_ACCOUNT_ID:-}" =~ ^[0-9]{12}$ ]] || { echo 'AWS_ACCOUNT_ID is missing' >&2; exit 2; }
  [[ -n "${AWS_REGION:-}" ]] || { echo 'AWS_REGION is missing' >&2; exit 2; }

  local actual_account
  actual_account="$(aws sts get-caller-identity --query Account --output text)"
  [[ "$actual_account" == "$AWS_ACCOUNT_ID" ]] || { echo 'AWS account mismatch' >&2; exit 1; }

  name_prefix="aws-fullstack-lab-$environment"
  cluster="$name_prefix-cluster"
  family="$name_prefix-web"
  repository="$family"
  registry="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

  local service_json
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
  current_image="$(image_of "$current_revision")"
}

image_of() {
  aws ecs describe-task-definition --task-definition "$1" \
    --query 'taskDefinition.containerDefinitions[?name==`web`].image | [0]' --output text
}

verify_deployment() {
  local revision="$1" service_json rollout_complete=false
  aws ecs wait services-stable --cluster "$cluster" --services web
  for _ in $(seq 1 30); do
    service_json="$(aws ecs describe-services --cluster "$cluster" --services web --output json)"
    if jq -e --arg revision "$revision" --argjson count "$expected_count" '
      (.failures | length) == 0 and
      .services[0].taskDefinition == $revision and
      .services[0].desiredCount == $count and
      .services[0].runningCount == $count and
      (.services[0].deployments | length) == 1 and
      .services[0].deployments[0].rolloutState == "COMPLETED"
    ' <<<"$service_json" >/dev/null; then
      rollout_complete=true
      break
    fi
    # circuit breaker나 5xx alarm이 이전 revision으로 되돌린 경우다.
    if jq -e --arg revision "$revision" '
      .services[0].taskDefinition != $revision or
      any(.services[0].deployments[]?; .status == "PRIMARY" and .rolloutState == "FAILED")
    ' <<<"$service_json" >/dev/null; then
      echo "$environment ECS rollout failed and was rolled back:" >&2
      jq -r '.services[0].events[:5][] | "  \(.createdAt) \(.message)"' <<<"$service_json" >&2
      exit 1
    fi
    sleep 10
  done
  [[ "$rollout_complete" == true ]] || { echo "$environment deployment did not complete" >&2; exit 1; }

  if [[ "$environment" == prod ]]; then
    local health target_group_arn target_json target_ready=false
    target_group_arn="$(jq -er '
      .services[0].loadBalancers | if length == 1 then .[0].targetGroupArn else empty end
    ' <<<"$service_json")" || { echo 'prod target group is missing' >&2; exit 1; }
    for _ in $(seq 1 30); do
      target_json="$(aws elbv2 describe-target-health --target-group-arn "$target_group_arn" --output json)"
      if jq -e --argjson count "$expected_count" '
        [.TargetHealthDescriptions[] | select(.TargetHealth.State == "healthy") | .Target.Id] as $ids
        | ($ids | length) == $count and ($ids | unique | length) == $count
      ' <<<"$target_json" >/dev/null; then
        target_ready=true
        break
      fi
      sleep 10
    done
    if [[ "$target_ready" != true ]]; then
      echo 'prod ALB targets are not healthy on two distinct EC2 instances:' >&2
      jq -r '.TargetHealthDescriptions[] | "  \(.Target.Id):\(.Target.Port) \(.TargetHealth.State)"' <<<"$target_json" >&2
      exit 1
    fi
    echo 'prod ALB healthy targets (EC2:port):'
    jq -r '.TargetHealthDescriptions[] | select(.TargetHealth.State == "healthy") | "  \(.Target.Id):\(.Target.Port)"' <<<"$target_json"
    {
      echo '- ALB healthy targets on distinct EC2 instances:'
      jq -r '.TargetHealthDescriptions[] | select(.TargetHealth.State == "healthy") | "  - \(.Target.Id):\(.Target.Port)"' <<<"$target_json"
    } >> "$GITHUB_STEP_SUMMARY"
    health="$(curl --retry 5 --retry-delay 3 -fsS https://aws.bandal.dev/api/health)"
    jq -e '.status == "ok" and .environment == "prod"' <<<"$health" >/dev/null
  fi
}

deploy_image() {
  local tag="$1" image digest latest_json new_revision
  image="$registry/$repository:$tag"

  if [[ "$current_image" == "$image" ]]; then
    verify_deployment "$current_revision"
    echo "$environment already runs this image"
    return
  fi

  digest="$(aws ecr describe-images --repository-name "$repository" --image-ids "imageTag=$tag" \
    --query 'imageDetails[0].imageDigest' --output text 2>/dev/null || true)"
  [[ "$digest" == sha256:* ]] || { echo "ECR image $tag is missing (ECR keeps the latest 5 images)" >&2; exit 1; }

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
  verify_deployment "$new_revision"
  {
    echo "- commit: \`$tag\`"
    echo "- digest: \`$digest\`"
    echo "- ECS running tasks: $expected_count/$expected_count"
  } >> "$GITHUB_STEP_SUMMARY"
}
