import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const viewer = read('learning-materials-viewer.js');
const css = read('learning-materials.css');

test('PDF starts centered in whole-page mode', () => {
  assert.match(viewer, /state\.fit = 'page'/);
  assert.match(viewer, /await applyFit\('page'(?:, \{ top: true \})?\)/);
  assert.match(viewer, /restoreView\(stage, ratios, center, top, bottom\)/);
  assert.match(css, /\.pdf-pages\{width:max-content;min-width:100%;min-height:100%/);
  assert.match(css, /\.pdf-pages\.is-contained\{align-items:center\}/);
});

test('fit controls calculate and apply distinct width, whole-page and fill-window scales', () => {
  assert.match(viewer, /pdfFitWidth[\s\S]*applyFit\('width'\)/);
  assert.match(viewer, /pdfFitPage[\s\S]*applyFit\('page'\)/);
  assert.match(viewer, /pdfFitFill[\s\S]*applyFit\('fill'\)/);
  assert.match(viewer, /mode === 'page'[\s\S]*Math\.min\(widthScale, heightScale\)/);
  assert.match(viewer, /mode === 'fill'[\s\S]*Math\.max\(widthScale, heightScale\)/);
  assert.match(viewer, /state\.scale = clamp\(await calculateFitScale\(mode\), MIN_SCALE, MAX_SCALE\)/);
});

test('controls have clear German labels and active-state feedback', () => {
  for (const label of ['↔ Breite', '▣ Ganze Seite', '⤢ Fenster füllen', 'Ansicht: Einzelseite', '⛶ Vollbild']) {
    assert.match(viewer, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(viewer, /classList\.toggle\('active', active\)/);
  assert.match(viewer, /setAttribute\('aria-pressed'/);
  assert.match(css, /\.pdf-tool\.active/);
});

test('free zoom reaches 600 percent and keeps oversized pages pannable', () => {
  assert.match(viewer, /const MAX_SCALE = 6/);
  assert.match(viewer, /max="600"/);
  assert.match(viewer, /state\.fit = 'custom'/);
  assert.match(viewer, /stage\.scrollLeft = state\.dragStart\.left - dx/);
  assert.match(viewer, /stage\.scrollTop = state\.dragStart\.top - dy/);
  assert.match(css, /\.pdf-stage\{touch-action:none/);
  assert.match(css, /\.pdf-page canvas\{display:block;max-width:none!important/);
});

test('pinch, wheel zoom, fullscreen, orientation and keyboard navigation remain available', () => {
  assert.match(viewer, /pinchDistance/);
  assert.match(viewer, /wheelZoom/);
  assert.match(viewer, /requestFullscreen/);
  assert.match(viewer, /screen\.orientation/);
  assert.match(viewer, /PageDown/);
  assert.match(viewer, /event\.key === '0'/);
});

test('folder-tree repair remains in the shipped stylesheet', () => {
  assert.match(css, /material-tree-children/);
  assert.match(css, /material-tree-toggle/);
  assert.match(css, /root-children/);
});

test('viewer fix does not touch KL change collection or server routing', () => {
  assert.doesNotMatch(viewer, /collectCourseChanges|captureBaseline|datasetRecordKeys|material-list|material-download-chunk/);
});


test('PDF stage uses the full real viewer area instead of the global main width cap', () => {
  assert.match(css, /\.pdf-body>\.pdf-stage\{width:100%;max-width:none!important;margin:0\}/);
  assert.match(css, /\.pdf-body>\.pdf-thumbs\.hidden\+\.pdf-stage\{grid-column:1\/-1;width:auto;min-width:0\}/);
  assert.match(viewer, /stage\.clientWidth - horizontalPadding/);
  assert.match(viewer, /stage\.clientHeight - verticalPadding/);
});
