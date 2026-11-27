'use strict';
// WP-13 (DEP-018, ENT-008): the node:sqlite behaviour the data layer relies on, as a contract that runs on every Node bump.
// The product ships Node 24 LTS (packaging/product.json runtime.node); development still runs on Node 22.13+. Run this file on the new runtime
// before moving the pin. It uses only what the code uses (grep of backend/src and vendor/engine): DatabaseSync, exec, prepare, run/get/all,
// changes/lastInsertRowid, PRAGMAs (WAL, busy_timeout, foreign_keys), BEGIN/COMMIT/ROLLBACK, VACUUM INTO (services/dbSnapshot.ts), BLOB columns.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmp } = require('./helpers');
const { DatabaseSync } = require('node:sqlite');

const major = Number(process.versions.node.split('.')[0]);

test(`node:sqlite contract on Node ${process.version}`, async (t) => {
  assert.ok(major === 22 || major === 24, `this suite is maintained for Node 22 and 24 (running ${process.version}); review the contract before adding a line`);
  const dir = tmp('agastya-sqlite-');
  const file = path.join(dir, 'contract.db');
  const db = new DatabaseSync(file);
  t.after(() => { try { db.close(); } catch { /* closed */ } });

  await t.test('pragmas the server sets are honoured', () => {
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec('PRAGMA foreign_keys = ON;');
    assert.equal(db.prepare('PRAGMA journal_mode = WAL').get().journal_mode, 'wal');
    assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 5000);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  });

  await t.test('prepared statements: run returns changes and lastInsertRowid; get/all return plain rows', () => {
    db.exec('CREATE TABLE p (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, n INTEGER)');
    db.exec('CREATE TABLE c (id INTEGER PRIMARY KEY, p INTEGER NOT NULL REFERENCES p(id) ON DELETE CASCADE, v BLOB)');
    const ins = db.prepare('INSERT INTO p (name, n) VALUES (?, ?)');
    const r = ins.run('a', 1);
    assert.equal(Number(r.changes), 1);
    assert.equal(Number(r.lastInsertRowid), 1);
    ins.run('b', 2);
    assert.deepEqual({ ...db.prepare('SELECT name, n FROM p WHERE id = ?').get(1) }, { name: 'a', n: 1 });
    assert.equal(db.prepare('SELECT * FROM p WHERE id = ?').get(99), undefined, 'a missing row is undefined');
    assert.deepEqual(db.prepare('SELECT name FROM p ORDER BY id').all().map((x) => x.name), ['a', 'b']);
    // named parameters, as some stores use them
    assert.equal(db.prepare('SELECT n FROM p WHERE name = :name').get({ name: 'b' }).n, 2);
    assert.throws(() => ins.run('a', 3), /UNIQUE/i, 'a constraint error is thrown, not swallowed');
  });

  await t.test('foreign keys are enforced and cascade', () => {
    assert.throws(() => db.prepare('INSERT INTO c (p, v) VALUES (?, ?)').run(42, null), /FOREIGN KEY/i);
    db.prepare('INSERT INTO c (p, v) VALUES (?, ?)').run(1, null);
    db.prepare('DELETE FROM p WHERE id = ?').run(1);
    assert.equal(db.prepare('SELECT COUNT(*) AS k FROM c').get().k, 0);
  });

  await t.test('explicit transactions commit and roll back', () => {
    db.exec('BEGIN');
    db.prepare('INSERT INTO p (name, n) VALUES (?, ?)').run('t1', 1);
    db.exec('ROLLBACK');
    assert.equal(db.prepare('SELECT COUNT(*) AS k FROM p WHERE name = ?').get('t1').k, 0);
    db.exec('BEGIN IMMEDIATE');
    db.prepare('INSERT INTO p (name, n) VALUES (?, ?)').run('t2', 1);
    db.exec('COMMIT');
    assert.equal(db.prepare('SELECT COUNT(*) AS k FROM p WHERE name = ?').get('t2').k, 1);
  });

  await t.test('large BLOBs round-trip byte for byte (revision blobs)', () => {
    const big = Buffer.alloc(8 * 1024 * 1024);
    for (let i = 0; i < big.length; i += 4096) big[i] = i % 251;
    db.prepare('INSERT INTO c (p, v) VALUES (?, ?)').run(2, big);
    const back = db.prepare('SELECT v FROM c WHERE p = ?').get(2).v;
    assert.ok(back instanceof Uint8Array);
    assert.ok(Buffer.from(back).equals(big));
  });

  await t.test('VACUUM INTO makes a consistent copy that opens on its own (services/dbSnapshot.ts)', () => {
    const copy = path.join(dir, 'copy.db');
    db.prepare('VACUUM INTO ?').run(copy);
    assert.ok(fs.existsSync(copy));
    const c = new DatabaseSync(copy, { readOnly: true });
    try { assert.equal(c.prepare('SELECT COUNT(*) AS k FROM p').get().k, 2); } finally { c.close(); }
  });

  await t.test('a second connection sees committed data under WAL and waits for the write lock', () => {
    const other = new DatabaseSync(file);
    try {
      other.exec('PRAGMA busy_timeout = 2000;');
      assert.equal(other.prepare('SELECT COUNT(*) AS k FROM p').get().k, 2);
      other.prepare('INSERT INTO p (name, n) VALUES (?, ?)').run('from-other', 9);
    } finally { other.close(); }
    assert.equal(db.prepare('SELECT n FROM p WHERE name = ?').get('from-other').n, 9);
  });
});
