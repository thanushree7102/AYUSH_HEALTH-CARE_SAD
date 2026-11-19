# Acceptance test evidence

Run: 2026-11-16T09:45:19.852Z  ·  94 passed, 0 failed, 94 checks

All checks go through the API gateway only, on temporary databases (nothing in `data/` is touched).


## 1. Architecture: 11 services up, gateway routing, boundaries

- PASS — gateway /v1/health sees all 11 services up
- PASS — /api/* alias works
- PASS — /internal/* is never reachable through the gateway
- PASS — a service rejects /internal calls without a service token
- PASS — protected route without token -> 401
- PASS — forged token -> 401
- PASS — domain service not reachable without login

## 2. Registration: OTP + face + consent

- PASS — new number has no face / account
- PASS — registration without face step refused
- PASS — wrong OTP refused
- PASS — enrol without liveness flag refused
- PASS — face enrolled
- PASS — registration without consent refused
- PASS — patient registered
- PASS — a different face is rejected
- PASS — same face accepted
- PASS — login by face + OTP
- PASS — login by OTP
- PASS — /me works with the token
- PASS — demo Aadhaar (masked)
- PASS — ABHA format check endpoint answers
- PASS — demo Ayurveda doctor logs in
- PASS — doctor, siddha doctor, admin, auditor, clinic all sign in

## 3. Consent and access control

- PASS — patient sees own summary + consultation id (created by event/ensure)
- PASS — doctor WITHOUT consent cannot read the summary
- PASS — doctor WITHOUT consent cannot read forms
- PASS — admin cannot read clinical data
- PASS — clinic cannot read clinical data
- PASS — unregistered number cannot log in as patient
- PASS — a doctor cannot grant consent on a patient's behalf
- PASS — patient grants Ayurveda-only access to D-1 for 30 days
- PASS — D-1 can now read
- PASS — D-2 (no grant) still refused

## 4. Five AYUSH services: forms, versions, scope of consent

- PASS — ayurveda: forms served by its own service (6 parts)
- PASS — yoga: forms served by its own service (5 parts)
- PASS — unani: forms served by its own service (5 parts)
- PASS — siddha: forms served by its own service (5 parts)
- PASS — homoeopathy: forms served by its own service (5 parts)
- PASS — each AYUSH service has its OWN forms (not a copy)
- PASS — doctor saves Ayurveda form v1
- PASS — second save creates v2 (history kept)
- PASS — same Idempotency-Key does not create another version
- PASS — version history lists 3 versions
- PASS — patient can read own form
- PASS — D-1 (Ayurveda-only consent) cannot write a Yoga form
- PASS — patient widens D-1 consent to every system
- PASS — yoga: form saved by its own service
- PASS — unani: form saved by its own service
- PASS — siddha: form saved by its own service
- PASS — homoeopathy: form saved by its own service
- PASS — empty form body refused
- PASS — missing required field refused (strict forms)
- PASS — consultation summary from Siddha service

## 5. Clinical records + longitudinal timeline

- PASS — patient saves a record (Common Clinical)
- PASS — timeline (read model fed by events) shows forms + record
- PASS — timeline has both records and AYUSH assessments
- PASS — doctor with Ayurveda-only consent sees only Ayurveda in the timeline
- PASS — summary is filtered to the shared system
- PASS — patient still sees everything
- PASS — patient withdraws consent
- PASS — after withdrawal the doctor is refused again
- PASS — auditor sees access + denial entries written by other services
- PASS — doctor cannot read the audit log

## 6. Security: spoofing, tokens, logout

- PASS — spoofed X-Role / X-Doctor-Id / X-Identity are ignored by the gateway
- PASS — token refresh issues a new token
- PASS — the old token is dead after refresh
- PASS — the new token works
- PASS — logout
- PASS — a logged-out token is revoked everywhere
- PASS — admin self-registration needs the invite code
- PASS — repeated wrong OTPs lock the number (429)

## 7. WhatsApp bot (Integrations) uses internal APIs only

- PASS — bot asks language
- PASS — registered through WhatsApp (health id returned)
- PASS — WhatsApp-registered patient exists in the Shared Platform
- PASS — typed description becomes a draft
- PASS — record saved from WhatsApp
- PASS — record + allergy are visible on the website side (Clinical + Platform)
- PASS — bot summary built from several services
- PASS — bot lists doctors from the Shared Platform
- PASS — consent granted by WhatsApp works for the doctor
- PASS — unregister confirmed on WhatsApp

## 8. Unregister purges every service (events)

- PASS — identity deleted in the Shared Platform
- PASS — clinical internal API reachable with a service token
- PASS — old token of the deleted patient is dead

## 9. Event reliability: a service is down, nothing is lost

- PASS — gateway answers 503 (not a crash) when a service is down
- PASS — health shows the service as down
- PASS — writing a record still works while the timeline service is down (loose coupling)
- PASS — the summary (owned by the down service) says 503
- PASS — after restart the bus delivers the missed event (retry with backoff, at-least-once)
- PASS — event bus statistics available
- PASS — no duplicates after redelivery (idempotent consumer)

## 10. Other

- PASS — WhatsApp QR endpoint answers
- PASS — external health network honestly reported as NOT connected
- PASS — translate validates languages
