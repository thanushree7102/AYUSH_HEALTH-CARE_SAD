// Shared Platform (port 5001): identity, registration, OTP, face, patient profile, doctors / clinics, consent, admin, audit.
// Owns shared-platform/database/platform.db. It never touches clinical data (encounters, records, AYUSH forms).
try { require('dotenv').config(); } catch (e) { /* optional */ }
process.env.SERVICE_NAME = 'platform';
const express = require('express');
const { createService, finish, listen, authenticate } = require('../../libs/common/http');
const { SERVICES } = require('../../libs/common/config');
const { isMobile } = require('../../libs/common/validate');
const c = require('./context');

const app = createService('platform');
const v1 = express.Router();
const internal = express.Router();

// Face recognition (shared by every role), demo Aadhaar / ABHA
const face = require('./face')(v1, { checkOtp: c.checkProof, audit: c.audit, isMobile });
require('./aadhaar')(v1, { audit: c.audit });
require('./aadhaar').installAbha(v1);

require('./routes-registration')(v1, c, face);
require('./routes-auth')(v1, c, face);
require('./routes-patient')(v1, c);
require('./routes-admin')(v1, c);
require('./routes-internal')(internal, c);

if (process.env.SEED_DEMO !== '0') require('./seed')();

app.use('/internal', internal);
app.use('/', v1);
finish(app, 'platform');
listen(app, 'platform');
c.events.subscribe('platform', `${SERVICES.platform.url}/internal/events`, ['clinical.record.created']);
void authenticate;
