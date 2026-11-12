import test from 'node:test';
import assert from 'node:assert/strict';
import { groundCriteria } from '../server/grounding.js';
import { emptyCriteria } from '../server/catalogue.js';

test('un petit hôtel ne devient pas un petit déjeuner et un pays ne sélectionne pas toutes ses îles', () => {
  const c = groundCriteria({ ...emptyCriteria(), pays:['GR'], destinations:['crete','corfou','kos'], pension:'petit_dejeuner' }, [
    {champ:'pays',extrait:'Grèce'}, {champ:'destinations',extrait:'Grèce'}, {champ:'pension',extrait:'petit hôtel'},
  ], [{role:'user',content:'Un petit hôtel en Grèce'}]);
  assert.deepEqual(c.pays,['GR']); assert.deepEqual(c.destinations,[]); assert.equal(c.pension,null);
});

test('les critères sans citation réelle sont effacés, les citations assistant sont ignorées', () => {
  const c = groundCriteria({ ...emptyCriteria(), etoiles_min:5, adultes:2, budget_max_par_personne:1000 }, [
    {champ:'etoiles_min',extrait:'5 étoiles'}, {champ:'budget_max_par_personne',extrait:'Budget 1000 euros'},
  ], [{role:'user',content:'Budget 1000 euros'}, {role:'assistant',content:'5 étoiles ?'}]);
  assert.equal(c.etoiles_min,null); assert.equal(c.adultes,null); assert.equal(c.budget_max_par_personne,null);
});

test('une destination explicite et un tout compris cité sont conservés', () => {
  const c = groundCriteria({ ...emptyCriteria(), destinations:['crete'], pension:'tout_compris' }, [
    {champ:'destinations',extrait:'Crète'}, {champ:'pension',extrait:'tout compris'},
  ], [{role:'user',content:'La Crète en tout compris'}]);
  assert.deepEqual(c.destinations,['crete']); assert.deepEqual(c.pays,['GR']); assert.equal(c.pension,'tout_compris');
});

test('les envies inventées sont retirées de la synthèse et les mots du client sont conservés', () => {
  const c = groundCriteria({...emptyCriteria(),preferences:['calme','sans animation','plage de sable'],recherche_semantique:'Calme près du sable'},[],[{role:'user',content:'Un hôtel sans animation.'}]);
  assert.deepEqual(c.preferences,['sans animation']); assert.equal(c.recherche_semantique,'sans animation');
});
