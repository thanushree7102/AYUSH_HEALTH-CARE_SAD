# Member 2 – Backend Services

**Project:** AYUSH Digital Health Platform (updated `Ayush_Health.zip`)

**Scope:** Owns the business logic and Express service implementations for the Shared Platform, five AYUSH domains, Common Clinical and Longitudinal Record.

## Responsibilities
- Shared Platform authentication, OTP, registration, patient/doctor/admin routes, face and Aadhaar backend workflows.
- Five AYUSH domain service server implementations and common domain-service plumbing.
- Common Clinical and Longitudinal Record backend APIs and service business logic.
- Shared backend middleware and validation/security helpers included in this package.

## Included files (original project-relative paths)
- `libs/common/domain-service.js`
- `libs/common/http.js`
- `libs/common/security.js`
- `libs/common/validate.js`
- `longitudinal-record-service/backend/server.js`
- `services/ayurveda-service/backend/server.js`
- `services/common-clinical-service/backend/server.js`
- `services/homoeopathy-service/backend/server.js`
- `services/siddha-service/backend/server.js`
- `services/unani-service/backend/server.js`
- `services/yoga-naturopathy-service/backend/server.js`
- `shared-platform/backend/aadhaar.js`
- `shared-platform/backend/context.js`
- `shared-platform/backend/face.js`
- `shared-platform/backend/otp.js`
- `shared-platform/backend/routes-admin.js`
- `shared-platform/backend/routes-auth.js`
- `shared-platform/backend/routes-internal.js`
- `shared-platform/backend/routes-patient.js`
- `shared-platform/backend/routes-registration.js`
- `shared-platform/backend/server.js`

## Technologies / components observed in this package
- Node.js
- Express 4
- SQLite via better-sqlite3 (through shared DB helper)
- Shared service authentication/validation middleware
- AYUSH domain-service backend pattern

## Setup and execution
- Start from the complete repository's main branch so all shared libraries and root configuration are present.
- At the repository root run npm install and configure .env from .env.example (do not commit .env or secrets).
- Run npm run dev to launch the full service set; use npm run health to inspect service health.
- Run npm run check for the repository-wide syntax check.

## Dependencies on other members
- Member 3 provides libs/common/db.js and the Shared Platform database initializer/seed files.
- Member 4 provides libs/common/config.js, events.js and internal.js, plus the API Gateway, Integrations service and Event Bus.
- Member 1's frontend calls these APIs through Member 4's API Gateway.

## Integration notes
The backend service source files remain in their original service folders. Several service schemas are initialized in their backend server files or in libs/common/domain-service.js; do not move those definitions without coordinating with Member 3 because that would change the existing architecture.

## GitHub branch usage
Create this member branch from the same complete, working project baseline in `main`. Extract this ZIP at the repository root so the original paths overlay the baseline. Do not create a new empty repository from this ZIP alone; each package intentionally contains only the files assigned to this member. Open a Pull Request back to `main` after testing.
