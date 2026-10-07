import fs from 'node:fs';
const p='index.html';let s=fs.readFileSync(p,'utf8');
const tag='<script src="/v10-client.js"></script>';
if(!s.includes(tag))s=s.replace('</body>',tag+'</body>');
fs.writeFileSync(p,s);
