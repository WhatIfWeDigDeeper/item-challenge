import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createStorage } from '../storage/index.js';
import { CreateItemSchema } from '../validators/items.js';

export async function createItemHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    let body: unknown;
    try {
      body = JSON.parse(event.body ?? '{}');
    } catch {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON body' }) };
    }
    const result = CreateItemSchema.safeParse(body);

    if (!result.success) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Validation failed', details: result.error.flatten() }),
      };
    }

    const item = await createStorage().createItem(result.data);
    return { statusCode: 201, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) };
  } catch (error) {
    console.error('Error creating item:', error);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Internal server error' }) };
  }
}
