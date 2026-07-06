import fs from 'fs';
import path from 'path';
import { FacebookReader } from '../dist/facebook-reader.js';

const reader = new FacebookReader();

async function downloadMedia(url, filename) {
  if (!url || !/^https?:\/\/(scontent|fbcdn)/.test(url)) return null;
  try {
    const res = await fetch(url, {timeout: 10000});
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const dir = 'assets/facebook-media';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive:true});
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, Buffer.from(buf));
    return `assets/facebook-media/${filename}`;
  } catch(e) {
    return null;
  }
}

async function scrapeBatch(batchSize = 10) {
  const d = JSON.parse(fs.readFileSync('data.json', 'utf8'));
  const posts = d.posts
    .filter(p => p.platform === 'facebook' && p.source_url && (!p.media_urls?.length || p.media_urls.some(u => /emoji\.php|static\.xx\.fbcdn/.test(u))))
    .slice(0, batchSize);

  if (!posts.length) return 0;

  let updated = 0;
  for (const p of posts) {
    try {
      const item = await reader.getItem({ source_url: p.source_url, account: p.source_account });
      const media = item.media_urls || [];
      if (media.length) {
        const localUrls = [];
        for (let i = 0; i < media.length; i++) {
          const ext = media[i].match(/\.(jpg|jpeg|png|mp4|webm)/i)?.[0] || '.jpg';
          const filename = `${p.source_item_id}-${i}${ext}`;
          const local = await downloadMedia(media[i], filename);
          if (local) localUrls.push(local);
        }
        if (localUrls.length) {
          const idx = d.posts.findIndex(x => x.id === p.id);
          d.posts[idx].media_urls = localUrls;
          d.posts[idx].media_type = localUrls.some(u => /\.mp4|\.webm/i.test(u)) ? 'video' : 'image';
          updated++;
        }
      }
    } catch(e) {}
  }

  if (updated) fs.writeFileSync('data.json', JSON.stringify(d, null, 2));
  return updated;
}

let total = 0;
for (let i = 0; i < 10; i++) {
  const n = await scrapeBatch(10);
  total += n;
  console.log(`Run ${i+1}: +${n} posts (total: ${total})`);
  if (n === 0) break;
  await new Promise(r => setTimeout(r, 2000));
}
console.log(`\nCompleted: ${total} posts updated`);
