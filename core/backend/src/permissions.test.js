'use strict';

// Test — motore permessi generico (ruleFor/isOwnRecord/ownedOrAllowed/filterViewable)
// Funzioni pure, nessun DB reale coinvolto. Stesso pattern di formula-soglia.test.js.
// Eseguire con: node permissions.test.js

const { ruleFor, isOwnRecord, ownedOrAllowed, filterViewable } = require('./permissions');

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  ✓ ' + name);
    passed++;
  } catch (e) {
    console.error('  ✗ ' + name);
    console.error('    ' + e.message);
    failed++;
  }
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || ''}: atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`);
  }
}

// ─── ruleFor ──────────────────────────────────────────────────────────────────

console.log('\n--- ruleFor ---');

test('nessun blocco permissions -> null (nessuna restrizione)', () => {
  assertEq(ruleFor({}, 'agente'), null);
  assertEq(ruleFor({ permissions: { rules: [] } }, 'agente'), null);
});

test('ruolo con riga esplicita -> quella riga', () => {
  const schema = { permissions: { rules: [{ role: 'agente', view: true, create: false }] } };
  const r = ruleFor(schema, 'agente');
  assertEq(r.view, true);
  assertEq(r.create, false);
});

test('admin senza riga esplicita -> pieno accesso di default', () => {
  const schema = { permissions: { rules: [{ role: 'agente', view: false }] } };
  const r = ruleFor(schema, 'admin');
  assertEq(r.view, true);
  assertEq(r.create, true);
  assertEq(r.edit, true);
  assertEq(r.delete, true);
});

test('ruolo custom senza riga esplicita -> nessun permesso di default (non admin)', () => {
  const schema = { permissions: { rules: [{ role: 'agente', view: true }] } };
  const r = ruleFor(schema, 'contabile');
  assertEq(r.view, false);
  assertEq(r.create, false);
});

// ─── isOwnRecord ──────────────────────────────────────────────────────────────

console.log('\n--- isOwnRecord ---');

test('senza owner_field: proprio se user_id combacia', () => {
  const rule = { view_own_only: true };
  assertEq(isOwnRecord(rule, { user_id: 5 }, { id: 5 }), true);
  assertEq(isOwnRecord(rule, { user_id: 5 }, { id: 6 }), false);
});

test('con owner_field: proprio se il campo del record combacia col linked_record_id', () => {
  const rule = { view_own_only: true, owner_field: 'agente' };
  const user = { id: 1, linked_record_id: 3 };
  assertEq(isOwnRecord(rule, { data: { agente: 3 } }, user), true);
  assertEq(isOwnRecord(rule, { data: { agente: 7 } }, user), false);
});

test('con owner_field: confronto come stringa (id numerico vs stringa)', () => {
  const rule = { owner_field: 'agente' };
  const user = { id: 1, linked_record_id: 3 };
  assertEq(isOwnRecord(rule, { data: { agente: '3' } }, user), true);
});

test('con owner_field: record.data ancora come stringa JSON (non ancora parsato)', () => {
  const rule = { owner_field: 'agente' };
  const user = { id: 1, linked_record_id: 3 };
  assertEq(isOwnRecord(rule, { data: JSON.stringify({ agente: 3 }) }, user), true);
});

test('con owner_field: utente senza linked_record_id -> mai proprio', () => {
  const rule = { owner_field: 'agente' };
  assertEq(isOwnRecord(rule, { data: { agente: 3 } }, { id: 1, linked_record_id: null }), false);
  assertEq(isOwnRecord(rule, { data: { agente: 3 } }, { id: 1 }), false);
});

test('con owner_field: record senza quel campo valorizzato -> non proprio', () => {
  const rule = { owner_field: 'agente' };
  const user = { id: 1, linked_record_id: 3 };
  assertEq(isOwnRecord(rule, { data: {} }, user), false);
});

// ─── ownedOrAllowed ───────────────────────────────────────────────────────────

console.log('\n--- ownedOrAllowed ---');

test('nessuna regola -> sempre consentito', () => {
  assertEq(ownedOrAllowed(null, { user_id: 99 }, { id: 1 }), true);
});

test('view_own_only false -> sempre consentito indipendentemente dal proprietario', () => {
  assertEq(ownedOrAllowed({ view_own_only: false }, { user_id: 99 }, { id: 1 }), true);
});

test('view_own_only true -> consentito solo se proprio', () => {
  const rule = { view_own_only: true };
  assertEq(ownedOrAllowed(rule, { user_id: 1 }, { id: 1 }), true);
  assertEq(ownedOrAllowed(rule, { user_id: 99 }, { id: 1 }), false);
});

// ─── filterViewable ───────────────────────────────────────────────────────────

console.log('\n--- filterViewable ---');

const records = [
  { id: 1, user_id: 1, data: { agente: 3 } },
  { id: 2, user_id: 2, data: { agente: 7 } },
  { id: 3, user_id: 1, data: { agente: 7 } },
];

test('nessuna regola -> tutti i record visibili', () => {
  assertEq(filterViewable(records, null, { id: 1 }).length, 3);
});

test('view false -> nessun record visibile', () => {
  assertEq(filterViewable(records, { view: false }, { id: 1 }).length, 0);
});

test('view true, view_own_only false -> tutti visibili', () => {
  assertEq(filterViewable(records, { view: true, view_own_only: false }, { id: 1 }).length, 3);
});

test('view_own_only senza owner_field -> solo i record creati dall\'utente', () => {
  const visible = filterViewable(records, { view: true, view_own_only: true }, { id: 1 });
  assertEq(visible.length, 2);
  assertEq(visible.every((r) => r.user_id === 1), true);
});

test('view_own_only con owner_field -> solo i record il cui campo punta al linked_record_id', () => {
  const rule = { view: true, view_own_only: true, owner_field: 'agente' };
  const visible = filterViewable(records, rule, { id: 1, linked_record_id: 7 });
  assertEq(visible.length, 2);
  assertEq(JSON.stringify(visible.map((r) => r.id).sort()), JSON.stringify([2, 3]));
});

// ─── SOMMARIO ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Risultato: ${passed} passati, ${failed} falliti`);
if (failed > 0) {
  process.exit(1);
}
