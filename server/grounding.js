import { destinations, emptyCriteria } from './catalogue.js';

const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, ' ');
const aliases = { crete: ['crete'], rhodes:['rhodes'], corfou:['corfou','corfu'], kos:['kos'], cyclades:['cyclades','naxos','santorin','mykonos'], majorque:['majorque','mallorca'], tenerife:['tenerife','teneriffe'], 'costa-del-sol':['costa del sol'], algarve:['algarve'], madere:['madere','madeira'], marrakech:['marrakech'], agadir:['agadir','taghazout'], djerba:['djerba'], antalya:['antalya','belek'], bodrum:['bodrum','bitez'], sicile:['sicile','sicily'], sardaigne:['sardaigne','sardinia'], chypre:['chypre','cyprus','paphos'], dubrovnik:['dubrovnik','cavtat'], maurice:['maurice','mauritius'] };

// Une valeur stricte doit être reliée à un extrait réel d'un message utilisateur.
// Les trois contrôles spécialisés empêchent les inférences observées en test réel.
export function groundCriteria(criteria, citations, messages) {
  const users = messages.filter(m => m.role === 'user').map(m => normalize(m.content));
  const c = structuredClone(criteria);
  const defaults = emptyCriteria();
  const cited = new Map();
  for (const citation of citations || []) {
    const quote = normalize(citation.extrait).trim();
    if (quote && users.some(text => text.includes(quote))) cited.set(citation.champ, `${cited.get(citation.champ) || ''} ${quote}`.trim());
  }
  for (const key of Object.keys(defaults)) {
    if (['recherche_semantique', 'preferences'].includes(key)) continue;
    if (c[key] != null && (!Array.isArray(c[key]) || c[key].length) && !cited.has(key)) c[key] = defaults[key];
  }
  const destinationQuote = cited.get('destinations') || '';
  c.destinations = c.destinations.filter(id => {
    const terms = aliases[id] || [id.replaceAll('-', ' ')];
    return terms.some(term => new RegExp(`(^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(destinationQuote));
  });
  // Un pays peut être déduit d'une destination explicite ; pas l'inverse.
  for (const id of c.destinations) {
    const d = destinations.find(d => d.id === id);
    if (d && !c.pays.length) c.pays = [d.code_pays];
  }
  if (c.pension) {
    const patterns = { petit_dejeuner: /petit[ -]dejeuner|breakfast/, demi_pension: /demi[ -]pension|half[ -]board/, tout_compris: /tout[ -]compris|all[ -]inclusive/ };
    if (!patterns[c.pension].test(cited.get('pension') || '')) c.pension = null;
  }
  if (c.budget_max_par_personne && !/par personne|par adulte|chacun|\/\s*(pers|personne)|\bpp\b/.test(cited.get('budget_max_par_personne') || '')) c.budget_max_par_personne = null;
  // Les envies affichées sont elles aussi des mots du client, jamais des goûts ajoutés par défaut.
  c.preferences = c.preferences.filter(p => users.some(text => text.includes(normalize(p))));
  c.recherche_semantique = c.preferences.join(', ');
  return c;
}
