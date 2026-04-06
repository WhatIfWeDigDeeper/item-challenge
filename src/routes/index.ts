import type { APIGatewayProxyEvent } from 'aws-lambda';
import { createItemRoute } from './create-item.js';
import { listItemsRoute } from './list-items.js';
import { getItemRoute } from './get-item.js';
import { updateItemRoute } from './update-item.js';
import { createVersionRoute } from './create-version.js';
import { getAuditRoute } from './get-audit.js';

export interface RouteDefinition {
  method: string;
  match: (parts: string[]) => boolean;
  pathParams: (parts: string[]) => Record<string, string> | null;
  handler: (event: APIGatewayProxyEvent) => Promise<{ statusCode: number; body: string }>;
}

const routes: RouteDefinition[] = [
  createItemRoute,
  listItemsRoute,
  getItemRoute,
  updateItemRoute,
  createVersionRoute,
  getAuditRoute,
];

type BuildEvent = (
  pathParameters: Record<string, string> | null,
  queryStringParameters: Record<string, string> | null,
  body: string | null,
) => APIGatewayProxyEvent;

export async function route(
  method: string,
  parts: string[],
  buildEvent: BuildEvent,
  body: string | null,
  queryStringParameters: Record<string, string> | null,
): Promise<{ statusCode: number; body: string }> {
  const matched = routes.find(r => r.method === method && r.match(parts));
  if (matched) {
    return matched.handler(buildEvent(matched.pathParams(parts), queryStringParameters, body));
  }
  return { statusCode: 404, body: JSON.stringify({ error: 'Route not found' }) };
}
