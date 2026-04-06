# Architecture Documentation

## Data Model Design

### DynamoDB Table Schema

**Table name:** `ExamItems`
**Partition key:** `id` (string, UUID)
**Sort key:** `sk` (string)

#### Key Patterns

| Record type      | PK       | SK             |
|------------------|----------|----------------|
| Current item     | `<uuid>` | `#CURRENT`     |
| Version snapshot | `<uuid>` | `VERSION#0001` |

Zero-padded version numbers in the SK (`VERSION#0001`, `VERSION#0002`, …) ensure lexicographic sort matches version order.

#### Access Patterns

| Operation       | DynamoDB operation |
|-----------------|-------------------|
| Create item     | `TransactWriteItems` → writes `#CURRENT` + `VERSION#0001` atomically |
| Get item        | `GetItem(id, #CURRENT)` |
| Update item     | `TransactWriteItems` → overwrites `#CURRENT` + writes new `VERSION#NNNN` |
| List items      | `Query` on GSI, SK filter `= #CURRENT` |
| Create version  | `TransactWriteItems` → overwrites `#CURRENT` + writes new `VERSION#NNNN` |
| Get audit trail | `Query(id)` with SK `begins_with VERSION#` |

#### GSIs

- **SubjectIndex** — PK: `subject`, SK: `sk`
  Supports `GET /api/items?subject=X` without Scan.

- **StatusIndex** — PK: `itemStatus`, SK: `sk`
  `itemStatus` is a denormalized top-level copy of `metadata.status`.
  DynamoDB cannot index nested attributes, so `itemStatus` is written
  as a top-level field on every create/update alongside `metadata.status`.
  Supports `GET /api/items?status=X` without Scan.

### Why Single-Table Design

Versioning and current-item reads are in one table. `TransactWriteItems` makes current + snapshot writes atomic with no cross-table coordination. `Query` on PK retrieves the full audit trail in one round-trip.

---

## Infrastructure Choices (Phase 2 Preview)

- **API Gateway (HTTP API)** — lower latency and cost than REST API, sufficient for this use case
- **Lambda per endpoint** — independent scaling and IAM policies; minimal blast radius per function
- **DynamoDB** — serverless, scales automatically, single-digit millisecond reads

---

## Scalability

- GSIs on `subject` and `itemStatus` eliminate full-table Scans for the two common list filters
- Lambda scales horizontally without configuration
- `offset`-based pagination used in Phase 1 for simplicity; DynamoDB's `LastEvaluatedKey` cursor is more efficient at large page offsets and is a Phase 2 item

---

## Security

- IAM least-privilege per Lambda: read-only functions (`getItem`, `listItems`, `getAudit`) get `dynamodb:GetItem`/`Query` only; write functions get scoped write policies on the single table
- DynamoDB encryption at rest enabled by default
- No authentication in Phase 1 — API Gateway JWT authorizer or Lambda authorizer is a Phase 2 item

---

## Trade-offs

| Decision | Chosen approach | Alternative | Reason |
|----------|----------------|-------------|--------|
| Versioning storage | Single-table `#CURRENT` / `VERSION#` SK pattern | Separate `ExamItemVersions` table | Atomic writes; no cross-table transactions required |
| Pagination | `offset` / `limit` | DynamoDB `LastEvaluatedKey` cursor | Simpler for Phase 1; cursor is more efficient at scale |
| Authentication | None | JWT / Lambda authorizer | Deferred to Phase 2 to keep Phase 1 focused on handler design |
| DynamoDB implementation | Deferred to Phase 2 | Full implementation in Phase 1 | Phase 1 validates the handler and schema design; DynamoDB wiring follows CDK in Phase 2 |
| List filtering | GSI per filter field | Single Scan + filter | GSI avoids full-table Scans as data grows |
