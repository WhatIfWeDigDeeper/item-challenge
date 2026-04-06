import { createServer, IncomingMessage, ServerResponse } from 'http';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { route } from './routes/index.js';

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

    const result = await route(
      method ?? 'GET',
      parts,
      (pathParameters, queryStringParameters, body) => buildEvent(req, body, pathParameters, queryStringParameters),
      body,
      queryStringParameters,
    );

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
