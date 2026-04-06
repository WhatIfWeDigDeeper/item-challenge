# Phase 2: CDK Infrastructure — Design Spec

**Date:** 2026-04-06
**Scope:** CDK app deploying all 6 Lambda functions, API Gateway REST API, and DynamoDB table. LocalStack integration for local deployment validation.

---

## 1. Goals

- Deliver a CDK app under `infrastructure/` that synthesizes valid CloudFormation on `cdk synth`
- Deploy all 6 Lambda-compatible handlers (from Phase 1) as individual Lambda functions behind a single API Gateway REST API
- Provision the DynamoDB table with the schema defined in specs/001 Section 8
- Enable LocalStack deployment via `aws-cdk-local` so the full stack can be validated without an AWS account
- Ship CDK assertion tests that verify key infrastructure properties without deploying

---

## 2. File Structure

```
infrastructure/
├── bin/
│   └── app.ts                    # CDK App entry point, instantiates ExamItemsStack
├── lib/
│   └── exam-items-stack.ts       # Single stack: DynamoDB + 6 Lambdas + API Gateway
├── test/
│   └── exam-items-stack.test.ts  # CDK assertion tests (vitest)
├── cdk.json                      # CDK app config: "npx tsx bin/app.ts"
├── package.json                  # CDK-specific deps, separate from root
└── tsconfig.json                 # ES2022, NodeNext, strict

docker-compose.localstack.yml     # LocalStack container (project root)
scripts/
└── localstack-deploy.sh          # Bootstrap + deploy + smoke test against LocalStack
```

The `infrastructure/` package is intentionally separate from the root `src/` package. CDK constructs are not imported by application code, so they need not share a `node_modules` tree or `tsconfig`. This keeps the app bundle clean and CDK tooling isolated.

---

## 3. Stack Architecture

```
Internet
    │
    ▼
API Gateway REST API  (ExamItemsApi)
    │
    ├── POST   /api/items              → CreateItem Lambda
    ├── GET    /api/items              → ListItems Lambda
    ├── GET    /api/items/{id}         → GetItem Lambda
    ├── PUT    /api/items/{id}         → UpdateItem Lambda
    ├── POST   /api/items/{id}/versions → CreateVersion Lambda
    └── GET    /api/items/{id}/audit   → GetAudit Lambda
                                              │ (all 6)
                                              ▼
                                      DynamoDB Table  (ExamItems)
                                      ├── GSI: SubjectIndex
                                      └── GSI: StatusIndex
```

One Lambda per endpoint. This gives each function an independent IAM policy, independent deployment unit, independent scaling, and isolated blast radius — a failed deployment of `UpdateItem` cannot affect `GetItem`.

---

## 4. DynamoDB Table

The schema is defined in specs/001-api-endpoints/design.md Section 8 and reproduced here for reference. The CDK construct must match exactly.

**Key schema:**

| Attribute | Role | Type |
|-----------|------|------|
| `id` | Partition key | STRING |
| `sk` | Sort key | STRING |

**Sort key patterns:**

| Record type | SK value |
|-------------|----------|
| Current item | `#CURRENT` |
| Version snapshot | `VERSION#0001`, `VERSION#0002`, … |

**GSIs:**

| Index name | Partition key | Sort key | Purpose |
|------------|--------------|----------|---------|
| `SubjectIndex` | `subject` (STRING) | `sk` (STRING) | Filter items by subject without Scan |
| `StatusIndex` | `itemStatus` (STRING) | `sk` (STRING) | Filter items by status without Scan |

`itemStatus` is a top-level denormalized copy of `metadata.status`. DynamoDB cannot index nested attributes, so the application writes this field alongside the nested value on every create/update.

**CDK construct settings:**

```typescript
const table = new dynamodb.Table(this, 'ExamItemsTable', {
  tableName: process.env.DYNAMODB_TABLE_NAME ?? 'ExamItems',
  partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
  sortKey:      { name: 'sk', type: dynamodb.AttributeType.STRING },
  billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

table.addGlobalSecondaryIndex({
  indexName:    'SubjectIndex',
  partitionKey: { name: 'subject',    type: dynamodb.AttributeType.STRING },
  sortKey:      { name: 'sk',         type: dynamodb.AttributeType.STRING },
});

table.addGlobalSecondaryIndex({
  indexName:    'StatusIndex',
  partitionKey: { name: 'itemStatus', type: dynamodb.AttributeType.STRING },
  sortKey:      { name: 'sk',         type: dynamodb.AttributeType.STRING },
});
```

`PAY_PER_REQUEST` billing eliminates capacity planning for a challenge project and scales from zero automatically. `DESTROY` removal policy ensures a `cdk destroy` cleans up completely — appropriate for non-production environments.

---

## 5. Lambda Functions

All functions are created using `NodejsFunction`, which invokes esbuild at synthesis time to bundle each handler and its imports into a single self-contained JS file. This avoids shipping `node_modules` in the Lambda ZIP and produces smaller, faster cold-starts.

**Handler name mapping:**

| Function name | Entry file | Handler export | IAM grant |
|--------------|-----------|---------------|-----------|
| `CreateItem` | `src/handlers/create-item.ts` | `createItemHandler` | `grantReadWriteData` |
| `GetItem` | `src/handlers/get-item.ts` | `getItemHandler` | `grantReadData` |
| `UpdateItem` | `src/handlers/update-item.ts` | `updateItemHandler` | `grantReadWriteData` |
| `ListItems` | `src/handlers/list-items.ts` | `listItemsHandler` | `grantReadData` |
| `CreateVersion` | `src/handlers/create-version.ts` | `createVersionHandler` | `grantReadWriteData` |
| `GetAudit` | `src/handlers/get-audit.ts` | `getAuditHandler` | `grantReadData` |

**Shared config helper:**

Rather than repeating the same construct options 6 times, a private `createHandlerFunction()` method holds the shared defaults and accepts only what varies per function:

```typescript
private createHandlerFunction(
  id: string,
  entry: string,
  handler: string,
  env: Record<string, string>,
): NodejsFunction {
  return new NodejsFunction(this, id, {
    entry,
    handler,
    runtime: lambda.Runtime.NODEJS_22_X,
    memorySize: 256,
    timeout: cdk.Duration.seconds(30),
    environment: env,
    bundling: { minify: true, sourceMap: false },
  });
}
```

Node 22 matches the runtime used in local development (see `package.json` engines). 256 MB is sufficient for a CRUD API backed by DynamoDB — bumping to 512 MB is a one-line change if latency becomes a concern. 30 seconds is the API Gateway integration timeout ceiling; setting Lambda timeout to match avoids silent truncation.

---

## 6. API Gateway

A REST API (not an HTTP API) is used. REST API is the GETTING_STARTED.md requirement and supports the `{id}` path parameter syntax used in all handler path patterns. Lambda proxy integration forwards the full request to each Lambda unchanged — headers, body, path parameters, and query string all arrive as `APIGatewayProxyEvent` fields, which is exactly the contract the handlers expect.

**Resource tree:**

```
/
└── api/
    └── items/
        ├── GET     → ListItems (Lambda proxy)
        ├── POST    → CreateItem (Lambda proxy)
        └── {id}/
            ├── GET  → GetItem (Lambda proxy)
            ├── PUT  → UpdateItem (Lambda proxy)
            ├── versions/
            │   └── POST → CreateVersion (Lambda proxy)
            └── audit/
                └── GET  → GetAudit (Lambda proxy)
```

**CORS:** Enabled on the REST API with default settings (`allowOrigins: ['*']`). Appropriate for a challenge project; production would restrict to known origins.

**Stack output:** The deployed API URL is emitted as a CloudFormation output so scripts can read it without parsing the console:

```
Outputs:
  ExamItemsStack.ApiUrl = https://<id>.execute-api.<region>.amazonaws.com/prod/
```

---

## 7. IAM Strategy

Each Lambda function receives only the DynamoDB permissions it needs, granted via CDK's built-in grant methods:

| Grant method | DynamoDB actions granted |
|-------------|--------------------------|
| `table.grantReadData(fn)` | `GetItem`, `Query`, `Scan`, `BatchGetItem`, `ConditionCheckItem` |
| `table.grantReadWriteData(fn)` | All of the above plus `PutItem`, `UpdateItem`, `DeleteItem`, `BatchWriteItem`, `TransactWriteItems` |

Read-only functions (`GetItem`, `ListItems`, `GetAudit`) receive `grantReadData`. Write functions (`CreateItem`, `UpdateItem`, `CreateVersion`) receive `grantReadWriteData`. A compromised read-only Lambda cannot write or delete data.

CDK grant methods also automatically grant access to all GSIs on the table — no manual GSI ARN enumeration is required.

---

## 8. Environment Variables

Each Lambda is configured with these environment variables at synthesis time:

| Variable | Value | Source |
|----------|-------|--------|
| `USE_DYNAMODB` | `"true"` | Hardcoded — Lambdas always use DynamoDB |
| `DYNAMODB_TABLE_NAME` | CDK token resolved at deploy time | `table.tableName` |
| `AWS_REGION` | CDK token resolved at deploy time | `this.region` |

`DYNAMODB_ENDPOINT` is intentionally omitted from Lambda env vars. In real AWS, the SDK resolves the DynamoDB endpoint automatically from the region. The endpoint override is only needed for LocalStack — the deploy script sets it separately in the LocalStack environment.

`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are also omitted — Lambda execution roles supply credentials via the instance metadata service, not environment variables.

---

## 9. LocalStack Integration

LocalStack provides a local AWS emulator that supports Lambda, API Gateway, and DynamoDB. It allows full stack validation without an AWS account.

**Package:** `aws-cdk-local` wraps the standard `aws-cdk` CLI as `cdklocal`. It points CDK at `http://localhost:4566` (LocalStack's default endpoint) instead of real AWS.

**`docker-compose.localstack.yml`** (project root):

```yaml
services:
  localstack:
    image: localstack/localstack:latest
    ports:
      - "4566:4566"
    environment:
      - SERVICES=lambda,apigateway,dynamodb,iam,sts
      - DEFAULT_REGION=us-east-1
```

Only the services the stack needs are listed. This keeps LocalStack startup fast and avoids unnecessary memory use.

**`scripts/localstack-deploy.sh`:**

1. Wait for LocalStack to be healthy (`curl` polling `http://localhost:4566/_localstack/health`)
2. `cd infrastructure && cdklocal bootstrap`
3. `cdklocal deploy --require-approval never`
4. Capture the API URL from stack outputs
5. Smoke test: `curl` the list endpoint and assert HTTP 200

The smoke test is intentionally minimal — CDK assertion tests cover structural properties; this just proves the stack came up and the API responds.

---

## 10. CDK Assertion Tests

CDK assertion tests use `@aws-cdk/assertions` (now part of `aws-cdk-lib`) to query the synthesized CloudFormation template without deploying. They are fast (no network, no AWS), deterministic, and run in CI like unit tests.

**What the tests verify:**

| Test | What it checks |
|------|---------------|
| DynamoDB key schema | Table has `id` (HASH) and `sk` (RANGE) |
| GSI count | Template contains exactly 2 GSIs |
| SubjectIndex | GSI with `subject` partition key exists |
| StatusIndex | GSI with `itemStatus` partition key exists |
| Lambda count | Template contains exactly 6 `AWS::Lambda::Function` resources |
| Lambda runtimes | All functions use `nodejs22.x` |
| IAM policies | Read-write functions have `dynamodb:PutItem` in their policy; read-only functions do not |
| API Gateway | REST API resource exists |
| API resource paths | `/api/items` and `/api/items/{id}` resources exist in the template |

These tests are the primary correctness signal for the CDK code. They catch configuration regressions — wrong runtime, missing GSI, over-privileged IAM — without requiring a running environment.

---

## 11. Out of Scope

- **Authentication / authorizers** — No API Gateway Lambda authorizer or Cognito authorizer. All endpoints are public. This is a noted trade-off (see specs/001 Section 8).
- **Custom domains** — The API is accessed via the auto-generated execute-api URL.
- **CI/CD pipeline** — No CodePipeline, GitHub Actions workflow, or automated deployment trigger.
- **Multi-environment parameters** — No SSM Parameter Store integration, no `dev`/`staging`/`prod` environment switching. Table name is read from an env var at synthesis time.
- **WAF / throttling** — No API Gateway usage plans or AWS WAF rules.
- **Alarms / dashboards** — No CloudWatch alarms, dashboards, or X-Ray tracing configured.
- **DynamoDB storage implementation** — The `src/storage/dynamodb.ts` class is part of Phase 1 handler work. CDK only provisions the table; it does not implement the SDK calls.
