# Member 3 – Database Management

**Project:** AYUSH Digital Health Platform (updated `Ayush_Health.zip`)

**Scope:** Owns the shared SQLite database helper, Shared Platform schema/seed initialization and database directory placeholders. This project creates service databases at runtime; it does not ship populated .db files.

## Responsibilities
- Shared SQLite openDb helper and common infrastructure tables (idempotency, event_outbox, processed_events).
- Shared Platform database schema and demo seed logic.
- Database directory placeholders for each service, preserving the one-database-per-service layout.
- Maintain the database schema inventory and coordinate schema changes that are embedded in service backend source files.

## Included files (original project-relative paths)
- `api-gateway/database/README.md`
- `event-bus/database/.gitkeep`
- `integrations/database/.gitkeep`
- `libs/common/db.js`
- `longitudinal-record-service/database/.gitkeep`
- `scripts/seed-demo.js`
- `services/ayurveda-service/database/.gitkeep`
- `services/common-clinical-service/database/.gitkeep`
- `services/homoeopathy-service/database/.gitkeep`
- `services/siddha-service/database/.gitkeep`
- `services/unani-service/database/.gitkeep`
- `services/yoga-naturopathy-service/database/.gitkeep`
- `shared-platform/backend/db.js`
- `shared-platform/backend/seed.js`
- `shared-platform/database/.gitkeep`

## Technologies / components observed in this package
- SQLite
- better-sqlite3
- Runtime schema initialization
- Seed data scripts

## Setup and execution
- Start from the complete repository's main branch; this package is not a standalone database server.
- Run npm install at the repository root.
- Run npm run dev to let each service initialize its own SQLite database on first start; database files are runtime-generated and ignored by Git.
- Run npm run seed to insert the synthetic Shared Platform demo accounts when needed (the Shared Platform also seeds on first start unless SEED_DEMO=0).

## Dependencies on other members
- Member 2 owns most service backend files. Some schemas are defined inline in those backend files and must be changed with the backend owner through a coordinated PR.
- Member 4 owns Event Bus and WhatsApp integration source files; their tables are initialized in those integration-owned files.
- Member 4 owns the root package manifest and runtime scripts used to initialize/run services.

## Integration notes
Important architecture constraint: no service reads another service's SQLite file. Cross-service data travels through internal HTTP APIs or the Event Bus. The current code embeds several schemas inside service/backend files, so this package deliberately does not duplicate those backend files or extract/refactor schemas into new files.

See `DATABASE_SCHEMA_INVENTORY.md` in this package for the current schema source map.

## GitHub branch usage
Create this member branch from the same complete, working project baseline in `main`. Extract this ZIP at the repository root so the original paths overlay the baseline. Do not create a new empty repository from this ZIP alone; each package intentionally contains only the files assigned to this member. Open a Pull Request back to `main` after testing.
