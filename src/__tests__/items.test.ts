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
