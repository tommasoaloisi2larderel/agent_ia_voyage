import { catalogue } from '../server/catalogue.js';
import { index } from '../server/embeddings.js';
try {
  await index.ensure(catalogue, (done, total) => console.log(`${done}/${total} fiches indexées.`));
} catch (error) { console.error(error.message); process.exitCode = 1; }
