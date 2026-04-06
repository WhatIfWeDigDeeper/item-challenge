import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createStorage } from '../storage/index.js';

export async function getItemHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const id = event.pathParameters?.id;
    if (!id) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing item id' }) };
    }

    const item = await createStorage().getItem(id);
    if (!item) {
      return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Item not found' }) };
    }

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) };
  } catch (error) {
    console.error('Error getting item:', error);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Internal server error' }) };
  }
}
