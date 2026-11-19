# Architecture

## 1. Service ownership

| Service | Port | Owns (own SQLite file) | Public API (through gateway, `/v1/*` or `/api/*`) | Calls |
|---|---|---|---|---|
| API Gateway | 5000 | – (rate limits, routing) | everything below; `/v1/health` aggregates all | Platform `/internal/auth/resolve` |
| Shared Platform | 5001 | users, patients, doctors, clinics, admins, face templates, OTP events, consent, audit, roles | `/auth/*`, `/face/*`, `/aadhaar/*`, `/abha/validate`, `/me`, `/doctors`, `/patients/:id/(profile\|medical-history\|health-concerns\|consents)`, `/admin/*` | Integrations (OTP delivery), Clinical (create first encounter) |
| Ayurveda / Yoga & Naturopathy / Unani / Siddha / Homoeopathy | 5002-5006 | `<system>_parts` (versioned form data), `<system>_assessments` | `/<system>/forms`, `/<system>/consultations/:cid/:part[/versions]`, `/<system>/consultations/:cid/summary` | Clinical (find encounter), Platform (consent check) |
| Common Clinical | 5007 | encounters, prescriptions, patient_records, patient_uploads | `/encounters`, `/records`, `/records/extract`, `/patients/:id/(records\|prescriptions)` | Platform (consent), Integrations (OCR) |
| Longitudinal Record | 5008 | timeline_entries (read model built from events) | `/patients/:id/timeline`, `/patients/:id/summary` | Platform, Clinical (summary assembly) |
| Integrations | 5009 | wa_chats, wa_drafts | `/whatsapp/qr`, `/translate`, `/voice/transcribe`, `/external-healthcare/status`, `/notifications`; webhook `/whatsapp`, mock `/whatsapp-mock` | Platform, Clinical |
| Event Bus | 5010 | event log + deliveries | internal only | subscribers' `/internal/events` |

Internal endpoints (service token required, never reachable through the gateway): `/internal/auth/resolve`, `/internal/access/check`,
`/internal/patients/*` (lookup, allergies, grants, register-whatsapp, delete), `/internal/doctors`, `/internal/audit`,
`/internal/encounters/*`, `/internal/records`, `/internal/uploads`, `/internal/reader/read`, `/internal/deliver`, `/internal/events`.

## 2. Events (`libs/common/config.js` → `EVENTS`)

| Event | Published by | Consumed by |
|---|---|---|
| `patient.created` | Platform | Clinical (creates first encounter) |
| `patient.deleted` | Platform | Clinical, five AYUSH services, Longitudinal, Integrations (each purges its own data) |
| `consent.granted` / `consent.withdrawn` | Platform | (available for subscribers; consent is checked live, not cached) |
| `encounter.created` | Clinical | Longitudinal |
| `clinical.record.created` | Clinical | Longitudinal (timeline), Platform (audit), Integrations (WhatsApp notice) |
| `clinical.assessment.saved` | each AYUSH service | Longitudinal, Clinical (doctor / diagnosis note on encounter) |
| `admin.decision.made` | Platform | (available) |

Delivery: outbox row in the publisher's DB → bus `/publish` (retried) → bus delivers to each subscriber in order with exponential backoff → subscriber ignores ids it already processed.

## 3. Identity and tokens

* Access token `k:'access'`, HMAC-signed, 60 min (`ACCESS_TOKEN_MINUTES`), `POST /auth/refresh` (session max 12 h), `POST /auth/logout` revokes it.
* Gateway → service: `X-Identity` (`k:'ident'`, 90 s). Service → service: `X-Service-Token` (`k:'svc'`). Face template sealed with AES-GCM.
* Secret: `AYUSH_SECRET` or an auto-created `data/ayush.secret` (shared by all services on one machine; set the env var when services run on different hosts).

## 4. Running on separate hosts

Every service reads `<NAME>_URL` / `<NAME>_PORT` (e.g. `PLATFORM_URL=http://platform:5001`) or `PORT_BASE`; set the same `AYUSH_SECRET` everywhere.
Each service folder is self-contained apart from `libs/common/` (a small shared library of HTTP, signing and validation helpers — no business logic, no database access to other services).

## End-to-end AYUSH clinical data flow (patient upload + practitioner assessment)

1. The patient selects one of the five AYUSH systems from **Patient → AYUSH Services**. The selected system is passed as the `system` query parameter to the upload/review screen and takes precedence over OCR's detected system. This prevents a generic or incorrect OCR classification from silently changing the patient's explicit selection.
2. The patient reviews and confirms the uploaded document. The document-derived common record is saved through the API Gateway to the Common Clinical Service (`clinical.db`). This is the shared longitudinal record layer, not the domain assessment database.
3. An authorized practitioner opens the patient using the Health Record ID, chooses the AYUSH system in the practitioner screen, and opens that system's consultation workspace.
4. The workspace loads that service's own `/forms` definition. Saving a domain form posts to that service's `/consultations/:cid/:part` endpoint. The domain service validates the fields, checks patient consent, creates a version in its own `<system>_parts` table, updates its own `<system>_assessments` summary, and publishes an assessment event.
5. Therefore, a confirmed patient upload appears in `clinical.db`; the service-specific practitioner assessment appears in exactly one domain DB (`ayurveda.db`, `yoga.db`, `unani.db`, `siddha.db`, or `homoeopathy.db`). These are intentionally separate records linked by patient and encounter identifiers. Internal outbox/idempotency/event tables are maintained by the services and should not be manually populated.

### Practitioner workflow for demo

- Sign in as a practitioner and open a patient with a valid 14-digit Health Record ID and consent for the selected AYUSH system.
- Select the system in the **AYUSH system** selector.
- Complete the system-specific forms shown in the left navigation and press **Save** on each form.
- Verify the matching domain database: `services/<system>-service/database/<system>.db` (Yoga folder is `yoga-naturopathy-service`, database file `yoga.db`).
- In DB Browser, inspect `<system>_parts` and `<system>_assessments`. `clinical.db` remains the common record store.
