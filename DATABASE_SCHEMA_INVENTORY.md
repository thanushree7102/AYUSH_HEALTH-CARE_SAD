# Database schema ownership inventory

This inventory maps where the current project initializes its SQLite tables. It is documentation only; it does not move or rewrite schema definitions.

| Database / service | Schema source file(s) | Current tables / notes |
|---|---|---|
| Shared Platform (`platform.db`) | `shared-platform/backend/db.js` | `patients`, `patient_emergency_contacts`, `patient_identity_references`, `patient_medical_history`, `patient_health_concerns`, `doctors`, `doctor_qualifications`, `doctor_registrations`, `doctor_specializations`, `doctor_availability`, `facilities`, `facility_addresses`, `facility_registrations`, `facility_services`, `facility_doctors`, `facility_infrastructure`, `user_accounts`, `admin_profiles`, `roles`, `permissions`, `user_role_assignments`, `role_permissions`, `authentication_events`, `biometric_verifications`, `consent_records`, `consent_grants`, `verification_cases`, `audit_logs`, `revoked_tokens` |
| Shared Platform – Aadhaar demo | `shared-platform/backend/aadhaar.js` | `demo_aadhaar` (synthetic demo records; not a live UIDAI connection) |
| Shared Platform – face recognition | `shared-platform/backend/face.js` | `face_profiles`, `face_pending`, `face_attempts` |
| Every service DB | `libs/common/db.js` | Common tables: `idempotency`, `event_outbox`, `processed_events` |
| Ayurveda / Yoga / Unani / Siddha / Homoeopathy | `libs/common/domain-service.js` (called by each domain's backend server) | Dynamically creates `<system>_parts` and `<system>_assessments` in each domain's own database |
| Common Clinical (`clinical.db`) | `services/common-clinical-service/backend/server.js` | `encounters`, `prescriptions`, `patient_records`, `patient_uploads` |
| Longitudinal Record (`longitudinal.db`) | `longitudinal-record-service/backend/server.js` | `timeline_entries` |
| Integrations (`integrations.db`) | `integrations/whatsapp/bot.js` and `integrations/backend/server.js` | WhatsApp tables: `wa_chats`, `wa_drafts`; integration DB is owned by Integrations |
| Event Bus (`event-bus.db`) | `event-bus/backend/server.js` | `events`, `subscriptions`, `deliveries` |
| API Gateway | `api-gateway/backend/server.js` | No persistent database; in-memory rate-limit buckets |

## Important ownership rule

Most service-specific schemas are embedded in backend implementation files in this version. Those files stay with their backend/integration owners to avoid duplicate files and merge conflicts. Member 3 owns database helper/initializer files listed in the Member 3 package and should coordinate schema edits with the owner of the file containing the schema. Do not create a second copy of those server files in the database branch.

## Runtime database files

No populated `.db` files are included in the ZIP. Databases are created on service startup under each service's `database/` folder (or under `DATA_ROOT` when configured). `.gitignore` intentionally excludes runtime database files and WAL sidecars. The `database/.gitkeep` files only preserve empty folders in Git.

## Data boundary

Each service owns its own SQLite file. A service must not open another service's database; cross-service information is exchanged through internal HTTP APIs or the Event Bus.
