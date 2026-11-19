# Known limitations (read before real use)

* **Clinical content of the four non-Ayurveda services is a starter set.** Ayurveda keeps the six forms of the original app. The Yoga & Naturopathy, Unani, Siddha and Homoeopathy forms were written for this project as sensible starting fields and **must be reviewed by a qualified practitioner of each system** before real use. They live only in each service's `server.js`, so changing them touches nothing else.
* **Face liveness cannot be proven by a server.** The browser sends `liveness:true`; the server only requires it. Treat face sign-in as a convenience on top of OTP (login is face **and** OTP).
* **Aadhaar / ABHA are demo only.** `/aadhaar/fetch` answers from a built-in demo set; `/abha/validate` checks the number format only. No UIDAI / ABDM connection exists, and `/external-healthcare/status` says `connected:false`.
* **OTP delivery** is WhatsApp (mock by default) or shown by the server in development. There is no SMS provider; add one in `shared-platform/backend/routes-auth.js` before production. Set `OTP_SHOW=0` in production.
* **WhatsApp** runs in `mock` mode by default (`POST /whatsapp-mock`). `meta` (Cloud API) and `baileys` modes are ported but were not exercised against real WhatsApp here.
* **SQLite** per service is right for a demo / single machine. For production use a server database per service and a managed queue instead of the built-in bus.
* **No cross-service transactions.** Consistency is eventual (events); e.g. the timeline can lag a record by about a second, and while a service is down its screens return 503.
* **OCR** (tesseract) reads printed English well; handwriting / Hindi need the optional AI reader (`ANTHROPIC_API_KEY`).
* Not legal or medical advice: DPDP Act / clinical-governance review is still required for real patient data.
