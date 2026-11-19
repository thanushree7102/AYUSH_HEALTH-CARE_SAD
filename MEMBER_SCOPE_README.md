# Member 1 – Frontend Development

**Project:** AYUSH Digital Health Platform (updated `Ayush_Health.zip`)

**Scope:** Owns the React/Vite user interface and frontend assets for the unified AYUSH application.

## Responsibilities
- Shared React application shell, navigation, registration, patient/doctor/clinic/admin screens and frontend hooks.
- Frontend modules for Ayurveda, Common Clinical and Longitudinal Record, plus the service-picker registration modules for the other AYUSH systems.
- Frontend API client, localization, speech UI, Aadhaar/face capture UI, styles and reusable components.
- Vite aliases and HTML entry point; browser-side face recognition model assets.

## Included files (original project-relative paths)
- `index.html`
- `longitudinal-record-service/frontend/pages/patient/Timeline.jsx`
- `public/models/face_landmark_68_model-weights_manifest.json`
- `public/models/face_landmark_68_model.bin`
- `public/models/face_recognition_model-weights_manifest.json`
- `public/models/face_recognition_model.bin`
- `public/models/tiny_face_detector_model-weights_manifest.json`
- `public/models/tiny_face_detector_model.bin`
- `scripts/copy-models.js`
- `services/ayurveda-service/frontend/DoctorLayout.jsx`
- `services/ayurveda-service/frontend/index.js`
- `services/ayurveda-service/frontend/pages/Comparison.jsx`
- `services/ayurveda-service/frontend/pages/Dashavidha.jsx`
- `services/ayurveda-service/frontend/pages/Diagnosis.jsx`
- `services/ayurveda-service/frontend/pages/Examination.jsx`
- `services/ayurveda-service/frontend/pages/PrakritiVikriti.jsx`
- `services/ayurveda-service/frontend/pages/Therapy.jsx`
- `services/common-clinical-service/frontend/components/CommonClinical.jsx`
- `services/common-clinical-service/frontend/pages/UploadPrescription.jsx`
- `services/common-clinical-service/frontend/pages/patient/AddRecord.jsx`
- `services/common-clinical-service/frontend/pages/patient/Medicines.jsx`
- `services/common-clinical-service/frontend/pages/patient/Uploads.jsx`
- `services/homoeopathy-service/frontend/index.js`
- `services/siddha-service/frontend/index.js`
- `services/unani-service/frontend/index.js`
- `services/yoga-naturopathy-service/frontend/index.js`
- `shared-platform/frontend/App.jsx`
- `shared-platform/frontend/api/client.js`
- `shared-platform/frontend/components/AadhaarFetch.jsx`
- `shared-platform/frontend/components/FaceCapture.jsx`
- `shared-platform/frontend/components/Field.jsx`
- `shared-platform/frontend/components/FormPage.jsx`
- `shared-platform/frontend/components/LangSwitch.jsx`
- `shared-platform/frontend/components/OtpBox.jsx`
- `shared-platform/frontend/components/PatientShell.jsx`
- `shared-platform/frontend/components/RoleRegister.jsx`
- `shared-platform/frontend/components/Steps.jsx`
- `shared-platform/frontend/components/TopBar.jsx`
- `shared-platform/frontend/components/VoiceMic.jsx`
- `shared-platform/frontend/constants/options.js`
- `shared-platform/frontend/domains.js`
- `shared-platform/frontend/hooks/useDraft.js`
- `shared-platform/frontend/hooks/usePrefill.js`
- `shared-platform/frontend/hooks/useSummary.js`
- `shared-platform/frontend/i18n/dict.js`
- `shared-platform/frontend/i18n/domTranslate.js`
- `shared-platform/frontend/i18n/index.jsx`
- `shared-platform/frontend/index.css`
- `shared-platform/frontend/main.jsx`
- `shared-platform/frontend/pages/Assistant.jsx`
- `shared-platform/frontend/pages/DomainConsultation.jsx`
- `shared-platform/frontend/pages/Landing.jsx`
- `shared-platform/frontend/pages/Me.jsx`
- `shared-platform/frontend/pages/admin/Dashboard.jsx`
- `shared-platform/frontend/pages/clinic/Dashboard.jsx`
- `shared-platform/frontend/pages/doctor/FindPatient.jsx`
- `shared-platform/frontend/pages/patient/Privacy.jsx`
- `shared-platform/frontend/pages/patient/Profile.jsx`
- `shared-platform/frontend/pages/patient/Services.jsx`
- `shared-platform/frontend/pages/register/Admin.jsx`
- `shared-platform/frontend/pages/register/Choose.jsx`
- `shared-platform/frontend/pages/register/Clinic.jsx`
- `shared-platform/frontend/pages/register/Doctor.jsx`
- `shared-platform/frontend/pages/register/Patient.jsx`
- `shared-platform/frontend/utils/aadhaar.js`
- `shared-platform/frontend/utils/session.js`
- `shared-platform/frontend/utils/time.js`
- `shared-platform/frontend/voice/speech.js`
- `vite.config.js`

## Technologies / components observed in this package
- React 19
- Vite 6
- React Router
- JSX/CSS
- @vladmandic/face-api browser model assets
- Frontend API client and browser speech utilities

## Setup and execution
- Start from the complete repository's main branch, not an empty folder.
- At the repository root run npm install (root package.json is shared and is retained from main).
- Run npm run dev to start all services and Vite; open http://localhost:5173.
- Do not replace the root package.json or package-lock.json with a frontend-only manifest; this project uses one root Vite app.

## Dependencies on other members
- Member 4's API Gateway must be running on port 5000 for API calls; Vite proxies /v1, /api and WhatsApp paths to it.
- Member 2's backend services must be available behind the gateway for data-backed screens.
- Member 4 owns root package.json/package-lock.json and environment/runtime orchestration in this division; keep those from the base repository.

## Integration notes
This package is a frontend work package, not a standalone application. The frontend folders from all services are compiled into one React/Vite site. Face model binaries are included under public/models.

## GitHub branch usage
Create this member branch from the same complete, working project baseline in `main`. Extract this ZIP at the repository root so the original paths overlay the baseline. Do not create a new empty repository from this ZIP alone; each package intentionally contains only the files assigned to this member. Open a Pull Request back to `main` after testing.
