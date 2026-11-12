import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

export const config = {
  apiKey: process.env.MISTRAL_API_KEY?.trim() || '',
  chatModel: process.env.MISTRAL_CHAT_MODEL || 'mistral-small-latest',
  embedModel: process.env.MISTRAL_EMBED_MODEL || 'mistral-embed',
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  cacheDir: fileURLToPath(new URL('../.cache/', import.meta.url)),
};
