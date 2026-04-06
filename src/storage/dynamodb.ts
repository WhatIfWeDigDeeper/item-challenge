/**
 * DynamoDB Storage Implementation (Optional)
 *
 * This implementation uses AWS DynamoDB for persistent storage.
 *
 * To use this:
 * 1. Set environment variable: USE_DYNAMODB=true
 * 2. Configure AWS credentials (or use DynamoDB Local)
 * 3. Set DYNAMODB_TABLE_NAME (or use default "ExamItems")
 *
 * For DynamoDB Local:
 * - Download from: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html
 * - Run: java -Djava.library.path=./DynamoDBLocal_lib -jar DynamoDBLocal.jar -sharedDb
 * - Set DYNAMODB_ENDPOINT=http://localhost:8000
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  ScanCommand,
  QueryCommand
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { ExamItem, CreateItemRequest, UpdateItemRequest, ListItemsQuery } from '../types/item.js';
import { ItemStorage } from './interface.js';

export class DynamoDBStorage implements ItemStorage {
  private client: DynamoDBDocumentClient;
  private tableName: string;

  constructor() {
    const dynamoClient = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.DYNAMODB_ENDPOINT && { endpoint: process.env.DYNAMODB_ENDPOINT }),
    });

    this.client = DynamoDBDocumentClient.from(dynamoClient);
    this.tableName = process.env.DYNAMODB_TABLE_NAME || 'ExamItems';
  }

  async createItem(data: CreateItemRequest): Promise<ExamItem> {
    const now = Date.now();
    const item: ExamItem = {
      id: randomUUID(),
      ...data,
      metadata: {
        ...data.metadata,
        created: now,
        lastModified: now,
        version: 1,
      },
    };

    // sk is required by the composite primary key; 'ITEM' identifies the base record.
    // VERSION#0001 is written alongside so the audit trail starts at creation.
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: { ...item, sk: 'ITEM' },
    }));
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: { ...item, sk: 'VERSION#0001' },
    }));

    return item;
  }

  async getItem(id: string): Promise<ExamItem | null> {
    const result = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { id, sk: 'ITEM' },
    }));

    if (!result.Item) return null;
    const { sk: _sk, ...item } = result.Item;
    return item as ExamItem;
  }

  async updateItem(id: string, data: UpdateItemRequest): Promise<ExamItem | null> {
    const existing = await this.getItem(id);
    if (!existing) return null;

    const updated: ExamItem = {
      ...existing,
      ...data,
      content: data.content ? { ...existing.content, ...data.content } : existing.content,
      metadata: {
        ...existing.metadata,
        ...(data.metadata || {}),
        lastModified: Date.now(),
        version: existing.metadata.version + 1,
      },
    };

    const versionSk = `VERSION#${String(updated.metadata.version).padStart(4, '0')}`;
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: { ...updated, sk: 'ITEM' },
    }));
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: { ...updated, sk: versionSk },
    }));

    return updated;
  }

  async listItems(query: ListItemsQuery): Promise<{ items: ExamItem[]; total: number }> {
    const filterParts: string[] = ['sk = :sk'];
    const expressionAttributeValues: Record<string, unknown> = { ':sk': 'ITEM' };
    const expressionAttributeNames: Record<string, string> = {};

    if (query.subject) {
      filterParts.push('#subject = :subject');
      expressionAttributeNames['#subject'] = 'subject';
      expressionAttributeValues[':subject'] = query.subject;
    }

    if (query.status) {
      // metadata and status are reserved words in DynamoDB expression syntax
      filterParts.push('#metadata.#status = :status');
      expressionAttributeNames['#metadata'] = 'metadata';
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = query.status;
    }

    const result = await this.client.send(new ScanCommand({
      TableName: this.tableName,
      FilterExpression: filterParts.join(' AND '),
      ExpressionAttributeValues: expressionAttributeValues,
      ...(Object.keys(expressionAttributeNames).length > 0 && { ExpressionAttributeNames: expressionAttributeNames }),
    }));

    // DynamoDB Limit caps items *scanned*, not returned — paginate client-side instead
    const allItems = (result.Items || []).map(({ sk: _sk, ...item }) => item as ExamItem);
    const offset = query.offset || 0;
    const limit = query.limit || 10;
    return { items: allItems.slice(offset, offset + limit), total: allItems.length };
  }

  async createVersion(id: string): Promise<ExamItem | null> {
    const current = await this.getItem(id);
    if (!current) return null;

    // Increment version and update lastModified — consistent with MemoryStorage behavior
    const updated: ExamItem = {
      ...current,
      metadata: {
        ...current.metadata,
        version: current.metadata.version + 1,
        lastModified: Date.now(),
      },
    };
    const versionSk = `VERSION#${String(updated.metadata.version).padStart(4, '0')}`;

    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: { ...updated, sk: 'ITEM' },
    }));
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: { ...updated, sk: versionSk },
    }));

    return updated;
  }

  async getAuditTrail(id: string): Promise<ExamItem[]> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'id = :id AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: { ':id': id, ':prefix': 'VERSION#' },
    }));

    return (result.Items || []).map(({ sk: _sk, ...item }) => item as ExamItem);
  }
}
