import { beforeAll, afterAll } from 'vitest';
import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  ListTablesCommand,
} from '@aws-sdk/client-dynamodb';
import { spawn, ChildProcess } from 'child_process';

const TABLE_NAME = 'ExamItems';
const DYNAMODB_ENDPOINT = 'http://localhost:8000';
export const BASE_URL = 'http://localhost:3001';

let serverProcess: ChildProcess;

const dynamoClient = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: DYNAMODB_ENDPOINT,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

async function waitForDynamoDB(maxWaitMs = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      await dynamoClient.send(new ListTablesCommand({}));
      return;
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error('DynamoDB Local did not become ready within 10 seconds');
}

async function waitForServer(maxWaitMs = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/items`);
      if (res.status < 500) return;
    } catch {
      // server not up yet
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('HTTP server did not become ready within 10 seconds');
}

beforeAll(async () => {
  await waitForDynamoDB();

  await dynamoClient.send(new CreateTableCommand({
    TableName: TABLE_NAME,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  }));

  serverProcess = spawn('pnpm', ['tsx', 'src/server.ts'], {
    env: {
      ...process.env,
      PORT: '3001',
      USE_DYNAMODB: 'false',           // Phase 2: change to 'true'
      DYNAMODB_TABLE_NAME: TABLE_NAME,
      DYNAMODB_ENDPOINT,
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'local',
      AWS_SECRET_ACCESS_KEY: 'local',
    },
    stdio: 'pipe',
    shell: false,
  });

  serverProcess.stderr?.on('data', (d: Buffer) => process.stderr.write(d));

  await waitForServer();
}, 30000);

afterAll(async () => {
  serverProcess?.kill('SIGTERM');
  try {
    await dynamoClient.send(new DeleteTableCommand({ TableName: TABLE_NAME }));
  } catch {
    // ignore cleanup errors
  }
});
