// Shared by browser and server: explicit form selections never need LLM extraction.
export const editGroups = {
  destination: ['pays', 'destinations'],
  depart: ['aeroport_depart'],
  duree: ['nuits'],
  budget: ['budget_max_par_personne', 'budget_total'],
  dates: ['date_depart', 'date_depart_fin'],
  voyageurs: ['adultes', 'enfants'],
  options: ['pension', 'etoiles_min', 'adultes_uniquement', 'types_exclus'],
  envies: ['preferences', 'recherche_semantique'],
};

export function describeEdit(edit, metadata) {
  const v = edit.values;
  const names = new Intl.DisplayNames(['fr'], { type: 'region' });
  const money = n => new Intl.NumberFormat('fr-FR').format(n);
  switch (edit.group) {
    case 'destination': return `Destination : ${v.destinations.length ? v.destinations.map(id => metadata.destinations.find(d => d.id === id)?.nom || id).join(' ou ') : v.pays.length ? v.pays.map(code => names.of(code)).join(' ou ') : 'indifférente, sans restriction de pays ou de destination'}.`;
    case 'depart': return v.aeroport_depart ? `Départ : ${metadata.airports[v.aeroport_depart] || v.aeroport_depart} (${v.aeroport_depart}).` : 'Je retire la restriction sur l’aéroport de départ.';
    case 'duree': return v.nuits ? `Durée : ${v.nuits} nuits.` : 'La durée du séjour est indifférente.';
    case 'budget': return v.budget_max_par_personne ? `Budget maximum : ${money(v.budget_max_par_personne)} € par personne, sans plafond de budget total.` : v.budget_total ? `Budget maximum : ${money(v.budget_total)} € au total, sans plafond par personne.` : 'Je retire les plafonds de budget par personne et au total.';
    case 'dates': return v.date_depart ? `Départ ${v.date_depart_fin && v.date_depart_fin !== v.date_depart ? `entre le ${v.date_depart} et le ${v.date_depart_fin}` : `le ${v.date_depart}`}.` : 'Mes dates de départ sont flexibles, sans restriction de date.';
    case 'voyageurs': return v.adultes != null || v.enfants != null ? `Voyageurs : ${v.adultes == null ? 'nombre d’adultes à préciser' : `${v.adultes} adulte(s)`}, ${v.enfants == null ? 'nombre d’enfants à préciser' : `${v.enfants} enfant(s)`}.` : 'Le nombre d’adultes et d’enfants reste à préciser.';
    case 'options': return `Options : ${v.pension ? {petit_dejeuner:'petit déjeuner',demi_pension:'demi-pension',tout_compris:'tout compris'}[v.pension] : 'pension indifférente'} ; ${v.etoiles_min ? `${v.etoiles_min} étoiles minimum` : 'catégorie indifférente'} ; ${v.adultes_uniquement ? 'hôtel réservé aux adultes' : 'pas de restriction aux hôtels réservés aux adultes'} ; ${v.types_exclus.length ? `sans hôtel ${v.types_exclus.join(', ')}` : 'aucun type d’hôtel exclu'}.`;
    case 'envies': return v.recherche_semantique ? `Mes envies d’hôtel remplacent les précédentes : ${v.recherche_semantique}.` : 'Je retire mes préférences d’ambiance et de style d’hôtel.';
    default: throw new Error('Critère inconnu.');
  }
}
