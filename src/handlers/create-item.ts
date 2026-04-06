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
