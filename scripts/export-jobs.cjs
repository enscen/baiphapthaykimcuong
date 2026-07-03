const fs = require('fs');
const path = require('path');

const jobsById = JSON.parse(fs.readFileSync('state/jobs.json', 'utf8'));
const posts = Object.values(jobsById)
  .map((job) => {
    const source = job.source || {};
    return {
      id: job.id,
      status: job.status,
      platform: source.source_platform || '',
      source_account: source.source_account || '',
      source_item_id: source.source_item_id || '',
      source_url: source.source_url || '',
      published_at: source.published_at || job.updated_at || job.created_at || '',
      title: source.title || job.title || job.id,
      caption_or_text: source.caption_or_text || '',
      original_text: job.original_text || source.original_text || source.caption_or_text || '',
      media_type: source.media_type || '',
      media_urls: source.media_urls || [],
      thumbnail_url: source.thumbnail_url || '',
      author_name: source.author_name || '',
      category: job.category || source.category || '',
      created_at: job.created_at || '',
      updated_at: job.updated_at || '',
      source,
    };
  })
  .sort((a, b) => {
    const left = Date.parse(b.published_at || b.updated_at || b.created_at || '') || 0;
    const right = Date.parse(a.published_at || a.updated_at || a.created_at || '') || 0;
    return left - right;
  });

const payload = {
  generated_at: new Date().toISOString(),
  count: posts.length,
  posts,
};

for (const file of ['data.json', path.join('deploy', 'data.json')]) {
  const dir = path.dirname(file);
  if (dir !== '.') fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify({ ok: true, total: posts.length }, null, 2));
