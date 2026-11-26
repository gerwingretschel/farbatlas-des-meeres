import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const viewer = read('learning-materials-viewer.js');
const css = read('learning-materials.css');

test('hidden thumbnails release the complete grid width', () => {
  assert.match(css, /\.pdf-body>\.pdf-thumbs\.hidden\+\.pdf-stage\{grid-column:1\/-1;width:auto;min-width:0\}/);
  assert.match(viewer, /q\('#pdfThumbnails'\)\.onclick = toggleThumbnails/);
  assert.match(viewer, /async function toggleThumbnails\(\)[\s\S]*classList\.toggle\('hidden'\)[\s\S]*await nextFrame\(\)[\s\S]*await handleViewportChange\(\)/);
});

test('top and bottom boundaries tolerate rounding and scrollbar subpixels', () => {
  const testable = viewer.replace(
    'window.FarbatlasPdfViewer = Object.freeze({ open, close, inspect });',
    'window.__edgeTest = { isAtPageTop, isAtPageBottom };',
  );
  const sandbox = {
    window: { addEventListener() {} },
    document: { querySelector() { return null; } },
    screen: { orientation: null },
    console,
  };
  vm.runInNewContext(testable, sandbox);
  const { isAtPageTop, isAtPageBottom } = sandbox.window.__edgeTest;
  assert.equal(isAtPageTop({ scrollTop: 2 }), true);
  assert.equal(isAtPageTop({ scrollTop: 3 }), false);
  assert.equal(isAtPageBottom({ scrollTop: 398, clientHeight: 600, scrollHeight: 1000 }), true);
  assert.equal(isAtPageBottom({ scrollTop: 397, clientHeight: 600, scrollHeight: 1000 }), false);
});

test('upward navigation opens the previous page at its lower edge', () => {
  const testable = viewer.replace(
    'window.FarbatlasPdfViewer = Object.freeze({ open, close, inspect });',
    'window.__edgeTest = { restoreView, state };',
  );
  const sandbox = {
    window: { addEventListener() {} },
    document: { querySelector() { return null; } },
    screen: { orientation: null },
    requestAnimationFrame(callback) { callback(); },
    console,
  };
  vm.runInNewContext(testable, sandbox);
  const { restoreView, state } = sandbox.window.__edgeTest;
  state.fit = 'fill';
  const stage = {
    scrollWidth: 1200, clientWidth: 400, scrollHeight: 1800, clientHeight: 600,
    scrollLeft: 0, scrollTop: 0, classList: { toggle() {} },
  };
  restoreView(stage, { x: 0.5, y: 0.5 }, true, false, true);
  assert.equal(stage.scrollLeft, 400);
  assert.equal(stage.scrollTop, 1200);
});

test('vertical arrow keys cross pages only at the corresponding edge', () => {
  assert.match(viewer, /event\.key === 'ArrowDown' && changePageAtVerticalEdge\(1\)/);
  assert.match(viewer, /event\.key === 'ArrowUp' && changePageAtVerticalEdge\(-1\)/);
  assert.match(viewer, /direction > 0[\s\S]*isAtPageBottom\(stage\)[\s\S]*position: 'top'/);
  assert.match(viewer, /direction < 0[\s\S]*isAtPageTop\(stage\)[\s\S]*position: 'bottom'/);
});

test('vertical touchscreen swipes continue to adjacent pages at page edges', () => {
  assert.match(viewer, /const verticalSwipe = Math\.abs\(dy\) > 70/);
  assert.match(viewer, /verticalSwipe && changePageAtVerticalEdge\(dy < 0 \? 1 : -1\)/);
  assert.match(viewer, /else if \(!wasDragging[\s\S]*Math\.abs\(dx\) > 70/);
});

test('existing horizontal, page-key, fit and pinch controls remain intact', () => {
  assert.match(viewer, /\['ArrowRight', 'PageDown'\]/);
  assert.match(viewer, /\['ArrowLeft', 'PageUp'\]/);
  assert.match(viewer, /applyFit\('width'\)/);
  assert.match(viewer, /applyFit\('page'\)/);
  assert.match(viewer, /applyFit\('fill'\)/);
  assert.match(viewer, /pinchDistance/);
});