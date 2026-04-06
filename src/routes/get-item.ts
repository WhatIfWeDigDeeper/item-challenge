import type { RouteDefinition } from './index.js';
import { getItemHandler } from '../handlers/get-item.js';

export const getItemRoute: RouteDefinition = {
  method: 'GET',
  match: parts => parts.length === 3 && parts[1] === 'items',
  pathParams: parts => ({ id: parts[2] }),
  handler: getItemHandler,
};
