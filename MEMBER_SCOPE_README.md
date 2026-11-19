# Member 4 – API & Integration

**Project:** AYUSH Digital Health Platform (updated `Ayush_Health.zip`)

**Scope:** Owns the API Gateway, Event Bus, Integrations service (including WhatsApp/OCR/voice), shared inter-service integration helpers, project orchestration, tests and root runtime configuration.

## Responsibilities
- API Gateway routing, token verification, rate limiting, request IDs, CORS and proxy routing.
- Event Bus publish/subscribe delivery and retry handling.
- Integrations backend, WhatsApp bot/drivers/language/reader/voice modules, OCR language data and external-healthcare status endpoint.
- Shared service routing/configuration, internal HTTP clients and event publishing helpers.
- Root scripts, service process orchestration, project-wide tests, documentation and runtime package/environment configuration.

## Included files (original project-relative paths)
- `.env.example`
- `.gitignore`
- `README.md`
- `api-gateway/backend/server.js`
- `api-gateway/frontend/README.md`
- `docs/ACCEPTANCE-EVIDENCE.md`
- `docs/ARCHITECTURE.md`
- `docs/LIMITATIONS.md`
- `docs/OCR-READER-FIX.md`
- `event-bus/backend/server.js`
- `integrations/backend/server.js`
- `integrations/external-healthcare/status.js`
- `integrations/tessdata/eng.traineddata`
- `integrations/whatsapp/bot.js`
- `integrations/whatsapp/drivers.js`
- `integrations/whatsapp/i18n.js`
- `integrations/whatsapp/reader.js`
- `integrations/whatsapp/voice.js`
- `libs/common/config.js`
- `libs/common/events.js`
- `libs/common/internal.js`
- `package-lock.json`
- `package.json`
- `scripts/acceptance-test.js`
- `scripts/check-syntax.js`
- `scripts/dev-all.js`
- `scripts/health.js`
- `scripts/isolation-test.js`
- `scripts/reader-test.js`
- `scripts/services.js`

## Technologies / components observed in this package
- Node.js
- Express 4
- API Gateway / reverse proxy
- HTTP inter-service clients
- Event Bus (durable publish/subscribe)
- WhatsApp integration (Baileys optional dependency)
- Tesseract OCR / voice processing modules
- Project test and orchestration scripts

## Setup and execution
- Start from the complete repository's main branch.
- Copy .env.example to .env and set required secrets/provider settings locally; never commit .env or credentials.
- Run npm install, then npm run dev to launch the Event Bus, Gateway, backend services, Integrations and Vite.
- Run npm run health, npm test, npm run test:isolation, npm run test:reader, npm run check and npm run build as appropriate.

## Dependencies on other members
- Member 2's backend services must be running for gateway routing, internal service calls and end-to-end tests.
- Member 3's database helper is used by Event Bus and Integrations and must remain available.
- Member 1's frontend is served through Vite in development and by the Gateway after a production build.

## Integration notes
The uploaded project has no existing .github/workflows CI workflow. This package includes project test/orchestration scripts and the API/integration code, but does not invent or add a CI/CD workflow. Add GitHub Actions separately after the team agrees on required checks.

## CI status
No GitHub Actions workflow (`.github/workflows/*.yml`) was present in the uploaded ZIP. Existing test scripts are included; CI configuration should be added as a separate, reviewed change.

## GitHub branch usage
Create this member branch from the same complete, working project baseline in `main`. Extract this ZIP at the repository root so the original paths overlay the baseline. Do not create a new empty repository from this ZIP alone; each package intentionally contains only the files assigned to this member. Open a Pull Request back to `main` after testing.
