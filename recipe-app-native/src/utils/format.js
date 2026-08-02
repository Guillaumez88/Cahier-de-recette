// Fonctions de mise en forme et de normalisation, sans dépendance à React Native :
// elles sont donc directement testables sous Node (voir tests/run-tests.js) et
// dupliquées à l'identique dans la v1 web (recipe-app/js/app.js).

/**
 * Convertit une durée écrite en français en minutes.
 * Reconnaît « 1 h 20 », « 1h30 », « 45 min », « 1 h », « 0 min ».
 * Ignore les parenthèses de commentaire : « 1 h (dont 45 min au four) » vaut 60.
 * Retourne null quand aucune durée n'est exprimée (« Non indiqué »).
 */
export function parseMinutes(valeur) {
  if (typeof valeur !== 'string') return null;

  const avecHeures = valeur.match(/(\d+)\s*h(?:\s*(\d+))?/i);
  if (avecHeures) {
    return Number(avecHeures[1]) * 60 + (avecHeures[2] ? Number(avecHeures[2]) : 0);
  }

  const minutesSeules = valeur.match(/(\d+)\s*min/i);
  if (minutesSeules) return Number(minutesSeules[1]);

  return null;
}

/**
 * Formate un nombre de minutes en durée française (« 1 h 20 », « 45 min »).
 */
export function formatMinutes(minutes) {
  if (typeof minutes !== 'number' || Number.isNaN(minutes)) return null;
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

/**
 * Découpe un texte contenant des passages « **en gras** » en segments.
 * Retourne [{ texte, gras }].
 *
 * Aucune des 17 recettes actuelles n'utilise cette syntaxe (vérifié sur les
 * 114 étapes). La fonction est conservée pour les recettes ajoutées plus tard,
 * et parce qu'elle rend le rendu inoffensif si la syntaxe apparaît un jour.
 */
export function splitBold(texte) {
  if (typeof texte !== 'string' || texte === '') return [];
  return texte
    .split(/(\*\*[^*]+\*\*)/g)
    .filter((segment) => segment !== '')
    .map((segment) => {
      const gras = segment.startsWith('**') && segment.endsWith('**') && segment.length > 4;
      return { texte: gras ? segment.slice(2, -2) : segment, gras };
    });
}

/**
 * Retire le préfixe redondant des astuces d'étape (« Astuce de la recette : »,
 * « Note de la recette : »), l'interface affichant déjà une étiquette.
 */
export function stripTipPrefix(texte) {
  if (typeof texte !== 'string') return '';
  return texte.replace(/^\s*(astuce|note|conseil)(\s+de\s+la\s+recette)?\s*:\s*/i, '').trim();
}

// --- Normalisation des champs en texte libre ---------------------------------
//
// `origine` et `difficulte` sont du texte libre dans recipes.json (« Provençale /
// française, déduite de la tapenade aux olives et câpres »). Les filtres ont
// besoin d'étiquettes courtes et stables : on les dérive par mots-clés, dans
// l'ordre, le premier qui correspond gagne. Le texte intégral reste affiché sur
// la fiche, la normalisation ne sert qu'au filtrage et aux puces.

const REGLES_ORIGINE = [
  [/itali/i, 'Italienne'],
  [/améric|americ|anglais/i, 'Américaine'],
  [/provenç|provenc/i, 'Provençale'],
  [/savoyard/i, 'Savoyarde'],
  [/méditerran|mediterran/i, 'Méditerranéenne'],
  [/franç|franc/i, 'Française'],
];

export function origineCourte(origine) {
  if (typeof origine !== 'string') return 'Autre';
  const regle = REGLES_ORIGINE.find(([motif]) => motif.test(origine));
  return regle ? regle[1] : 'Autre';
}

export function difficulteCourte(difficulte) {
  if (typeof difficulte !== 'string') return 'Non indiquée';
  if (/technique|difficile/i.test(difficulte)) return 'Technique';
  if (/moyen/i.test(difficulte)) return 'Moyenne';
  if (/facile/i.test(difficulte)) return 'Facile';
  return 'Non indiquée';
}

// Tranches de durée, appliquées au temps total de la recette.
export const TRANCHES_TEMPS = [
  { cle: 'rapide', libelle: '30 min ou moins', min: 0, max: 30 },
  { cle: 'moyen', libelle: '30 min à 1 h', min: 31, max: 60 },
  { cle: 'long', libelle: '1 h à 2 h', min: 61, max: 120 },
  { cle: 'tres-long', libelle: 'Plus de 2 h', min: 121, max: Infinity },
];

export function trancheTemps(minutes) {
  if (typeof minutes !== 'number') return null;
  const tranche = TRANCHES_TEMPS.find((t) => minutes >= t.min && minutes <= t.max);
  return tranche ? tranche.cle : null;
}
