import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// One React app, built from the frontend/ folder of each service. The aliases below point at those folders.
// Dev: the app runs on :5173 and forwards API calls to the API GATEWAY on :5000 (PORT_BASE moves it), so there is one origin.
const GATEWAY = `http://localhost:${process.env.PORT_BASE || 5000}`;
const r = (p) => path.resolve(__dirname, p);
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': r('shared-platform/frontend'),
      '@ayurveda': r('services/ayurveda-service/frontend'),
      '@yoga': r('services/yoga-naturopathy-service/frontend'),
      '@unani': r('services/unani-service/frontend'),
      '@siddha': r('services/siddha-service/frontend'),
      '@homoeopathy': r('services/homoeopathy-service/frontend'),
      '@clinical': r('services/common-clinical-service/frontend'),
      '@longitudinal': r('longitudinal-record-service/frontend'),
    },
  },
  server: { proxy: { '/v1': GATEWAY, '/api': GATEWAY, '/whatsapp-mock': GATEWAY, '/whatsapp': GATEWAY, '/health': GATEWAY } },
});
