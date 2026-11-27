'use strict';
// The ONE password policy, plus username rules and the temporary-password
// scheme. Every path that accepts or issues a password — onboarding, change,
// admin reset, reset-queue approval, bootstrap — goes through this module, so
// the rules can never drift apart between flows.

// Deliberately compact denylist of the passwords people actually type. Kept
// lowercase; matching is case-insensitive.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword',
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234',
  'qwertyui', 'qwerty123', 'qwerty12', '1q2w3e4r', '1qaz2wsx', 'qwer1234', 'asdfghjk', 'asdf1234',
  'iloveyou', 'sunshine', 'princess', 'football', 'baseball', 'superman', 'welcome1', 'welcome123',
  'admin123', 'root1234', 'letmein1', 'whatever', 'trustno1', 'dragon12', 'monkey12', 'shadow12',
  'master12', 'michael1', 'jennifer', 'computer', 'internet', 'samsung1', 'google12', 'facebook',
  'starwars', 'pokemon1', 'batman12', 'abcd1234', 'abc12345', 'a1b2c3d4', 'test1234', 'temp1234',
  'changeme', 'default1', 'secret12', 'india123', 'pass1234', 'pass@123', 'admin@123', 'user@123',
  'welcome@123', 'password@123', 'aaaaaaaa', 'zzzzzzzz', '112233445', '11223344', '55555555',
  '66666666', '77777777', '88888888', '99999999', 'qazwsxed', 'zaq12wsx', 'qwertyuiop', 'asdfghjkl',
]);

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

/*
  Central policy. Returns { ok: true } or { ok: false, error }.
  There is explicitly NO "must not contain the username" rule, and no composition rule (NIST SP 800-63B-4).

  `min` is the security policy's minimum length (default 15 there, RES-009; PASSWORD_MIN when no policy is given).
  `context` words (the username, the person's name; the product names are always included) are refused when the
  password is nothing but one of them with digits or symbols around it ("Asha2026!", "agastya-123"): the first thing
  someone who knows the person would try (RES-009 "extend the blocklist with context words").
*/
const PRODUCT_WORDS = ['agastya', 'agastyaplatform', 'jsspublisher', 's1000d', 'publisher'];
function validatePassword(password, { min = PASSWORD_MIN, context = [] } = {}) {
  if (typeof password !== 'string' || password.length === 0) {
    return { ok: false, error: 'A password is required.' };
  }
  if (password.length < min) {
    return { ok: false, error: `Password must be at least ${min} characters.` };
  }
  if (password.length > PASSWORD_MAX) {
    return { ok: false, error: `Password must be at most ${PASSWORD_MAX} characters.` };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { ok: false, error: 'That password is too common. Choose something less guessable.' };
  }
  const core = password.toLowerCase().replace(/[^a-z]/g, '');
  const words = [...PRODUCT_WORDS, ...context.flatMap((w) => String(w || '').toLowerCase().split(/[\s._-]+/)), ...context.map((w) => String(w || '').toLowerCase().replace(/[^a-z]/g, ''))]
    .filter((w) => w.length >= 3);
  if (core && words.includes(core)) {
    return { ok: false, error: 'That password is only your name, username or the product name with numbers or symbols added. Choose something less guessable.' };
  }
  return { ok: true };
}

// ---- usernames ------------------------------------------------------------

// Names that must never belong to a person. The bootstrap administrator is
// the single, narrow exception — see validateUsername's allowReserved, which
// only bootstrap.js passes.
const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'system', 'superuser', 'sysadmin',
  'support', 'security', 'operator', 'service', 'daemon', 'guest', 'nobody',
  'anonymous', 'owner', 'moderator', 'staff', 'test', 'null', 'undefined', 'api',
]);

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function validateUsername(username, { allowReserved = false } = {}) {
  const u = normalizeUsername(username);
  if (!u) return { ok: false, error: 'A username is required.' };
  if (!USERNAME_RE.test(u)) {
    return { ok: false, error: 'Usernames are 3–32 characters: lowercase letters, digits, dot, dash or underscore, starting with a letter or digit.' };
  }
  if (!allowReserved && RESERVED_USERNAMES.has(u)) {
    return { ok: false, error: 'That username is reserved. Choose another.' };
  }
  return { ok: true, username: u };
}

// ---- full names & temporary passwords -------------------------------------

function validateFullName(fullName) {
  const n = String(fullName || '').replace(/\s+/g, ' ').trim();
  if (!n) return { ok: false, error: 'A full name is required.' };
  if (n.length > 120) return { ok: false, error: 'That full name is too long.' };
  return { ok: true, fullName: n };
}

/*
  The surname is always EXTRACTED from the full name — the last
  whitespace-separated word — never collected separately. Shared by user
  creation, CSV import and reset approval so a temporary password looks the
  same no matter which flow issued it.
*/
function surnameOf(fullName) {
  const n = String(fullName || '').replace(/\s+/g, ' ').trim();
  if (!n) return '';
  const parts = n.split(' ');
  return parts[parts.length - 1];
}

/*
  Temporary password: <Surname>-<random>, e.g. "Kumble-k7m2q9xw".

  JSS Publisher used Surname@Year ("Kumble@2026"), which anyone who knows a new
  colleague's name can guess for the window between account creation and the
  person's first sign-in. The surname prefix is kept so the administrator can
  read the password to the right person; the random part (40 bits from a CSPRNG,
  unambiguous alphabet) is what makes it unguessable. Still single-use by
  construction: every issuer also gates the account (onboarding or forced
  change), and completing that gate replaces the password and revokes all other
  sessions.
*/
const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/*
  Temporary password: <username>-<8 random characters> (audit SEC-004 / PLT-014: the former username@year
  could be guessed by anyone who knew a colleague's name). The random part comes from the CSPRNG
  (crypto.randomInt, no modulo bias) over TEMP_ALPHABET, about 40 bits. It only ever works for the first
  sign-in: the account is created with onboarding pending and the forced-change gate.
*/
const TEMP_RANDOM_LENGTH = 8;
function tempPasswordFor(username) {
  const { randomInt } = require('crypto');
  let r = '';
  for (let i = 0; i < TEMP_RANDOM_LENGTH; i++) r += TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)];
  return `${normalizeUsername(username)}-${r}`;
}

const ascii = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/*
  Suggested username from a person's name: the first name; if that is taken (or not a valid
  username), firstname.<first letter of the last name>; if that is taken too, a number is added.
  `isTaken` answers for the database; reserved names count as taken.
*/
function suggestUsername(fullName, isTaken) {
  const parts = String(fullName || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const first = ascii(parts[0]);
  const last = parts.length > 1 ? ascii(parts[parts.length - 1]) : '';
  const free = (u) => USERNAME_RE.test(u) && !RESERVED_USERNAMES.has(u) && !isTaken(u);
  if (!first) return '';
  if (free(first)) return first;
  const dotted = last ? `${first}.${last[0]}` : first;
  if (free(dotted)) return dotted;
  for (let i = 2; i < 1000; i++) { const u = `${dotted}${i}`; if (free(u)) return u; }
  return '';
}

// admin: platform-wide oversight and accounts | project_manager: creates and runs projects, approves releases | author: writes
const GLOBAL_ROLES = ['admin', 'project_manager', 'author'];

module.exports = {
  validatePassword, validateUsername, normalizeUsername, validateFullName,
  surnameOf, tempPasswordFor, suggestUsername,
  RESERVED_USERNAMES, COMMON_PASSWORDS, PASSWORD_MIN, PASSWORD_MAX, GLOBAL_ROLES,
};
