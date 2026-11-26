import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const course = fs.readFileSync(new URL('../course-leader-client.js', import.meta.url), 'utf8');
const fastClient = fs.readFileSync(new URL('../v10-client.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../netlify/functions/farbatlas.mjs', import.meta.url), 'utf8');

test('course leaders use the V11 structure-first loader and their token can fetch lazy assets', () => {
  assert.match(course, /FarbatlasRuntime\?\.applyDatasetPayload/);
  assert.match(course, /applyDatasetPayload\(payload, result\.name, result\.versionTag/);
  assert.match(fastClient, /sessionStorage\.getItem\('farbatlasCourseTokenV1'\)/);
  assert.match(fastClient, /applyDatasetPayload,/);
});

test('the unified animal editor displays every field and gates editing by individual permissions', () => {
  for (const field of ['family', 'genus', 'species', 'de', 'en', 'place', 'author', 'group']) {
    assert.match(course, new RegExp(`record\\.${field}\\.edit`));
  }
  assert.match(course, /function openCourseRecordEditor\(record\)/);
  assert.match(course, /openGroupAssignment = \(record\)/);
  assert.match(course, /openKnowledge = \(record\)/);
  assert.match(course, /contenteditable="\$\{canKnowledge \? 'true' : 'false'\}"/);
  assert.match(course, /data-course-record-permission/);
});

test('course saving and version restore support permission-aware animal fields', () => {
  assert.match(course, /recordFields\.push\(\{ key, field: field\.key, baseValue, value \}\)/);
  assert.match(course, /Datensatz speichern/);
  assert.match(server, /recordFields: \[\{ key: change\.key, field: change\.field/);
  assert.match(server, /assertAssigned\(user, name\)/);
});

test('course changes are based only on the freshly loaded dataset records', () => {
  assert.match(course, /let datasetRecordKeys = new Set\(\)/);
  assert.match(course, /datasetRecordKeys\.add\(key\)/);
  assert.match(course, /recordFields\[key\]\[field\.key\] = String\(edit\[field\.key\] \?\? fallback\[field\.key\]/);
  assert.match(course, /for \(const key of datasetRecordKeys\)/);
  assert.match(course, /recordEdits\?\.\[key\]\?\.knowledge \?\? baseValue/);
  assert.doesNotMatch(course, /const liveRecords = new Map/);
  assert.doesNotMatch(course, /Object\.keys\(baseline\.knowledge\).*Object\.keys\(recordEdits/);
});
