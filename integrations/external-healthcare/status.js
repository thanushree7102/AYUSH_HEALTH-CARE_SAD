// External health networks (ABDM / ABHA gateway, hospital HIS, labs). NOT connected in this build.
// This is where such a connector would live; the integrations service only asks it for its status.
module.exports = { status: () => ({ connected: false, note: 'No external health network (ABDM) is connected in this build.' }) };
