import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const renderStart = index.indexOf('function renderGalleryModal()');
const renderEnd = index.indexOf('function showPreviousGalleryImage()', renderStart);

function render(record) {
  const elements = {
    '#modalContent': {},
    '#modal': { classList: { remove() {} } },
    '#modal .modalbox': {},
    '#galleryBack': {},
  };
  const sandbox = {
    gallerySet: [record],
    galleryIndex: 0,
    galleryInfo: false,
    esc: (value) => String(value ?? '').replace(/[&<>"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    })[char]),
    title: (value) => String(value || 'Nicht angegeben'),
    sci: (item) => [item.genus, item.species].filter(Boolean).join(' '),
    fmt: () => '',
    $: (selector) => elements[selector] || null,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${index.slice(renderStart, renderEnd)}globalThis.render = renderGalleryModal;`,
    sandbox,
  );
  sandbox.render();
  return elements['#modalContent'].innerHTML;
}

test('large photo views show the German name and scientific name in a centered overlay', () => {
  const markup = render({
    de: 'Blauer Fisch',
    genus: 'Chromis',
    species: 'chromis',
    src: '/fish.jpg',
  });

  assert.match(markup, /class="gallery-image-title"[^>]*>Blauer Fisch - <i>Chromis chromis<\/i>/);
  assert.match(markup, /left:50%;transform:translateX\(-50%\)/);
});

test('large photo title escapes names before inserting them into markup', () => {
  const markup = render({
    de: '<script>Fehler</script>',
    genus: 'Genus',
    species: 'species',
    src: '/fish.jpg',
  });

  assert.match(markup, /&lt;script&gt;Fehler&lt;\/script&gt; - <i>Genus species<\/i>/);
  assert.doesNotMatch(markup, /<script>/);
});
