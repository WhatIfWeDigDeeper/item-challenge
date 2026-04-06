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
