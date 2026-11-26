import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadCourseChangeHarness() {
  const source = fs.readFileSync(new URL('../course-leader-client.js', import.meta.url), 'utf8');
  const instrumented = source.replace(
    "  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);\n  else init();",
    `  window.__courseChangeTest = {
      captureBaseline,
      collectCourseChanges,
      setProfile: (value) => { courseProfile = value; },
      setDataset: (value) => { selectedDataset = value; }
    };`
  );
  assert.notEqual(instrumented, source, 'test harness hook must be installed');

  const context = {
    window: {},
    document: {},
    sessionStorage: {
      getItem: () => '',
      setItem: () => {},
      removeItem: () => {},
    },
    sanitizeKnowledgeHtml: (value) => String(value ?? ''),
    safeKnowledgeUrl: (value) => String(value ?? '').trim(),
    group: () => 'Fische',
    recordEdits: {},
    groupMoves: {},
    savedGroups: {},
    records: [],
    console,
    Set,
    Map,
  };
  vm.runInNewContext(instrumented, context, { filename: 'course-leader-client.js' });
  return context;
}

test('collects only the real knowledge change from records in the opened dataset', () => {
  const context = loadCourseChangeHarness();
  const currentKey = 'f#g#a#de#en#d#p#u#current.jpg';
  const orphanKey = 'old#record#not#in#dataset#x#x#x#orphan.jpg';
  const api = context.window.__courseChangeTest;

  api.setProfile({ permissions: ['knowledge.edit'] });
  api.setDataset('Rotes Meer');
  context.records = [{ name: currentKey, knowledge: 'staler lokaler Wert' }];
  api.captureBaseline({
    images: [{ name: currentKey }],
    recordEdits: {
      [currentKey]: { knowledge: 'Serverwert' },
      [orphanKey]: { knowledge: 'verwaiste Altlast' },
    },
    groupMoves: {},
    savedGroups: {},
  });

  context.recordEdits = {
    [currentKey]: { knowledge: 'Echte Änderung' },
    [orphanKey]: { knowledge: 'verwaiste Altlast' },
  };

  assert.deepEqual(
    JSON.parse(JSON.stringify(api.collectCourseChanges())),
    {
      knowledge: [{ key: currentKey, baseValue: 'Serverwert', value: 'Echte Änderung' }],
      recordFields: [],
      academicLinks: [],
    }
  );
});
