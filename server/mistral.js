import { setTimeout as delay } from 'node:timers/promises';
import { config } from './config.js';
import { validate } from './schema.js';

export class AppError extends Error {
  constructor(message, status = 500) { super(message); this.status = status; }
}

export function createMistral({ apiKey = config.apiKey, fetchImpl = fetch } = {}) {
  async function request(path, body, signal) {
    if (!apiKey) throw new AppError('Ajoutez MISTRAL_API_KEY dans le fichier .env, puis redémarrez le serveur.', 503);
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      try {
        response = await fetchImpl(`https://api.mistral.ai/v1/${path}`, {
          method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new AppError('Mistral est injoignable ou le délai de réponse est dépassé. Réessayez dans un instant.', 502);
      }
      if (response.ok) return response.json();
      await response.body?.cancel();
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        const retry = Number(response.headers.get('retry-after'));
        await delay(Math.min(10000, Math.max(1000 * (attempt + 1), Number.isFinite(retry) ? retry * 1000 : 0)), undefined, { signal });
        continue;
      }
      const messages = {
        401: 'Clé Mistral refusée. Vérifiez MISTRAL_API_KEY dans .env puis redémarrez.',
        403: 'Cette clé ne dispose pas des accès nécessaires au modèle Mistral.',
        429: 'Limite Mistral atteinte. Attendez un instant ou vérifiez le quota de votre compte.',
        402: 'Le compte Mistral ne dispose pas de crédits suffisants.',
        400: 'Mistral a refusé la requête. Vérifiez les modèles configurés et leur prise en charge des sorties structurées.',
        404: 'Modèle Mistral introuvable. Vérifiez les modèles configurés dans .env.',
      };
      throw new AppError(messages[response.status] || 'Mistral rencontre une erreur. Réessayez dans un instant.', 502);
    }
  }
  return {
    async structured(messages, schema, name, signal) {
      const data = await request('chat/completions', {
        model: config.chatModel, messages, temperature: 0.1, max_tokens: 2400,
        response_format: { type: 'json_schema', json_schema: { name, schema, strict: true } },
      }, signal);
      if (data.choices?.[0]?.finish_reason === 'length') throw new AppError('La réponse Mistral est incomplète. Essayez une demande plus courte.', 502);
      let parsed;
      try { parsed = JSON.parse(data.choices[0].message.content); validate(parsed, schema); }
      catch { throw new AppError('Mistral a renvoyé un format inattendu. Réessayez votre demande.', 502); }
      return parsed;
    },
    async embed(texts, signal) {
      const data = await request('embeddings', { model: config.embedModel, input: texts, encoding_format: 'float' }, signal);
      const rows = data.data?.slice().sort((a, b) => a.index - b.index);
      if (!rows || rows.length !== texts.length || rows.some((r, i) => r.index !== i || !Array.isArray(r.embedding) || !r.embedding.length || r.embedding.some(n => !Number.isFinite(n)))) {
        throw new AppError('Les embeddings Mistral reçus sont invalides.', 502);
      }
      return rows.map(r => r.embedding);
    },
  };
}
export const mistral = createMistral();
