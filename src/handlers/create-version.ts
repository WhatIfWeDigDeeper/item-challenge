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
