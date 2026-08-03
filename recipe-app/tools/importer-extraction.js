/* Import d'une extraction Markdown vers le format JSON du carnet.
 *
 *   node tools/importer-extraction.js <fichier.md> [--ecrire]
 *
 * Sans --ecrire, l'outil se contente d'afficher ce qu'il ferait : les recettes
 * nouvelles, celles deja presentes, et les quantites dont l'unite manque. C'est le
 * mode a utiliser d'abord.
 *
 * Deux regles de conduite, et elles expliquent la forme du code :
 *
 * 1. On n'ecrase jamais une recette existante. Les extractions recues ne sont pas
 *    toujours meilleures que ce qui est deja en base : celle du 3 aout 2026 perdait
 *    de 29 % a 80 % du texte des instructions, des ingredients entiers, les groupes
 *    d'ingredients et les unites des quantites. Seules les recettes absentes sont
 *    ajoutees. Pour remplacer une fiche existante, passer par l'editeur de
 *    l'application, qui montre ce qui change avant d'enregistrer.
 *
 * 2. On n'invente aucune unite. Le defaut recurrent de ces extractions est que la
 *    quantite se retrouve collee au nom de l'ingredient et tronquee de son unite :
 *    « bœuf haché 300 » au lieu de « 300 g », « sel 1 c. à » au lieu de
 *    « 1 c. à c. », « lait 10 » qui peut valoir 10 cl comme 100 ml. Ecrire « g »
 *    partout donnerait une liste de courses fausse sans que rien ne le signale. Ces
 *    quantites sont donc reprises telles quelles et inscrites dans le champ
 *    `manquants` de la recette, que l'application affiche sous « Ce que la source ne
 *    donne pas ». La correction se fait ensuite en deux minutes dans l'editeur.
 *
 * La detection est mecanique, sans jugement sur l'ingredient : une unite est
 * consideree perdue lorsque la colonne « Quantité » du tableau etait vide et qu'il a
 * fallu extraire le nombre du nom. Quand la colonne est remplie (« œufs | 4 »),
 * l'extraction a fait son travail et on lui fait confiance.
 */

const fs = require('fs');
const path = require('path');

const racine = path.join(__dirname, '..');
const Q = require(path.join(racine, 'js/quantites.js'));

const fichier = process.argv[2];
const ecrire = process.argv.includes('--ecrire');

if (!fichier) {
  console.error('Usage : node tools/importer-extraction.js <fichier.md> [--ecrire]');
  process.exit(2);
}

const md = fs.readFileSync(fichier, 'utf8');

// --- Outils de texte ---------------------------------------------------------

function slug(titre) {
  return String(titre)
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Majuscule initiale, sans toucher au reste (les noms propres sont conserves). */
function capitaliser(texte) {
  const t = String(texte || '').trim();
  return t === '' ? t : t.charAt(0).toUpperCase() + t.slice(1);
}

function sectionDe(bloc, titre) {
  const m = bloc.match(new RegExp('### ' + titre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\n([\\s\\S]*?)(?=\\n### |$)'));
  return m ? m[1].trim() : '';
}

/** Lignes d'un tableau Markdown, en-tete et separateur exclus. */
function lignesTableau(texte) {
  return texte
    .split('\n')
    .filter((l) => l.trim().startsWith('|') && !/^\|[\s|:-]+\|$/.test(l.trim()))
    .map((l) =>
      l
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim())
    )
    .slice(1);
}

function puces(texte) {
  return texte
    .split('\n')
    .filter((l) => /^\s*[-*]\s+/.test(l))
    .map((l) => capitaliser(l.replace(/^\s*[-*]\s+/, '').trim()))
    .filter((l) => l !== '');
}

// --- Categorie ---------------------------------------------------------------
//
// L'application filtre sur trois categories. Les libelles composes de l'extraction
// sont reduits a la premiere, ce qui est fidele : « Entrée / apéritif » est une
// entree. Le libelle complet, lui, n'est pas perdu : il est repris dans `origine`
// quand il apporte une precision.

function categorieDe(brut) {
  const t = String(brut || '').toLowerCase();
  if (/dessert/.test(t)) return 'Dessert';
  if (/plat/.test(t)) return 'Plat';
  if (/entr|aperitif|apéritif|accompagnement/.test(t)) return 'Entrée';
  return 'Plat';
}

// --- Ingredients -------------------------------------------------------------

/**
 * Lit une ligne d'ingredient.
 * Retourne { nom, quantite, unitePerdue, brut }.
 */
function lireIngredient(colonnes) {
  const gauche = (colonnes[0] || '').trim();
  const droite = (colonnes[1] || '').trim();

  // Cas sain : la colonne quantite est remplie.
  if (droite !== '') {
    return { nom: capitaliser(gauche), quantite: droite, unitePerdue: false, brut: `${gauche} | ${droite}` };
  }

  // Colonne vide : la quantite a ete collee au nom. On coupe au premier nombre
  // precede d'une espace, et non au premier chiffre : « Farine T55 250 » doit donner
  // « Farine T55 » et « 250 », pas « Farine T » et « 55 250 ».
  const separateur = gauche.search(/\s\d/);
  const coupure = separateur === -1 ? (/^\d/.test(gauche) ? 0 : -1) : separateur + 1;
  if (coupure === -1) {
    // Aucun nombre : la source ne donne pas de quantite (« sel », « poivre »).
    return { nom: capitaliser(gauche), quantite: '', unitePerdue: false, brut: gauche };
  }

  const nom = capitaliser(gauche.slice(0, coupure).trim().replace(/[,;]$/, ''));
  const quantite = gauche.slice(coupure).trim();

  // L'unite est-elle reconnue ? On interroge le module de quantites plutot que de
  // deviner : si l'unite est vide, elle a ete tronquee a l'extraction.
  const analyse = Q.analyser(quantite);
  const uniteReconnue = analyse.lisible && analyse.unite !== '' && analyse.unite !== null;

  return { nom, quantite, unitePerdue: !uniteReconnue, brut: gauche };
}

// --- Conversion d'une recette ------------------------------------------------

function convertir(bloc) {
  const titreBloc = bloc.split('\n')[0].trim();

  const fiche = {};
  lignesTableau(sectionDe(bloc, 'Fiche recette')).forEach((c) => {
    fiche[c[0]] = c[1] || '';
  });

  const source = bloc.match(/\*\*Source :\*\*\s*\[([^\]]*)\]\(([^)]*)\)/);

  const lignes = lignesTableau(sectionDe(bloc, 'Ingrédients')).map(lireIngredient);
  const perdues = lignes.filter((l) => l.unitePerdue);

  const instructions = sectionDe(bloc, 'Instructions détaillées')
    .split('\n')
    .filter((l) => /^\s*\d+\./.test(l))
    .map((l, i) => ({
      numero: i + 1,
      texte: capitaliser(l.replace(/^\s*\d+\.\s*/, '').trim()),
      astuce: null,
    }));

  const manquants = [];
  if (perdues.length > 0) {
    manquants.push(
      "L'unité de mesure a été perdue à l'extraction pour " +
        perdues.length +
        ' quantité' +
        (perdues.length > 1 ? 's' : '') +
        ' : ' +
        perdues.map((l) => `${l.nom} « ${l.quantite} »`).join(', ') +
        '. Ces valeurs sont reprises telles quelles, sans unité inventée : à confirmer sur la source, puis à corriger dans l’éditeur.'
    );
  }
  if (!Q.analyserPortions(fiche['Nombre de parts / personnes'] || '').nombre) {
    manquants.push(
      'La source ne donne pas de nombre de parts exploitable (« ' +
        (fiche['Nombre de parts / personnes'] || '') +
        ' ») : le recalcul automatique des quantités est donc désactivé pour cette recette.'
    );
  }

  const titre = fiche.Titre || titreBloc;

  return {
    id: slug(titre),
    titre,
    categorie: categorieDe(fiche['Catégorie']),
    // On conserve le libelle de categorie d'origine quand il est plus precis que
    // les trois valeurs de l'application, pour ne pas perdre l'information.
    origine:
      fiche.Origine +
      (fiche['Catégorie'] && categorieDe(fiche['Catégorie']) !== fiche['Catégorie']
        ? ` (catégorie indiquée par la source : ${fiche['Catégorie']})`
        : ''),
    difficulte: fiche.Difficulté || 'Non indiquée',
    portions: fiche['Nombre de parts / personnes'] || 'Non indiqué',
    temps: {
      preparation: fiche.Préparation || 'Non indiqué',
      cuisson: fiche.Cuisson || 'Non indiqué',
      repos: fiche.Repos || 'Non indiqué',
      total: fiche['Temps total'] || 'Non indiqué',
    },
    calories: null,
    source: { label: source ? source[1] : titre, url: source ? source[2] : '' },
    ingredients: [
      {
        groupe: null,
        items: lignes.map((l) => ({ nom: l.nom, quantite: l.quantite })),
      },
    ],
    instructions,
    astuces: { recette: puces(sectionDe(bloc, 'Astuces')), commentaires: [] },
    variantes: { recette: puces(sectionDe(bloc, 'Variantes et idées associées')), associees: [] },
    manquants,
    // Pas de tableau fourni : celui de l'extraction ne contient que des marqueurs
    // repetes sans information (« ✓ », « Selon recette », « Si concerné »).
    // L'application reconstitue le deroule depuis les etapes, ce qui est plus juste.
    flowTable: { headers: [], rows: [] },
  };
}

// --- Deroulement -------------------------------------------------------------

const blocs = md.split(/\n## \d+\.\s*/).slice(1);
const cheminBase = path.join(racine, 'data/recipes.json');
const base = JSON.parse(fs.readFileSync(cheminBase, 'utf8'));

// --- Appariement avec les recettes deja en base ------------------------------
//
// Les titres d'une extraction a l'autre ne sont pas identiques : « Lasagnes
// bolognaise » designe la meme recette que « Lasagnes bolognaise : la meilleure
// recette », et « Tarte au citron CAP Pâtissier » que « Tarte au citron, recette CAP
// Pâtissier ». Un simple slug egal laisserait passer trois doublons.
//
// On compare donc des ensembles de mots : une recette est consideree deja presente
// si ses mots sont inclus dans ceux d'une recette existante, ou inversement. Quand
// plusieurs candidates conviennent, on retient la plus proche en nombre de mots, ce
// qui evite de confondre « Flan pâtissier » avec « Flan pâtissier sans pâte
// crémeux » lorsque les deux existent.

const MOTS_TITRE_IGNORES = new Set(['la', 'le', 'les', 'de', 'des', 'du', 'au', 'aux', 'et', 'a', 'en']);

function motsTitre(titre) {
  return new Set(
    slug(titre)
      .split('-')
      .filter((m) => m !== '' && !MOTS_TITRE_IGNORES.has(m))
  );
}

function inclus(petit, grand) {
  for (const m of petit) if (!grand.has(m)) return false;
  return true;
}

const indexBase = base.map((r) => ({ id: r.id, titre: r.titre, mots: motsTitre(r.titre) }));

/** Retourne la recette existante correspondante, ou null. */
function correspondance(recette) {
  const exact = indexBase.find((r) => r.id === recette.id || slug(r.titre) === slug(recette.titre));
  if (exact) return exact;

  const candidates = indexBase.filter(
    (r) => inclus(recette.mots, r.mots) || inclus(r.mots, recette.mots)
  );
  if (candidates.length === 0) return null;

  candidates.sort(
    (a, b) => Math.abs(a.mots.size - recette.mots.size) - Math.abs(b.mots.size - recette.mots.size)
  );
  return candidates[0];
}

const nouvelles = [];
const deja = [];
const ambigues = [];

blocs.forEach((bloc) => {
  const recette = convertir(bloc);
  recette.mots = motsTitre(recette.titre);

  const trouvee = correspondance(recette);
  delete recette.mots;

  if (trouvee) {
    deja.push({ titre: recette.titre, correspond: trouvee.titre, id: trouvee.id });
    return;
  }
  // Garde-fou : un identifiant deja pris signalerait un appariement rate.
  if (base.some((r) => r.id === recette.id)) {
    ambigues.push(recette.titre);
    return;
  }
  nouvelles.push(recette);
});

console.log(`\n${blocs.length} recette(s) dans l'extraction, ${base.length} déjà en base.\n`);

console.log(`Déjà présentes, laissées intactes (${deja.length}) :`);
deja.forEach((r) =>
  console.log(
    `   ${r.titre}` + (r.titre !== r.correspond ? `\n      correspond à « ${r.correspond} » (${r.id})` : '')
  )
);

if (ambigues.length > 0) {
  console.log(`\nAmbiguës, non traitées (${ambigues.length}) :`);
  ambigues.forEach((t) => console.log(`   ${t}`));
}

console.log(`\nNouvelles, à ajouter (${nouvelles.length}) :`);
nouvelles.forEach((r) => {
  const nb = r.ingredients.reduce((n, g) => n + g.items.length, 0);
  console.log(`   ${r.titre}`);
  console.log(`      id ${r.id} · ${r.categorie} · ${nb} ingrédients · ${r.instructions.length} étapes`);
  r.manquants.forEach((m) => console.log(`      À CONFIRMER : ${m}`));
});

if (!ecrire) {
  console.log('\nRien n’a été écrit. Relancer avec --ecrire pour ajouter les nouvelles recettes.\n');
  process.exit(0);
}

if (ambigues.length > 0) {
  console.error(
    '\nÉcriture refusée : ' +
      ambigues.length +
      ' recette(s) n’ont pu être appariées de façon sûre. Les traiter à la main avant de recommencer.\n'
  );
  process.exit(1);
}

if (nouvelles.length === 0) {
  console.log('\nAucune nouvelle recette : rien à écrire.\n');
  process.exit(0);
}

fs.writeFileSync(cheminBase, JSON.stringify(base.concat(nouvelles), null, 2) + '\n', 'utf8');
console.log(`\n${nouvelles.length} recette(s) ajoutée(s) à data/recipes.json (${base.length + nouvelles.length} au total).\n`);
