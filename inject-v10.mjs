import fs from 'node:fs';

const path = 'index.html';
let html = fs.readFileSync(path, 'utf8');
const style = '<link rel="stylesheet" href="/learning-materials.css">';
if (!html.includes(style)) html = html.replace('</head>', style + '</head>');
const scripts = [
  '<script src="/v10-client.js"></script>',
  '<script src="/course-leader-client.js"></script>',
  '<script src="/image-compression-client.js"></script>',
  '<script src="/learning-materials-viewer.js"></script>',
  '<script src="/learning-materials-client.js"></script>',
];
for (const script of scripts) {
  if (!html.includes(script)) html = html.replace('</body>', script + '</body>');
}
for (const file of ['vendor/pdfjs/pdf.mjs', 'vendor/pdfjs/pdf.worker.mjs']) {
  if (!fs.existsSync(file)) throw new Error(`Lokale PDF.js-Datei fehlt: ${file}`);
}
fs.writeFileSync(path, html);
