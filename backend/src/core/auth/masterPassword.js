'use strict';
/*
  Master-password recovery is DISABLED in Agastya Platform v2.

  The JSS Publisher revision this auth layer was taken from carried a
  compiled-in hash that signed in as ANY administrator on ANY installation.
  JSS removed that mechanism in a later revision, and a new on-premises
  platform must not start life with a shared backdoor, so this module keeps the
  interface routes.js calls but never matches.

  Locked-out administrators recover through the admin-mediated reset queue, or
  on the server machine with `npm run reset-admin` (backend/scripts/
  reset-admin.js), which needs filesystem access to the database.
*/

function isEnabled() { return false; }

// eslint-disable-next-line no-unused-vars
async function matches(_user, _password) { return false; }

module.exports = { isEnabled, matches };
