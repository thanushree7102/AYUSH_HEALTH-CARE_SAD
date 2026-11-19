// List of the 11 processes (one per service) and how to start them. Used by dev-all.js and the tests.
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
module.exports = {
  ROOT,
  PROCESSES: [
    ['bus', 'event-bus/backend/server.js'],
    ['platform', 'shared-platform/backend/server.js'],
    ['clinical', 'services/common-clinical-service/backend/server.js'],
    ['ayurveda', 'services/ayurveda-service/backend/server.js'],
    ['yoga', 'services/yoga-naturopathy-service/backend/server.js'],
    ['unani', 'services/unani-service/backend/server.js'],
    ['siddha', 'services/siddha-service/backend/server.js'],
    ['homoeopathy', 'services/homoeopathy-service/backend/server.js'],
    ['longitudinal', 'longitudinal-record-service/backend/server.js'],
    ['integrations', 'integrations/backend/server.js'],
    ['gateway', 'api-gateway/backend/server.js'],
  ],
};
