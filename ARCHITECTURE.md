# Architecture Documentation

## Data Model Design

### DynamoDB Table Schema

**Table name:** `ExamItems`
**Partition key:** `id` (string, UUID)
**Sort key:** `sk` (string)

#### Key Patterns

| Record type      | PK       | SK             |
|------------------|----------|----------------|
| Current item     | `<uuid>` | `ITEM`         |
| Version snapshot | `<uuid>` | `VERSION#0001` |

Zero-padded version numbers in the SK (`VERSION#0001`, `VERSION#0002`, …) ensure lexicographic sort matches version order.

#### Access Patterns

| Operation       | DynamoDB operation |
|-----------------|-------------------|
| Create item     | `TransactWriteItems` → atomic write of `ITEM` + `VERSION#0001` records |
| Get item        | `GetItem(id, ITEM)` |
| Update item     | `TransactWriteItems` → atomic overwrite of `ITEM` + new `VERSION#NNNN` snapshot |
| List items      | `Query` on `SubjectIndex` (subject filter) or `StatusIndex` (status filter); `Scan` with `FilterExpression sk = ITEM` when no filters; client-side offset/limit |
| Create version  | `TransactWriteItems` → atomic overwrite of `ITEM` + new `VERSION#NNNN` snapshot |
| Get audit trail | `Query(id)` with SK `begins_with VERSION#` |

#### GSIs

- **SubjectIndex** — PK: `subject`, SK: `sk`
  Supports `GET /api/items?subject=X` without Scan.

- **StatusIndex** — PK: `itemStatus`, SK: `sk`
  `itemStatus` is a denormalized top-level copy of `metadata.status`.
  DynamoDB cannot index nested attributes, so `itemStatus` is written
  as a top-level field on every create/update alongside `metadata.status`.
  Supports `GET /api/items?status=X` without Scan.

### Why Single-Table Design

Versioning and current-item reads are in one table. `TransactWriteItems` makes current + snapshot writes atomic with no cross-table coordination. `Query` on PK retrieves the full audit trail in one round-trip.

---

## Infrastructure

### CDK App Structure

The CDK app lives under `infrastructure/` as a standalone package (separate `package.json`, `tsconfig.json`, `node_modules`) so CDK tooling is fully isolated from the application bundle.

```
infrastructure/
├── bin/app.ts                    # CDK App entry — instantiates ExamItemsStack
├── lib/exam-items-stack.ts       # Single stack: DynamoDB + 6 Lambdas + API Gateway
├── test/exam-items-stack.test.ts # CDK assertion tests (vitest, no deployment needed)
├── cdk.json                      # app: "npx tsx bin/app.ts"
└── package.json
```

Supporting files at the project root:

```
docker-compose.localstack.yml    # LocalStack container (Lambda, API Gateway, DynamoDB, IAM, STS)
scripts/localstack-deploy.sh     # Bootstrap → deploy → smoke test against LocalStack
```

### Stack Components

**API Gateway REST API** (`exam-items-api`, stage `prod`) — REST API with Lambda proxy integration. All routes forward the full request (path params, query string, body, headers) as `APIGatewayProxyEvent`, which is exactly the contract the handlers already accept. CORS is enabled with permissive defaults (`allowOrigins: *`) appropriate for a challenge project.

**6 Lambda functions** (`NodejsFunction`) — one per handler file. esbuild bundles each entry point at synthesis time, including `aws-sdk` v3 (`externalModules: []`), producing a self-contained ZIP with no `node_modules` folder to ship. Runtime: `nodejs22.x`, 256 MB memory, 30 s timeout (matching the API Gateway integration timeout ceiling).

**CloudWatch Log Groups** — explicit log group per function with 1-week retention and `DESTROY` removal policy, so `cdk destroy` cleans up fully.

**Stack outputs** — `ApiUrl`, `TableName`, and one ARN output per Lambda function.

### IAM Strategy

CDK grant methods scope each function to only what it needs:

| Grant | Functions | DynamoDB actions |
|-------|-----------|-----------------|
| `grantReadData` | `GetItem`, `ListItems`, `GetAudit` | `GetItem`, `Query`, `Scan`, `BatchGetItem`, `ConditionCheckItem` |
| `grantReadWriteData` | `CreateItem`, `UpdateItem`, `CreateVersion` | All of the above + `PutItem`, `UpdateItem`, `DeleteItem`, `BatchWriteItem`, `TransactWriteItems` |

Grant methods automatically include GSI ARNs — no manual enumeration required.

### LocalStack Integration

`docker-compose.localstack.yml` runs LocalStack (Lambda, API Gateway, DynamoDB, IAM, STS on port 4566). `scripts/localstack-deploy.sh` performs:
1. Health check against `/_localstack/health`
2. `cdklocal bootstrap` + `cdklocal deploy` via `aws-cdk-local`
3. Smoke test: POST a new item and assert a successful response

### CDK Assertion Tests

`infrastructure/test/exam-items-stack.test.ts` uses `aws-cdk-lib/assertions` (`Template.fromStack`) to verify the synthesized CloudFormation template without deploying. Tests cover: DynamoDB key schema, GSI count and attribute names, Lambda count and runtime, IAM write-permission presence/absence, REST API existence, and resource path parts (`items`, `{id}`).

---

## Scalability

- GSIs on `subject` and `itemStatus` eliminate full-table Scans for the two common list filters
- Lambda scales horizontally without configuration, but shards are limited to 3000 read units, which may be a bottleneck if there are many concurrent requests with heavy read patterns. In that case, we could consider adding a caching layer (e.g., DynamoDB Accelerator or ElastiCache) for hot items. See future improvements for splitting off management from distribution.
- `offset`-based pagination used for simplicity; DynamoDB's `LastEvaluatedKey` cursor is more efficient at large page offsets and is a future improvement

---

## Security

- IAM least-privilege per Lambda: read-only functions get `GetItem`/`Query` only; write functions get scoped write policies on the single table (see IAM Strategy above)
- DynamoDB encryption at rest enabled by default
- No authentication — API Gateway JWT authorizer or Lambda authorizer is a future item

---

## Commands

### Application

```bash
pnpm install          # Install dependencies
pnpm dev              # Start dev server with hot reload (http://localhost:3000)
pnpm build            # Compile TypeScript → dist/
pnpm start            # Run compiled output
pnpm test             # Run unit tests once
pnpm test:watch       # Run unit tests in watch mode
pnpm test:api         # Run Docker-based API integration tests (requires Docker)
```

### Infrastructure

```bash
cd infrastructure
pnpm install          # Install CDK + esbuild dependencies
pnpm test             # Run CDK assertion tests (no deployment needed)
pnpm synth            # Synthesize CloudFormation template
npx cdk deploy        # Deploy to AWS (requires credentials + bootstrap)
npx cdk destroy       # Tear down the stack
```

### LocalStack (deploy without AWS account)

```bash
docker compose -f docker-compose.localstack.yml up -d   # Start LocalStack
cd infrastructure && pnpm install && cdklocal deploy      # Bootstrap + deploy
pnpm --filter exam-items-infrastructure deploy:local      # Full deploy + smoke test
```

### Optional DynamoDB (instead of in-memory)

```bash
export USE_DYNAMODB=true
export DYNAMODB_TABLE_NAME=ExamItems
export DYNAMODB_ENDPOINT=http://localhost:8000   # for DynamoDB Local
pnpm dev
```

### Debugging (VS Code)

A launch configuration is defined in `.vscode/launch.json`. Open the **Run and Debug** panel (`⇧⌘D`), select **Debug Node**, and press `F5`. This starts `src/server.ts` via `tsx` with the VS Code debugger attached — breakpoints, watch expressions, and the debug console all work as expected.

### API Curl Examples

All examples assume `pnpm dev` is running on `http://localhost:3000`.

**Create an item**
```bash
curl -s -X POST http://localhost:3000/api/items \
  -H 'Content-Type: application/json' \
  -d '{
    "subject": "AP Biology",
    "itemType": "multiple-choice",
    "difficulty": 3,
    "content": {
      "question": "What is photosynthesis?",
      "options": ["A process in animals", "A process in plants", "A type of cell", "A chemical bond"],
      "correctAnswer": "A process in plants",
      "explanation": "Photosynthesis is the process by which plants convert light into energy."
    },
    "metadata": { "author": "jane.doe", "status": "draft", "tags": ["biology", "plants"] },
    "securityLevel": "standard"
  }'
```

**Get an item** (replace `<id>` with a real UUID from the create response)
```bash
curl -s http://localhost:3000/api/items/<id>
```

**Update an item**
```bash
curl -s -X PUT http://localhost:3000/api/items/<id> \
  -H 'Content-Type: application/json' \
  -d '{"difficulty": 4, "metadata": {"status": "review"}}'
```

**List items** (optional filters: `subject`, `status`, `limit`, `offset`)
```bash
curl -s 'http://localhost:3000/api/items'
curl -s 'http://localhost:3000/api/items?subject=AP+Biology'
curl -s 'http://localhost:3000/api/items?status=draft&limit=10&offset=0'
```

**Create a new version**
```bash
curl -s -X POST http://localhost:3000/api/items/<id>/versions
```

**Get audit trail**
```bash
curl -s http://localhost:3000/api/items/<id>/audit
```

---

## Trade-offs

| Decision | Chosen approach | Alternative | Reason |
|----------|----------------|-------------|--------|
| Versioning storage | Single-table `ITEM` / `VERSION#` SK pattern | Separate `ExamItemVersions` table | Simpler key structure; VERSION# snapshots written on create, update, and createVersion |
| Pagination | `offset` / `limit` | DynamoDB `LastEvaluatedKey` cursor | Simpler implementation; cursor is more efficient at scale |
| Authentication | None | JWT / Lambda authorizer | Ran out of time (didn't prioritize correctly) |
| API Gateway type | REST API | HTTP API | REST API supports `{id}` path parameter syntax and matches `APIGatewayProxyEvent` that handlers already use |
| Lambda bundling | esbuild via `NodejsFunction`, `externalModules: []` | Ship `node_modules` in ZIP | Smaller artifacts, faster cold starts; aws-sdk v3 bundled explicitly since the runtime only ships v2 |
| CDK package isolation | Separate `infrastructure/package.json` | Monorepo root deps | Keeps CDK tooling out of the application bundle; `node_modules` trees don't mix |
| List filtering | GSI per filter field | Single Scan + filter | GSI avoids full-table Scans as data grows |

## Future improvements

### Priority 1 (critical for production readiness)

- More human review
- Add API authentication (JWT authorizer or Lambda authorizer)
- Send SNS messages on item status changes (e.g., when an item moves from `draft` to `review` or `approved`) to trigger downstream workflows with SQS consumers. This allows for a CQRS pattern where this service is the management of items, and another service handles the distribution of approved items. This allows for better separation of concerns and scalability as the system grows.
- Implement a CI/CD pipeline for automated testing and deployment
- Add more comprehensive unit and integration tests, including edge cases and error handling
- Add structured logging with correlation IDs for tracing requests across services. Consider using Datadog or another logging platform for better observability.

### Priority 2 (important but not critical)

- Add CloudWatch Alarms for Lambda errors and throttling
- Implement cursor-based pagination with `LastEvaluatedKey`
- Add API documentation (e.g., OpenAPI/Swagger) for better developer experience and client generation

### Priority 3 (nice-to-have features)

- Implement soft deletes with a `deleted` boolean and GSI for non-deleted items
- Add support for batch operations (e.g., batch create, batch update) to improve efficiency for bulk changes
- Add support for partial updates (PATCH) to allow clients to update only specific fields without sending the entire item payload
- Implement a more flexible metadata structure, allowing for arbitrary key-value pairs without requiring schema changes
- Add support for exporting data (e.g., CSV or JSON export of items and audit trails) for reporting and analysis purposes
- Implement a more robust error handling strategy, including retries for transient errors and better error messages for clients
- Add support for language localization in item content and metadata to support diverse student populations and future expansion to international markets
- Add performance testing and optimization, especially for list operations as the dataset grows, to ensure the service remains responsive under load.

## Frontend client

- Implement a frontend client (e.g., React app) to manage the data and interact with the API. This will require additional endpoints for authentication and user management (probably through AWS Cognito), as well as UI components for creating, updating, and listing items.

### Nice-to-have feature

- Add support for calling AI services for draft quiz question generation, and generation of explanations and distractors for multiple-choice questions. This might involve RAG, but should be in a different service than this repo.

