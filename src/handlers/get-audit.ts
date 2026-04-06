import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createStorage } from '../storage/index.js';

export async function getAuditHandler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const id = event.pathParameters?.id;
    if (!id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing item id' }) };
    }

    const storage = createStorage();
    const item = await storage.getItem(id);
    if (!item) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Item not found' }) };
    }

    const versions = await storage.getAuditTrail(id);
    return { statusCode: 200, body: JSON.stringify({ itemId: id, versions }) };
  } catch (error) {
    console.error('Error getting audit trail:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
  }
}
