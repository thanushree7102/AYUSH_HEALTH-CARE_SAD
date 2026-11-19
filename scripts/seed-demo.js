// Creates the demo accounts (Ayurveda doctor 9000000001, Siddha doctor 9000000002, clinic 9000000005, auditor 9000000008,
// admin 9000000009) in the Shared Platform database. The Shared Platform also does this on its first start (SEED_DEMO=0 turns it off).
process.env.SERVICE_NAME = 'platform';
require('../shared-platform/backend/seed')();
console.log('Demo accounts are in place. Sign in with OTP (see OTP_CODE in .env; empty = shown by the server).');
process.exit(0);
