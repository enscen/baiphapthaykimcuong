import { reconcileFacebookJob } from '../dist/facebook-reconcile.js';
import { getJob, listJobs, updateJob } from '../dist/jobs.js';

const limit = Number(process.argv[2] || 30);
const jobs = (await listJobs()).filter(j => j.source.source_platform === 'facebook' && (!j.source.source_url || j.source.source_url.includes('#pasted'))).slice(0, limit);
console.log(`[${new Date().toISOString()}] FB reconcile batch: ${jobs.length}`);
for (const job of jobs) {
  try {
    console.log('search', job.id, job.source.title || job.original_text.split(/\r?\n/)[0]);
    const result = await reconcileFacebookJob(job);
    if (result.best?.source_url) {
      const mergedSource = { ...job.source, source_url: result.best.source_url, media_urls: result.best.media_urls?.length ? result.best.media_urls : [result.best.source_url], thumbnail_url: result.best.thumbnail_url || job.source.thumbnail_url, raw: { previous: job.source.raw, reconcile: result } };
      await updateJob(job.id, { source: mergedSource, source_compare_note: `Đã tự dò và gắn link Facebook gốc: ${result.best.source_url}`, media_review_status: (result.best.media_urls?.length || 0) > 0 ? 'reviewed' : 'needs_review' });
      console.log('OK', result.best.source_url);
    } else {
      console.log('MISS');
    }
  } catch (e) {
    console.log('ERR', e.message);
  }
}
console.log('done');
