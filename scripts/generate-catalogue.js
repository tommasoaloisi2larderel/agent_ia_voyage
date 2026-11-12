import { mkdir, writeFile } from 'node:fs/promises';

// 20 destinations x 5 profils x 3 variantes. Aucun appel IA, aucune donnée d'hôtel réel.
const destinations = [
  ['crete', 'Crète', 'Grèce', 'GR', 'Héraklion', 530, 'sable', 'med'],
  ['rhodes', 'Rhodes', 'Grèce', 'GR', 'Lindos', 550, 'sable', 'med'],
  ['corfou', 'Corfou', 'Grèce', 'GR', 'Paleokastrítsa', 540, 'galets', 'green'],
  ['kos', 'Kos', 'Grèce', 'GR', 'Tigaki', 510, 'sable', 'med'],
  ['cyclades', 'Cyclades', 'Grèce', 'GR', 'Naxos', 680, 'sable', 'med'],
  ['majorque', 'Majorque', 'Espagne', 'ES', 'Alcúdia', 490, 'sable', 'med'],
  ['tenerife', 'Tenerife', 'Espagne', 'ES', 'Costa Adeje', 590, 'volcanique', 'volcan'],
  ['costa-del-sol', 'Costa del Sol', 'Espagne', 'ES', 'Nerja', 470, 'sable', 'sun'],
  ['algarve', 'Algarve', 'Portugal', 'PT', 'Lagos', 510, 'sable', 'sun'],
  ['madere', 'Madère', 'Portugal', 'PT', 'Funchal', 610, 'galets', 'green'],
  ['marrakech', 'Marrakech', 'Maroc', 'MA', 'Palmeraie', 430, 'aucune', 'desert'],
  ['agadir', 'Agadir', 'Maroc', 'MA', 'Taghazout', 450, 'sable', 'desert'],
  ['djerba', 'Djerba', 'Tunisie', 'TN', 'Midoun', 390, 'sable', 'sun'],
  ['antalya', 'Antalya', 'Turquie', 'TR', 'Belek', 520, 'sable', 'green'],
  ['bodrum', 'Bodrum', 'Turquie', 'TR', 'Bitez', 560, 'galets', 'med'],
  ['sicile', 'Sicile', 'Italie', 'IT', 'Cefalù', 590, 'sable', 'volcan'],
  ['sardaigne', 'Sardaigne', 'Italie', 'IT', 'Olbia', 650, 'sable', 'med'],
  ['chypre', 'Chypre', 'Chypre', 'CY', 'Paphos', 570, 'sable', 'sun'],
  ['dubrovnik', 'Dubrovnik', 'Croatie', 'HR', 'Cavtat', 620, 'galets', 'green'],
  ['maurice', 'Île Maurice', 'Maurice', 'MU', 'Grand Baie', 1290, 'sable', 'tropical'],
];
const profiles = [
  { type: 'boutique', nom: 'Les Terrasses', chambres: 28, ambiance: 'Une adresse intimiste et paisible, à taille humaine. Jardin ombragé, petits déjeuners en terrasse et soirées tranquilles, sans animation musicale ni grand complexe voisin.', equipements: ['piscine extérieure', 'restaurant local', 'Wi-Fi'], pension: 'petit_dejeuner', distance: 180 },
  { type: 'famille', nom: 'Les Jardins', chambres: 120, ambiance: 'Un hôtel convivial pour les familles, avec club enfants de 4 à 12 ans, pataugeoire et activités en journée. Les soirées proposent des spectacles ; ce lieu ne convient pas à une recherche de silence absolu.', equipements: ['club enfants', 'pataugeoire', 'piscine', 'chambres familiales', 'Wi-Fi'], pension: 'tout_compris', distance: 80 },
  { type: 'club', nom: 'Grand Horizon', chambres: 360, ambiance: 'Un grand complexe animé avec tournois sportifs, aquagym, musique à la piscine et spectacles en soirée. Une ambiance sociale et festive ; ce n’est pas un petit hôtel calme.', equipements: ['trois piscines', 'toboggans', 'tennis', 'buffets', 'salle de sport', 'Wi-Fi'], pension: 'tout_compris', distance: 0 },
  { type: 'nature', nom: 'La Clairière', chambres: 42, ambiance: 'Un refuge au vert, à l’écart des zones touristiques et de la vie nocturne. Départs de sentiers de randonnée, cuisine de saison et potager. Pas de club enfants ni de programme de spectacles.', equipements: ['location de vélos', 'potager', 'restaurant de saison', 'Wi-Fi'], pension: 'demi_pension', distance: 3200 },
  { type: 'spa', nom: 'Maison Sereine', chambres: 64, ambiance: 'Une retraite réservée aux adultes, propice au repos et aux séjours en couple. Soins au spa, yoga au lever du soleil et espaces silencieux, sans animations festives.', equipements: ['spa', 'hammam', 'piscine', 'yoga', 'restaurant gastronomique', 'Wi-Fi'], pension: 'demi_pension', distance: 250 },
];
const airports = ['CDG', 'ORY', 'LYS', 'MRS', 'NTE', 'TLS', 'BOD', 'LIL', 'NCE', 'BRU', 'GVA'];
const hotels = [];
destinations.forEach(([id, destination, pays, code_pays, ville, base, beach, scene], d) => {
  profiles.forEach((p, j) => {
    for (let v = 0; v < 3; v++) {
      const n = d * 15 + j * 3 + v;
      const plageType = beach === 'sable' && v === 2 ? 'galets' : beach;
      const distance = beach === 'aucune' ? null : p.distance + v * 120;
      const etoiles = Math.min(5, 3 + v + (j === 4 ? 1 : 0));
      const hotel = {
        id: `hotel-${String(n + 1).padStart(3, '0')}`, nom: `${p.nom} ${ville}${v ? ['',' Azur',' Évasion'][v] : ''}`,
        destination_id: id, destination, pays, code_pays, ville, type: p.type,
        etoiles, chambres: p.chambres + v * 8, adultes_uniquement: j === 4, scene,
        ambiance: p.ambiance, equipements: [...p.equipements, ...(v === 2 ? ['chambres accessibles sur demande'] : [])],
        plage: { type: plageType, distance_metres: distance, description: beach === 'aucune'
          ? 'Destination intérieure : aucune plage à proximité.'
          : `${distance === 0 ? 'Accès direct à une plage' : 'Une plage'}${plageType === 'sable' ? ' de sable fin' : plageType === 'galets' ? ' de galets (pas de sable)' : ' de sable volcanique sombre'}${distance === 0 ? '' : ` se trouve à ${distance} mètres de l’hôtel`}. ${distance > 1000 ? 'Un véhicule est conseillé pour rejoindre la mer.' : 'La plage est accessible à pied.'}` },
        situation: `${ville}, ${destination}. ${j === 3 ? 'Dans l’arrière-pays, au départ de sentiers balisés.' : j === 2 ? 'Dans une zone touristique animée, avec commerces à proximité.' : 'Dans un quartier résidentiel, à l’écart des principales discothèques.'}`,
        fictif: true,
        offres: [5, 7, 10, 14].map((nuits, k) => {
          const prix = Math.round((base + v * 150 + j * 55) * (0.35 + nuits / 10) / 5) * 5;
          return { id: `offre-${n + 1}-${nuits}`, nuits, pension: p.pension,
            aeroports: airports.filter((a, i) => i < 4 || (i + n) % 3 === 0),
            prix_par_personne: prix, prix_par_enfant: j === 4 ? null : Math.round(prix * .65), devise: 'EUR',
            du: '2027-01-01', au: '2027-12-31', disponible: (n + k) % 17 !== 16,
            capacite: j === 4 ? 2 : 6, inclus: ['vol aller-retour simulé', 'transferts', 'hébergement', 'pension indiquée'],
          };
        }),
      };
      hotels.push(hotel);
    }
  });
});
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/hotels.json', import.meta.url), JSON.stringify(hotels, null, 2) + '\n');
console.log(`${hotels.length} hôtels fictifs, ${destinations.length} destinations, ${hotels.length * 4} offres simulées générées.`);
