#!/usr/bin/env bash
# scripts/canary-deploy.sh
# Canary deployment orchestrator for Finchippay-Solution.
#
# Supports two deployment targets:
#   frontend  — Vercel Blue-Green (alias → health check → promote)
#   backend   — AWS ECS weighted routing (10% → 50% → 100% via ALB)
#
# Usage:
#   chmod +x scripts/canary-deploy.sh
#   ./scripts/canary-deploy.sh frontend  [commit-sha]
#   ./scripts/canary-deploy.sh backend   [commit-sha]
#
# Required environment variables:
#   Frontend:
#     VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID, HEALTH_CHECK_URL
#   Backend:
#     AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
#     ECS_CLUSTER, ECS_SERVICE, ALB_LISTENER_ARN, HEALTH_CHECK_URL
#   Monitoring:
#     SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT (optional)

set -euo pipefail

TARGET="${1:-}"
COMMIT_SHA="${2:-$(git rev-parse HEAD 2>/dev/null || echo "unknown")}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CANARY_MONITOR="$SCRIPT_DIR/canary-monitor.js"
ROLLBACK_SCRIPT="$SCRIPT_DIR/rollback.sh"

# ─── Configuration ────────────────────────────────────────────────────────────
CANARY_WEIGHT_START="${CANARY_WEIGHT_START:-10}"
CANARY_WEIGHT_STEP="${CANARY_WEIGHT_STEP:-50}"
CANARY_WEIGHT_FINAL="${CANARY_WEIGHT_FINAL:-100}"
MONITOR_DURATION_MINUTES="${MONITOR_DURATION_MINUTES:-5}"
HEALTH_CHECK_URL="${HEALTH_CHECK_URL:-http://localhost:4000/health}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info()  { echo -e "${BLUE}[canary-deploy]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[canary-deploy] ✓${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[canary-deploy] ⚠${NC} $*"; }
log_error() { echo -e "${RED}[canary-deploy] ✗${NC} $*"; }

# ─── Usage ────────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $0 <frontend|backend> [commit-sha]

Deploy a canary release and promote gradually while monitoring health.

Targets:
  frontend  — Deploy to Vercel staging alias, health-check, then promote
  backend   — Deploy new ECS task set with weighted ALB routing (${CANARY_WEIGHT_START}% → ${CANARY_WEIGHT_STEP}% → ${CANARY_WEIGHT_FINAL}%)

Options:
  CANARY_WEIGHT_START       Initial traffic percentage (default: ${CANARY_WEIGHT_START})
  MONITOR_DURATION_MINUTES  How long to monitor each stage (default: ${MONITOR_DURATION_MINUTES})
  HEALTH_CHECK_URL          URL to health-check (default: ${HEALTH_CHECK_URL})

Environment:
  Vercel: VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID
  AWS:    AWS_REGION, ECS_CLUSTER, ECS_SERVICE, ALB_LISTENER_ARN
EOF
  exit 1
}

# ─── Validate ─────────────────────────────────────────────────────────────────

validate_vercel() {
  local missing=()
  for var in VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID; do
    if [ -z "${!var:-}" ]; then
      missing+=("$var")
    fi
  done
  if [ ${#missing[@]} -gt 0 ]; then
    log_error "Missing Vercel environment variables: ${missing[*]}"
    return 1
  fi
}

validate_aws() {
  local missing=()
  for var in AWS_REGION ECS_CLUSTER ECS_SERVICE ALB_LISTENER_ARN; do
    if [ -z "${!var:-}" ]; then
      missing+=("$var")
    fi
  done
  if [ ${#missing[@]} -gt 0 ]; then
    log_error "Missing AWS environment variables: ${missing[*]}"
    return 1
  fi
  if ! command -v aws &>/dev/null; then
    log_error "AWS CLI not found. Install: pip install awscli"
    return 1
  fi
}

# ─── Health check helper ──────────────────────────────────────────────────────

health_check() {
  local url="${1:-$HEALTH_CHECK_URL}"
  local max_retries="${2:-30}"
  local delay="${3:-2}"

  log_info "Waiting for health check at $url ..."
  for i in $(seq 1 "$max_retries"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      log_ok "Health check passed (attempt $i)"
      return 0
    fi
    sleep "$delay"
  done
  log_error "Health check failed after $max_retries attempts"
  return 1
}

# ─── Monitor canary ───────────────────────────────────────────────────────────

run_monitor() {
  local stage="$1"
  log_info "Starting canary monitoring for stage: $stage (${MONITOR_DURATION_MINUTES} minutes)..."

  if [ ! -f "$CANARY_MONITOR" ]; then
    log_warn "canary-monitor.js not found at $CANARY_MONITOR — skipping Sentry monitoring"
    log_info "Running basic health-check loop for ${MONITOR_DURATION_MINUTES} minutes..."
    local end_time=$(($(date +%s) + MONITOR_DURATION_MINUTES * 60))
    while [ "$(date +%s)" -lt "$end_time" ]; do
      if ! curl -fsS "$HEALTH_CHECK_URL" >/dev/null 2>&1; then
        log_error "Health check failed during monitoring — triggering rollback"
        return 1
      fi
      sleep 10
    done
    log_ok "Basic health monitoring passed for $stage"
    return 0
  fi

  node "$CANARY_MONITOR" \
    --duration "$MONITOR_DURATION_MINUTES" \
    --health-url "$HEALTH_CHECK_URL" \
    --stage "$stage" \
    --threshold-error-rate "${CANARY_ERROR_THRESHOLD:-1}" \
    --threshold-latency-multiplier "${CANARY_LATENCY_MULTIPLIER:-2}" \
    --threshold-5xx-per-minute "${CANARY_5XX_THRESHOLD:-5}"
}

# ─── Frontend: Vercel Blue-Green ──────────────────────────────────────────────

deploy_frontend() {
  log_info "═══════════════════════════════════════════"
  log_info "  Frontend Canary: Vercel Blue-Green"
  log_info "  SHA: $COMMIT_SHA"
  log_info "═══════════════════════════════════════════"

  validate_vercel

  if ! command -v vercel &>/dev/null; then
    log_info "Installing Vercel CLI..."
    npm install -g vercel@latest
  fi

  local PROJECT_DIR="$SCRIPT_DIR/../frontend"
  local CANARY_ALIAS="canary-${COMMIT_SHA:0:8}.finchippay.vercel.app"

  # Step 1: Deploy staging build
  log_info "Deploying staging build to Vercel..."
  cd "$PROJECT_DIR"

  vercel pull --yes --environment=production --token="$VERCEL_TOKEN"
  vercel build --prod --token="$VERCEL_TOKEN"

  local CANARY_URL
  CANARY_URL=$(vercel deploy --prebuilt --token="$VERCEL_TOKEN")
  log_ok "Deployed to: $CANARY_URL"

  # Save deployment info for rollback
  echo "$CANARY_URL" > /tmp/canary-frontend-url.txt
  echo "$CANARY_ALIAS" > /tmp/canary-frontend-alias.txt

  # Step 2: Assign canary alias
  log_info "Assigning canary alias: $CANARY_ALIAS"
  vercel alias set "$CANARY_URL" "$CANARY_ALIAS" --token="$VERCEL_TOKEN" || {
    log_error "Failed to assign canary alias"
    return 1
  }
  log_ok "Canary alias assigned: https://$CANARY_ALIAS"

  # Step 3: Health check the canary URL
  local CANARY_HEALTH_URL="https://$CANARY_ALIAS/api/health"
  if ! health_check "$CANARY_HEALTH_URL" 30 2; then
    log_error "Canary health check failed — rolling back"
    bash "$ROLLBACK_SCRIPT" frontend "$COMMIT_SHA"
    return 1
  fi

  # Step 4: Monitor canary
  if ! run_monitor "frontend-staging"; then
    log_error "Canary monitoring detected degradation — rolling back"
    bash "$ROLLBACK_SCRIPT" frontend "$COMMIT_SHA"
    return 1
  fi

  # Step 5: Promote to production
  log_info "Promoting canary to production..."
  vercel promote "$CANARY_URL" --token="$VERCEL_TOKEN" || {
    log_error "Vercel promote failed — rolling back"
    bash "$ROLLBACK_SCRIPT" frontend "$COMMIT_SHA"
    return 1
  }
  log_ok "Promoted to production: https://finchippay.vercel.app"

  # Step 6: Cleanup
  log_info "Removing canary alias..."
  vercel alias rm "$CANARY_ALIAS" --token="$VERCEL_TOKEN" --yes 2>/dev/null || true
  rm -f /tmp/canary-frontend-url.txt /tmp/canary-frontend-alias.txt

  log_ok "Frontend canary deployment complete!"
  return 0
}

# ─── Backend: ECS Weighted Routing ────────────────────────────────────────────

get_current_task_def() {
  aws ecs describe-services \
    --cluster "$ECS_CLUSTER" \
    --services "$ECS_SERVICE" \
    --region "$AWS_REGION" \
    --query "services[0].taskDefinition" \
    --output text
}

get_current_target_group() {
  aws elbv2 describe-listeners \
    --listener-arns "$ALB_LISTENER_ARN" \
    --region "$AWS_REGION" \
    --query "Listeners[0].DefaultActions[0].ForwardConfig.TargetGroups[0].TargetGroupArn" \
    --output text
}

get_lb_vpc_id() {
  local lb_arn
  lb_arn=$(aws elbv2 describe-listeners \
    --listener-arns "$ALB_LISTENER_ARN" \
    --region "$AWS_REGION" \
    --query "Listeners[0].LoadBalancerArn" \
    --output text)
  aws elbv2 describe-load-balancers \
    --load-balancer-arns "$lb_arn" \
    --region "$AWS_REGION" \
    --query "LoadBalancers[0].VpcId" \
    --output text
}

deploy_backend() {
  log_info "═══════════════════════════════════════════"
  log_info "  Backend Canary: ECS Weighted Routing"
  log_info "  SHA: $COMMIT_SHA"
  log_info "  Route: ${CANARY_WEIGHT_START}% → ${CANARY_WEIGHT_STEP}% → ${CANARY_WEIGHT_FINAL}%"
  log_info "═══════════════════════════════════════════"

  validate_aws

  # Step 1: Save current state for rollback
  local OLD_TASK_DEF
  OLD_TASK_DEF=$(get_current_task_def)
  local OLD_TG_ARN
  OLD_TG_ARN=$(get_current_target_group)

  log_info "Current task definition: $OLD_TASK_DEF"
  log_info "Current target group: $OLD_TG_ARN"

  echo "$OLD_TASK_DEF" > /tmp/canary-backend-old-taskdef.txt
  echo "$OLD_TG_ARN" > /tmp/canary-backend-old-tg.txt

  # Step 2: Register new task definition (strip read-only fields)
  log_info "Registering new task definition..."
  local TASK_DEF_JSON
  TASK_DEF_JSON=$(aws ecs describe-task-definition \
    --task-definition "$OLD_TASK_DEF" \
    --region "$AWS_REGION" \
    --query 'taskDefinition' \
    --output json)

  # Remove read-only fields that would cause register-task-definition to fail
  local CLEAN_TASK_DEF_JSON
  CLEAN_TASK_DEF_JSON=$(printf '%s\n' "$TASK_DEF_JSON" | node -e "
    const td = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    delete td.taskDefinitionArn;
    delete td.revision;
    delete td.status;
    delete td.registeredAt;
    delete td.registeredBy;
    delete td.compatibilities;
    delete td.requiresAttributes;
    process.stdout.write(JSON.stringify(td));
  ")

  local NEW_TASK_DEF
  NEW_TASK_DEF=$(aws ecs register-task-definition \
    --cli-input-json "$CLEAN_TASK_DEF_JSON" \
    --region "$AWS_REGION" \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text)
  log_ok "New task definition: $NEW_TASK_DEF"

  echo "$NEW_TASK_DEF" > /tmp/canary-backend-new-taskdef.txt

  # Step 3: Create new target group for canary
  local CANARY_TG_NAME="finchippay-canary-${COMMIT_SHA:0:8}"
  local VPC_ID
  VPC_ID=$(get_lb_vpc_id)

  log_info "Creating canary target group: $CANARY_TG_NAME"
  local CANARY_TG_ARN
  CANARY_TG_ARN=$(aws elbv2 create-target-group \
    --name "$CANARY_TG_NAME" \
    --protocol HTTP \
    --port 4000 \
    --vpc-id "${VPC_ID:-vpc-default}" \
    --target-type ip \
    --health-check-path /health \
    --health-check-interval-seconds 10 \
    --health-check-timeout-seconds 5 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 3 \
    --region "$AWS_REGION" \
    --query 'TargetGroups[0].TargetGroupArn' \
    --output text)
  log_ok "Canary target group: $CANARY_TG_ARN"

  echo "$CANARY_TG_ARN" > /tmp/canary-backend-canary-tg.txt

  # Step 4: Create a separate canary ECS service linked to the new target group.
  # This ensures the new tasks register with the canary TG for health checks.
  local CANARY_SERVICE_NAME="${ECS_SERVICE}-canary-${COMMIT_SHA:0:8}"
  log_info "Creating canary ECS service: $CANARY_SERVICE_NAME"

  # Get subnet and security group from existing service
  local SERVICE_DETAILS
  SERVICE_DETAILS=$(aws ecs describe-services \
    --cluster "$ECS_CLUSTER" \
    --services "$ECS_SERVICE" \
    --region "$AWS_REGION" \
    --query 'services[0]' \
    --output json)

  local SUBNETS
  SUBNETS=$(printf '%s\n' "$SERVICE_DETAILS" | node -e "
    const s = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const nc = s.networkConfiguration || {};
    const subnets = (nc.awsvpcConfiguration && nc.awsvpcConfiguration.subnets) || [];
    process.stdout.write(subnets.join(','));
  ")

  local SECURITY_GROUPS
  SECURITY_GROUPS=$(printf '%s\n' "$SERVICE_DETAILS" | node -e "
    const s = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const nc = s.networkConfiguration || {};
    const sgs = (nc.awsvpcConfiguration && nc.awsvpcConfiguration.securityGroups) || [];
    process.stdout.write(sgs.join(','));
  ")

  # Derive launch type and container config from existing service
  local LAUNCH_TYPE
  LAUNCH_TYPE=$(printf '%s\n' "$SERVICE_DETAILS" | node -e "
    const s = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    process.stdout.write(s.launchType || 'FARGATE');
  ")

  local CONTAINER_NAME
  CONTAINER_NAME=$(printf '%s\n' "$SERVICE_DETAILS" | node -e "
    const s = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const td = s.taskDefinition || '';
    // Default to common container name; can be overridden via env
    process.stdout.write(process.env.CANARY_CONTAINER_NAME || 'finchippay-backend');
  ")

  local CONTAINER_PORT
  CONTAINER_PORT=$(printf '%s\n' "$SERVICE_DETAILS" | node -e "
    const s = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const lbs = s.loadBalancers || [];
    const port = lbs.length > 0 ? lbs[0].containerPort : (process.env.CANARY_CONTAINER_PORT || 4000);
    process.stdout.write(String(port));
  ")

  local ASSIGN_PUBLIC_IP
  ASSIGN_PUBLIC_IP=$(printf '%s\n' "$SERVICE_DETAILS" | node -e "
    const s = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const nc = s.networkConfiguration || {};
    const awsvpc = nc.awsvpcConfiguration || {};
    process.stdout.write(awsvpc.assignPublicIp || 'DISABLED');
  ")

  aws ecs create-service \
    --cluster "$ECS_CLUSTER" \
    --service-name "$CANARY_SERVICE_NAME" \
    --task-definition "$NEW_TASK_DEF" \
    --desired-count 1 \
    --launch-type "$LAUNCH_TYPE" \
    --network-configuration "awsvpcConfiguration={subnets=[${SUBNETS}],securityGroups=[${SECURITY_GROUPS}],assignPublicIp=${ASSIGN_PUBLIC_IP}}" \
    --load-balancers "targetGroupArn=${CANARY_TG_ARN},containerName=${CONTAINER_NAME},containerPort=${CONTAINER_PORT}" \
    --region "$AWS_REGION" >/dev/null
  log_ok "Canary ECS service created: $CANARY_SERVICE_NAME"

  echo "$CANARY_SERVICE_NAME" > /tmp/canary-backend-service-name.txt

  # Wait for canary tasks to be healthy
  log_info "Waiting for canary tasks to be healthy (up to 5 minutes)..."
  aws ecs wait services-stable \
    --cluster "$ECS_CLUSTER" \
    --services "$CANARY_SERVICE_NAME" \
    --region "$AWS_REGION" || {
    log_error "Canary tasks did not stabilize — rolling back"
    bash "$ROLLBACK_SCRIPT" backend "$COMMIT_SHA"
    return 1
  }
  log_ok "Canary tasks are healthy"

  # Wait for new tasks to be healthy
  log_info "Waiting for new tasks to be healthy (up to 5 minutes)..."
  aws ecs wait services-stable \
    --cluster "$ECS_CLUSTER" \
    --services "$ECS_SERVICE" \
    --region "$AWS_REGION" || {
    log_error "New tasks did not stabilize — rolling back"
    bash "$ROLLBACK_SCRIPT" backend "$COMMIT_SHA"
    return 1
  }
  log_ok "New tasks are healthy"

  # Step 5: Health check the backend
  if ! health_check "$HEALTH_CHECK_URL" 30 2; then
    log_error "Backend health check failed — rolling back"
    bash "$ROLLBACK_SCRIPT" backend "$COMMIT_SHA"
    return 1
  fi

  # Step 6: Gradual traffic shifting
  local TG_ARN_1="$OLD_TG_ARN"
  local TG_ARN_2="$CANARY_TG_ARN"

  # ── Stage 1: 10% → canary ───────────────────────────────────────
  log_info "Shifting traffic: ${CANARY_WEIGHT_START}% → canary"
  aws elbv2 modify-listener \
    --listener-arn "$ALB_LISTENER_ARN" \
    --region "$AWS_REGION" \
    --default-actions \
      "[{\"Type\":\"forward\",\"ForwardConfig\":{\"TargetGroups\":[{\"TargetGroupArn\":\"$TG_ARN_1\",\"Weight\":$((100 - CANARY_WEIGHT_START))},{\"TargetGroupArn\":\"$TG_ARN_2\",\"Weight\":$CANARY_WEIGHT_START}]}}]" >/dev/null

  if ! run_monitor "backend-${CANARY_WEIGHT_START}%"; then
    log_error "Canary degraded at ${CANARY_WEIGHT_START}% — rolling back"
    bash "$ROLLBACK_SCRIPT" backend "$COMMIT_SHA"
    return 1
  fi
  log_ok "Canary healthy at ${CANARY_WEIGHT_START}%"

  # ── Stage 2: 50% → canary ───────────────────────────────────────
  log_info "Shifting traffic: ${CANARY_WEIGHT_STEP}% → canary"
  aws elbv2 modify-listener \
    --listener-arn "$ALB_LISTENER_ARN" \
    --region "$AWS_REGION" \
    --default-actions \
      "[{\"Type\":\"forward\",\"ForwardConfig\":{\"TargetGroups\":[{\"TargetGroupArn\":\"$TG_ARN_1\",\"Weight\":$((100 - CANARY_WEIGHT_STEP))},{\"TargetGroupArn\":\"$TG_ARN_2\",\"Weight\":$CANARY_WEIGHT_STEP}]}}]" >/dev/null

  if ! run_monitor "backend-${CANARY_WEIGHT_STEP}%"; then
    log_error "Canary degraded at ${CANARY_WEIGHT_STEP}% — rolling back"
    bash "$ROLLBACK_SCRIPT" backend "$COMMIT_SHA"
    return 1
  fi
  log_ok "Canary healthy at ${CANARY_WEIGHT_STEP}%"

  # ── Stage 3: 100% → new version ─────────────────────────────────
  log_info "Shifting traffic: ${CANARY_WEIGHT_FINAL}% → new version"
  aws elbv2 modify-listener \
    --listener-arn "$ALB_LISTENER_ARN" \
    --region "$AWS_REGION" \
    --default-actions \
      "[{\"Type\":\"forward\",\"ForwardConfig\":{\"TargetGroups\":[{\"TargetGroupArn\":\"$TG_ARN_2\",\"Weight\":$CANARY_WEIGHT_FINAL}]}}]" >/dev/null

  if ! run_monitor "backend-${CANARY_WEIGHT_FINAL}%"; then
    log_error "Canary degraded at ${CANARY_WEIGHT_FINAL}% — rolling back"
    bash "$ROLLBACK_SCRIPT" backend "$COMMIT_SHA"
    return 1
  fi
  log_ok "Canary healthy at ${CANARY_WEIGHT_FINAL}% — fully promoted!"

  # Step 7: Cleanup old target group
  log_info "Cleaning up old target group: $OLD_TG_ARN"
  sleep 30  # Drain connections
  aws elbv2 delete-target-group \
    --target-group-arn "$OLD_TG_ARN" \
    --region "$AWS_REGION" >/dev/null 2>&1 || log_warn "Could not delete old target group (may have active connections)"
  log_ok "Old target group removed"

  # Step 8: Update main ECS service to new task definition and clean up canary service
  log_info "Updating main ECS service to new task definition..."
  aws ecs update-service \
    --cluster "$ECS_CLUSTER" \
    --service "$ECS_SERVICE" \
    --task-definition "$NEW_TASK_DEF" \
    --region "$AWS_REGION" \
    --force-new-deployment >/dev/null

  # Wait for main service to stabilize with new definition
  aws ecs wait services-stable \
    --cluster "$ECS_CLUSTER" \
    --services "$ECS_SERVICE" \
    --region "$AWS_REGION" || log_warn "Main service stabilization warning"

  log_info "Deleting canary ECS service: $CANARY_SERVICE_NAME"
  aws ecs update-service \
    --cluster "$ECS_CLUSTER" \
    --service "$CANARY_SERVICE_NAME" \
    --desired-count 0 \
    --region "$AWS_REGION" >/dev/null 2>&1 || true
  aws ecs delete-service \
    --cluster "$ECS_CLUSTER" \
    --service "$CANARY_SERVICE_NAME" \
    --region "$AWS_REGION" >/dev/null 2>&1 || log_warn "Could not delete canary service"

  # Cleanup state files
  rm -f /tmp/canary-backend-*.txt

  log_ok "Backend canary deployment complete!"
  return 0
}

# ─── Main ─────────────────────────────────────────────────────────────────────

case "$TARGET" in
  frontend)
    deploy_frontend
    ;;
  backend)
    deploy_backend
    ;;
  *)
    usage
    ;;
esac
