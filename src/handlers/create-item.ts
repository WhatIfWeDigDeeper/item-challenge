import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export async function createItemHandler(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return { statusCode: 501, body: JSON.stringify({ error: 'Not implemented' }) };
}
