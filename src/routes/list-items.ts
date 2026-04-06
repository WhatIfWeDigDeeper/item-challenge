import type { RouteDefinition } from './index.js';
import { listItemsHandler } from '../handlers/list-items.js';

export const listItemsRoute: RouteDefinition = {
  method: 'GET',
  match: parts => parts.length === 2 && parts[1] === 'items',
  pathParams: () => null,
  handler: listItemsHandler,
};
