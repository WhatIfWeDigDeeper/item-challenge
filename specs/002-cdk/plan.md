# Phase 2: CDK Infrastructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold and implement the CDK app under `infrastructure/`, assertion tests, and LocalStack deploy tooling. After completing all tasks, `cdk synth` produces valid CloudFormation and the CDK assertion tests pass.

**Architecture:** Single CDK stack (`ExamItemsStack`) containing one DynamoDB table, 6 `NodejsFunction` Lambda constructs (one per handler from Phase 1), and one API Gateway REST API wiring all 6 routes. See `specs/002-cdk/design.md` for full architectural rationale.

**Tech Stack:** TypeScript, `aws-cdk-lib`, `constructs`, `aws-cdk` (CLI), `aws-cdk-local` (`cdklocal` CLI), `tsx`, `vitest`, LocalStack (Docker)

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `infrastructure/package.json` | Create | CDK-specific deps; `cdk synth`, `deploy:local` scripts |
| `infrastructure/tsconfig.json` | Create | ES2022, NodeNext, strict |
| `infrastructure/cdk.json` | Create | CDK app entrypoint config |
| `infrastructure/bin/app.ts` | Create | CDK App — instantiates `ExamItemsStack` |
| `infrastructure/lib/exam-items-stack.ts` | Create | Full stack: DynamoDB + 6 Lambdas + API Gateway |
| `infrastructure/test/exam-items-stack.test.ts` | Create | CDK assertion tests (vitest) |
| `docker-compose.localstack.yml` | Create | LocalStack container at project root |
| `scripts/localstack-deploy.sh` | Create | Bootstrap + deploy + smoke test |

---

## Task 1: Scaffold `infrastructure/`

**Files:** `infrastructure/package.json`, `infrastructure/tsconfig.json`, `infrastructure/cdk.json`, `infrastructure/bin/app.ts`

- [ ] **Step 1: Create `infrastructure/package.json`**

  Runtime dependencies: `aws-cdk-lib`, `constructs`
  Dev dependencies: `aws-cdk`, `aws-cdk-local`, `tsx`, `typescript`, `vitest`, `@types/node`

  Scripts:
  ```json
  {
    "scripts": {
      "build":        "tsc --noEmit",
      "synth":        "cdk synth",
      "deploy:local": "bash ../scripts/localstack-deploy.sh",
      "test":         "vitest run"
    }
  }
  ```

  Expected: `package.json` created with correct deps.

- [ ] **Step 2: Install dependencies**

  ```bash
  cd infrastructure && npm install
  ```

  Expected: `node_modules/` populated, no peer-dependency errors.

- [ ] **Step 3: Create `infrastructure/tsconfig.json`**

  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "NodeNext",
      "moduleResolution": "NodeNext",
      "lib": ["ES2022"],
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "outDir": "dist"
    },
    "include": ["bin", "lib", "test"]
  }
  ```

  Expected: `tsc --noEmit` exits 0.

- [ ] **Step 4: Create `infrastructure/cdk.json`**

  ```json
  {
    "app": "npx tsx bin/app.ts",
    "watch": {
      "include": ["**"],
      "exclude": ["README.md", "cdk*.json", "**/*.d.ts", "**/*.js", "dist"]
    }
  }
  ```

  Expected: `cdk synth` (once the stack exists) uses `tsx` to run TypeScript directly.

- [ ] **Step 5: Create `infrastructure/bin/app.ts`**

  ```typescript
  import * as cdk from 'aws-cdk-lib';
  import { ExamItemsStack } from '../lib/exam-items-stack';

  const app = new cdk.App();
  new ExamItemsStack(app, 'ExamItemsStack', {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region:  process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
    },
  });
  ```

  Expected: file compiles without errors.

---

## Task 2: Implement `exam-items-stack.ts`

**File:** `infrastructure/lib/exam-items-stack.ts`

This is the core deliverable. Implement each sub-step in order — later steps depend on earlier ones.

- [ ] **Step 1: DynamoDB table**

  Create table with:
  - Partition key: `id` (STRING)
  - Sort key: `sk` (STRING)
  - Billing mode: `PAY_PER_REQUEST`
  - Removal policy: `DESTROY`
  - Table name: `process.env.DYNAMODB_TABLE_NAME ?? 'ExamItems'`

- [ ] **Step 2: Add GSIs**

  Add two GSIs to the table (see design.md Section 4 for attribute names):
  - `SubjectIndex`: partition key `subject` (STRING), sort key `sk` (STRING)
  - `StatusIndex`: partition key `itemStatus` (STRING), sort key `sk` (STRING)

- [ ] **Step 3: Implement `createHandlerFunction()` helper**

  Private method accepting `(id, entry, handler)`. Shared config: `NODEJS_22_X`, 256 MB memory, 30s timeout, esbuild bundling with `minify: true`. Environment variables passed to every function:
  - `USE_DYNAMODB=true`
  - `DYNAMODB_TABLE_NAME`: `table.tableName` (CDK token)
  - `AWS_REGION`: `this.region` (CDK token)

- [ ] **Step 4: Create 6 Lambda functions**

  Call `createHandlerFunction()` once for each handler. Use the entry/handler mapping from design.md Section 5. Note: `entry` paths must be relative to the `infrastructure/` directory (e.g., `'../src/handlers/create-item.ts'`).

  | Construct ID | Entry | Handler |
  |-------------|-------|---------|
  | `CreateItemFunction` | `../src/handlers/create-item.ts` | `createItemHandler` |
  | `GetItemFunction` | `../src/handlers/get-item.ts` | `getItemHandler` |
  | `UpdateItemFunction` | `../src/handlers/update-item.ts` | `updateItemHandler` |
  | `ListItemsFunction` | `../src/handlers/list-items.ts` | `listItemsHandler` |
  | `CreateVersionFunction` | `../src/handlers/create-version.ts` | `createVersionHandler` |
  | `GetAuditFunction` | `../src/handlers/get-audit.ts` | `getAuditHandler` |

- [ ] **Step 5: Apply IAM grants**

  Per design.md Section 7:
  - `grantReadData`: `GetItemFunction`, `ListItemsFunction`, `GetAuditFunction`
  - `grantReadWriteData`: `CreateItemFunction`, `UpdateItemFunction`, `CreateVersionFunction`

- [ ] **Step 6: Create API Gateway REST API**

  ```typescript
  const api = new apigateway.RestApi(this, 'ExamItemsApi', {
    restApiName: 'ExamItemsApi',
    defaultCorsPreflightOptions: {
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: apigateway.Cors.ALL_METHODS,
    },
  });
  ```

- [ ] **Step 7: Wire API routes**

  Build the resource tree and attach Lambda proxy integrations per design.md Section 6:

  ```
  /api/items          GET → ListItems,    POST → CreateItem
  /api/items/{id}     GET → GetItem,      PUT  → UpdateItem
  /api/items/{id}/versions  POST → CreateVersion
  /api/items/{id}/audit     GET  → GetAudit
  ```

- [ ] **Step 8: Add stack outputs**

  - `ApiUrl`: `api.url`
  - `TableName`: `table.tableName`
  - One output per Lambda ARN (e.g., `CreateItemFunctionArn`, etc.)

  Expected: `cdk synth` exits 0 and the template contains all outputs.

---

## Task 3: CDK Assertion Tests

**File:** `infrastructure/test/exam-items-stack.test.ts`

All tests use `aws-cdk-lib/assertions` (`Template.fromStack()`). No deployment or network access.

- [ ] **Test: DynamoDB key schema**

  Assert the template has a `AWS::DynamoDB::Table` resource with:
  - `KeySchema` containing `{ AttributeName: 'id', KeyType: 'HASH' }`
  - `KeySchema` containing `{ AttributeName: 'sk', KeyType: 'RANGE' }`

- [ ] **Test: Table has 2 GSIs**

  Assert the `GlobalSecondaryIndexes` array has length 2.

- [ ] **Test: SubjectIndex GSI**

  Assert one GSI entry has `IndexName: 'SubjectIndex'` and partition key `subject`.

- [ ] **Test: StatusIndex GSI**

  Assert one GSI entry has `IndexName: 'StatusIndex'` and partition key `itemStatus`.

- [ ] **Test: 6 Lambda functions exist**

  ```typescript
  template.resourceCountIs('AWS::Lambda::Function', 6);
  ```

- [ ] **Test: All Lambda functions use Node 22**

  Assert all 6 functions have `Runtime: 'nodejs22.x'`.

- [ ] **Test: IAM — read-write functions have write permission**

  Assert that at least one IAM policy document contains `dynamodb:PutItem` in its actions.

- [ ] **Test: IAM — read-only functions lack write permission**

  Assert that the IAM policy attached to `GetItemFunction` does not contain `dynamodb:PutItem`.

- [ ] **Test: REST API exists**

  ```typescript
  template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
  ```

- [ ] **Test: API resource paths**

  Assert the template contains `AWS::ApiGateway::Resource` resources with `PathPart: 'items'` and `PathPart: '{id}'`.

  Expected: `cd infrastructure && npx vitest run` → all tests pass.

---

## Task 4: LocalStack Setup

**Files:** `docker-compose.localstack.yml` (project root), `scripts/localstack-deploy.sh`

- [ ] **Step 1: Create `docker-compose.localstack.yml`**

  ```yaml
  services:
    localstack:
      image: localstack/localstack:latest
      ports:
        - "4566:4566"
      environment:
        - SERVICES=lambda,apigateway,dynamodb,iam,sts
        - DEFAULT_REGION=us-east-1
      volumes:
        - "/var/run/docker.sock:/var/run/docker.sock"
  ```

  Expected: `docker compose -f docker-compose.localstack.yml up -d` starts LocalStack.

- [ ] **Step 2: Create `scripts/localstack-deploy.sh`**

  Script steps:
  1. Poll `http://localhost:4566/_localstack/health` until `"dynamodb": "available"` (max 60s, 2s interval)
  2. `cd "$(dirname "$0")/../infrastructure"`
  3. `cdklocal bootstrap`
  4. `cdklocal deploy --require-approval never --outputs-file /tmp/cdk-outputs.json`
  5. Parse `API_URL` from `/tmp/cdk-outputs.json` using `node -e` or `jq`
  6. Smoke test: `curl -sf "${API_URL}api/items"` — assert HTTP 200

  Mark script executable (`chmod +x`).

- [ ] **Step 3: Add `deploy:local` script to `infrastructure/package.json`**

  ```json
  "deploy:local": "bash ../scripts/localstack-deploy.sh"
  ```

---

## Verification

Run these commands in order to confirm all tasks are complete:

```bash
# 1. CDK synthesis — must exit 0 and print valid CloudFormation YAML
cd infrastructure && npm install && npx cdk synth

# 2. CDK assertion tests — all tests must pass
cd infrastructure && npx vitest run

# 3. LocalStack deployment (requires Docker)
docker compose -f docker-compose.localstack.yml up -d
cd infrastructure && npx cdklocal deploy --require-approval never

# 4. Smoke test the deployed API
curl http://localhost:4566/restapis/.../prod/api/items
```

A passing `cdk synth` and green assertion tests are the primary success criteria. LocalStack deployment is a bonus validation that proves the CloudFormation template is executable, not just syntactically valid.
