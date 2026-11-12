import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.js';
import { emptyCriteria } from '../server/catalogue.js';

test('HTTP : catalogue, absence de secrets, validation et diffusion progressive', async t => {
  let lastMessages, lastOptions;
  const app = createApp({ agent: async (messages, emit, signal, options) => {
    lastMessages=messages;lastOptions=options;
    emit('criteria', { criteria: emptyCriteria() }); emit('results', { hotels:[], total:0, semantic:false }); emit('reply',{message:'Précisez vos envies.'});
  } });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.close(resolve)));
  const base = `http://127.0.0.1:${app.address().port}`;
  const boot = await fetch(`${base}/api/bootstrap`); assert.equal(boot.status,200);
  const bootstrap = await boot.json(); assert.equal(bootstrap.hotels,300); assert.equal(bootstrap.destinations.length,20);
  assert(!('apiKey' in bootstrap)); assert(!JSON.stringify(bootstrap).includes('MISTRAL_API_KEY='));
  assert.match(boot.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(`${base}/.env`)).status,404);
  assert.equal((await fetch(`${base}/server/config.js`)).status,404);
  const listing = await (await fetch(`${base}/api/catalogue?destination=crete&type=boutique`)).json();
  assert.equal(listing.total,3); assert(listing.hotels.every(h=>h.destination_id==='crete'&&h.type==='boutique'));
  const jsonPost = body => ({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await fetch(`${base}/api/chat`,jsonPost({messages:[{role:'system',content:'bad'}]}))).status,400);
  assert.equal((await fetch(`${base}/api/chat`,{...jsonPost({messages:[]}),headers:{'content-type':'application/json',origin:'https://other.example'}})).status,403);
  const stream = await fetch(`${base}/api/chat`,jsonPost({messages:[{role:'user',content:'Bonjour'}]}));
  assert.equal(stream.status,200);
  assert.match(stream.headers.get('content-type'),/x-ndjson/);
  const events = (await stream.text()).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.map(e=>e.type),['criteria','results','reply','done']);
  const manual=await fetch(`${base}/api/chat`,jsonPost({messages:[{role:'user',content:'La saisie libre ne peut pas modifier les valeurs du formulaire.'}],edit:{group:'duree',values:{nuits:10}}}));
  assert.equal(manual.status,200);
  const manualEvents=(await manual.text()).trim().split('\n').map(JSON.parse);
  assert.equal(manualEvents[0].type,'user');assert.equal(manualEvents[0].message,'Durée : 10 nuits.');
  assert.equal(lastMessages.at(-1).content,'Durée : 10 nuits.');assert.equal(lastOptions.edit.criteria.nuits,10);
  const invalid=await fetch(`${base}/api/chat`,jsonPost({messages:[{role:'user',content:'test'}],edit:{group:'duree',values:{nuits:-4}}}));
  assert.equal(invalid.status,400);
});
