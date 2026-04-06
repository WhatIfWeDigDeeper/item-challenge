import type { RouteDefinition } from './index.js';
import { createVersionHandler } from '../handlers/create-version.js';

export const createVersionRoute: RouteDefinition = {
  method: 'POST',
  match: parts => parts.length === 4 && parts[1] === 'items' && parts[3] === 'versions',
  pathParams: parts => ({ id: parts[2] }),
  handler: createVersionHandler,
};
