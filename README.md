# AYUSH Digital Health Platform — Microservices edition (v3.0)

## Folder layout

Every service has its own `frontend/`, `backend/` and `database/` folder.

```
AYUSH-DIGITAL-HEALTH-PLATFORM/
├── shared-platform/            identity, OTP, face, consent, admin  (+ the React shell: App.jsx, main.jsx, login, registration, shared components)
│   ├── frontend/  backend/  database/
├── api-gateway/                routing, rate limits, serves the built UI
│   ├── frontend/  backend/  database/
├── services/
│   ├── ayurveda-service/  yoga-naturopathy-service/  unani-service/  siddha-service/  homoeopathy-service/
│   └── common-clinical-service/     each: frontend/  backend/  database/
├── longitudinal-record-service/    frontend/  backend/  database/
├── integrations/               whatsapp/  external-healthcare/  backend/  database/  tessdata/
├── event-bus/                  backend/  database/
├── libs/common/                tiny shared helpers (HTTP, signing, validation); no business logic
└── docs/
```

* `backend/` = that service's Express server. `database/` = its own SQLite file, created on first start (git-ignored).
* `frontend/` = that service's React pages. All of them are built into **one** site: `vite.config.js` has an alias per service (`@shared`, `@ayurveda`, `@yoga`, `@unani`, `@siddha`, `@homoeopathy`, `@clinical`, `@longitudinal`) and `index.html` starts at `shared-platform/frontend/main.jsx`. Each AYUSH service's `frontend/index.js` registers its name and icon, which the service picker and the doctor's system selector read.
* Ayurveda's six forms and consultation screen are in `services/ayurveda-service/frontend/`; the generic form screen for the other four systems is `shared-platform/frontend/pages/DomainConsultation.jsx` (forms come from each service's `GET /forms`).


The AYUSH health-record platform, split from one Express app into **11 independently running services**:
an API Gateway, a Shared Platform, five AYUSH domain services, Common Clinical, Longitudinal Record, Integrations and an Event Bus.
The React app (the `frontend/` folders, built together) talks to the gateway only.

```
 browser ──► API Gateway :5000 ──► Shared Platform  :5001  identity, OTP, face, consent, admin, audit   (platform.db)
                │                ├► Ayurveda         :5002  its own forms + versions                      (ayurveda.db)
                │                ├► Yoga & Naturop.  :5003  its own forms + versions                      (yoga.db)
                │                ├► Unani            :5004  its own forms + versions                      (unani.db)
                │                ├► Siddha           :5005  its own forms + versions                      (siddha.db)
                │                ├► Homoeopathy      :5006  its own forms + versions                      (homoeopathy.db)
                │                ├► Common Clinical  :5007  encounters, records, prescriptions, uploads   (clinical.db)
                │                ├► Longitudinal     :5008  patient timeline / summary (read model)       (longitudinal.db)
                │                └► Integrations     :5009  WhatsApp bot, OTP delivery, OCR reader, translate, voice
                └─ Event Bus :5010 (durable, retried, at-least-once)  ◄── every service publishes / subscribes
```

## Run it

```bash
npm install                 # Node 20+; add --omit=optional to skip the WhatsApp/AI extras
copy .env.example .env      # Windows PowerShell; optional: AYUSH_SECRET, OTP_CODE, ANTHROPIC_API_KEY, ...
npm run dev                 # all 11 services + Vite UI on http://localhost:5173
npm start                   # services only; run `npm run build` first and the gateway serves the UI on :5000
npm run health              # which services are up
```

Demo sign-in (OTP shown by the server, or `OTP_CODE` from `.env`): doctor `9000000001` (Ayurveda) / `9000000002` (Siddha),
clinic `9000000005`, admin `9000000009`, auditor `9000000008`. Patients register on the site (OTP + face + consent) or on WhatsApp.

## Tests (all run on temporary data and ports)

| Command | What it proves |
|---|---|
| `npm test` | 94 end-to-end checks through the gateway → writes `docs/ACCEPTANCE-EVIDENCE.md` |
| `npm run test:isolation` | no service reads another's database or code; no shared tables; Clinical holds no identity data |
| `npm run check` | syntax check of the JavaScript / JSX source files |\n| `npm run test:reader` | offline OCR field-mapping regression checks for an Ayurvedic prescription sample |

## How the pieces behave (the rules the code follows)

* **One database per service.** No cross-service reads or foreign keys. Cross-service data = internal HTTP API or event.
* **Identity once, at the gateway.** The gateway verifies the Bearer token, asks the Shared Platform to resolve it (revocation, suspended/unapproved accounts) and forwards a **signed 90-second `X-Identity`** header. Client-sent `X-Role`, `X-Doctor-Id`, `X-Identity`, `X-Service-Token` … are stripped. `/internal/*` is never forwarded.
* **Consent is checked by every service that touches patient data** through `POST /internal/access/check` (own record → allowed; practitioner → needs an active grant, optionally limited to AYUSH systems and days; admin / clinic → denied). Each decision is audited.
* **Events** use a transactional outbox in each service + the bus (retry with backoff, consumers de-duplicate by event id). A service can be down and catch up later.
* **Forms are versioned**: every save is a new version; `Idempotency-Key` makes retries safe.
* **Unregister** deletes identity in the Shared Platform and every other service deletes its own data when it receives `patient.deleted`.

See `docs/ARCHITECTURE.md` for ownership tables, API and event contracts, and `docs/LIMITATIONS.md` for what is *not* real.
