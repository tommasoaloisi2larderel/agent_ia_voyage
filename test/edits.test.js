import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEdit } from '../server/edits.js';
import { emptyCriteria, destinations, airports } from '../server/catalogue.js';
import { groundCriteria } from '../server/grounding.js';
import { runAgent } from '../server/agent.js';
import { describeEdit } from '../public/criteria-edit.js';

test('les formulaires appliquent exactement la valeur choisie sans effacer les autres critères',()=>{
  const previous={criteria:{...emptyCriteria(),pays:['GR'],nuits:7,aeroport_depart:'LYS',budget_max_par_personne:1000},citations:[{champ:'nuits',extrait:'Une semaine'},{champ:'aeroport_depart',extrait:'Lyon'},{champ:'budget_max_par_personne',extrait:'1000 euros par personne'},{champ:'pays',extrait:'Grèce'}]};
  const edit={group:'destination',values:{pays:['PT'],destinations:['algarve']}};
  const result=prepareEdit(edit,previous);
  assert.deepEqual(result.criteria.pays,['PT']);assert.deepEqual(result.criteria.destinations,['algarve']);
  assert.equal(result.criteria.nuits,7);assert.equal(result.criteria.aeroport_depart,'LYS');assert.equal(result.criteria.budget_max_par_personne,1000);
  assert.equal(result.content,describeEdit(edit,{destinations,airports}));
  const grounded=groundCriteria(result.criteria,result.citations,[{role:'user',content:'Une semaine de Lyon pour 1000 euros par personne en Grèce'},{role:'user',content:result.content}]);
  assert.deepEqual(grounded.destinations,['algarve']);assert.equal(grounded.budget_max_par_personne,1000);assert.equal(grounded.nuits,7);
});

test('un budget de groupe remplace le plafond par personne ; effacer une destination retire aussi son pays',()=>{
  const previous={criteria:{...emptyCriteria(),pays:['GR'],destinations:['crete'],budget_max_par_personne:1000},citations:[]};
  const budget=prepareEdit({group:'budget',values:{budget_total:3500,budget_max_par_personne:null}},previous);
  assert.equal(budget.criteria.budget_total,3500);assert.equal(budget.criteria.budget_max_par_personne,null);
  const cleared=prepareEdit({group:'destination',values:{pays:[],destinations:[]}},{criteria:budget.criteria,citations:budget.citations});
  assert.deepEqual(cleared.criteria.pays,[]);assert.deepEqual(cleared.criteria.destinations,[]);assert.equal(cleared.criteria.budget_total,3500);
});

test('les modifications mal formées, dates invalides et contradictions de voyageurs sont refusées',()=>{
  assert.throws(()=>prepareEdit({group:'constructor',values:{}}),/inconnu/);
  assert.throws(()=>prepareEdit({group:'budget',values:{budget_total:3000}}),/invalide/);
  assert.throws(()=>prepareEdit({group:'depart',values:{aeroport_depart:'LYS',nuits:7}}),/invalide/);
  assert.throws(()=>prepareEdit({group:'duree',values:{nuits:-2}}),/limites/);
  assert.throws(()=>prepareEdit({group:'dates',values:{date_depart:'2027-02-30',date_depart_fin:null}}),/Date/);
  assert.throws(()=>prepareEdit({group:'dates',values:{date_depart:'2027-08-15',date_depart_fin:'2027-08-10'}}),/période/);
  assert.throws(()=>prepareEdit({group:'voyageurs',values:{adultes:2,enfants:1}},{criteria:{...emptyCriteria(),adultes_uniquement:true},citations:[]}),/enfants/);
});

test('les envies saisies restent citées dans les messages et la synthèse correspond à leur texte',()=>{
  const result=prepareEdit({group:'envies',values:{preferences:['sans animation','plage de sable'],recherche_semantique:'sans animation, plage de sable'}});
  const grounded=groundCriteria(result.criteria,result.citations,[{role:'user',content:result.content}]);
  assert.deepEqual(grounded.preferences,['sans animation','plage de sable']);
  assert.throws(()=>prepareEdit({group:'envies',values:{preferences:['calme'],recherche_semantique:'fête'}}),/correspondent/);
});

test('un filtre direct recherche les offres sans appel au modèle d’extraction',async()=>{
  const prepared=prepareEdit({group:'destination',values:{pays:['PT'],destinations:['algarve']}});
  const events=[];
  await runAgent([{role:'user',content:prepared.content}],(type,data)=>events.push({type,...data}),undefined,{
    edit:prepared,client:{structured:()=>assert.fail('Un filtre direct ne nécessite pas d’extraction.'),embed:()=>assert.fail('Pas de préférence sémantique.')},
  });
  const results=events.find(e=>e.type==='results');
  assert(results.hotels.length>0);assert(results.hotels.every(h=>h.destination_id==='algarve'));
  assert.deepEqual(events.find(e=>e.type==='criteria').criteria.pays,['PT']);
  assert.equal(events.find(e=>e.type==='reply').message,'Votre sélection est à jour.');
});
