import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.js';
import { runAgent } from '../server/agent.js';
import { emptyCriteria } from '../server/catalogue.js';
import { validate, extractionSchema, contextSchema } from '../server/schema.js';

test('un contexte produit par plusieurs tours reste accepté au tour suivant', async t => {
  const firstMessage = 'Je voudrais partir pour un séjour en Tunisie pendant 7 nuits.';
  // Plusieurs citations distinctes du même champ sont autorisées par le modèle.
  const quotes = Array.from({length:10}, (_,i) => firstMessage.slice(i));
  const citations = ['pays','nuits'].flatMap(champ => quotes.map(extrait => ({champ,extrait})));
  const extractions = [
    {search_holidays:{...emptyCriteria(),pays:['TN'],nuits:7},changements:['pays','nuits'],citations,message:'Quel départ ?'},
    {search_holidays:{...emptyCriteria(),aeroport_depart:'NTE'},changements:['aeroport_depart'],citations:[{champ:'aeroport_depart',extrait:'Nantes'}],message:'Votre sélection est à jour.'},
    {search_holidays:emptyCriteria(),changements:[],citations:[],message:'Les critères sont conservés.'},
  ];
  for (const extraction of extractions) validate(extraction,extractionSchema);
  const client = {structured:async()=>{
    assert(extractions.length, 'Aucun nouvel appel modèle inattendu');
    return extractions.shift();
  }};
  const app = createApp({agent:(messages,emit,signal,options)=>runAgent(messages,emit,signal,{...options,client})});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>app.close(resolve)));
  const url = `http://127.0.0.1:${app.address().port}/api/chat`;
  const messages = [];
  let context;
  for (const content of [firstMessage,'Au départ de Nantes.','Que me recommandes-tu entre ces 3 produits ?']) {
    messages.push({role:'user',content});
    const response = await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages,context})});
    assert.equal(response.status,200);
    const events = (await response.text()).trim().split('\n').map(JSON.parse);
    assert(!events.some(e=>e.type==='error'));
    assert.equal(events.at(-1).type,'done');
    context = events.find(e=>e.type==='criteria').context;
    validate(context,contextSchema);
    messages.push({role:'assistant',content:events.find(e=>e.type==='reply').message});
  }
  assert(context.citations.length>extractionSchema.properties.citations.maxItems);
  assert.deepEqual(context.criteria.pays,['TN']);
  assert.equal(context.criteria.nuits,7);
  assert.equal(context.criteria.aeroport_depart,'NTE');
});

test('les limites et la structure du contexte restent contrôlées', () => {
  const context = {criteria:emptyCriteria(),citations:[]};
  assert.throws(()=>validate({...context,criteria:{...context.criteria,nuits:-1}},contextSchema),/limites/);
  assert.throws(()=>validate({...context,citations:[{champ:'invente',extrait:'test'}]},contextSchema),/inattendue/);
  assert.throws(()=>validate({...context,citations:Array.from({length:contextSchema.properties.citations.maxItems+1},()=>({champ:'pays',extrait:'Tunisie'}))},contextSchema),/longue/);
});
