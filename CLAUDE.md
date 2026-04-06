# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a take-home coding challenge to build an exam item management API. The system manages exam items (test questions) with versioning, auditing, and dual-deployment architecture (local HTTP server and AWS Lambda).

## Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Start local dev server with hot reload (http://localhost:3000)
pnpm build            # Compile TypeScript to dist/
pnpm start            # Run compiled output
pnpm test             # Run tests once
pnpm test:watch       # Watch mode
pnpm test:ui          # Interactive Vitest UI
```

Run a single test file:
```bash
pnpm vitest run src/__tests__/example.test.ts
```

Optional DynamoDB storage (instead of in-memory default):
```bash
export USE_DYNAMODB=true
export DYNAMODB_TABLE_NAME=ExamItems
export DYNAMODB_ENDPOINT=http://localhost:8000   # for local DynamoDB
pnpm dev
```

## Architecture

### Dual-Deployment Design

Handlers in `src/handlers/` return `{statusCode, body}` objects — they are intentionally Lambda-compatible. The local `src/server.ts` wraps them in a Node.js `http` server for development. The same handler code deploys to AWS Lambda without modification.

### Storage Abstraction

`src/storage/interface.ts` defines the `ItemStorage` interface. Two implementations exist:
- `src/storage/memory.ts` — default for local dev (in-memory, no setup required)
- `src/storage/dynamodb.ts` — production backend (AWS DynamoDB)

`src/storage/index.ts` is a factory: it checks `USE_DYNAMODB` env var and returns the appropriate implementation. Handlers depend only on the interface, never a concrete storage class.

### Key Types

`src/types/item.ts` defines the core data model: `ExamItem`, request/response shapes, and query parameters. All validation should use Zod (`zod` is already a dependency).

## Required API Endpoints (per README)

Six endpoints to implement:
1. `POST /api/items` — create item
2. `GET /api/items/:id` — get item by ID
3. `PUT /api/items/:id` — update item
4. `GET /api/items` — list/filter items
5. `POST /api/items/:id/versions` — create new version
6. `GET /api/items/:id/audit` — get audit trail

## Infrastructure as Code

The challenge expects either AWS CDK or Terraform. The stack needs: Lambda functions, API Gateway, and DynamoDB table. No IaC scaffolding exists yet — this is a required deliverable.

## Testing

Tests live in `src/__tests__/`. Vitest is configured with globals enabled (no import needed for `describe`, `it`, `expect`). Coverage via V8 reports to `coverage/`.

## Environment

### GitHub CLI (gh)
`gh` commands fail in sandbox mode on this machine with a TLS certificate error (`x509: OSStatus -26276`).
Always use `dangerouslyDisableSandbox: true` when invoking `gh`.
