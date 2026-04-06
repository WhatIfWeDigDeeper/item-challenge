import type { RouteDefinition } from './index.js';
import { createItemHandler } from '../handlers/create-item.js';

export const createItemRoute: RouteDefinition = {
  method: 'POST',
  match: parts => parts.length === 2 && parts[1] === 'items',
  pathParams: () => null,
  handler: createItemHandler,
};
