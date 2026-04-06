# Phase 1: API Endpoints — Design Spec

**Date:** 2026-04-06  
**Scope:** Implement all 6 exam item API endpoints, unit tests, Docker-based API tests, environment config, and architecture documentation.

---

## 1. Goals

- Implement all 6 required API endpoints as Lambda-compatible handlers
- Add Zod validation in a shared validators module
- Write unit tests (in-memory storage, no Docker)
- Write Docker-based API tests against a real DynamoDB Local instance
- Document environment variables in `.env.sample`
- Fill in `ARCHITECTURE.md` with DynamoDB schema, scalability, and trade-off notes

---

## 2. File Structure

```
src/
├── handlers/
│   ├── create-item.ts        # POST /api/items
│   ├── get-item.ts           # GET /api/items/:id
│   ├── update-item.ts        # PUT /api/items/:id
│   ├── list-items.ts         # GET /api/items
│   ├── create-version.ts     # POST /api/items/:id/versions
│   ├── get-audit.ts          # GET /api/items/:id/audit
│   └── example.ts            # DELETED — replaced by the handlers above
├── validators/
│   └── items.ts              # All Zod schemas
├── storage/                  # Unchanged
├── types/                    # Unchanged
├── server.ts                 # Expanded with all 6 routes
└── __tests__/
    └── items.test.ts         # Unit tests, one describe block per handler

tests/
└── api/
    ├── docker-compose.yml    # DynamoDB Local on port 8000
    ├── setup.ts              # Table creation, server lifecycle
    └── items.api.test.ts     # fetch-based end-to-end tests

.env.sample                   # All env vars documented with defaults
.env                          # Copied from .env.sample (gitignored)

specs/
└── 001-api-endpoints/
    └── design.md             # This file
```

---

## 3. Handler Contract

All handlers accept an `APIGatewayProxyEvent` and return `Promise<APIGatewayProxyResult>`. This is the real Lambda contract — no adaptation needed at deploy time.

`src/handlers/example.ts` is deleted. The new handler files replace it entirely — do not extend or re-export from it.

```typescript
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export async function createItemHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const data = JSON.parse(event.body ?? '{}');
  // validate → storage → respond
  return { statusCode: 201, body: JSON.stringify(item) };
}
```

`@types/aws-lambda` is added as a devDependency (types only, no runtime cost).

**Storage singleton:** Handlers call `createStorage()` inside the handler function. `createStorage()` (in `src/storage/index.ts`) is memoized — it creates the storage instance on the first call and returns the same instance on every subsequent call. Because Node caches modules, all handlers in a given process share the same storage instance. In Lambda, each function is a separate process, so each gets its own instance — which is correct.

`server.ts` constructs an `APIGatewayProxyEvent` from the Node `IncomingMessage` before calling each handler:

```typescript
const event = {
  httpMethod: method,
  path: url,
  pathParameters: { id },           // extracted from URL pattern
  queryStringParameters: parsedQS,  // from URLSearchParams
  body: body ? JSON.stringify(parsedBody) : null,
  headers: req.headers as Record<string, string>,
  // remaining required fields as null/empty
} as APIGatewayProxyEvent;
```

### Response Shapes

**Error (400 / 404 / 500):**
```json
{ "error": "string", "details": {} }
```

**Single item (200 / 201):** `ExamItem` object directly

**List (200):**
```json
{ "items": [], "total": 0, "limit": 10, "offset": 0 }
```

**Audit trail (200):**
```json
{ "itemId": "string", "versions": [] }
```

---

## 4. Validators (`src/validators/items.ts`)

Three Zod schemas, imported by handlers and reused in tests:

| Schema | Used by |
|--------|---------|
| `CreateItemSchema` | `createItemHandler` |
| `UpdateItemSchema` | `updateItemHandler` (all fields optional) |
| `ListQuerySchema` | `listItemsHandler` (strings coerced to numbers) |

**Key constraints:**
- `difficulty`: `z.number().int().min(1).max(5)`
- `itemType`: `z.enum(['multiple-choice', 'free-response', 'essay'])`
- `securityLevel`: `z.enum(['standard', 'secure', 'highly-secure'])`
- `metadata.status`: `z.enum(['draft', 'review', 'approved', 'archived'])`
- `content.options`: optional array of strings
- `limit` / `offset`: `z.coerce.number().int().min(0)` (query params arrive as strings)

On validation failure, handlers return:
```json
{ "statusCode": 400, "body": "{\"error\":\"Validation failed\",\"details\":{...}}" }
```

---

## 5. Unit Tests (`src/__tests__/items.test.ts`)

- Uses Vitest globals (`describe`, `it`, `expect`) — no imports needed
- `USE_DYNAMODB` forced to `false` via `process.env` before each test (ensures in-memory storage)
- A `makeEvent()` helper constructs minimal `APIGatewayProxyEvent` objects to keep tests concise
- One `describe` block per handler; handlers are imported directly

```
describe('createItemHandler')   → 201 created, 400 invalid body, 400 missing fields
describe('getItemHandler')      → 200 found, 404 not found
describe('updateItemHandler')   → 200 updated, 404 not found, 400 invalid body
describe('listItemsHandler')    → 200 with array, filter by subject, filter by status, pagination
describe('createVersionHandler')→ 201 new version (no request body — snapshots current state), 404 not found, version number incremented
describe('getAuditHandler')     → 200 with `{ itemId, versions: ExamItem[] }` shape, 404 not found, all versions in order
```

---

## 6. Docker API Tests (`tests/api/`)

### `docker-compose.yml`
Runs `amazon/dynamodb-local` on port 8000. Tests expect it running before the suite.

### npm script
```json
"test:api": "docker-compose -f tests/api/docker-compose.yml up -d && vitest run --config tests/api/vitest.config.ts; status=$?; docker-compose -f tests/api/docker-compose.yml down; exit $status"
```

### `setup.ts`
- `beforeAll`: polls DynamoDB Local with `ListTablesCommand` until ready (max 10s), creates table (partition key `id` + sort key `sk`, GSIs for `SubjectIndex` and `StatusIndex`), starts HTTP server on port 3001 with `PORT=3001 USE_DYNAMODB=true` pointing at DynamoDB Local
- `afterAll`: deletes table, shuts down server

### `items.api.test.ts`
- Targets `http://localhost:3001`
- Env: `USE_DYNAMODB=true`, `DYNAMODB_ENDPOINT=http://localhost:8000`, dummy AWS credentials
- Covers happy path for all 6 endpoints + selected error cases (404, 400)
- Uses Node 22 built-in `fetch` — no additional dependencies

---

## 7. Environment Variables (`.env.sample`)

```bash
PORT=3000
USE_DYNAMODB=false
DYNAMODB_TABLE_NAME=ExamItems
DYNAMODB_ENDPOINT=http://localhost:8000
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=local
AWS_SECRET_ACCESS_KEY=local
```

`.env` is copied from `.env.sample` and gitignored. Unit tests do not depend on `.env` — storage mode is controlled via `process.env` directly in test setup.

---

## 8. ARCHITECTURE.md Content

### DynamoDB Table Schema

**Table name:** `ExamItems`  
**Partition key:** `id` (string, UUID)  
**Sort key:** `sk` (string)

**Key patterns:**
| Record type | PK | SK |
|-------------|----|----|
| Current item | `<uuid>` | `#CURRENT` |
| Version snapshot | `<uuid>` | `VERSION#0001`, `VERSION#0002`, … |

Zero-padded version numbers in the SK ensure lexicographic sort order matches version order.

**Versioning strategy:** Single-table design. On every create/update/createVersion, a `TransactWriteItems` atomically writes both the `#CURRENT` record and a new `VERSION#NNNN` snapshot. `getAuditTrail` uses a `Query` on PK=`id` with SK beginning with `VERSION#` — returns all snapshots in version order in one call. No second table, no cross-table coordination.

**GSIs:**
- `SubjectIndex`: partition key `subject`, SK `sk` — supports `GET /api/items?subject=X` filtered to `sk = #CURRENT` without Scan
- `StatusIndex`: partition key `itemStatus` (top-level denormalized copy of `metadata.status`), SK `sk` — DynamoDB cannot index nested attributes, so `itemStatus` is written as a top-level field alongside `metadata.status` at create/update time. Supports `GET /api/items?status=X` filtered to `sk = #CURRENT` without Scan.

### Infrastructure Choices (preview for Phase 2)
- API Gateway (HTTP API) → Lambda (one function per endpoint) → DynamoDB
- Lambda per endpoint = independent scaling, independent IAM policies, minimal blast radius

### Scalability
- GSIs eliminate full-table Scan for common list filters
- Pagination via `limit`/`offset` in Phase 1; cursor-based pagination is a Phase 2 trade-off
- Lambda scales horizontally without configuration

### Security
- IAM least-privilege per Lambda function (read-only functions get read-only policies)
- DynamoDB encryption at rest enabled by default
- No auth in Phase 1 — API Gateway authorizer is a Phase 2 item (noted trade-off)

### Trade-offs
- `offset`-based pagination is simple but inefficient at scale; DynamoDB's `LastEvaluatedKey` cursor is better for production
- Single-table versioning (`#CURRENT` + `VERSION#NNNN` SK pattern) avoids cross-table transactions but means `listItems` GSI queries must filter to `sk = #CURRENT` to exclude version records
- No auth in Phase 1 — accepted to keep scope focused

---

## 9. Out of Scope (Phase 1)

- CDK / Terraform infrastructure (Phase 2: `specs/002-cdk`)
- Authentication / authorization
- Cursor-based pagination
- DynamoDB storage implementation code (`dynamodb.ts` changes) — the single-table schema design IS in scope and documented in Section 8; only the actual `DynamoDBStorage` class implementation is deferred to Phase 2
