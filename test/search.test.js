import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogue, destinations, emptyCriteria, filterOffers, cosine, embeddingText } from '../server/catalogue.js';
import { validateCriteria } from '../server/schema.js';
import { runAgent } from '../server/agent.js';

test('le catalogue couvre 20 destinations, cinq profils et 1 200 offres cohérentes', () => {
  assert.equal(catalogue.length, 300); assert.equal(destinations.length, 20);
  assert.equal(new Set(catalogue.map(h => h.id)).size, 300);
  assert.equal(catalogue.reduce((n,h) => n + h.offres.length, 0), 1200);
  for (const d of destinations) {
    const hotels = catalogue.filter(h => h.destination_id === d.id);
    assert.equal(hotels.length, 15); assert.equal(new Set(hotels.map(h => h.type)).size, 5);
  }
  for (const h of catalogue) {
    assert.equal(h.fictif, true);
    if (h.destination_id === 'marrakech') assert.equal(h.plage.type, 'aucune');
    if (h.plage.type === 'galets') assert.match(h.plage.description, /pas de sable/);
    if (h.type === 'spa') assert.equal(h.adultes_uniquement, true);
    for (const o of h.offres) {
      if (h.adultes_uniquement) assert.equal(o.prix_par_enfant,null);
      else assert(o.prix_par_personne > o.prix_par_enfant);
      assert(o.aeroports.includes('LYS'));
    }
  }
});

test('les filtres exacts et les exclusions éliminent les offres incompatibles', () => {
  const criteria = { ...emptyCriteria(), pays: ['GR'], aeroport_depart: 'LYS', nuits: 7, budget_max_par_personne: 1000, types_exclus: ['club'] };
  const results = filterOffers(catalogue, criteria);
  assert(results.length > 0);
  for (const h of results) {
    assert.equal(h.code_pays, 'GR'); assert.notEqual(h.type, 'club');
    assert.equal(h.offre.nuits, 7); assert(h.offre.aeroports.includes('LYS'));
    assert(h.offre.prix_par_personne <= 1000); assert(h.offre.disponible);
  }
  assert.equal(filterOffers(catalogue, { ...criteria, budget_max_par_personne: 1 }).length, 0);
  assert.equal(filterOffers(catalogue, { ...criteria, aeroport_depart: 'JFK' }).length, 0);
  assert.equal(filterOffers(catalogue, { ...criteria, destinations: ['madrid'] }).length, 0);
  assert.equal(filterOffers(catalogue, { ...criteria, nuits: 8 }).length, 0);
});

test('le budget familial est calculé avec le tarif enfant et les adultes seuls sont exclus', () => {
  const criteria = { ...emptyCriteria(), adultes: 2, enfants: 2, budget_total: 3500, nuits: 7 };
  const results = filterOffers(catalogue, criteria);
  assert(results.length > 0);
  for (const h of results) {
    assert.equal(h.adultes_uniquement, false);
    assert.equal(h.offre.prix_total, h.offre.prix_par_personne * 2 + h.offre.prix_par_enfant * 2);
    assert(h.offre.prix_total <= 3500);
  }
  assert.equal(filterOffers(catalogue, { ...criteria, adultes: null }).length, 0);
  assert.equal(filterOffers(catalogue, { ...criteria, enfants: null }).length, 0);
  assert.equal(filterOffers(catalogue, { ...emptyCriteria(), adultes: 20 }).length, 0);
});

test('les dates et la durée du séjour entier respectent les périodes simulées', () => {
  assert.equal(filterOffers(catalogue, { ...emptyCriteria(), nuits: 7, date_depart: '2026-12-20' }).length, 0);
  assert.equal(filterOffers(catalogue, { ...emptyCriteria(), nuits: 7, date_depart: '2027-12-29' }).length, 0);
  const results = filterOffers(catalogue, { ...emptyCriteria(), nuits: 7, date_depart: '2026-12-20', date_depart_fin: '2027-01-15' });
  assert(results.length > 0);
  assert(results.every(h => h.offre.date_depart === '2027-01-01'));
  assert.throws(() => validateCriteria({ ...emptyCriteria(), date_depart: '2027-02-30' }), /Date/);
  assert.throws(() => validateCriteria({ ...emptyCriteria(), date_depart: '2027-03-20', date_depart_fin: '2027-03-01' }), /période/);
});

test('les réponses modèle incohérentes ou hors schéma sont refusées', () => {
  assert.throws(() => validateCriteria({ ...emptyCriteria(), nuits: -2 }), /limites/);
  assert.throws(() => validateCriteria({ ...emptyCriteria(), enfants: 2, adultes_uniquement: true }), /enfants/);
  assert.throws(() => validateCriteria({ ...emptyCriteria(), injection: 'x' }), /inattendu/);
});

test('cosinus : proximité sémantique, pas un pourcentage de correspondance', () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1, 0], [-1, 0]), -1);
  assert.throws(() => cosine([1], [1, 2]), /Dimensions/);
  assert.match(embeddingText(catalogue[0]), /intimiste/);
});

test('les critères sont diffusés avant les embeddings, les preuves restent des passages exacts', async () => {
  const criteria = { ...emptyCriteria(), pays: ['GR'], nuits: 7, budget_max_par_personne: 1000, recherche_semantique: 'Petit hôtel calme près du sable', preferences:['petit hôtel calme'], types_exclus: ['club'] };
  const events = []; let call = 0;
  const client = {
    structured: async () => ++call === 1 ? { search_holidays: criteria, citations: [
      {champ:'pays', extrait:'Grèce'}, {champ:'nuits', extrait:'7 nuits'}, {champ:'budget_max_par_personne', extrait:'1000 € par personne'}, {champ:'types_exclus', extrait:'sans club'},
    ], message: 'Quel aéroport de départ ?' }
      : { selections: [{ hotel_id: 'hotel-001', sources: ['plage', 'ambiance'] }] },
    embed: async () => [[1, 0]],
  };
  const index = { ensure: async (_, progress) => { assert(events.some(e => e.type === 'criteria')); progress(300,300); }, vector: h => h.type === 'boutique' ? [1,0] : [0,1] };
  await runAgent([{ role: 'user', content: 'Grèce, 7 nuits, 1000 € par personne, sans club. Un petit hôtel calme.' }], (type, data) => events.push({ type, ...data }), undefined, { client, index });
  assert(events.findIndex(e => e.type === 'criteria') < events.findIndex(e => e.phase === 'semantique'));
  const results = events.find(e => e.type === 'results');
  assert.equal(results.semantic, true); assert.equal(results.hotels[0].type, 'boutique');
  for (const h of results.hotels) {
    assert(h.offre.prix_par_personne <= 1000);
    for (const proof of h.preuves) assert(h.sources.some(s => s.id === proof.id && s.texte === proof.texte));
  }
});

test('zéro résultat ne relâche jamais les critères et ne paie pas des embeddings inutiles', async () => {
  const events = [];
  const client = { structured: async () => ({ search_holidays: { ...emptyCriteria(), budget_max_par_personne: 1 }, citations:[{champ:'budget_max_par_personne',extrait:'1 euro par personne'}], message: '' }), embed: () => assert.fail('Pas d’embeddings nécessaires') };
  await runAgent([{ role: 'user', content: '1 euro par personne' }], (type, data) => events.push({ type, ...data }), undefined, { client });
  assert.deepEqual(events.find(e => e.type === 'results').hotels, []);
  assert.equal(events.find(e => e.type === 'criteria').criteria.budget_max_par_personne, 1);
});

test('un changement de budget conserve la durée et le départ du contexte précédent', async () => {
  const previous = {
    criteria:{...emptyCriteria(),nuits:7,aeroport_depart:'LYS',budget_max_par_personne:1000},
    citations:[{champ:'nuits',extrait:'Une semaine'},{champ:'aeroport_depart',extrait:'Lyon'},{champ:'budget_max_par_personne',extrait:'1000 euros par personne'}],
  };
  const client = { structured:async()=>({search_holidays:{...emptyCriteria(),budget_max_par_personne:1},changements:['budget_max_par_personne'],citations:[{champ:'budget_max_par_personne',extrait:'1 euro par personne'}],message:''}) };
  const events = [];
  await runAgent([{role:'user',content:'Une semaine de Lyon pour 1000 euros par personne'},{role:'assistant',content:'D’accord'},{role:'user',content:'Baisse à 1 euro par personne'}],(type,data)=>events.push({type,...data}),undefined,{client,previous});
  const c = events.find(e=>e.type==='criteria').criteria;
  assert.equal(c.nuits,7); assert.equal(c.aeroport_depart,'LYS'); assert.equal(c.budget_max_par_personne,1);
});
