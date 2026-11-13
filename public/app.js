import { editGroups, describeEdit } from './criteria-edit.js';

const $ = selector => document.querySelector(selector);
const types = { boutique: 'Boutique & intimiste', famille: 'En famille', club: 'Club & animé', nature: 'Nature & randonnée', spa: 'Spa & adultes' };
const pensions = { petit_dejeuner: 'Petit déjeuner', demi_pension: 'Demi-pension', tout_compris: 'Tout compris' };
const euro = value => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
const date = value => value ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)) : '';
const state = { bootstrap: null, criteria: null, context: null, messages: [], expanded: false, editing: null, failedEdit: null, busy: false, controller: null, lastFailed: false, cataloguePage: 0, catalogueTotal: 0, catalogueController: null };
const hotelsById = new Map();
let composerMotion = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function showError(message, retry = true) {
  $('#error-text').textContent = message;
  $('#error').hidden = false;
  $('#retry').hidden = !retry;
}
function hideError() { $('#error').hidden = true; }
function setBusy(busy) {
  state.busy = busy;
  $('#send').disabled = busy;
  $('#prompt').disabled = busy;
  $('#activity').hidden = !busy;
  $('#search-form').setAttribute('aria-busy', String(busy));
  $('#results-section').setAttribute('aria-busy', String(busy));
  document.querySelectorAll('[data-prompt], .detail-search, .criterion, #edit-envies').forEach(button => { button.disabled = busy; });
}

function syncComposerDock() {
  if (!state.messages.length) return;
  $('#prompt').placeholder = window.innerWidth <= 700 ? 'Précisez vos envies…' : 'Affinez votre séjour ou répondez à FRAM…';
  const rect = $('.main-inner').getBoundingClientRect();
  const styles = document.documentElement.style;
  styles.setProperty('--composer-left', `${rect.left}px`);
  styles.setProperty('--composer-width', `${rect.width}px`);
  styles.setProperty('--composer-space', `${$('#composer-dock').offsetHeight + 24}px`);
  const viewport = window.visualViewport;
  styles.setProperty('--keyboard-inset', `${viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0}px`);
}
new ResizeObserver(() => requestAnimationFrame(syncComposerDock)).observe($('#main'));
new ResizeObserver(() => requestAnimationFrame(syncComposerDock)).observe($('#composer-dock'));
window.addEventListener('resize', syncComposerDock);
window.visualViewport?.addEventListener('resize', syncComposerDock);
window.visualViewport?.addEventListener('scroll', syncComposerDock);

function lowerComposer(from) {
  if (!from || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  composerMotion?.cancel();
  const form = $('#search-form');
  const to = form.getBoundingClientRect();
  composerMotion = form.animate([
    {transform:`translate(${from.left-to.left}px, ${from.top-to.top}px)`},
    {transform:'translate(0, 0)'},
  ], {duration:1100, delay:100, easing:'cubic-bezier(.3,0,.2,1)', fill:'backwards'});
  return composerMotion.finished.catch(() => {});
}
function openDialog(selector) {
  const dialog = $(selector);
  if (!dialog.open) dialog.showModal();
}
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }
}));

function renderCriteria(c) {
  const prior = state.criteria;
  state.criteria = c;
  const destinations = c.destinations.map(id => state.bootstrap.destinations.find(d => d.id === id)?.nom || id);
  const countries = c.pays.map(code => {
    try { return new Intl.DisplayNames(['fr'], { type: 'region' }).of(code); } catch { return code; }
  });
  const location = destinations.length ? destinations.join(' ou ') : countries.join(' ou ');
  const budget = [c.budget_max_par_personne ? `${euro(c.budget_max_par_personne)} max / personne` : '', c.budget_total ? `${euro(c.budget_total)} max au total` : ''].filter(Boolean).join('\n');
  const party = c.adultes != null || c.enfants != null ? `${c.adultes ?? '?'} adulte${c.adultes > 1 ? 's' : ''} · ${c.enfants ?? '?'} enfant${c.enfants > 1 ? 's' : ''}` : '';
  const dates = c.date_depart ? `${date(c.date_depart)}${c.date_depart_fin && c.date_depart_fin !== c.date_depart ? ` → ${date(c.date_depart_fin)}` : ''}` : '';
  const rows = [
    ['⌖', 'Destination', location, ['pays', 'destinations'], 'destination'],
    ['↗', 'Départ', c.aeroport_depart ? `${state.bootstrap.airports[c.aeroport_depart] || c.aeroport_depart} (${c.aeroport_depart})` : '', ['aeroport_depart'], 'depart'],
    ['☾', 'Durée', c.nuits ? `${c.nuits} nuits` : '', ['nuits'], 'duree'],
    ['€', 'Budget', budget, ['budget_max_par_personne', 'budget_total'], 'budget'],
    ['▦', 'Dates', dates, ['date_depart', 'date_depart_fin'], 'dates'],
    ['♧', 'Voyageurs', party, ['adultes', 'enfants'], 'voyageurs'],
  ];
  rows.push(['◇', 'Options', [
    c.pension ? pensions[c.pension] : '', c.etoiles_min ? `${c.etoiles_min} étoiles minimum` : '',
    c.adultes_uniquement ? 'Établissement réservé aux adultes' : '',
    ...c.types_exclus.map(t => `Sans hôtel ${types[t]?.toLowerCase() || t}`),
  ].filter(Boolean).join('\n'), ['pension', 'etoiles_min', 'adultes_uniquement', 'types_exclus'], 'options']);
  const fragment = document.createDocumentFragment();
  for (const [icon, label, value, keys, group] of rows) {
    const changed = prior && keys.some(key => JSON.stringify(prior[key]) !== JSON.stringify(c[key]));
    const row = el('button', `criterion${changed ? ' updated' : ''}`);
    row.type = 'button'; row.disabled = state.busy; row.dataset.criterion = group;
    row.setAttribute('aria-label', `Modifier ${label.toLowerCase()}${value ? ` : ${value}` : ''}`);
    row.setAttribute('aria-haspopup', 'dialog'); row.addEventListener('click', () => openEditor(group));
    const symbol = el('span', 'criterion-icon', icon); symbol.setAttribute('aria-hidden', 'true');
    row.append(symbol);
    const content = el('span', 'criterion-content'); content.append(el('span', 'criterion-label', label), el('span', `criterion-value${value ? '' : ' unknown'}`, value || 'Choisir'));
    const editIcon = el('span','criterion-edit', value ? '↗' : '+'); editIcon.setAttribute('aria-hidden','true');
    row.append(content, editIcon); fragment.append(row);
  }
  $('#criteria-list').replaceChildren(fragment);
  $('#preferences').replaceChildren(...c.preferences.map(p => el('span', 'preference', p)));
  $('#criteria-json').textContent = JSON.stringify(c, null, 2);
}

function createCard(hotel, { sources = false, rank = null } = {}) {
  hotelsById.set(hotel.id, hotel);
  const card = el('article', 'hotel-card');
  const imageWrap = el('div', 'image-wrap');
  const image = el('img', 'hotel-image'); image.src = `/assets/${hotel.scene}.svg`; image.alt = `Illustration de paysage, ne représente pas l’hôtel ${hotel.nom}`; image.loading = 'lazy'; image.width = 640; image.height = 400;
  imageWrap.append(image, el('span', 'card-type', types[hotel.type]));
  const body = el('div', 'card-body');
  const location = el('div', 'card-location');
  const stars = el('span', 'stars', '★'.repeat(hotel.etoiles)); stars.setAttribute('aria-label', `${hotel.etoiles} étoiles simulées`);
  location.append(el('span', '', `${hotel.destination}, ${hotel.pays}`), stars);
  body.append(location, el('h3', '', hotel.nom));
  const beach = hotel.plage.type === 'aucune' ? 'Destination intérieure · Sans plage' : hotel.plage.distance_metres === 0 ? 'Accès direct à la plage' : `Plage à ${hotel.plage.distance_metres.toLocaleString('fr-FR')} m`;
  body.append(el('p', 'card-facts', `${hotel.offre.nuits} nuits · ${pensions[hotel.offre.pension]}\n${beach}`));
  const priceRow = el('div', 'card-price');
  const priceText = el('div'); const price = el('span', 'price', euro(hotel.offre.prix_par_personne)); price.append(el('small', '', '/ pers.'));
  priceText.append(price);
  const detailButton = el('button', 'card-open', '↗'); detailButton.type = 'button'; detailButton.setAttribute('aria-label', `Voir la fiche de ${hotel.nom}`); detailButton.addEventListener('click', () => openHotel(hotel));
  priceRow.append(priceText, detailButton); body.append(priceRow);
  if (sources && hotel.preuves?.length) {
    const toggle = el('button', 'source-toggle', 'Pourquoi ce séjour ? +'); toggle.type = 'button'; toggle.setAttribute('aria-expanded', 'false');
    const sourceList = el('ul', 'card-sources'); sourceList.hidden = true;
    sourceList.id = `sources-${hotel.id}`; toggle.setAttribute('aria-controls', sourceList.id);
    hotel.preuves.forEach(source => sourceList.append(el('li', '', source.texte)));
    toggle.addEventListener('click', () => {
      sourceList.hidden = !sourceList.hidden;
      toggle.setAttribute('aria-expanded', String(!sourceList.hidden));
      toggle.textContent = sourceList.hidden ? 'Pourquoi ce séjour ? +' : 'Extraits de la fiche −';
    });
    body.append(toggle, sourceList);
  }
  card.append(imageWrap, body); return card;
}

function renderResults(hotels, { total = 300, semantic = false, preview = false } = {}) {
  $('#results-section').hidden = false;
  $('#results-section').classList.remove('is-loading', 'is-updated');
  $('#results-section').setAttribute('aria-busy', 'false');
  $('#results-update').hidden = true;
  $('#results').replaceChildren(...hotels.map((h, i) => createCard(h, { sources: !preview, rank: !preview ? i + 1 : null })));
  $('#empty-results').hidden = hotels.length > 0;
  $('#results-title').textContent = preview ? 'Quelques idées pour partir' : hotels.length ? 'Votre sélection' : 'Aucun séjour pour le moment';
  $('#results-count').textContent = preview ? '20 destinations' : `${total} séjour${total > 1 ? 's' : ''}`;
}

function showSearchLoading() {
  $('#results-section').hidden = false;
  $('#results-section').classList.remove('is-updated');
  $('#results-section').classList.add('is-loading');
  $('#results-update').hidden = true;
  $('#results-title').textContent = 'Votre prochaine sélection';
  $('#results-count').textContent = 'Recherche en cours…';
  $('#empty-results').hidden = true;
  $('#results').replaceChildren(...Array.from({length:3}, () => {
    const card = el('div','hotel-skeleton'); card.setAttribute('aria-hidden','true');
    card.append(el('div','skeleton-image'),el('div','skeleton-line'),el('div','skeleton-line short'),el('div','skeleton-price')); return card;
  }));
}

function renderConversation() {
  const lastUser = state.messages.findLastIndex(m => m.role === 'user');
  $('#conversation-wrap').hidden = !state.messages.length;
  $('#conversation-toggle').hidden = lastUser < 1;
  $('#conversation-toggle').setAttribute('aria-expanded', String(state.expanded));
  $('#conversation-toggle').replaceChildren(document.createTextNode(state.expanded ? 'Réduire la conversation ' : 'Étendre la conversation '),el('span','',state.expanded ? '⌃' : '⌄'));
  $('#conversation').classList.toggle('expanded', state.expanded);
  $('#conversation').replaceChildren(...state.messages.map((m,i) => {
    const node = el('article', `message ${m.role}${i === state.messages.length - 1 ? ' latest' : ''}`);
    node.append(el('p','message-text',m.content));
    node.setAttribute('aria-label', m.role === 'user' ? 'Vous' : 'FRAM');
    node.hidden = !state.expanded && i < (lastUser === -1 ? state.messages.length - 1 : lastUser);
    return node;
  }));
  document.body.classList.toggle('chat-active', state.messages.length > 0);
  $('#prompt').placeholder = state.messages.length ? 'Affinez votre séjour ou répondez à FRAM…' : 'Une semaine au soleil, un petit hôtel au calme…';
  syncComposerDock();
}
$('#conversation-toggle').addEventListener('click', () => {state.expanded = !state.expanded; renderConversation();});

const editorTitles = {destination:'Destination',depart:'Aéroport de départ',duree:'Durée du séjour',budget:'Votre budget',dates:'Dates de départ',voyageurs:'Les voyageurs',options:'Options du séjour',envies:'Vos envies'};
function input(name, type, value, options = {}) {
  const control = el('input'); control.type = type; control.name = name; control.id = `edit-${name}`;
  control.value = value ?? '';
  Object.assign(control, options); return control;
}
function select(name, choices, value) {
  const control = el('select'); control.name = name; control.id = `edit-${name}`;
  control.append(...choices.map(([id,label]) => new Option(label,id))); control.value = value ?? ''; return control;
}
function field(label, control) {
  const wrapper = el('label','editor-field'); wrapper.htmlFor = control.id;
  wrapper.append(el('span','',label),control); return wrapper;
}
function checkbox(name, label, checked, value = 'on') {
  const wrapper = el('label','editor-check');
  const control = input(name,'checkbox',''); control.value = value; control.checked = checked;
  // Grouped checkboxes have distinct ids, while sharing the form name.
  control.id = `edit-${name}-${value}`; wrapper.htmlFor = control.id;
  wrapper.append(control,document.createTextNode(label)); return wrapper;
}
function openEditor(group) {
  if (state.busy || !state.bootstrap) return;
  state.editing = group;
  const c = state.criteria;
  $('#criterion-title').textContent = editorTitles[group];
  $('#criterion-error').hidden = true;
  const container = $('#criterion-fields'); container.replaceChildren();
  switch (group) {
    case 'destination': {
      const control = select('destination',[['','Peu importe']], '');
      const countries = [...new Map(state.bootstrap.destinations.map(d=>[d.code_pays,d.pays])).entries()];
      for (const [code,country] of countries) {
        const groupNode = el('optgroup'); groupNode.label = country;
        groupNode.append(new Option(`Tout le pays · ${country}`,`pays:${code}`));
        for (const d of state.bootstrap.destinations.filter(d=>d.code_pays===code)) groupNode.append(new Option(d.nom,`destination:${d.id}`));
        control.append(groupNode);
      }
      const selected = c.destinations.length === 1 ? `destination:${c.destinations[0]}` : c.pays.length === 1 ? `pays:${c.pays[0]}` : '';
      control.value = selected;
      if (c.destinations.length > 1 || c.pays.length > 1 || control.value !== selected) {
        const current = new Option('Conserver les destinations actuelles','actuel'); control.append(current); control.value='actuel';
      }
      container.append(field('Pays ou destination',control)); break;
    }
    case 'depart':
      container.append(field('Aéroport',select('aeroport_depart',[['','Peu importe'],...Object.entries(state.bootstrap.airports).map(([id,nom])=>[id,`${nom} (${id})`]),...(c.aeroport_depart&&!state.bootstrap.airports[c.aeroport_depart]?[[c.aeroport_depart,c.aeroport_depart]]:[])],c.aeroport_depart))); break;
    case 'duree': {
      const control = input('nuits','number',c.nuits,{min:'1',max:'60',step:'1',placeholder:'Nombre de nuits'});
      container.append(field('Nuits',control));
      const choices = el('div','quick-durations');
      for(const nights of [5,7,10,14]) {const button=el('button','',`${nights} nuits`);button.type='button';button.addEventListener('click',()=>{control.value=nights;});choices.append(button);}
      container.append(choices); break;
    }
    case 'budget':
      container.append(field('Montant maximum (€)',input('montant','number',c.budget_max_par_personne??c.budget_total,{min:'1',max:'1000000',step:'1',placeholder:'Ex. 1 000'})),field('Pour',select('budget_type',[['personne','Par personne'],['total','Tout le groupe']],c.budget_total?'total':'personne'))); break;
    case 'dates': {
      const pair = el('div','editor-pair');
      pair.append(field('À partir du',input('date_depart','date',c.date_depart,{min:'2027-01-01',max:'2027-12-31'})),field('Jusqu’au (facultatif)',input('date_depart_fin','date',c.date_depart_fin,{min:'2027-01-01',max:'2027-12-31'})));
      container.append(pair,el('p','editor-hint','Les offres de démonstration couvrent 2027.')); break;
    }
    case 'voyageurs': {
      const pair = el('div','editor-pair');
      pair.append(field('Adultes',input('adultes','number',c.adultes,{min:'1',max:'20',step:'1',placeholder:'À préciser'})),field('Enfants',input('enfants','number',c.enfants,{min:'0',max:'20',step:'1',placeholder:'À préciser'}))); container.append(pair); break;
    }
    case 'options': {
      container.append(field('Pension',select('pension',[['','Peu importe'],...Object.entries(pensions)],c.pension)),field('Catégorie minimum',select('etoiles_min',[['','Peu importe'],...[1,2,3,4,5].map(n=>[String(n),`${n} étoile${n>1?'s':''}`])],c.etoiles_min?String(c.etoiles_min):'')),checkbox('adultes_uniquement','Établissement réservé aux adultes',c.adultes_uniquement===true));
      const exclusions = el('fieldset','editor-checks'); exclusions.append(el('legend','','Profils à exclure'));
      for (const [id,label] of Object.entries(types)) exclusions.append(checkbox('types_exclus',label,c.types_exclus.includes(id),id));
      container.append(exclusions); break;
    }
    case 'envies': {
      const textarea = el('textarea'); textarea.id='edit-envies-text';textarea.name='envies';textarea.maxLength=1200;textarea.rows=3;textarea.value=c.preferences.join('; ');textarea.placeholder='Au calme ; plage de sable ; sans animation';
      container.append(field('Ambiance, plage, activités…',textarea),el('p','editor-hint','Séparez vos envies par un point-virgule.')); break;
    }
  }
  openDialog('#criterion-dialog');
  container.querySelector('select, input:not([type="checkbox"]), textarea')?.focus();
}
$('#edit-envies').addEventListener('click',()=>openEditor('envies'));

function editorValues() {
  const data = new FormData($('#criterion-form'));
  const number = key => data.get(key)?.trim() ? Number(data.get(key)) : null;
  switch (state.editing) {
    case 'destination': {
      const value = data.get('destination');
      if(value==='actuel')return {pays:state.criteria.pays,destinations:state.criteria.destinations};
      const [kind,id]=value.split(':');
      const destination=state.bootstrap.destinations.find(d=>d.id===id);
      return {pays:kind==='pays'?[id]:destination?[destination.code_pays]:[],destinations:destination?[destination.id]:[]};
    }
    case 'depart': return {aeroport_depart:data.get('aeroport_depart')||null};
    case 'duree': return {nuits:number('nuits')};
    case 'budget': {const amount=number('montant');return {budget_max_par_personne:data.get('budget_type')==='personne'?amount:null,budget_total:data.get('budget_type')==='total'?amount:null};}
    case 'dates': return {date_depart:data.get('date_depart')||null,date_depart_fin:data.get('date_depart_fin')||null};
    case 'voyageurs': return {adultes:number('adultes'),enfants:number('enfants')};
    case 'options': return {pension:data.get('pension')||null,etoiles_min:number('etoiles_min'),adultes_uniquement:data.has('adultes_uniquement')?true:null,types_exclus:data.getAll('types_exclus')};
    case 'envies': {const preferences=data.get('envies').split(/;|\n/).map(s=>s.trim()).filter(Boolean);return {preferences,recherche_semantique:preferences.join(', ')};}
  }
}
function applyEditor(values) {
  if(state.busy)return;
  let error = '';
  if(values.date_depart_fin&&(!values.date_depart||values.date_depart_fin<values.date_depart))error='Choisissez une période de départ valide.';
  if(values.preferences&&(values.preferences.length>12||values.preferences.some(p=>p.length>100)))error='Utilisez jusqu’à 12 envies de 100 caractères maximum chacune.';
  const merged={...state.criteria,...values};
  if(merged.adultes_uniquement&&merged.enfants>0)error='Un établissement réservé aux adultes ne peut pas accueillir d’enfants.';
  if(error){$('#criterion-error').textContent=error;$('#criterion-error').hidden=false;return;}
  $('#criterion-dialog').close();
  const changed=Object.keys(values).some(k=>JSON.stringify(values[k])!==JSON.stringify(state.criteria[k]));
  if(changed)sendMessage({edit:{group:state.editing,values}});
}
$('#criterion-form').addEventListener('submit',event=>{event.preventDefault();applyEditor(editorValues());});
$('#criterion-clear').addEventListener('click',()=>applyEditor(Object.fromEntries(editGroups[state.editing].map(key=>[key,structuredClone(state.bootstrap.criteria[key])]))));

async function sendMessage({ retry = false, edit = null } = {}) {
  if (state.busy || !state.bootstrap) return;
  if (!state.bootstrap.configured) { openDialog('#config-dialog'); return; }
  if (retry) edit = state.failedEdit;
  const content = edit ? describeEdit(edit, state.bootstrap) : $('#prompt').value.trim();
  if (!retry && !content) return;
  if (!retry && state.messages.length >= 79) { showError('Cette conversation est longue. Lancez une nouvelle recherche pour continuer.', false); return; }
  const composerFrom = state.messages.length ? null : $('#search-form').getBoundingClientRect();
  if (!retry) {
    state.messages.push({ role: 'user', content }); state.expanded = false; renderConversation();
    if (!edit) { $('#prompt').value = ''; $('#prompt').style.height = ''; }
  }
  state.failedEdit = edit;
  state.lastFailed = false; hideError(); setBusy(true);
  $('#activity-label').textContent = 'Recherche…';
  showSearchLoading();
  syncComposerDock();
  const lowering = lowerComposer(composerFrom);
  const controller = new AbortController(); state.controller = controller;
  let done = false;
  let nextResults = null, nextReply = null;
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: state.messages, context: state.context, edit }), signal: controller.signal });
    if (!response.ok) { const body = await response.json(); throw new Error(body.error || 'La recherche a échoué.'); }
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    function receive(line) {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (event.type === 'user') {state.messages.at(-1).content = event.message; renderConversation();}
      if (event.type === 'status') $('#activity-label').textContent = event.message;
      if (event.type === 'criteria') { renderCriteria(event.criteria); state.context = event.context; }
      if (event.type === 'results') nextResults = event;
      if (event.type === 'reply') nextReply = event.message;
      if (event.type === 'done') done = true;
      if (event.type === 'error') throw new Error(event.message);
    }
    while (true) {
      const { value, done: finished } = await reader.read();
      buffer += finished ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); receive(line); }
      if (finished) { if (buffer.trim()) receive(buffer); break; }
    }
    if (!done) throw new Error('La connexion a été interrompue avant la fin de la recherche. Réessayez.');
    if (!nextResults || !nextReply) throw new Error('La sélection est incomplète. Réessayez votre recherche.');
    if (lowering) await lowering;
    if (state.controller !== controller) return;
    controller.signal.throwIfAborted();
    renderResults(nextResults.hotels, nextResults);
    state.messages.push({ role: 'assistant', content: nextReply }); renderConversation();
    $('#results-update').hidden = false;
    $('#results-section').classList.add('is-updated');
    const exchangeTop = $('#conversation-wrap').getBoundingClientRect().top;
    if (!document.querySelector('dialog[open]') && (exchangeTop < $('.topbar').getBoundingClientRect().bottom || exchangeTop > window.innerHeight * .45)) $('#conversation-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    if (state.controller !== controller) return;
    state.lastFailed = true;
    $('#results-section').hidden = true;
    showError(controller.signal.aborted ? 'Recherche arrêtée. Vous pouvez réessayer ou ajouter une précision.' : error.message);
  } finally {
    if (state.controller === controller) { state.controller = null; setBusy(false); syncComposerDock(); }
  }
}

$('#search-form').addEventListener('submit', event => { event.preventDefault(); sendMessage(); });
$('#prompt').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendMessage(); } });
$('#prompt').addEventListener('input', () => { $('#prompt').style.height = 'auto'; $('#prompt').style.height = Math.min(180, $('#prompt').scrollHeight) + 'px'; });
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => { $('#prompt').value = button.dataset.prompt; $('#prompt').dispatchEvent(new Event('input')); $('#prompt').focus(); }));
$('#retry').addEventListener('click', () => { if (state.lastFailed) sendMessage({ retry: true }); else bootstrap(); });
$('#cancel-search').addEventListener('click', () => state.controller?.abort());
$('#config-open').addEventListener('click', () => openDialog('#config-dialog'));
$('#setup-help').addEventListener('click', () => openDialog('#config-dialog'));
$('#reset').addEventListener('click', () => {
  composerMotion?.cancel(); composerMotion = null;
  state.controller?.abort(); state.controller = null; state.messages = []; state.context = null; state.lastFailed = false; state.failedEdit = null; state.expanded = false;
  setBusy(false); hideError(); $('#conversation').replaceChildren(); $('#prompt').value = ''; $('#prompt').style.height = '';
  renderConversation();
  if (state.bootstrap) { renderCriteria(state.bootstrap.criteria); renderResults(state.bootstrap.apercu, { preview: true }); }
  window.scrollTo({ top: 0, behavior: 'smooth' }); $('#prompt').focus({ preventScroll: true });
});

async function openHotel(hotel) {
  const container = $('#hotel-detail'); container.replaceChildren();
  const image = el('img', 'detail-image'); image.src = `/assets/${hotel.scene}.svg`; image.alt = 'Illustration de paysage ; ce visuel ne représente pas un hôtel réel';
  const title = el('h2', '', hotel.nom); title.id = 'hotel-title';
  container.append(image, title, el('p', 'detail-meta', `${hotel.destination}, ${hotel.pays} · ${hotel.etoiles} étoiles simulées · ${hotel.chambres} chambres\n${types[hotel.type]} · ${hotel.adultes_uniquement ? 'Adultes uniquement (18+)' : 'Adultes et enfants bienvenus'}`));
  const sourceContainer = el('div', 'detail-sources');
  const headings = { ambiance: 'L’ambiance', plage: 'La plage', equipements: 'Les équipements', situation: 'La situation', public: 'Les voyageurs', taille: 'La taille de l’hôtel' };
  for (const source of hotel.sources) { const section = el('section'); section.append(el('h3', '', headings[source.id] || source.id), el('p', '', source.texte)); sourceContainer.append(section); }
  container.append(sourceContainer);
  const box = el('div', 'offer-box');
  box.append(el('strong', '', `${euro(hotel.offre.prix_par_personne)} / adulte`), el('p', '', `${hotel.offre.nuits} nuits · ${pensions[hotel.offre.pension]} · Départ ${hotel.offre.aeroport_depart}\n${hotel.adultes_uniquement ? 'Établissement réservé aux adultes.' : `${euro(hotel.offre.prix_par_enfant)} / enfant.`}\n${euro(hotel.offre.prix_total)} pour ${hotel.offre.adultes} adulte(s) et ${hotel.offre.enfants} enfant(s)${hotel.offre.occupation_confirmee ? '' : ' (occupation indicative)'}.\n${hotel.offre.date_depart ? `Départ proposé : ${date(hotel.offre.date_depart)}.` : 'Date de départ à préciser.'}\nValidité : ${date(hotel.offre.du)} au ${date(hotel.offre.au)} ; le séjour complet doit être inclus.\nInclus : ${hotel.offre.inclus.join(', ')}.`));
  const table = el('table', 'offer-table'); const caption = el('caption', 'sr-only', 'Toutes les variantes simulées de cet hôtel'); table.append(caption);
  const thead = el('thead'); const header = el('tr'); ['Nuits', 'Prix adulte', 'Stock simulé'].forEach(label => header.append(el('th', '', label))); thead.append(header); table.append(thead);
  const tbody = el('tbody'); hotel.offres.forEach(offer => { const tr = el('tr'); tr.append(el('td', '', String(offer.nuits)), el('td', '', euro(offer.prix_par_personne)), el('td', '', offer.disponible ? 'Disponible' : 'Indisponible')); tbody.append(tr); }); table.append(tbody); box.append(table);
  box.append(el('p', 'modal-note', 'Hôtel, prix, stocks, horaires de départ et prestations fictifs. Aucune réservation ni vérification de disponibilité réelle. Les étoiles sont une catégorie de démonstration.'));
  container.append(box);
  const explore = el('button', 'detail-search', 'Affiner un séjour dans cette destination ↗'); explore.type = 'button'; explore.disabled = state.busy;
  explore.addEventListener('click', () => { $('#hotel-dialog').close(); $('#catalogue-dialog').close(); $('#prompt').value = `Je souhaite affiner ma recherche à ${hotel.destination}.`; $('#prompt').focus(); $('#search-form').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  container.append(explore); openDialog('#hotel-dialog');
}

async function loadCatalogue() {
  state.catalogueController?.abort(); const controller = new AbortController(); state.catalogueController = controller;
  $('#catalogue-count').textContent = 'Chargement du catalogue…';
  const params = new URLSearchParams({ page: state.cataloguePage, destination: $('#catalogue-destination').value, type: $('#catalogue-type').value });
  try {
    const response = await fetch(`/api/catalogue?${params}`, { signal: controller.signal });
    if (!response.ok) throw new Error('Le catalogue ne peut pas être chargé.');
    const data = await response.json(); state.catalogueTotal = data.total;
    $('#catalogue-count').textContent = `${data.total} hôtels fictifs · Offres simulées pour 2027`;
    $('#catalogue-results').replaceChildren(...data.hotels.map(h => createCard(h)));
    $('#page-label').textContent = `Page ${data.page + 1} / ${Math.max(1, Math.ceil(data.total / 12))}`;
    $('#page-prev').disabled = data.page === 0; $('#page-next').disabled = (data.page + 1) * 12 >= data.total;
  } catch (error) { if (!controller.signal.aborted) { $('#catalogue-count').textContent = error.message; $('#catalogue-results').replaceChildren(); } }
}
function openCatalogue() { openDialog('#catalogue-dialog'); loadCatalogue(); }
$('#catalogue-open').addEventListener('click', openCatalogue);
for (const id of ['#catalogue-destination', '#catalogue-type']) $(id).addEventListener('change', () => { state.cataloguePage = 0; loadCatalogue(); });
$('#page-prev').addEventListener('click', () => { state.cataloguePage = Math.max(0, state.cataloguePage - 1); loadCatalogue(); $('#catalogue-dialog').scrollTop = 0; });
$('#page-next').addEventListener('click', () => { state.cataloguePage++; loadCatalogue(); $('#catalogue-dialog').scrollTop = 0; });

async function bootstrap() {
  try {
    const response = await fetch('/api/bootstrap'); if (!response.ok) throw new Error('Impossible de joindre le serveur. Relancez npm start.');
    const data = await response.json(); state.bootstrap = data;
    $('#connection-label').textContent = data.configured ? 'Réglages' : 'Configurer';
    $('#config-open').title = data.configured ? 'Mistral configuré' : 'Ajouter une clé Mistral';
    $('#config-open').classList.toggle('configured', data.configured);
    $('#config-state').textContent = data.configured ? `Une clé est configurée côté serveur. Modèle : ${data.chatModel}. Embeddings : ${data.embedModel}.` : 'Ajoutez votre propre clé pour activer la conversation. Le catalogue reste consultable.';
    $('#setup-note').hidden = data.configured;
    $('#catalogue-destination').replaceChildren(new Option('Toutes les destinations', ''), ...data.destinations.map(d => new Option(`${d.nom} · ${d.pays}`, d.id)));
    hideError(); renderCriteria(data.criteria); renderResults(data.apercu, { preview: true });
  } catch (error) { $('#connection-label').textContent = 'Serveur indisponible'; showError(error.message); }
}
bootstrap();
