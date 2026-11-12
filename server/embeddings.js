import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { embeddingText } from './catalogue.js';
import { mistral } from './mistral.js';

export class EmbeddingIndex {
  constructor({ client = mistral, cacheDir = config.cacheDir, model = config.embedModel } = {}) {
    this.client = client; this.cacheDir = cacheDir; this.model = model;
    this.entries = {}; this.loaded = false; this.queue = Promise.resolve();
  }
  key(h) { return createHash('sha256').update(this.model + '\n' + embeddingText(h)).digest('hex'); }
  async load() {
    if (this.loaded) return;
    try {
      const saved = JSON.parse(await readFile(join(this.cacheDir, 'embeddings.json'), 'utf8'));
      if (saved.model === this.model && saved.entries && typeof saved.entries === 'object') {
        this.entries = Object.fromEntries(Object.entries(saved.entries).filter(([,v]) => Array.isArray(v) && v.length && v.some(x => x !== 0) && v.every(Number.isFinite)));
      }
    } catch (error) { if (error.code !== 'ENOENT') console.warn('Cache embeddings illisible : il sera reconstruit.'); }
    this.loaded = true;
  }
  async ensure(hotels, onProgress = () => {}, signal) {
    // Sérialisation de l'indexation : deux conversations ne paient pas deux fois les mêmes fiches.
    const work = this.queue.catch(() => {}).then(async () => {
      signal?.throwIfAborted();
      await this.load();
      const missing = hotels.filter(h => !this.entries[this.key(h)]);
      let completed = hotels.length - missing.length;
      onProgress(completed, hotels.length);
      for (let i = 0; i < missing.length; i += 32) {
        signal?.throwIfAborted();
        const batch = missing.slice(i, i + 32);
        const vectors = await this.client.embed(batch.map(embeddingText), signal);
        batch.forEach((h, j) => { this.entries[this.key(h)] = vectors[j]; });
        await mkdir(this.cacheDir, { recursive: true });
        const target = join(this.cacheDir, 'embeddings.json');
        await writeFile(target + '.tmp', JSON.stringify({ model: this.model, entries: this.entries }), { mode: 0o600 });
        await rename(target + '.tmp', target);
        completed += batch.length;
        onProgress(completed, hotels.length);
      }
    });
    this.queue = work;
    await work;
  }
  vector(h) { return this.entries[this.key(h)]; }
}
export const index = new EmbeddingIndex();
