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
