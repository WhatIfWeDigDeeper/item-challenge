import type { RouteDefinition } from './index.js';
import { updateItemHandler } from '../handlers/update-item.js';

export const updateItemRoute: RouteDefinition = {
  method: 'PUT',
  match: parts => parts.length === 3 && parts[1] === 'items',
  pathParams: parts => ({ id: parts[2] }),
  handler: updateItemHandler,
};
