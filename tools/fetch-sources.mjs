/**
 * Download and unpack the two upstream sources into data/.
 *
 * JMdict is re-released frequently, so the exact asset is resolved from the
 * GitHub release API rather than pinned to a URL that will rot.
 */
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const DATA = 'data';
const WNJPN_URL = 'https://github.com/bond-lab/wnja/releases/download/v1.1/wnjpn.db.gz';
const JMDICT_RELEASE = 'https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest';

fs.mkdirSync(DATA, { recursive: true });

const UA = { 'User-Agent': 'eiwa-jiten-build' };

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { ...UA, ...headers } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        res.resume();
        return resolve(get(res.headers.location, headers));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      resolve(res);
    }).on('error', reject);
  });
}

async function download(url, dest) {
  if (fs.existsSync(dest)) {
    console.log(`have ${dest}`);
    return;
  }
  console.log(`fetching ${url}`);
  const res = await get(url);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(`${dest}.part`);
    res.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    res.on('error', reject);
  });
  fs.renameSync(`${dest}.part`, dest);
  console.log(`  -> ${dest} (${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`);
}

function gunzip(src, dest) {
  if (fs.existsSync(dest)) return console.log(`have ${dest}`);
  console.log(`decompressing ${src}`);
  fs.writeFileSync(dest, zlib.gunzipSync(fs.readFileSync(src)));
}

// --- Japanese WordNet -------------------------------------------------------
await download(WNJPN_URL, path.join(DATA, 'wnjpn.db.gz'));
gunzip(path.join(DATA, 'wnjpn.db.gz'), path.join(DATA, 'wnjpn.db'));

// --- JMdict -----------------------------------------------------------------
console.log('resolving latest JMdict release...');
const res = await get(JMDICT_RELEASE, { Accept: 'application/vnd.github+json' });
let body = '';
for await (const chunk of res) body += chunk;
const release = JSON.parse(body);

// The English-only, full (non common-only) JSON build.
const asset = release.assets.find(
  (a) => /^jmdict-eng-\d/.test(a.name) && a.name.endsWith('.json.zip')
);
if (!asset) throw new Error('could not find jmdict-eng json asset in latest release');

console.log(`JMdict ${release.tag_name}: ${asset.name}`);
const zipPath = path.join(DATA, 'jmdict-eng.json.zip');
await download(asset.browser_download_url, zipPath);

// The archive holds a single versioned .json; unzip with the platform tool.
const expected = asset.name.replace(/\.zip$/, '');
if (!fs.existsSync(path.join(DATA, expected))) {
  console.log('extracting...');
  if (process.platform === 'win32') {
    execFileSync('powershell', [
      '-NoProfile', '-Command',
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${DATA}' -Force`,
    ], { stdio: 'inherit' });
  } else {
    execFileSync('unzip', ['-o', zipPath, '-d', DATA], { stdio: 'inherit' });
  }
}

const found = fs.readdirSync(DATA).filter((f) => /^jmdict-eng-.*\.json$/.test(f));
console.log(`\nJMdict JSON: ${found.join(', ')}`);
console.log('\nNote: tools/extract-jmdict.mjs reads a pinned filename -- update SRC there');
console.log('if the version changed, then run: npm run build');
