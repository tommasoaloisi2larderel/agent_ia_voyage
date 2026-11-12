import { editGroups, describeEdit } from '../public/criteria-edit.js';
import { emptyCriteria, destinations, airports } from './catalogue.js';
import { criteriaSchema, validate, validateCriteria } from './schema.js';
import { AppError } from './mistral.js';

export function prepareEdit(edit, previous) {
  try {
    if (!edit || typeof edit !== 'object' || !Object.hasOwn(editGroups, edit.group)) throw new Error('Critère inconnu.');
    const keys = editGroups[edit.group];
    if (!edit.values || typeof edit.values !== 'object' || Array.isArray(edit.values)
      || Object.keys(edit.values).length !== keys.length || keys.some(k => !Object.hasOwn(edit.values,k))) throw new Error('Modification de critère invalide.');
    for (const key of keys) validate(edit.values[key], criteriaSchema.properties[key], key);
    if (edit.group === 'envies' && edit.values.recherche_semantique !== edit.values.preferences.join(', ')) throw new Error('Les envies et leur synthèse ne correspondent pas.');
    const criteria = validateCriteria({ ...(previous?.criteria || emptyCriteria()), ...edit.values });
    const content = describeEdit(edit, { destinations, airports });
    const citations = [
      ...(previous?.citations || []).filter(c => !keys.includes(c.champ)),
      ...keys.filter(k => !['preferences','recherche_semantique'].includes(k)).map(champ => ({champ, extrait:content})),
    ];
    return { criteria, citations:[...new Map(citations.map(c=>[c.champ,c])).values()], content };
  } catch (error) { throw new AppError(error.message || 'Modification invalide.', 400); }
}
