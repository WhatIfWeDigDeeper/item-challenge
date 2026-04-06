import type { RouteDefinition } from './index.js';
import { getAuditHandler } from '../handlers/get-audit.js';

export const getAuditRoute: RouteDefinition = {
  method: 'GET',
  match: parts => parts.length === 4 && parts[0] === 'api' && parts[1] === 'items' && parts[3] === 'audit',
  pathParams: parts => ({ id: parts[2] }),
  handler: getAuditHandler,
};
