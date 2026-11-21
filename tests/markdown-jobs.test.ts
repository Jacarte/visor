import { expect, it } from 'vitest';
import path from 'node:path';
import { MarkdownJobs } from '../src/markdown-jobs';
it('markdown-jobs bounds the queue, settles cancellations and reclaims capacity for the next scope', async () => {
  const jobs = new MarkdownJobs(path.resolve('build/app/markdown-worker.cjs'));
  try {
    const pending = Array.from({ length: 20 }, () => jobs.run({ kind: 'index', markdown: '['.repeat(120000) + ']'.repeat(120000) }).then(() => 'completed', error => String(error)));
    await new Promise(resolve => setTimeout(resolve, 50)); jobs.cancel();
    const results = await Promise.all(pending); expect(results.filter(result => result.includes('queue full')).length).toBeGreaterThanOrEqual(17); expect(results.filter(result => result.includes('cancelled')).length).toBeGreaterThan(0);
    const healthy = await jobs.run({ kind: 'index', markdown: '# Reclaimed' }); expect(healthy.record.headings[0].text).toBe('Reclaimed');
  } finally { jobs.cancel(); }
});
it('markdown-jobs settles startup failure instead of losing a promise or queue capacity', async () => {
  const jobs = new MarkdownJobs('/nonexistent/visor-trusted-worker.cjs');
  try { await expect(jobs.run({ kind: 'index', markdown: '# Note' })).rejects.toThrow(); await expect(jobs.run({ kind: 'index', markdown: '# Again' })).rejects.toThrow(); }
  finally { jobs.cancel(); }
});
