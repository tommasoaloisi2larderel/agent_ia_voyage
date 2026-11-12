import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EmbeddingIndex } from '../server/embeddings.js';
import { catalogue } from '../server/catalogue.js';
import { createMistral } from '../server/mistral.js';

test('le cache persiste, évite les doubles appels concurrents et réindexe les fiches modifiées', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'echappee-cache-'));
  try {
    let calls = 0;
    const client = { embed: async texts => { calls++; return texts.map(() => [1,2,3]); } };
    const index = new EmbeddingIndex({ client, cacheDir, model: 'test' });
    await Promise.all([index.ensure(catalogue.slice(0,3)), index.ensure(catalogue.slice(0,3))]);
    assert.equal(calls, 1);
    const restarted = new EmbeddingIndex({ client, cacheDir, model: 'test' });
    await restarted.ensure(catalogue.slice(0,3)); assert.equal(calls, 1);
    await restarted.ensure([{ ...catalogue[0], ambiance: 'Nouvelle fiche' }]); assert.equal(calls, 2);
    const changedModel = new EmbeddingIndex({ client, cacheDir, model: 'autre-modele' });
    await changedModel.ensure(catalogue.slice(0,3)); assert.equal(calls, 3);
  } finally { await rm(cacheDir, { recursive: true, force: true }); }
});

test('les lots déjà indexés survivent à une interruption et sont repris sans refacturation', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'echappee-resume-'));
  try {
    let calls = 0;
    const index = new EmbeddingIndex({ cacheDir, model: 'test', client: { embed: async texts => {
      calls++; if (calls === 2) throw new Error('panne réseau'); return texts.map(() => [1,2]);
    } } });
    await assert.rejects(index.ensure(catalogue.slice(0,40)), /panne/);
    let remaining = 0;
    const restarted = new EmbeddingIndex({ cacheDir, model: 'test', client: { embed: async texts => { remaining += texts.length; return texts.map(() => [1,2]); } } });
    await restarted.ensure(catalogue.slice(0,40)); assert.equal(remaining, 8);
  } finally { await rm(cacheDir, { recursive: true, force: true }); }
});

test('le client REST utilise le schéma Mistral et trie les vecteurs selon leur index', async () => {
  const requests = [];
  const client = createMistral({ apiKey: 'test-only', fetchImpl: async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify(url.endsWith('/embeddings') ? { data: [{ index:1, embedding:[0,1] },{ index:0, embedding:[1,0] }] }
      : { choices:[{ finish_reason: 'stop', message: { content:'{"ok":true}' } }] }), { status:200 });
  } });
  const schema = { type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false };
  assert.deepEqual(await client.structured([{role:'user',content:'JSON'}], schema, 'test'), {ok:true});
  assert.deepEqual(requests[0].body.response_format.json_schema.schema, schema);
  assert.deepEqual(await client.embed(['a','b']), [[1,0],[0,1]]);
  assert.deepEqual(requests[1].body.input, ['a','b']);
});

test('les clés refusées et les réponses invalides ne divulguent pas la réponse fournisseur', async () => {
  const secret = 'test-only-never-print';
  const client = createMistral({ apiKey: secret, fetchImpl: async () => new Response(`secret=${secret}`, {status:401}) });
  await assert.rejects(client.embed(['x']), error => /Clé Mistral refusée/.test(error.message) && !error.message.includes(secret));
  const invalid = createMistral({ apiKey: 'test', fetchImpl: async () => new Response(JSON.stringify({ data:[{index:0,embedding:['invalid']}] }), {status:200}) });
  await assert.rejects(invalid.embed(['x']), /invalides/);
});
