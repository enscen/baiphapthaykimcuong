import fs from 'fs';
import path from 'path';
import { FacebookReader } from '../dist/facebook-reader.js';

const BATCH_SIZE = Number(process.env.FACEBOOK_MEDIA_BATCH || 10);
const reader = new FacebookReader();

async function downloadMedia(url, filename) {
  if (!url || !/^https?:\/\/(scontent|fbcdn)/.test(url)) return null;
  try {
    const res = await fetch(url);
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

async function scrapeAndSaveFB() {
  const d = JSON.parse(fs.readFileSync('data.json', 'utf8'));
  const posts = d.posts
    .filter(p => p.platform === 'facebook' && p.source_url && (!p.media_urls?.length || p.media_urls.some(u => /emoji\.php|static\.xx\.fbcdn/.test(u))))
    .filter(p => ((p.raw || {}).facebook_media_attempts || 0) < 20)
    .sort((a, b) => (((a.raw || {}).facebook_media_attempts || 0) - ((b.raw || {}).facebook_media_attempts || 0)))
    .slice(0, BATCH_SIZE);

  if (!posts.length) {
    console.log('✓ All posts have media or no scraping needed');
    return;
  }

  console.log(`Refreshing ${posts.length} posts...`);
  let updated = 0;

  for (const p of posts) {
    try {
      const item = await reader.getItem({ source_url: p.source_url, account: p.source_account });
      const media = item.media_urls || [];
      if (media.length > 0) {
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
          d.posts[idx].thumbnail_url = localUrls[0];
          d.posts[idx].raw = { ...(d.posts[idx].raw || {}), facebook_media_attempts: 0, facebook_media_refreshed_at: new Date().toISOString() };
          updated++;
          console.log(`✓ ${p.source_item_id.slice(0,30)}: ${localUrls.length} media`);
        } else {
          const idx = d.posts.findIndex(x => x.id === p.id);
          d.posts[idx].raw = { ...(d.posts[idx].raw || {}), facebook_media_attempts: ((d.posts[idx].raw || {}).facebook_media_attempts || 0) + 1, facebook_media_checked_at: new Date().toISOString() };
        }
      }
      if (!media.length) {
        const idx = d.posts.findIndex(x => x.id === p.id);
        d.posts[idx].raw = { ...(d.posts[idx].raw || {}), facebook_media_attempts: ((d.posts[idx].raw || {}).facebook_media_attempts || 0) + 1, facebook_media_checked_at: new Date().toISOString() };
      }
    } catch(e) {
      const idx = d.posts.findIndex(x => x.id === p.id);
      if (idx >= 0) d.posts[idx].raw = { ...(d.posts[idx].raw || {}), facebook_media_attempts: ((d.posts[idx].raw || {}).facebook_media_attempts || 0) + 1, facebook_media_error: e.message.slice(0,120), facebook_media_checked_at: new Date().toISOString() };
      console.log(`✗ ${p.source_item_id.slice(0,30)}: ${e.message.slice(0,40)}`);
    }
  }

  if (updated > 0) {
    fs.writeFileSync('data.json', JSON.stringify(d, null, 2));
    console.log(`\n✓ Updated ${updated}/${posts.length} posts`);
  }
}

await scrapeAndSaveFB();
