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
