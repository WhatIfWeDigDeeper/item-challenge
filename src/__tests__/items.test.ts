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
