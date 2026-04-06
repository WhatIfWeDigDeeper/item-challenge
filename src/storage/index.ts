import { ItemStorage } from './interface.js';
import { MemoryStorage } from './memory.js';
import { DynamoDBStorage } from './dynamodb.js';

let instance: ItemStorage | null = null;

export function createStorage(): ItemStorage {
  if (!instance) {
    if (process.env.USE_DYNAMODB === 'true') {
      console.log('📦 Using DynamoDB storage');
      instance = new DynamoDBStorage();
    } else {
      console.log('📦 Using in-memory storage');
      instance = new MemoryStorage();
    }
  }
  return instance;
}

/** For testing only — forces next createStorage() call to create a fresh instance. */
export function _resetStorageForTesting(): void {
  instance = null;
}

export * from './interface.js';
