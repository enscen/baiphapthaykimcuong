const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { createWorker } = require('tesseract.js');

const root = process.cwd();
const dataPath = path.join(root, 'data.json');
const outPath = path.join(root, 'tiktok-thumb-titles.json');
const attemptsPath = path.join(root, 'tiktok-thumb-title-attempts.json');
const limit = Number(process.env.TIKTOK_OCR_LIMIT || 40);
const retryDays = Number(process.env.TIKTOK_OCR_RETRY_DAYS || 14);
const now = new Date().toISOString();

const readJson = (file, fallback) => fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  : fallback;
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const data = readJson(dataPath, { posts: [] });
const current = readJson(outPath, {});
const attempts = readJson(attemptsPath, {});
const isTeacher = p => p.platform === 'tiktok' && String(p.source_account || '').includes('@diamond.paramita');
const idOf = p => String(p.source_item_id || p.id || '').replace('tiktok:', '');
const dateOf = p => Date.parse(p.published_at || p.updated_at || p.created_at || '') || 0;

function clean(raw) {
  const lines = String(raw || '')
    .normalize('NFC')
    .replace(/[|_•·]+/g, ' ')
    .replace(/\b(TikTok|CapCut|LIVE|Follow|Following)\b/gi, ' ')
    .split('\n')
    .map(line => line
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[^\p{L}\p{N}\s.,!?&-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(line => line.length >= 3 && !/^#/.test(line));
  return lines
    .sort((a, b) => scoreLine(b) - scoreLine(a))
    .slice(0, 2)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreLine(line) {
  const tokens = String(line || '').split(/\s+/).filter(Boolean);
  const words = tokens.filter(x => /^[\p{L}\p{N}]{2,}$/u.test(x));
  const upper = words.filter(x => x === x.toUpperCase()).length;
  return words.length * 3 + upper - Math.abs(line.length - 34) / 8;
}

function goodOcrTitle(value) {
  const text = String(value || '').trim();
  if (/[ñðþß¢¬]/i.test(text)) return false;
  if (/([A-Z]{1,2}\s*){8,}/.test(text)) return false;
  const tokens = text.split(/\s+/).filter(Boolean);
  const words = tokens.filter(x => /^[\p{L}\p{N}]{2,}$/u.test(x));
  const singles = tokens.filter(x => x.length === 1).length;
  const digits = tokens.filter(x => /\d/.test(x)).length;
  const vowelWords = words.filter(x => /[aăâeêioôơuưyáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(x)).length;
  if (words.length < 2) return false;
  if (words.length / tokens.length < 0.68) return false;
  if (singles / tokens.length > 0.25) return false;
  if (digits / tokens.length > 0.2) return false;
  if (vowelWords < 2) return false;
  return text.length >= 8 && text.length <= 120;
}

function recentlyTried(id) {
  const triedAt = Date.parse(attempts[id]?.last_attempt_at || '');
  if (!triedAt) return false;
  return Date.now() - triedAt < retryDays * 24 * 60 * 60 * 1000;
}

function freshThumbnail(job) {
  if (!job.source_url) return job.url;
  try {
    const raw = cp.execFileSync('python', ['-m', 'yt_dlp', '--skip-download', '--dump-json', job.source_url], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    const info = JSON.parse(raw.trim().split(/\r?\n/).pop());
    const thumbs = Array.isArray(info.thumbnails) ? info.thumbnails : [];
    const picked = [...thumbs].sort((a, b) => (b.preference || 0) - (a.preference || 0)).find(x => x.url);
    return picked?.url || info.thumbnail || job.url;
  } catch (error) {
    return job.url;
  }
}

const jobs = (data.posts || [])
  .filter(isTeacher)
  .sort((a, b) => dateOf(b) - dateOf(a))
  .map(p => ({ id: idOf(p), url: p.thumbnail_url || '', source_url: p.source_url || '' }))
  .filter(x => x.id && x.url && !current[x.id] && !recentlyTried(x.id))
  .slice(0, limit);

(async () => {
  if (!jobs.length) {
    console.log('No TikTok thumbnail OCR jobs.');
    return;
  }
  const worker = await createWorker('vie+eng');
  for (const job of jobs) {
    try {
      const imageUrl = freshThumbnail(job);
      const result = await worker.recognize(imageUrl);
      const title = clean(result.data.text);
      attempts[job.id] = { last_attempt_at: now, ok: goodOcrTitle(title), text: title, source_url: job.source_url, refreshed: imageUrl !== job.url };
      if (attempts[job.id].ok) current[job.id] = title;
      console.log(`${job.id}: ${attempts[job.id].ok ? title : 'OCR rejected'}${title ? ` (${title})` : ''}`);
    } catch (error) {
      attempts[job.id] = { last_attempt_at: now, ok: false, error: error.message, source_url: job.source_url };
      console.log(`${job.id}: OCR failed: ${error.message}`);
    }
  }
  await worker.terminate();
  writeJson(outPath, current);
  writeJson(attemptsPath, attempts);
  for (const dir of ['deploy', 'public']) {
    if (fs.existsSync(dir)) writeJson(path.join(root, dir, 'tiktok-thumb-titles.json'), current);
  }
})();
