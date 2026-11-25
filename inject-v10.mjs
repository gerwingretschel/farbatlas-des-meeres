import fs from 'node:fs';

const path = 'index.html';
let html = fs.readFileSync(path, 'utf8');
const scripts = [
  '<script src="/v10-client.js"></script>',
  '<script src="/course-leader-client.js"></script>',
];

for (const script of scripts) {
  if (!html.includes(script)) html = html.replace('</body>', script + '</body>');
}
fs.writeFileSync(path, html);
