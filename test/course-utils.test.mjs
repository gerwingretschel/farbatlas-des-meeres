import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COURSE_PERMISSIONS,
  COURSE_RECORD_FIELD_PERMISSIONS,
  ValidationError,
  applyContentChanges,
  createPasswordRecord,
  normalizeAcademicUrl,
  normalizeUsername,
  sanitizeKnowledgeHtml,
  verifyPassword,
} from '../netlify/functions/lib/course-utils.mjs';

test('normalizes course leader usernames deterministically', () => {
  assert.equal(normalizeUsername('  Anna Maria  '), 'anna.maria');
});

test('hashes and verifies passwords without storing plaintext', () => {
  const record = createPasswordRecord('SehrSicher-2026!');
  assert.ok(record.passwordSalt);
  assert.ok(record.passwordHash);
  assert.equal(record.passwordHash.includes('SehrSicher'), false);
  assert.equal(verifyPassword('SehrSicher-2026!', record), true);
  assert.equal(verifyPassword('falsch', record), false);
});

test('sanitizes knowledge HTML and keeps safe academic links', () => {
  const cleaned = sanitizeKnowledgeHtml(
    '<p onclick="x()">Text <strong>fett</strong><script>alert(1)</script>' +
    '<a href="javascript:alert(1)" onmouseover="x()">schlecht</a>' +
    '<a href="https://example.org/a?q=1" style="color:red">Quelle</a></p>'
  );
  assert.equal(cleaned.includes('onclick'), false);
  assert.equal(cleaned.includes('<script'), false);
  assert.equal(cleaned.includes('javascript:'), false);
  assert.match(cleaned, /<a href="https:\/\/example\.org\/a\?q=1" target="_blank" rel="noopener noreferrer"/);
});

test('accepts HTTP links and rejects active protocols', () => {
  assert.equal(normalizeAcademicUrl('www.example.org'), 'https://www.example.org/');
  assert.throws(() => normalizeAcademicUrl('javascript:alert(1)'), ValidationError);
});

test('applies only permitted content fields and preserves structural data', () => {
  const payload = {
    images: [{ name: 'f#g#a#de#en#d#p#u#x.jpg', imageKey: 'img-1' }],
    recordEdits: {
      'f#g#a#de#en#d#p#u#x.jpg': { family: 'F', knowledge: '<p>Alt</p>' },
    },
    savedGroups: {
      Fische: { icon: '🐠', c1: '#1', c2: '#2', families: ['g'], academicUrl: '' },
    },
    deleted: [],
  };
  const result = applyContentChanges(
    payload,
    {
      knowledge: [{
        key: 'f#g#a#de#en#d#p#u#x.jpg',
        baseValue: '<p>Alt</p>',
        value: '<p>Neu</p>',
      }],
      academicLinks: [{ key: 'Fische', baseValue: '', value: 'https://example.org' }],
    },
    [COURSE_PERMISSIONS.KNOWLEDGE, COURSE_PERMISSIONS.ACADEMIC_LINKS]
  );
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.payload.recordEdits['f#g#a#de#en#d#p#u#x.jpg'].family, 'F');
  assert.equal(result.payload.recordEdits['f#g#a#de#en#d#p#u#x.jpg'].knowledge, '<p>Neu</p>');
  assert.equal(result.payload.savedGroups.Fische.icon, '🐠');
  assert.equal(result.payload.savedGroups.Fische.academicUrl, 'https://example.org/');
  assert.equal(result.auditChanges.length, 2);
});

test('detects a concurrent content change instead of overwriting it', () => {
  const key = 'f#g#a#de#en#d#p#u#x.jpg';
  const result = applyContentChanges(
    { images: [{ name: key }], recordEdits: { [key]: { knowledge: '<p>Server</p>' } } },
    { knowledge: [{ key, baseValue: '<p>Alt</p>', value: '<p>Eigene Fassung</p>' }] },
    [COURSE_PERMISSIONS.KNOWLEDGE]
  );
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].serverValue, '<p>Server</p>');
  assert.equal(result.conflicts[0].proposedValue, '<p>Eigene Fassung</p>');
  assert.equal(result.auditChanges.length, 0);
});

test('rejects edits without the matching permission', () => {
  const key = 'f#g#a#de#en#d#p#u#x.jpg';
  assert.throws(
    () => applyContentChanges(
      { images: [{ name: key }] },
      { knowledge: [{ key, baseValue: '', value: 'Neu' }] },
      []
    ),
    (error) => error instanceof ValidationError && error.status === 403
  );
});

test('applies individually permitted animal fields and group assignment', () => {
  const key = 'Acanthuridae#acanthurus#sohal#arabischer doktorfisch#arabian surgeonfish#20260101#hausriff#autor#sohal.jpg';
  const result = applyContentChanges(
    {
      images: [{ name: key, imageKey: 'img-1' }],
      recordEdits: {},
      groupMoves: {},
    },
    {
      recordFields: [
        { key, field: 'de', baseValue: 'arabischer doktorfisch', value: 'Arabischer Doktorfisch' },
        { key, field: 'place', baseValue: 'hausriff', value: 'Hausriff Süd' },
        { key, field: 'group', baseValue: '', value: 'Fische' },
      ],
    },
    [
      COURSE_RECORD_FIELD_PERMISSIONS.de,
      COURSE_RECORD_FIELD_PERMISSIONS.place,
      COURSE_RECORD_FIELD_PERMISSIONS.group,
    ]
  );
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.payload.recordEdits[key].de, 'Arabischer Doktorfisch');
  assert.equal(result.payload.recordEdits[key].place, 'Hausriff Süd');
  assert.equal(result.payload.groupMoves[key], 'Fische');
  assert.deepEqual(result.auditChanges.map((change) => change.field), ['de', 'place', 'group']);
});

test('rejects an animal field that was not assigned by the administrator', () => {
  const key = 'f#g#a#de#en#20260101#place#author#image.jpg';
  assert.throws(
    () => applyContentChanges(
      { images: [{ name: key }] },
      { recordFields: [{ key, field: 'author', baseValue: 'author', value: 'changed' }] },
      [COURSE_RECORD_FIELD_PERMISSIONS.de]
    ),
    (error) => error instanceof ValidationError && error.status === 403
  );
});

test('detects concurrent animal-field changes', () => {
  const key = 'f#g#a#Alt#en#20260101#place#author#image.jpg';
  const result = applyContentChanges(
    { images: [{ name: key }], recordEdits: { [key]: { de: 'Serverfassung' } } },
    { recordFields: [{ key, field: 'de', baseValue: 'Alt', value: 'Eigene Fassung' }] },
    [COURSE_RECORD_FIELD_PERMISSIONS.de]
  );
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].field, 'de');
  assert.equal(result.conflicts[0].serverValue, 'Serverfassung');
});
