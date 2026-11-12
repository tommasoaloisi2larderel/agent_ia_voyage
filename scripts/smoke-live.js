import assert from 'node:assert/strict';

// Test manuel et explicite : utilise réellement le quota de la clé configurée.
const base = process.env.APP_URL || 'http://127.0.0.1:3000';
const conversation = [];
const contexts = new WeakMap();
async function turn(text, history = conversation) {
  history.push({ role:'user', content:text });
  const response = await fetch(`${base}/api/chat`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:history,context:contexts.get(history)})});
  if (!response.ok) throw new Error((await response.json()).error);
  const events = (await response.text()).trim().split('\n').map(JSON.parse);
  const error = events.find(e=>e.type==='error'); if (error) throw new Error(error.message);
  assert(events.some(e=>e.type==='done'));
  const criteria = events.find(e=>e.type==='criteria').criteria;
  contexts.set(history,events.find(e=>e.type==='criteria').context);
  const results = events.find(e=>e.type==='results');
  const reply = events.find(e=>e.type==='reply').message;
  history.push({role:'assistant',content:reply});
  console.log(JSON.stringify({criteria, total:results.total, premiers:results.hotels.slice(0,3).map(h=>({nom:h.nom,pays:h.code_pays,plage:h.plage.type,prix:h.offre.prix_par_personne}))},null,2));
  return {criteria,results,reply};
}
try {
  const first = await turn('Une semaine en Grèce au départ de Lyon, 1 000 € maximum par personne. Un petit hôtel calme près d’une plage de sable, loin des grands complexes.');
  assert.deepEqual(first.criteria.pays,['GR']); assert.deepEqual(first.criteria.destinations,[]);
  assert.equal(first.criteria.pension,null); assert.equal(first.criteria.nuits,7); assert.equal(first.criteria.aeroport_depart,'LYS');
  assert.equal(first.criteria.budget_max_par_personne,1000);
  assert(first.results.hotels.length); assert.equal(first.results.hotels[0].plage.type,'sable');
  const corrected = await turn('Finalement, le Portugal plutôt que la Grèce. Je garde les mêmes envies et le départ de Lyon. Baisse mon budget à 850 € maximum par personne.');
  assert.deepEqual(corrected.criteria.pays,['PT']); assert.equal(corrected.criteria.nuits,7);
  assert.equal(corrected.criteria.budget_max_par_personne,850);
  assert(corrected.results.hotels.every(h=>h.code_pays==='PT'&&h.offre.prix_par_personne<=850));
  const impossible = await turn('Pour tester, baisse le budget à 1 € maximum par personne.');
  assert.equal(impossible.results.total,0); assert.equal(impossible.criteria.budget_max_par_personne,1); assert.equal(impossible.criteria.nuits,7); assert.equal(impossible.criteria.aeroport_depart,'LYS');
  const family = await turn('Nous sommes 2 adultes et 2 enfants. Une semaine à Djerba au départ de Marseille en tout compris. Budget total : 3500 euros. Départ le 10 août 2027.',[]);
  assert.equal(family.criteria.adultes,2); assert.equal(family.criteria.enfants,2);
  assert.equal(family.criteria.budget_total,3500); assert.equal(family.criteria.budget_max_par_personne,null);
  assert.equal(family.criteria.pension,'tout_compris'); assert.equal(family.criteria.date_depart,'2027-08-10');
  assert(family.results.hotels.length);
  assert(family.results.hotels.every(h=>!h.adultes_uniquement&&h.offre.prix_total<=3500&&h.offre.aeroport_depart==='MRS'));
  console.log('PASS : extraction réelle, recherche sémantique, corrections, budget impossible et séjour familial.');
} catch (error) { console.error(error.message); process.exitCode=1; }
