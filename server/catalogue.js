import { readFileSync } from 'node:fs';

export const catalogue = JSON.parse(readFileSync(new URL('../data/hotels.json', import.meta.url), 'utf8'));
export const airports = {
  CDG: 'Paris Charles-de-Gaulle', ORY: 'Paris Orly', LYS: 'Lyon', MRS: 'Marseille',
  NTE: 'Nantes', TLS: 'Toulouse', BOD: 'Bordeaux', LIL: 'Lille', NCE: 'Nice', BRU: 'Bruxelles', GVA: 'Genève',
};
export const destinations = [...new Map(catalogue.map(h => [h.destination_id, {
  id: h.destination_id, nom: h.destination, pays: h.pays, code_pays: h.code_pays,
}])).values()];

export const emptyCriteria = () => ({
  pays: [], destinations: [], aeroport_depart: null, nuits: null,
  budget_max_par_personne: null, budget_total: null, adultes: null, enfants: null,
  date_depart: null, date_depart_fin: null, etoiles_min: null, pension: null, adultes_uniquement: null,
  types_exclus: [], recherche_semantique: '', preferences: [],
});

export function facts(hotel) {
  return [
    { id: 'ambiance', texte: hotel.ambiance },
    { id: 'plage', texte: hotel.plage.description },
    { id: 'equipements', texte: `Équipements : ${hotel.equipements.join(', ')}.` },
    { id: 'situation', texte: hotel.situation },
    { id: 'public', texte: hotel.adultes_uniquement ? 'Hôtel réservé aux adultes de 18 ans et plus.' : 'Hôtel accueillant les adultes et les enfants.' },
    { id: 'taille', texte: `${hotel.chambres} chambres. Catégorie simulée : ${hotel.etoiles} étoiles.` },
  ];
}

export function embeddingText(hotel) {
  return `${hotel.nom}. ${hotel.destination}, ${hotel.pays}. ${hotel.type}. ${facts(hotel).map(f => f.texte).join(' ')}`;
}

// Toutes les règles ci-dessous portent sur des offres synthétiques, jamais sur des stocks réels.
export function filterOffers(hotels, c) {
  return hotels.flatMap(h => {
    if (c.pays.length && !c.pays.includes(h.code_pays)) return [];
    if (c.destinations.length && !c.destinations.includes(h.destination_id)) return [];
    if (c.etoiles_min && h.etoiles < c.etoiles_min) return [];
    if (c.adultes_uniquement === true && !h.adultes_uniquement) return [];
    if ((c.enfants ?? 0) > 0 && h.adultes_uniquement) return [];
    if (c.types_exclus.includes(h.type)) return [];
    const adults = c.adultes ?? 2;
    const children = c.enfants ?? 0;
    const offers = h.offres.filter(o => {
      if (!o.disponible || o.capacite < adults + children) return false;
      if (c.aeroport_depart && !o.aeroports.includes(c.aeroport_depart)) return false;
      if (c.nuits && o.nuits !== c.nuits) return false;
      if (c.pension && o.pension !== c.pension) return false;
      if (c.date_depart) {
        const start = c.date_depart_fin ? (c.date_depart > o.du ? c.date_depart : o.du) : c.date_depart;
        if (c.date_depart_fin && start > c.date_depart_fin) return false;
        const end = new Date(`${start}T12:00:00Z`);
        end.setUTCDate(end.getUTCDate() + o.nuits);
        if (start < o.du || end.toISOString().slice(0, 10) > o.au) return false;
      }
      if (c.budget_max_par_personne && o.prix_par_personne > c.budget_max_par_personne) return false;
      if (c.budget_total && (c.adultes == null || c.enfants == null)) return false;
      if (c.budget_total && totalPrice(o, adults, children) > c.budget_total) return false;
      return true;
    }).sort((a, b) => (c.nuits ? 0 : Math.abs(a.nuits - 7) - Math.abs(b.nuits - 7)) || a.prix_par_personne - b.prix_par_personne);
    if (!offers.length) return [];
    const offer = offers[0];
    return [{ ...h, offre: { ...offer, aeroport_depart: c.aeroport_depart ?? offer.aeroports[0],
      date_depart: c.date_depart ? (c.date_depart > offer.du ? c.date_depart : offer.du) : null, adultes: adults, enfants: children,
      prix_total: totalPrice(offer, adults, children), occupation_confirmee: c.adultes != null && c.enfants != null,
    }, sources: facts(h) }];
  });
}

export function totalPrice(o, adults, children) {
  return Math.round(o.prix_par_personne * adults + o.prix_par_enfant * children);
}

export function cosine(a, b) {
  if (a.length !== b.length || !a.length) throw new Error('Dimensions des embeddings incompatibles. Réindexez le catalogue.');
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
