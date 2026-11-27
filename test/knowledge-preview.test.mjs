import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const helperStart = index.indexOf('function hasKnowledgeText(');
const photosStart = index.indexOf('function photos(', helperStart);
const bindStart = index.indexOf('function bindPhotos(', photosStart);
const deleteStart = index.indexOf('function deleteCard(', bindStart);

function createSandbox(record) {
  const previewButton = { dataset: { id: record.id } };
  const template = { content: { textContent: '' } };
  Object.defineProperty(template, 'innerHTML', {
    set(value) {
      template.content.textContent = String(value)
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;|&#160;/gi, ' ');
    },
  });
  const opened = [];
  const sandbox = {
    document: {
      createElement: () => template,
      querySelectorAll(selector) {
        return selector === '.photo [data-id]' || selector === '.knowledge-preview'
          ? [previewButton]
          : [];
      },
    },
    sanitizeKnowledgeHtml: (html) => html,
    esc: (value) => String(value ?? ''),
    title: (value) => String(value ?? ''),
    sci: () => '',
    records: [record],
    openKnowledge: (selected) => opened.push(selected),
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${index.slice(helperStart, photosStart)}${index.slice(photosStart, bindStart)}${index.slice(bindStart, deleteStart)}globalThis.renderPhotos = photos; globalThis.bindPhotoCards = bindPhotos;`,
    sandbox,
  );
  return { sandbox, previewButton, opened };
}

test('species previews show the brain icon only when knowledge contains text', () => {
  const record = { id: 'fish-1', de: 'Fisch', src: '/fish.jpg', knowledge: '<p>Lebt im Meer.</p>' };
  const { sandbox } = createSandbox(record);
  const markup = sandbox.renderPhotos([record]);

  assert.match(markup, /class="knowledge-preview"/);
  assert.match(markup, /aria-label="Wissenstext zu Fisch anzeigen"/);
  assert.doesNotMatch(sandbox.renderPhotos([{ ...record, knowledge: ' <p><br>&nbsp;</p> ' }]), /knowledge-preview/);
  assert.doesNotMatch(sandbox.renderPhotos([{ ...record, knowledge: '' }]), /knowledge-preview/);
});

test('clicking the brain icon opens the selected record knowledge', () => {
  const record = { id: 'fish-1', de: 'Fisch', knowledge: 'Lebt im Meer.' };
  const { sandbox, previewButton, opened } = createSandbox(record);
  let propagationStopped = false;

  sandbox.bindPhotoCards();
  previewButton.onclick({ stopPropagation: () => { propagationStopped = true; } });

  assert.equal(propagationStopped, true);
  assert.deepEqual(opened, [record]);
});
