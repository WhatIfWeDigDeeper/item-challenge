import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export async function updateItemHandler(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ error: 'Not implemented' }) };
}
