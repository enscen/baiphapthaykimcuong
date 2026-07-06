const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/import-facebook-paste.cjs <pasted-text.txt>');
  process.exit(1);
}
const stateDir = path.join(process.cwd(), 'state');
const jobsFile = path.join(stateDir, 'jobs.json');
const raw = fs.readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
let text = raw.slice(Math.max(0, raw.indexOf('Bài viết')));

const markerRe = /(^|\n)(Vũ Kim Cương\n(?:\d+\s*(?:phút|giờ|ngày|tuần|tháng|năm)|\d{1,2}\s+Tháng\s+\d{1,2}|\d{1,2}\s+tháng\s+\d{1,2}|\d{1,2}\s+thg\s+\d{1,2}))/g;
const markers = [];
let match;
while ((match = markerRe.exec(text))) markers.push(match.index + (match[1] ? 1 : 0));

function cleanSegment(segment) {
  let lines = segment.replace(/\u00a0/g, ' ').split('\n').map((line) => line.trimEnd());
  if (lines[0] === 'Vũ Kim Cương') lines = lines.slice(1);
  if (lines[0] && /^(\d+\s*(phút|giờ|ngày|tuần|tháng|năm)|\d{1,2}\s+Tháng\s+\d{1,2}|\d{1,2}\s+tháng\s+\d{1,2}|\d{1,2}\s+thg\s+\d{1,2})$/i.test(lines[0].trim())) lines = lines.slice(1);
  if (lines[0]?.trim() === '·') lines = lines.slice(1);
  let body = lines.join('\n').trim();
  const cutPatterns = [
    /\nTất cả cảm xúc:[\s\S]*$/i,
    /\nAll reactions:[\s\S]*$/i,
    /\nThích\s*\nBình luận[\s\S]*$/i,
    /\nLike\s*\nComment[\s\S]*$/i,
    /\nBình luận[\s\S]*$/i,
    /\nComment[\s\S]*$/i,
    /\nViết bình luận[\s\S]*$/i,
    /\nXem thêm bình luận[\s\S]*$/i,
  ];
  for (const re of cutPatterns) body = body.replace(re, '');
  body = body
    .replace(/\n\s*·\s*\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/Xem thêm/g, '')
    .replace(/Ẩn bớt[\s\S]*$/g, '')
    .trim();
  return body;
}

function titleOf(body) {
  return body.split('\n').map((line) => line.trim()).find((line) => line.length >= 8)?.slice(0, 120) || 'Facebook pasted post';
}

function idOf(body, index) {
  const hash = crypto.createHash('sha1').update(body).digest('hex').slice(0, 14);
  return `facebook-paste:${hash}-${index}`;
}

const posts = [];
for (let i = 0; i < markers.length; i += 1) {
  const start = markers[i];
  const end = markers[i + 1] ?? text.length;
  const body = cleanSegment(text.slice(start, end));
  if (body.length < 350) continue;
  if (/sinh nhật|chúc mừng sinh nhật/i.test(body) && body.length < 1200) continue;
  posts.push({ index: i + 1, body });
}

fs.mkdirSync(stateDir, { recursive: true });
let jobs = {};
try { jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8')); } catch {}
let created = 0, updated = 0, skipped = 0;
const now = new Date().toISOString();
for (const post of posts) {
  const id = idOf(post.body, post.index);
  const existing = jobs[id];
  const sourceItem = {
    source_platform: 'facebook',
    source_account: 'facebook.com/vukim.cuong.71',
    source_item_id: id,
    source_url: `https://www.facebook.com/vukim.cuong.71#pasted-${post.index}`,
    published_at: undefined,
    title: titleOf(post.body),
    caption_or_text: post.body,
    original_text: post.body,
    media_type: 'text',
    media_urls: [],
    author_name: 'Vũ Kim Cương',
    raw: { imported_from: inputPath, pasted_index: post.index },
  };
  if (existing) {
    if ((existing.original_text || '').length < post.body.length) {
      jobs[id] = {
        ...existing,
        source: sourceItem,
        original_text: post.body,
        proposed_text: existing.proposed_text === existing.original_text ? post.body : existing.proposed_text,
        updated_at: now,
      };
      updated += 1;
    } else skipped += 1;
    continue;
  }
  jobs[id] = {
    id,
    status: 'draft',
    source: sourceItem,
    platform_targets: ['facebook'],
    original_text: post.body,
    proposed_text: post.body,
    personal_comment: '',
    created_at: now,
    updated_at: now,
  };
  created += 1;
}
fs.writeFileSync(jobsFile, JSON.stringify(jobs, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ ok: true, markers: markers.length, imported_posts: posts.length, created, updated, skipped, jobs_file: jobsFile }, null, 2));