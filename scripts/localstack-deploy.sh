#!/usr/bin/env bash
# LocalStack deployment script for exam-items infrastructure.
# Requires:
#   - LocalStack running: docker compose -f docker-compose.localstack.yml up -d
#   - aws-cdk-local installed (cdklocal): npm install -g aws-cdk-local
#   - AWS CDK installed: npm install -g aws-cdk
#
# Usage: bash scripts/localstack-deploy.sh [--no-smoke-test]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$SCRIPT_DIR/../infrastructure"
LOCALSTACK_ENDPOINT="http://localhost:4566"
STACK_NAME="${CDK_STACK_NAME:-ExamItemsStack}"
NO_SMOKE_TEST="${1:-}"

# Fake AWS credentials for LocalStack (it doesn't validate them)
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=us-east-1
export AWS_ENDPOINT_URL="$LOCALSTACK_ENDPOINT"

echo "==> Checking LocalStack health..."
if ! curl -sf "$LOCALSTACK_ENDPOINT/_localstack/health" > /dev/null; then
  echo "ERROR: LocalStack is not running at $LOCALSTACK_ENDPOINT"
  echo "Start it with: docker compose -f docker-compose.localstack.yml up -d"
  exit 1
fi
echo "    LocalStack is healthy."

echo ""
echo "==> Bootstrapping CDK for LocalStack..."
cd "$INFRA_DIR"
cdklocal bootstrap aws://000000000000/us-east-1 --require-approval never

echo ""
echo "==> Deploying $STACK_NAME to LocalStack..."
cdklocal deploy "$STACK_NAME" --require-approval never --outputs-file /tmp/exam-items-outputs.json

echo ""
echo "==> Deployment complete! Stack outputs:"
python3 -m json.tool /tmp/exam-items-outputs.json || cat /tmp/exam-items-outputs.json

if [[ "$NO_SMOKE_TEST" == "--no-smoke-test" ]]; then
  echo ""
  echo "Skipping smoke test (--no-smoke-test flag set)."
  exit 0
fi

echo ""
echo "==> Running smoke test..."

# Extract API URL from outputs
API_URL=$(python3 -c "
import json, sys
with open('/tmp/exam-items-outputs.json') as f:
    data = json.load(f)
stacks = list(data.values())
for stack in stacks:
    if 'ApiUrl' in stack:
        print(stack['ApiUrl'].rstrip('/'))
        sys.exit(0)
print('')
")

if [[ -z "$API_URL" ]]; then
  echo "WARNING: Could not extract API URL from outputs. Skipping smoke test."
  exit 0
fi

echo "    API URL: $API_URL"

# Create an item
echo "    POST /api/items..."
RESPONSE=$(curl -sf -X POST "$API_URL/api/items" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Mathematics",
    "itemType": "multiple-choice",
    "difficulty": 3,
    "content": {
      "question": "What is 2+2?",
      "options": ["3", "4", "5"],
      "correctAnswer": "4",
      "explanation": "2+2 equals 4 by the definition of addition."
    },
    "securityLevel": "standard",
    "metadata": {
      "status": "draft",
      "author": "smoke-test",
      "tags": []
    }
  }') || {
  echo "ERROR: POST /api/items failed — smoke test did not pass"
  exit 1
}

echo "    Response: $RESPONSE"
echo ""
echo "==> Smoke test passed!"
