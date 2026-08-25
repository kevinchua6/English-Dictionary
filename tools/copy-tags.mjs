import fs from 'node:fs';

const tags = JSON.parse(fs.readFileSync('data/tags-ja.json', 'utf8'));
delete tags._comment;
fs.writeFileSync('web/tags.json', JSON.stringify(tags));
console.log(`web/tags.json: ${Object.keys(tags).length} tags`);
