const nullable = (type, extra = {}) => ({ type: [type, 'null'], ...extra });
export const criteriaSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    pays: { type: 'array', items: { type: 'string', pattern: '^[A-Z]{2}$' }, maxItems: 10 },
    destinations: { type: 'array', items: { type: 'string', maxLength: 80 }, maxItems: 10 },
    aeroport_depart: nullable('string', { pattern: '^[A-Z]{3}$' }),
    nuits: nullable('integer', { minimum: 1, maximum: 60 }),
    budget_max_par_personne: nullable('number', { minimum: 1, maximum: 1000000 }),
    budget_total: nullable('number', { minimum: 1, maximum: 10000000 }),
    adultes: nullable('integer', { minimum: 1, maximum: 20 }),
    enfants: nullable('integer', { minimum: 0, maximum: 20 }),
    date_depart: nullable('string', { pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
    date_depart_fin: nullable('string', { pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
    etoiles_min: nullable('integer', { minimum: 1, maximum: 5 }),
    pension: { type: ['string', 'null'], enum: [null, 'petit_dejeuner', 'demi_pension', 'tout_compris'] },
    adultes_uniquement: nullable('boolean'),
    types_exclus: { type: 'array', items: { type: 'string', enum: ['boutique', 'famille', 'club', 'nature', 'spa'] }, maxItems: 5 },
    recherche_semantique: { type: 'string', maxLength: 1800 },
    preferences: { type: 'array', items: { type: 'string', maxLength: 100 }, maxItems: 12 },
  },
};
criteriaSchema.required = Object.keys(criteriaSchema.properties);
export const extractionSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    search_holidays: criteriaSchema,
    changements: { type: 'array', maxItems: 18, items: { type: 'string', enum: Object.keys(criteriaSchema.properties) } },
    citations: { type: 'array', maxItems: 20, items: {
      type: 'object', additionalProperties: false,
      properties: { champ: { type: 'string', enum: Object.keys(criteriaSchema.properties).filter(k => !['recherche_semantique','preferences'].includes(k)) }, extrait: { type: 'string', maxLength: 500 } },
      required: ['champ', 'extrait'],
    } },
    message: { type: 'string', maxLength: 1200 },
  },
  required: ['search_holidays', 'changements', 'citations', 'message'],
};
export const contextSchema = {
  type: 'object', additionalProperties: false,
  properties: { criteria: criteriaSchema, citations: {
    ...extractionSchema.properties.citations,
    // Le contexte fusionne les citations conservées de plusieurs extractions.
    // Chaque champ est remplacé en entier lorsqu'il change : au plus 20 par champ.
    maxItems: extractionSchema.properties.citations.maxItems * extractionSchema.properties.citations.items.properties.champ.enum.length,
  } },
  required: ['criteria', 'citations'],
};

// Valide aussi côté serveur : le format contraint de l'API ne remplace pas une validation locale.
export function validate(value, schema, path = 'réponse') {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const validType = types.some(type => type === 'null' ? value === null
    : type === 'array' ? Array.isArray(value)
      : type === 'integer' ? Number.isInteger(value)
        : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
          : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
            : typeof value === type);
  if (!validType) throw new Error(`Format inattendu : ${path}.`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`Valeur inattendue : ${path}.`);
  if (value == null) return;
  if (typeof value === 'string') {
    if (schema.maxLength && value.length > schema.maxLength) throw new Error(`Texte trop long : ${path}.`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) throw new Error(`Format invalide : ${path}.`);
  }
  if (typeof value === 'number' && (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) throw new Error(`Valeur hors limites : ${path}.`);
  if (Array.isArray(value)) {
    if (schema.maxItems && value.length > schema.maxItems) throw new Error(`Liste trop longue : ${path}.`);
    value.forEach((item, i) => validate(item, schema.items, `${path}[${i}]`));
  } else if (typeof value === 'object') {
    for (const key of schema.required || []) if (!(key in value)) throw new Error(`Champ manquant : ${path}.${key}.`);
    for (const key of Object.keys(value)) {
      if (!(key in schema.properties)) { if (schema.additionalProperties === false) throw new Error(`Champ inattendu : ${path}.${key}.`); }
      else validate(value[key], schema.properties[key], `${path}.${key}`);
    }
  }
}

export function validateCriteria(c) {
  validate(c, criteriaSchema);
  for (const key of ['date_depart', 'date_depart_fin']) {
    if (c[key] && (Number.isNaN(Date.parse(`${c[key]}T12:00:00Z`)) || new Date(`${c[key]}T12:00:00Z`).toISOString().slice(0, 10) !== c[key])) throw new Error('Date de départ invalide.');
  }
  if (c.date_depart_fin && (!c.date_depart || c.date_depart_fin < c.date_depart)) throw new Error('La période de départ est invalide.');
  if (c.adultes_uniquement && c.enfants > 0) throw new Error('Un hôtel réservé aux adultes ne peut pas accueillir des enfants. Précisez votre souhait.');
  return c;
}
