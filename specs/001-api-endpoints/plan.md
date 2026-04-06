# Phase 1: API Endpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 6 exam item API endpoints as Lambda-compatible handlers with Zod validation, unit tests, Docker-based API tests, and architecture documentation.

**Architecture:** One handler file per endpoint under `src/handlers/`, each accepting `APIGatewayProxyEvent` and returning `APIGatewayProxyResult`. Shared Zod validators in `src/validators/items.ts`. A module-level singleton in `src/storage/index.ts` ensures all handlers in one process share the same storage instance. `server.ts` constructs Lambda events from Node HTTP requests and dispatches to handlers. Unit tests call handlers directly with in-memory storage; API tests hit a running server over HTTP.

**Tech Stack:** TypeScript, Vitest, Zod, `@types/aws-lambda`, `@aws-sdk/client-dynamodb`, Node 22 built-in `fetch`, Docker (`amazon/dynamodb-local`)

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | Modify | Add `@types/aws-lambda` devDep, `test:api` script |
| `.env.sample` | Create | Document all env vars with defaults |
| `.env` | Create | Copy of `.env.sample` (gitignored) |
| `.gitignore` | Modify | Add `.env` |
| `src/validators/items.ts` | Create | Zod schemas: `CreateItemSchema`, `UpdateItemSchema`, `ListQuerySchema` |
| `src/storage/index.ts` | Modify | Singleton pattern + `_resetStorageForTesting` export |
| `src/__tests__/items.test.ts` | Create | Unit tests — `makeEvent` helper, `validItem` fixture, one `describe` per handler |
| `src/handlers/create-item.ts` | Create | `POST /api/items` |
| `src/handlers/get-item.ts` | Create | `GET /api/items/:id` |
| `src/handlers/update-item.ts` | Create | `PUT /api/items/:id` |
| `src/handlers/list-items.ts` | Create | `GET /api/items` |
| `src/handlers/create-version.ts` | Create | `POST /api/items/:id/versions` |
| `src/handlers/get-audit.ts` | Create | `GET /api/items/:id/audit` |
| `src/handlers/example.ts` | Delete | Replaced by above handlers |
| `src/__tests__/example.test.ts` | Delete | Tested example.ts which is deleted |
| `src/server.ts` | Modify | Wire all 6 routes, export `server`, build Lambda events |
| `tests/api/docker-compose.yml` | Create | DynamoDB Local on port 8000 |
| `tests/api/setup.ts` | Create | DynamoDB table lifecycle, spawn/kill HTTP server |
| `tests/api/items.api.test.ts` | Create | HTTP-level tests via `fetch` for all 6 endpoints |
| `ARCHITECTURE.md` | Modify | DynamoDB schema, access patterns, trade-offs |

---

## Task 1: Project Setup

**Files:**
- Modify: `package.json`
- Create: `.env.sample`, `.env`
- Modify: `.gitignore`

- [ ] **Step 1: Install `@types/aws-lambda`**

```bash
pnpm add -D @types/aws-lambda
```

Expected: `package.json` devDependencies updated, no errors.

- [ ] **Step 2: Create `.env.sample`**

Create the file `.env.sample` with this exact content:

```bash
PORT=3000
USE_DYNAMODB=false
DYNAMODB_TABLE_NAME=ExamItems
DYNAMODB_ENDPOINT=http://localhost:8000
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=local
AWS_SECRET_ACCESS_KEY=local
```

- [ ] **Step 3: Copy to `.env`**

```bash
cp .env.sample .env
```

- [ ] **Step 4: Add `.env` to `.gitignore`**

If `.gitignore` doesn't exist, create it. Add `.env` as a line:

```
.env
```

- [ ] **Step 5: Create `tests/api` directory**

```bash
mkdir -p tests/api
```

- [ ] **Step 6: Commit**

```bash
git add package.json .env.sample .gitignore
git commit -m "chore: add @types/aws-lambda, env sample, gitignore"
```

---

## Task 2: Shared Validators

**Files:**
- Create: `src/validators/items.ts`

- [ ] **Step 1: Create `src/validators/items.ts`**

```typescript
import { z } from 'zod';

export const CreateItemSchema = z.object({
  subject: z.string().min(1),
  itemType: z.enum(['multiple-choice', 'free-response', 'essay']),
  difficulty: z.number().int().min(1).max(5),
  content: z.object({
    question: z.string().min(1),
    options: z.array(z.string()).optional(),
    correctAnswer: z.string().min(1),
    explanation: z.string().min(1),
  }),
  metadata: z.object({
    author: z.string().min(1),
    status: z.enum(['draft', 'review', 'approved', 'archived']),
    tags: z.array(z.string()),
  }),
  securityLevel: z.enum(['standard', 'secure', 'highly-secure']),
});

export const UpdateItemSchema = z.object({
  subject: z.string().min(1).optional(),
  itemType: z.enum(['multiple-choice', 'free-response', 'essay']).optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  content: z.object({
    question: z.string().min(1).optional(),
    options: z.array(z.string()).optional(),
    correctAnswer: z.string().min(1).optional(),
    explanation: z.string().min(1).optional(),
  }).optional(),
  metadata: z.object({
    author: z.string().min(1).optional(),
    status: z.enum(['draft', 'review', 'approved', 'archived']).optional(),
    tags: z.array(z.string()).optional(),
  }).optional(),
  securityLevel: z.enum(['standard', 'secure', 'highly-secure']).optional(),
});

export const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  offset: z.coerce.number().int().min(0).default(0),
  subject: z.string().optional(),
  status: z.string().optional(),
});

export type CreateItemInput = z.infer<typeof CreateItemSchema>;
export type UpdateItemInput = z.infer<typeof UpdateItemSchema>;
export type ListQueryInput = z.infer<typeof ListQuerySchema>;
```

- [ ] **Step 2: Commit**

```bash
git add src/validators/items.ts
git commit -m "feat: add shared Zod validators for items API"
```

---

## Task 3: Storage Singleton

**Files:**
- Modify: `src/storage/index.ts`

The current `createStorage()` creates a new instance on every call. Each handler would get its own storage instance, so a test that creates via `createItemHandler` and reads via `getItemHandler` would find nothing. Fix by caching the instance at the module level.

- [ ] **Step 1: Replace `src/storage/index.ts`**

```typescript
import { ItemStorage } from './interface.js';
import { MemoryStorage } from './memory.js';
import { DynamoDBStorage } from './dynamodb.js';

let instance: ItemStorage | null = null;

export function createStorage(): ItemStorage {
  if (!instance) {
    if (process.env.USE_DYNAMODB === 'true') {
      console.log('📦 Using DynamoDB storage');
      instance = new DynamoDBStorage();
    } else {
      console.log('📦 Using in-memory storage');
      instance = new MemoryStorage();
    }
  }
  return instance;
}

/** For testing only — forces next createStorage() call to create a fresh instance. */
export function _resetStorageForTesting(): void {
  instance = null;
}

export * from './interface.js';
```

- [ ] **Step 2: Commit**

```bash
git add src/storage/index.ts
git commit -m "feat: make storage a per-process singleton with test reset hook"
```

---

## Task 4: Test Infrastructure + Handler Stubs

**Files:**
- Create: `src/__tests__/items.test.ts`
- Create: `src/handlers/create-item.ts` (stub)
- Create: `src/handlers/get-item.ts` (stub)
- Create: `src/handlers/update-item.ts` (stub)
- Create: `src/handlers/list-items.ts` (stub)
- Create: `src/handlers/create-version.ts` (stub)
- Create: `src/handlers/get-audit.ts` (stub)

All 6 handler stubs are created first so the test file compiles with all imports. Describe blocks are added one per task.

- [ ] **Step 1: Create stub handler files**

Create `src/handlers/create-item.ts`:
```typescript
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
export async function createItemHandler(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ error: 'Not implemented' }) };
}
```

Create `src/handlers/get-item.ts`:
```typescript
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
export async function getItemHandler(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ error: 'Not implemented' }) };
}
```

Create `src/handlers/update-item.ts`:
```typescript
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
export async function updateItemHandler(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ error: 'Not implemented' }) };
}
```

Create `src/handlers/list-items.ts`:
```typescript
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
export async function listItemsHandler(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ error: 'Not implemented' }) };
}
```

Create `src/handlers/create-version.ts`:
```typescript
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
export async function createVersionHandler(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ error: 'Not implemented' }) };
}
```

Create `src/handlers/get-audit.ts`:
```typescript
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
export async function getAuditHandler(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ error: 'Not implemented' }) };
}
```

- [ ] **Step 2: Create `src/__tests__/items.test.ts` with helpers and shared fixture**

```typescript
import { beforeEach, describe, it, expect } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { createItemHandler } from '../handlers/create-item.js';
import { getItemHandler } from '../handlers/get-item.js';
import { updateItemHandler } from '../handlers/update-item.js';
import { listItemsHandler } from '../handlers/list-items.js';
import { createVersionHandler } from '../handlers/create-version.js';
import { getAuditHandler } from '../handlers/get-audit.js';
import { _resetStorageForTesting } from '../storage/index.js';

function makeEvent(overrides: {
  httpMethod?: string;
  body?: object | null;
  pathParameters?: Record<string, string> | null;
  queryStringParameters?: Record<string, string> | null;
} = {}): APIGatewayProxyEvent {
  return {
    httpMethod: overrides.httpMethod ?? 'GET',
    path: '/',
    pathParameters: overrides.pathParameters ?? null,
    queryStringParameters: overrides.queryStringParameters ?? null,
    body: overrides.body !== undefined ? JSON.stringify(overrides.body) : null,
    headers: {},
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    requestContext: {} as any,
    resource: '',
    stageVariables: null,
  } as APIGatewayProxyEvent;
}

const validItem = {
  subject: 'AP Biology',
  itemType: 'multiple-choice' as const,
  difficulty: 3,
  content: {
    question: 'What is photosynthesis?',
    options: ['A', 'B', 'C', 'D'],
    correctAnswer: 'A',
    explanation: 'Photosynthesis is the process by which plants make food.',
  },
  metadata: {
    author: 'test-author',
    status: 'draft' as const,
    tags: ['biology'],
  },
  securityLevel: 'standard' as const,
};

beforeEach(() => {
  process.env.USE_DYNAMODB = 'false';
  _resetStorageForTesting();
});
```

- [ ] **Step 3: Verify test file compiles with zero tests**

```bash
pnpm vitest run src/__tests__/items.test.ts
```

Expected: `0 tests` run, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/handlers/ src/__tests__/items.test.ts
git commit -m "test: add handler stubs and unit test infrastructure"
```

---

## Task 5: createItemHandler

**Files:**
- Modify: `src/__tests__/items.test.ts` (append describe block)
- Modify: `src/handlers/create-item.ts` (implement)

- [ ] **Step 1: Append describe block to `items.test.ts`**

Add after the `beforeEach` block:

```typescript
describe('createItemHandler', () => {
  it('returns 201 with created item', async () => {
    const result = await createItemHandler(makeEvent({ httpMethod: 'POST', body: validItem }));
    const body = JSON.parse(result.body);
    expect(result.statusCode).toBe(201);
    expect(body).toHaveProperty('id');
    expect(body.subject).toBe('AP Biology');
    expect(body.metadata.version).toBe(1);
    expect(body.metadata).toHaveProperty('created');
    expect(body.metadata).toHaveProperty('lastModified');
  });

  it('returns 400 when required fields are missing', async () => {
    const result = await createItemHandler(makeEvent({ httpMethod: 'POST', body: { subject: 'Only Subject' } }));
    const body = JSON.parse(result.body);
    expect(result.statusCode).toBe(400);
    expect(body.error).toBe('Validation failed');
    expect(body).toHaveProperty('details');
  });

  it('returns 400 when difficulty is out of range', async () => {
    const result = await createItemHandler(makeEvent({ httpMethod: 'POST', body: { ...validItem, difficulty: 10 } }));
    const body = JSON.parse(result.body);
    expect(result.statusCode).toBe(400);
    expect(body.error).toBe('Validation failed');
  });
});
```

- [ ] **Step 2: Run tests to confirm 3 FAIL**

```bash
pnpm vitest run src/__tests__/items.test.ts
```

Expected: 3 FAIL — status 501 not matching 201/400.

- [ ] **Step 3: Implement `src/handlers/create-item.ts`**

```typescript
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createStorage } from '../storage/index.js';
import { CreateItemSchema } from '../validators/items.js';

export async function createItemHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body ?? '{}');
    const result = CreateItemSchema.safeParse(body);

    if (!result.success) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Validation failed', details: result.error.flatten() }),
      };
    }

    const item = await createStorage().createItem(result.data);
    return { statusCode: 201, body: JSON.stringify(item) };
  } catch (error) {
    console.error('Error creating item:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
  }
}
```

- [ ] **Step 4: Run tests to confirm 3 PASS**

```bash
pnpm vitest run src/__tests__/items.test.ts
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/create-item.ts src/__tests__/items.test.ts
git commit -m "feat: implement createItemHandler with Zod validation"
```

---

## Task 6: getItemHandler

**Files:**
- Modify: `src/__tests__/items.test.ts` (append describe block)
- Modify: `src/handlers/get-item.ts` (implement)

- [ ] **Step 1: Append describe block to `items.test.ts`**

```typescript
describe('getItemHandler', () => {
  it('returns 200 with the item when it exists', async () => {
    const created = await createItemHandler(makeEvent({ httpMethod: 'POST', body: validItem }));
    const { id } = JSON.parse(created.body);

    const result = await getItemHandler(makeEvent({ pathParameters: { id } }));
    const body = JSON.parse(result.body);
    expect(result.statusCode).toBe(200);
    expect(body.id).toBe(id);
    expect(body.subject).toBe('AP Biology');
  });

  it('returns 404 for an unknown id', async () => {
    const result = await getItemHandler(makeEvent({ pathParameters: { id: 'does-not-exist' } }));
    const body = JSON.parse(result.body);
    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('Item not found');
  });
});
```

- [ ] **Step 2: Run tests to confirm 2 new FAIL**

```bash
pnpm vitest run src/__tests__/items.test.ts
```

Expected: previous 3 PASS + 2 FAIL.

- [ ] **Step 3: Implement `src/handlers/get-item.ts`**

```typescript
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createStorage } from '../storage/index.js';

export async function getItemHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const id = event.pathParameters?.id;
    if (!id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing item id' }) };
    }

    const item = await createStorage().getItem(id);
    if (!item) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Item not found' }) };
    }

    return { statusCode: 200, body: JSON.stringify(item) };
  } catch (error) {
    console.error('Error getting item:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
  }
}
```

- [ ] **Step 4: Run tests to confirm all PASS**

```bash
pnpm vitest run src/__tests__/items.test.ts
```

Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/get-item.ts src/__tests__/items.test.ts
git commit -m "feat: implement getItemHandler"
```

---

## Task 7: updateItemHandler

**Files:**
- Modify: `src/__tests__/items.test.ts` (append describe block)
- Modify: `src/handlers/update-item.ts` (implement)

- [ ] **Step 1: Append describe block to `items.test.ts`**

```typescript
describe('updateItemHandler', () => {
  it('returns 200 with updated fields', async () => {
    const created = await createItemHandler(makeEvent({ httpMethod: 'POST', body: validItem }));
    const { id } = JSON.parse(created.body);

    const result = await updateItemHandler(makeEvent({
      httpMethod: 'PUT',
      pathParameters: { id },
      body: { subject: 'AP Chemistry', difficulty: 4 },
    }));
    const body = JSON.parse(result.body);
    expect(result.statusCode).toBe(200);
    expect(body.subject).toBe('AP Chemistry');
    expect(body.difficulty).toBe(4);
    expect(body.metadata.version).toBe(2);
  });

  it('returns 404 for an unknown id', async () => {
    const result = await updateItemHandler(makeEvent({
      httpMethod: 'PUT',
      pathParameters: { id: 'does-not-exist' },
      body: { subject: 'AP Chemistry' },
    }));
    expect(result.statusCode).toBe(404);
  });

  it('returns 400 when difficulty is invalid', async () => {
    const created = await createItemHandler(makeEvent({ httpMethod: 'POST', body: validItem }));
    const { id } = JSON.parse(created.body);

    const result = await updateItemHandler(makeEvent({
      httpMethod: 'PUT',
      pathParameters: { id },
      body: { difficulty: 99 },
    }));
    const body = JSON.parse(result.body);
    expect(result.statusCode).toBe(400);
    expect(body.error).toBe('Validation failed');
  });
});
```

- [ ] **Step 2: Run tests to confirm 3 new FAIL**

```bash
pnpm vitest run src/__tests__/items.test.ts
```

Expected: previous 5 PASS + 3 FAIL.

- [ ] **Step 3: Implement `src/handlers/update-item.ts`**

```typescript
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createStorage } from '../storage/index.js';
import { UpdateItemSchema } from '../validators/items.js';

export async function updateItemHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const id = event.pathParameters?.id;
    if (!id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing item id' }) };
    }

    const body = JSON.parse(event.body ?? '{}');
    const result = UpdateItemSchema.safeParse(body);

    if (!result.success) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Validation failed', details: result.error.flatten() }),
      };
    }

    const item = await createStorage().updateItem(id, result.data);
    if (!item) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Item not found' }) };
    }

    return { statusCode: 200, body: JSON.stringify(item) };
  } catch (error) {
    console.error('Error updating item:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
  }
}
```

- [ ] **Step 4: Run tests to confirm all PASS**

```bash
pnpm vitest run src/__tests__/items.test.ts
```

Expected: 8 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/update-item.ts src/__tests__/items.test.ts
git commit -m "feat: implement updateItemHandler with Zod validation"
```

---

## Task 8: listItemsHandler

**Files:**
- Modify: `src/__tests__/items.test.ts` (append describe block)
- Modify: `src/handlers/list-items.ts` (implement)

- [ ] **Step 1: Append describe block to `items.test.ts`**

```typescript
describe('listItemsHandler', () => {
  it('returns 200 with empty list when no items exist', async () => {
    const result = await listItemsHandler(makeEvent());
    const body = JSON.parse(result.body);
    expect(result.statusCode).toBe(200);
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(0);
  });

  it('returns all items with total count', async () => {
    await createItemHandler(makeEvent({ httpMethod: 'POST', body: validItem }));
    await createItemHandler(makeEvent({ httpMethod: 'POST', body: { ...validItem, subject: 'AP Chemistry' } }));

    const result = await listItemsHandler(makeEvent());
    const body = JSON.parse(result.body);
    expect(result.statusCode).toBe(200);
    expect(body.items).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it('filters by subject', async () => {
    await createItemHandler(makeEvent({ httpMethod: 'POST', body: validItem }));
    await createItemHandler(makeEvent({ httpMethod: 'POST', body: { ...validItem, subject: 'AP Chemistry' } }));

    const result = await listItemsHandler(makeEvent({ queryStringParameters: { subject: 'AP Biology' } }));
    const body = JSON.parse(result.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].subject).toBe('AP Biology');
  });

  it('filters by status', async () => {
    await createItemHandler(makeEvent({ httpMethod: 'POST', body: validItem }));
    await createItemHandler(makeEvent({
      httpMethod: 'POST',
      body: { ...validItem, metadata: { ...validItem.metadata, status: 'approved' } },
    }));

    const result = await listItemsHandler(makeEvent({ queryStringParameters: { status: 'approved' } }));
    const body = JSON.parse(result.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].metadata.status).toBe('approved');
  });

  it('paginates with limit and offset', async () => {
    for (let i = 0; i < 3; i++) {
      await createItemHandler(makeEvent({ httpMethod: 'POST', body: { ...validItem, subject: `Subject ${i}` } }));
    }

    const result = await listItemsHandler(makeEvent({ queryStringParameters: { limit: '2', offset: '1' } }));
    const body = JSON.parse(result.body);
    expect(body.items).toHaveLength(2);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to confirm 5 new FAIL**

```bash
pnpm vitest run src/__tests__/items.test.ts
```

Expected: previous 8 PASS + 5 FAIL.

- [ ] **Step 3: Implement `src/handlers/list-items.ts`**

```typescript
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createStorage } from '../storage/index.js';
import { ListQuerySchema } from '../validators/items.js';

export async function listItemsHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const result = ListQuerySchema.safeParse(event.queryStringParameters ?? {});

    if (!result.success) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Validation failed', details: result.error.flatten() }),
      };
    }

    const { limit, offset, subject, status } = result.data;
    const { items, total } = await createStorage().listItems({ limit, offset, subject, status });

    return {
      statusCode: 200,
      body: JSON.stringify({ items, total, limit, offset }),
    };
  } catch (error) {
    console.error('Error listing items:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
  }
}
```

- [ ] **Step 4: Run tests to confirm all PASS**

```bash
pnpm vitest run src/__tests__/items.test.ts
```

Expected: 13 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/list-items.ts src/__tests__/items.test.ts
git commit -m "feat: implement listItemsHandler with filtering and pagination"
```

---

## Task 9: createVersionHandler

**Files:**
- Modify: `src/__tests__/items.test.ts` (append describe block)
- Modify: `src/handlers/create-version.ts` (implement)

- [ ] **Step 1: Append describe block to `items.test.ts`**

```typescript
describe('createVersionHandler', () => {
  it('returns 201 with snapshot of current state (no request body needed)', async () => {
    const created = await createItemHandler(makeEvent({ httpMethod: 'POST', body: validItem }));
    const { id } = JSON.parse(created.body);

    const result = await createVersionHandler(makeEvent({ httpMethod: 'POST', pathParameters: { id } }));
    const body = JSON.parse(result.body);
    expect(result.statusCode).toBe(201);
    expect(body.id).toBe(id);
    expect(body.metadata.version).toBe(2);
  });

  it('returns 404 for an unknown id', async () => {
    const result = await createVersionHandler(makeEvent({
      httpMethod: 'POST',
      pathParameters: { id: 'does-not-exist' },
    }));
    expect(result.statusCode).toBe(404);
  });

  it('increments version number on each call', async () => {
    const created = await createItemHandler(makeEvent({ httpMethod: 'POST', body: validItem }));
    const { id } = JSON.parse(created.body);

    await createVersionHandler(makeEvent({ httpMethod: 'POST', pathParameters: { id } }));
    const result = await createVersionHandler(makeEvent({ httpMethod: 'POST', pathParameters: { id } }));
    const body = JSON.parse(result.body);
    expect(body.metadata.version).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to confirm 3 new FAIL**

```bash
pnpm vitest run src/__tests__/items.test.ts
```

Expected: previous 13 PASS + 3 FAIL.

- [ ] **Step 3: Implement `src/handlers/create-version.ts`**

```typescript
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createStorage } from '../storage/index.js';

export async function createVersionHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const id = event.pathParameters?.id;
    if (!id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing item id' }) };
    }

    const item = await createStorage().createVersion(id);
    if (!item) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Item not found' }) };
    }

    return { statusCode: 201, body: JSON.stringify(item) };
  } catch (error) {
    console.error('Error creating version:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
  }
}
```

- [ ] **Step 4: Run tests to confirm all PASS**

```bash
pnpm vitest run src/__tests__/items.test.ts
```

Expected: 16 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/create-version.ts src/__tests__/items.test.ts
git commit -m "feat: implement createVersionHandler"
```

---

## Task 10: getAuditHandler

**Files:**
- Modify: `src/__tests__/items.test.ts` (append describe block)
- Modify: `src/handlers/get-audit.ts` (implement)

- [ ] **Step 1: Append describe block to `items.test.ts`**

```typescript
describe('getAuditHandler', () => {
  it('returns 200 with { itemId, versions } shape', async () => {
    const created = await createItemHandler(makeEvent({ httpMethod: 'POST', body: validItem }));
    const { id } = JSON.parse(created.body);

    const result = await getAuditHandler(makeEvent({ pathParameters: { id } }));
    const body = JSON.parse(result.body);
    expect(result.statusCode).toBe(200);
    expect(body.itemId).toBe(id);
    expect(Array.isArray(body.versions)).toBe(true);
    expect(body.versions).toHaveLength(1);
  });

  it('returns 404 for an unknown id', async () => {
    const result = await getAuditHandler(makeEvent({ pathParameters: { id: 'does-not-exist' } }));
    expect(result.statusCode).toBe(404);
  });

  it('returns all versions in creation order', async () => {
    const created = await createItemHandler(makeEvent({ httpMethod: 'POST', body: validItem }));
    const { id } = JSON.parse(created.body);

    await createVersionHandler(makeEvent({ httpMethod: 'POST', pathParameters: { id } }));
    await createVersionHandler(makeEvent({ httpMethod: 'POST', pathParameters: { id } }));

    const result = await getAuditHandler(makeEvent({ pathParameters: { id } }));
    const body = JSON.parse(result.body);
    expect(body.versions).toHaveLength(3);
    expect(body.versions[0].metadata.version).toBe(1);
    expect(body.versions[1].metadata.version).toBe(2);
    expect(body.versions[2].metadata.version).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to confirm 3 new FAIL**

```bash
pnpm vitest run src/__tests__/items.test.ts
```

Expected: previous 16 PASS + 3 FAIL.

- [ ] **Step 3: Implement `src/handlers/get-audit.ts`**

```typescript
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createStorage } from '../storage/index.js';

export async function getAuditHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const id = event.pathParameters?.id;
    if (!id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing item id' }) };
    }

    const storage = createStorage();
    const item = await storage.getItem(id);
    if (!item) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Item not found' }) };
    }

    const versions = await storage.getAuditTrail(id);
    return { statusCode: 200, body: JSON.stringify({ itemId: id, versions }) };
  } catch (error) {
    console.error('Error getting audit trail:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
  }
}
```

- [ ] **Step 4: Run all unit tests — expect 19 PASS**

```bash
pnpm vitest run src/__tests__/items.test.ts
```

Expected: 19 PASS, 0 FAIL.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/get-audit.ts src/__tests__/items.test.ts
git commit -m "feat: implement getAuditHandler"
```

---

## Task 11: Update server.ts

**Files:**
- Modify: `src/server.ts`

Replace the current 2-route server with one that handles all 6 routes, constructs `APIGatewayProxyEvent` from Node HTTP requests, and exports `server` for use by API tests.

- [ ] **Step 1: Replace `src/server.ts`**

```typescript
import { createServer, IncomingMessage, ServerResponse } from 'http';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { createItemHandler } from './handlers/create-item.js';
import { getItemHandler } from './handlers/get-item.js';
import { updateItemHandler } from './handlers/update-item.js';
import { listItemsHandler } from './handlers/list-items.js';
import { createVersionHandler } from './handlers/create-version.js';
import { getAuditHandler } from './handlers/get-audit.js';

const PORT = process.env.PORT || 3000;

function buildEvent(
  req: IncomingMessage,
  body: string | null,
  pathParameters: Record<string, string> | null,
  queryStringParameters: Record<string, string> | null,
): APIGatewayProxyEvent {
  return {
    httpMethod: req.method ?? 'GET',
    path: req.url?.split('?')[0] ?? '/',
    pathParameters,
    queryStringParameters,
    body,
    headers: req.headers as Record<string, string>,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    requestContext: {} as any,
    resource: '',
    stageVariables: null,
  } as APIGatewayProxyEvent;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const { method, url = '/' } = req;

  let rawBody = '';
  req.on('data', chunk => rawBody += chunk);
  await new Promise(resolve => req.on('end', resolve));

  console.log(`${method} ${url}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const urlObj = new URL(`http://localhost${url}`);
    const parts = urlObj.pathname.split('/').filter(Boolean);
    // parts examples: ['api','items'], ['api','items','<id>'], ['api','items','<id>','versions']
    const qs = Object.fromEntries(urlObj.searchParams.entries());
    const queryStringParameters = Object.keys(qs).length ? qs : null;
    const body = rawBody || null;

    let result;

    if (method === 'POST' && parts.length === 2 && parts[1] === 'items') {
      result = await createItemHandler(buildEvent(req, body, null, null));
    } else if (method === 'GET' && parts.length === 2 && parts[1] === 'items') {
      result = await listItemsHandler(buildEvent(req, null, null, queryStringParameters));
    } else if (method === 'GET' && parts.length === 3 && parts[1] === 'items') {
      result = await getItemHandler(buildEvent(req, null, { id: parts[2] }, null));
    } else if (method === 'PUT' && parts.length === 3 && parts[1] === 'items') {
      result = await updateItemHandler(buildEvent(req, body, { id: parts[2] }, null));
    } else if (method === 'POST' && parts.length === 4 && parts[1] === 'items' && parts[3] === 'versions') {
      result = await createVersionHandler(buildEvent(req, null, { id: parts[2] }, null));
    } else if (method === 'GET' && parts.length === 4 && parts[1] === 'items' && parts[3] === 'audit') {
      result = await getAuditHandler(buildEvent(req, null, { id: parts[2] }, null));
    } else {
      result = { statusCode: 404, body: JSON.stringify({ error: 'Route not found' }) };
    }

    res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
    res.end(result.body);
  } catch (error) {
    console.error('Server error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

export const server = createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log('\nEndpoints:');
  console.log(`  POST   http://localhost:${PORT}/api/items`);
  console.log(`  GET    http://localhost:${PORT}/api/items`);
  console.log(`  GET    http://localhost:${PORT}/api/items/:id`);
  console.log(`  PUT    http://localhost:${PORT}/api/items/:id`);
  console.log(`  POST   http://localhost:${PORT}/api/items/:id/versions`);
  console.log(`  GET    http://localhost:${PORT}/api/items/:id/audit`);
  console.log('\nPress Ctrl+C to stop\n');
});
```

- [ ] **Step 2: Run unit tests to confirm nothing broke**

```bash
pnpm vitest run src/__tests__/items.test.ts
```

Expected: 19 PASS.

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: wire all 6 routes in server.ts with Lambda event construction"
```

---

## Task 12: Cleanup

**Files:**
- Delete: `src/handlers/example.ts`
- Delete: `src/__tests__/example.test.ts`

- [ ] **Step 1: Delete example files**

```bash
rm src/handlers/example.ts src/__tests__/example.test.ts
```

- [ ] **Step 2: Run all tests to confirm clean**

```bash
pnpm vitest run
```

Expected: 19 PASS, 0 FAIL, no errors about missing files.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove example.ts and example.test.ts (replaced by items handlers)"
```

---

## Task 13: Docker API Tests

**Files:**
- Create: `tests/api/docker-compose.yml`
- Create: `tests/api/setup.ts`
- Create: `tests/api/items.api.test.ts`
- Modify: `package.json`

> **Note:** The API tests run the server with `USE_DYNAMODB=false` (MemoryStorage) in Phase 1. DynamoDB Local is provisioned and a table is created to validate the Docker/AWS SDK setup, but the server uses in-memory storage until the DynamoDB storage implementation is complete in Phase 2. Change `USE_DYNAMODB` to `'true'` in `setup.ts` after Phase 2.

- [ ] **Step 1: Create `tests/api/docker-compose.yml`**

```yaml
version: '3.8'
services:
  dynamodb-local:
    image: amazon/dynamodb-local:latest
    container_name: dynamodb-local
    ports:
      - "8000:8000"
    command: "-jar DynamoDBLocal.jar -sharedDb -inMemory"
```

- [ ] **Step 2: Create `tests/api/setup.ts`**

```typescript
import { beforeAll, afterAll } from 'vitest';
import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  ListTablesCommand,
} from '@aws-sdk/client-dynamodb';
import { spawn, ChildProcess } from 'child_process';

const TABLE_NAME = 'ExamItems';
const DYNAMODB_ENDPOINT = 'http://localhost:8000';
export const BASE_URL = 'http://localhost:3001';

let serverProcess: ChildProcess;

const dynamoClient = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: DYNAMODB_ENDPOINT,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

async function waitForDynamoDB(maxWaitMs = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      await dynamoClient.send(new ListTablesCommand({}));
      return;
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error('DynamoDB Local did not become ready within 10 seconds');
}

async function waitForServer(maxWaitMs = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/items`);
      if (res.status < 500) return;
    } catch {
      // server not up yet
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('HTTP server did not become ready within 10 seconds');
}

beforeAll(async () => {
  await waitForDynamoDB();

  await dynamoClient.send(new CreateTableCommand({
    TableName: TABLE_NAME,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  }));

  serverProcess = spawn('pnpm', ['tsx', 'src/server.ts'], {
    env: {
      ...process.env,
      PORT: '3001',
      USE_DYNAMODB: 'false',           // Phase 2: change to 'true'
      DYNAMODB_TABLE_NAME: TABLE_NAME,
      DYNAMODB_ENDPOINT,
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'local',
      AWS_SECRET_ACCESS_KEY: 'local',
    },
    stdio: 'pipe',
    shell: false,
  });

  serverProcess.stderr?.on('data', (d: Buffer) => process.stderr.write(d));

  await waitForServer();
}, 30000);

afterAll(async () => {
  serverProcess?.kill('SIGTERM');
  try {
    await dynamoClient.send(new DeleteTableCommand({ TableName: TABLE_NAME }));
  } catch {
    // ignore cleanup errors
  }
});
```

- [ ] **Step 3: Create `tests/api/items.api.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import './setup.js';
import { BASE_URL } from './setup.js';

const validItem = {
  subject: 'AP Biology',
  itemType: 'multiple-choice',
  difficulty: 3,
  content: {
    question: 'What is photosynthesis?',
    options: ['A', 'B', 'C', 'D'],
    correctAnswer: 'A',
    explanation: 'Photosynthesis is the process by which plants make food.',
  },
  metadata: { author: 'test-author', status: 'draft', tags: ['biology'] },
  securityLevel: 'standard',
};

async function post(path: string, body?: object) {
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function get(path: string) {
  return fetch(`${BASE_URL}${path}`);
}

async function put(path: string, body: object) {
  return fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/items', () => {
  it('returns 201 with created item', async () => {
    const res = await post('/api/items', validItem);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body).toHaveProperty('id');
    expect(body.subject).toBe('AP Biology');
  });

  it('returns 400 for invalid body', async () => {
    const res = await post('/api/items', { subject: 'incomplete' });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });
});

describe('GET /api/items/:id', () => {
  it('returns 200 with the item', async () => {
    const created = await (await post('/api/items', validItem)).json();
    const res = await get(`/api/items/${created.id}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.id).toBe(created.id);
  });

  it('returns 404 for unknown id', async () => {
    const res = await get('/api/items/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/items/:id', () => {
  it('returns 200 with updated item', async () => {
    const created = await (await post('/api/items', validItem)).json();
    const res = await put(`/api/items/${created.id}`, { subject: 'AP Chemistry' });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.subject).toBe('AP Chemistry');
  });

  it('returns 404 for unknown id', async () => {
    const res = await put('/api/items/does-not-exist', { subject: 'AP Chemistry' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/items', () => {
  it('returns 200 with items array and total', async () => {
    await post('/api/items', validItem);
    const res = await get('/api/items');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(typeof body.limit).toBe('number');
    expect(typeof body.offset).toBe('number');
  });
});

describe('POST /api/items/:id/versions', () => {
  it('returns 201 with incremented version', async () => {
    const created = await (await post('/api/items', validItem)).json();
    const res = await post(`/api/items/${created.id}/versions`);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.metadata.version).toBe(2);
  });

  it('returns 404 for unknown id', async () => {
    const res = await post('/api/items/does-not-exist/versions');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/items/:id/audit', () => {
  it('returns 200 with { itemId, versions } shape', async () => {
    const created = await (await post('/api/items', validItem)).json();
    const res = await get(`/api/items/${created.id}/audit`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.itemId).toBe(created.id);
    expect(Array.isArray(body.versions)).toBe(true);
  });

  it('returns 404 for unknown id', async () => {
    const res = await get('/api/items/does-not-exist/audit');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 4: Add `test:api` script to `package.json`**

In the `scripts` block of `package.json`, add:
```json
"test:api": "docker-compose -f tests/api/docker-compose.yml up -d && vitest run tests/api; docker-compose -f tests/api/docker-compose.yml down"
```

The `;` before `docker-compose down` ensures teardown runs even if tests fail.

- [ ] **Step 5: Commit**

```bash
git add tests/api/ package.json
git commit -m "test: add Docker-based API tests for all 6 endpoints"
```

---

## Task 14: ARCHITECTURE.md

**Files:**
- Modify: `ARCHITECTURE.md`

- [ ] **Step 1: Replace `ARCHITECTURE.md` with full content**

```markdown
# Architecture Documentation

## Data Model Design

### DynamoDB Table Schema

**Table name:** `ExamItems`
**Partition key:** `id` (string, UUID)
**Sort key:** `sk` (string)

#### Key Patterns

| Record type      | PK       | SK             |
|------------------|----------|----------------|
| Current item     | `<uuid>` | `#CURRENT`     |
| Version snapshot | `<uuid>` | `VERSION#0001` |

Zero-padded version numbers in the SK (`VERSION#0001`, `VERSION#0002`, …) ensure lexicographic sort matches version order.

#### Access Patterns

| Operation       | DynamoDB operation |
|-----------------|-------------------|
| Create item     | `TransactWriteItems` → writes `#CURRENT` + `VERSION#0001` atomically |
| Get item        | `GetItem(id, #CURRENT)` |
| Update item     | `TransactWriteItems` → overwrites `#CURRENT` + writes new `VERSION#NNNN` |
| List items      | `Query` on GSI, SK filter `= #CURRENT` |
| Create version  | `TransactWriteItems` → overwrites `#CURRENT` + writes new `VERSION#NNNN` |
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

## Infrastructure Choices (Phase 2 Preview)

- **API Gateway (HTTP API)** — lower latency and cost than REST API, sufficient for this use case
- **Lambda per endpoint** — independent scaling and IAM policies; minimal blast radius per function
- **DynamoDB** — serverless, scales automatically, single-digit millisecond reads

---

## Scalability

- GSIs on `subject` and `itemStatus` eliminate full-table Scans for the two common list filters
- Lambda scales horizontally without configuration
- `offset`-based pagination used in Phase 1 for simplicity; DynamoDB's `LastEvaluatedKey` cursor is more efficient at large page offsets and is a Phase 2 item

---

## Security

- IAM least-privilege per Lambda: read-only functions (`getItem`, `listItems`, `getAudit`) get `dynamodb:GetItem`/`Query` only; write functions get scoped write policies on the single table
- DynamoDB encryption at rest enabled by default
- No authentication in Phase 1 — API Gateway JWT authorizer or Lambda authorizer is a Phase 2 item

---

## Trade-offs

| Decision | Chosen approach | Alternative | Reason |
|----------|----------------|-------------|--------|
| Versioning storage | Single-table `#CURRENT` / `VERSION#` SK pattern | Separate `ExamItemVersions` table | Atomic writes; no cross-table transactions required |
| Pagination | `offset` / `limit` | DynamoDB `LastEvaluatedKey` cursor | Simpler for Phase 1; cursor is more efficient at scale |
| Authentication | None | JWT / Lambda authorizer | Deferred to Phase 2 to keep Phase 1 focused on handler design |
| DynamoDB implementation | Deferred to Phase 2 | Full implementation in Phase 1 | Phase 1 validates the handler and schema design; DynamoDB wiring follows CDK in Phase 2 |
| List filtering | GSI per filter field | Single Scan + filter | GSI avoids full-table Scans as data grows |
```

- [ ] **Step 2: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs: fill in ARCHITECTURE.md with DynamoDB schema, access patterns, trade-offs"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| All 6 handlers as Lambda-compatible | Tasks 5–10 |
| `@types/aws-lambda` devDep | Task 1 |
| Zod validators in `src/validators/items.ts` | Task 2 |
| Storage singleton + test reset | Task 3 |
| `makeEvent` helper + `beforeEach` reset | Task 4 |
| One `describe` per handler in single test file | Tasks 5–10 |
| `USE_DYNAMODB=false` in unit test setup | Task 4 (`beforeEach`) |
| `.env.sample` + `.env` copy | Task 1 |
| `server.ts` wired for all 6 routes | Task 11 |
| `example.ts` deleted | Task 12 |
| Docker API tests with `docker-compose` | Task 13 |
| `test:api` npm script with `;` teardown | Task 13 Step 4 |
| `ARCHITECTURE.md` | Task 14 |
| `POST /versions` takes no body | Tasks 9, 13 (no body passed) |
| Audit response wraps `{ itemId, versions }` | Tasks 10, 13 |

**Placeholder scan:** No TBDs or incomplete steps found.

**Type consistency:**
- `createStorage()` called inside each handler function (not at module level) ✅
- `_resetStorageForTesting` defined in Task 3, imported in Task 4 ✅
- `makeEvent` defined in Task 4, used in Tasks 5–10 ✅
- `validItem` defined in Task 4, used in Tasks 5–10 ✅
- `BASE_URL` exported from `setup.ts`, double-imported correctly in `items.api.test.ts` ✅
- All 6 handler function names match across stubs (Task 4), implementations (Tasks 5–10), and server routes (Task 11) ✅
