const fs = require('fs');
const cp = require('child_process');
const path = require('path');

const data = JSON.parse(fs.readFileSync('data.json', 'utf8').replace(/^\uFEFF/, ''));
const titles = JSON.parse(fs.readFileSync('tiktok-thumb-titles.json', 'utf8').replace(/^\uFEFF/, ''));
const outDir = path.join('assets', 'tiktok-thumbs');
fs.mkdirSync(outDir, { recursive: true });

const posts = (data.posts || [])
  .filter(p => p.platform === 'tiktok' && String(p.source_account || '').includes('@diamond.paramita'))
  .filter(p => titles[String(p.source_item_id || p.id).replace('tiktok:', '')]);

let made = 0;
let skipped = 0;
let failed = 0;
for (const post of posts) {
  const id = String(post.source_item_id || post.id).replace('tiktok:', '');
  const out = path.join(outDir, `${id}.jpg`);
  if (fs.existsSync(out)) {
    skipped++;
    continue;
  }
  const tmpBase = path.join(outDir, `${id}.tmp`);
  try {
    cp.execFileSync('python', ['-m', 'yt_dlp', '--skip-download', '--write-thumbnail', '-o', `${tmpBase}.%(ext)s`, post.source_url], { timeout: 60000, stdio: ['ignore', 'ignore', 'pipe'] });
    const downloaded = fs.readdirSync(outDir).find(name => name.startsWith(`${id}.tmp.`));
    if (!downloaded) throw new Error('no thumbnail');
    const downloadedPath = path.join(outDir, downloaded);
    cp.execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', downloadedPath, '-vf', 'scale=640:1138:force_original_aspect_ratio=increase,crop=640:1138', '-q:v', '3', out], { timeout: 30000 });
    if (fs.existsSync(downloadedPath)) fs.unlinkSync(downloadedPath);
    made++;
  } catch (error) {
    failed++;
    for (const name of fs.readdirSync(outDir).filter(name => name.startsWith(`${id}.tmp.`))) fs.rmSync(path.join(outDir, name), { force: true });
    console.log(`${id}: thumbnail failed: ${error.message}`);
  }
}
console.log(JSON.stringify({ made, skipped, failed, total: posts.length }));
