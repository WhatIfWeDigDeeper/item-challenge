import { createServer, IncomingMessage, ServerResponse } from 'http';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { createItemHandler } from './handlers/create-item.js';
import { getItemHandler } from './handlers/get-item.js';
import { updateItemHandler } from './handlers/update-item.js';
import { listItemsHandler } from './handlers/list-items.js';
import { createVersionHandler } from './handlers/create-version.js';
import { getAuditHandler } from './handlers/get-audit.js';

const PORT = process.env.PORT || 3000;

function buildEvent(
  req: IncomingMessage,
  body: string | null,
  pathParameters: Record<string, string> | null,
  queryStringParameters: Record<string, string> | null,
): APIGatewayProxyEvent {
  return {
    httpMethod: req.method ?? 'GET',
    path: req.url?.split('?')[0] ?? '/',
    pathParameters,
    queryStringParameters,
    body,
    headers: req.headers as Record<string, string>,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    requestContext: {} as any,
    resource: '',
    stageVariables: null,
  } as APIGatewayProxyEvent;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const { method, url = '/' } = req;

  let rawBody = '';
  req.on('data', chunk => rawBody += chunk);
  await new Promise(resolve => req.on('end', resolve));

  console.log(`${method} ${url}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const urlObj = new URL(`http://localhost${url}`);
    const parts = urlObj.pathname.split('/').filter(Boolean);
    // parts examples: ['api','items'], ['api','items','<id>'], ['api','items','<id>','versions']
    const qs = Object.fromEntries(urlObj.searchParams.entries());
    const queryStringParameters = Object.keys(qs).length ? qs : null;
    const body = rawBody || null;

    let result;

    if (method === 'POST' && parts.length === 2 && parts[1] === 'items') {
      result = await createItemHandler(buildEvent(req, body, null, null));
    } else if (method === 'GET' && parts.length === 2 && parts[1] === 'items') {
      result = await listItemsHandler(buildEvent(req, null, null, queryStringParameters));
    } else if (method === 'GET' && parts.length === 3 && parts[1] === 'items') {
      result = await getItemHandler(buildEvent(req, null, { id: parts[2] }, null));
    } else if (method === 'PUT' && parts.length === 3 && parts[1] === 'items') {
      result = await updateItemHandler(buildEvent(req, body, { id: parts[2] }, null));
    } else if (method === 'POST' && parts.length === 4 && parts[1] === 'items' && parts[3] === 'versions') {
      result = await createVersionHandler(buildEvent(req, null, { id: parts[2] }, null));
    } else if (method === 'GET' && parts.length === 4 && parts[1] === 'items' && parts[3] === 'audit') {
      result = await getAuditHandler(buildEvent(req, null, { id: parts[2] }, null));
    } else {
      result = { statusCode: 404, body: JSON.stringify({ error: 'Route not found' }) };
    }

    res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
    res.end(result.body);
  } catch (error) {
    console.error('Server error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

export const server = createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log('\nEndpoints:');
  console.log(`  POST   http://localhost:${PORT}/api/items`);
  console.log(`  GET    http://localhost:${PORT}/api/items`);
  console.log(`  GET    http://localhost:${PORT}/api/items/:id`);
  console.log(`  PUT    http://localhost:${PORT}/api/items/:id`);
  console.log(`  POST   http://localhost:${PORT}/api/items/:id/versions`);
  console.log(`  GET    http://localhost:${PORT}/api/items/:id/audit`);
  console.log('\nPress Ctrl+C to stop\n');
});
