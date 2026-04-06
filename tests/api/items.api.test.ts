import { describe, it, expect } from 'vitest';
import './setup.js';
import { BASE_URL } from './setup.js';

const validItem = {
  subject: 'AP Biology',
  itemType: 'multiple-choice',
  difficulty: 3,
  content: {
    question: 'What is photosynthesis?',
    options: ['A', 'B', 'C', 'D'],
    correctAnswer: 'A',
    explanation: 'Photosynthesis is the process by which plants make food.',
  },
  metadata: { author: 'test-author', status: 'draft', tags: ['biology'] },
  securityLevel: 'standard',
};

async function post(path: string, body?: object) {
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function get(path: string) {
  return fetch(`${BASE_URL}${path}`);
}

async function put(path: string, body: object) {
  return fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/items', () => {
  it('returns 201 with created item', async () => {
    const res = await post('/api/items', validItem);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body).toHaveProperty('id');
    expect(body.subject).toBe('AP Biology');
  });

  it('returns 400 for invalid body', async () => {
    const res = await post('/api/items', { subject: 'incomplete' });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('Validation failed');
  });
});

describe('GET /api/items/:id', () => {
  it('returns 200 with the item', async () => {
    const created = await (await post('/api/items', validItem)).json();
    const res = await get(`/api/items/${created.id}`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.id).toBe(created.id);
  });

  it('returns 404 for unknown id', async () => {
    const res = await get('/api/items/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/items/:id', () => {
  it('returns 200 with updated item', async () => {
    const created = await (await post('/api/items', validItem)).json();
    const res = await put(`/api/items/${created.id}`, { subject: 'AP Chemistry' });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.subject).toBe('AP Chemistry');
  });

  it('returns 404 for unknown id', async () => {
    const res = await put('/api/items/does-not-exist', { subject: 'AP Chemistry' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/items', () => {
  it('returns 200 with items array and total', async () => {
    await post('/api/items', validItem);
    const res = await get('/api/items');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(typeof body.limit).toBe('number');
    expect(typeof body.offset).toBe('number');
  });
});

describe('POST /api/items/:id/versions', () => {
  it('returns 201 with incremented version', async () => {
    const created = await (await post('/api/items', validItem)).json();
    const res = await post(`/api/items/${created.id}/versions`);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.metadata.version).toBe(2);
  });

  it('returns 404 for unknown id', async () => {
    const res = await post('/api/items/does-not-exist/versions');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/items/:id/audit', () => {
  it('returns 200 with { itemId, versions } shape', async () => {
    const created = await (await post('/api/items', validItem)).json();
    const res = await get(`/api/items/${created.id}/audit`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.itemId).toBe(created.id);
    expect(Array.isArray(body.versions)).toBe(true);
  });

  it('returns 404 for unknown id', async () => {
    const res = await get('/api/items/does-not-exist/audit');
    expect(res.status).toBe(404);
  });
});
