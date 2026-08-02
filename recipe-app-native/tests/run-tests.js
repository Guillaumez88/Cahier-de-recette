// Tests des fonctions pures, exécutables sans Expo : node tests/run-tests.js
//
// Les modules source sont en syntaxe ESM (import/export) parce qu'ils sont
// consommés par Metro. Pour les exécuter sous Node sans chaîne de build, on les
// transpile ici de la façon la plus minimale possible : réécriture des `import`
// relatifs et des `export` en CommonJS. C'est suffisant pour format.js,
// filters.js et flow.js, qui n'importent rien d'autre qu'eux-mêmes.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const racine = path.join(__dirname, '..');
const cache = new Map();

function requireEsm(nomRelatif) {
  const fichier = path.join(racine, 'src/utils', `${nomRelatif}.js`);
  if (cache.has(fichier)) return cache.get(fichier);

  let code = fs.readFileSync(fichier, 'utf8');

  // Les imports relatifs deviennent des appels a requireEsm.
  code = code.replace(
    /import\s*\{([^}]+)\}\s*from\s*'\.\/([\w-]+)'\s*;?/g,
    (_, noms, module) => `const {${noms}} = requireEsm('${module}');`
  );

  // On retire le mot-cle `export` en gardant les declarations locales intactes
  // (sinon les fonctions du module ne se voient pas entre elles), puis on
  // réexporte les noms collectés a la fin.
  const noms = [];
  code = code.replace(/export\s+(function|const)\s+(\w+)/g, (_, genre, nom) => {
    noms.push(nom);
    return `${genre} ${nom}`;
  });
  code += `\n${noms.map((n) => `exports.${n} = ${n};`).join('\n')}\n`;

  const exportes = {};
  cache.set(fichier, exportes);
  // eslint-disable-next-line no-new-func
  new Function('exports', 'requireEsm', code)(exportes, requireEsm);
  return exportes;
}

const { parseMinutes, formatMinutes, splitBold, stripTipPrefix, origineCourte, difficulteCourte, trancheTemps } =
  requireEsm('format');
const { filterRecipes, normaliser, optionsDisponibles, texteIndexable } = requireEsm('filters');
const { resolveGrid, buildFlowPhases, isFlowTableInformative } = requireEsm('flow');
const { stripBasePath, addBasePath } = requireEsm('linking');

const recettes = JSON.parse(fs.readFileSync(path.join(racine, 'src/data/recipes.json'), 'utf8'));

let reussis = 0;
const echecs = [];

function test(nom, fn) {
  try {
    fn();
    reussis += 1;
  } catch (erreur) {
    echecs.push({ nom, message: erreur.message });
  }
}

// --- format.js ---------------------------------------------------------------

test('parseMinutes lit les heures et les minutes', () => {
  assert.strictEqual(parseMinutes('1 h 20'), 80);
  assert.strictEqual(parseMinutes('1h30'), 90);
  assert.strictEqual(parseMinutes('45 min'), 45);
  assert.strictEqual(parseMinutes('1 h'), 60);
  assert.strictEqual(parseMinutes('0 min'), 0);
  assert.strictEqual(parseMinutes('13 h 15'), 795);
});

test('parseMinutes ignore les commentaires entre parentheses', () => {
  assert.strictEqual(parseMinutes('1 h (dont 45 min au four, le reste sur le feu)'), 60);
});

test('parseMinutes retourne null sans duree', () => {
  assert.strictEqual(parseMinutes('Non indiqué'), null);
  assert.strictEqual(parseMinutes('Non indiqué précisément'), null);
  assert.strictEqual(parseMinutes(null), null);
  assert.strictEqual(parseMinutes(undefined), null);
});

test('formatMinutes est la reciproque lisible', () => {
  assert.strictEqual(formatMinutes(80), '1 h 20');
  assert.strictEqual(formatMinutes(45), '45 min');
  assert.strictEqual(formatMinutes(60), '1 h');
  assert.strictEqual(formatMinutes(null), null);
});

test('splitBold decoupe le gras', () => {
  assert.deepStrictEqual(splitBold('a **b** c'), [
    { texte: 'a ', gras: false },
    { texte: 'b', gras: true },
    { texte: ' c', gras: false },
  ]);
  assert.deepStrictEqual(splitBold('sans gras'), [{ texte: 'sans gras', gras: false }]);
  assert.deepStrictEqual(splitBold(''), []);
});

test('stripTipPrefix retire les prefixes redondants', () => {
  assert.strictEqual(stripTipPrefix('Astuce de la recette : faire revenir'), 'faire revenir');
  assert.strictEqual(stripTipPrefix('Note de la recette : ajouter'), 'ajouter');
  assert.strictEqual(stripTipPrefix('Texte sans prefixe'), 'Texte sans prefixe');
});

test('origineCourte classe les 17 recettes sans reste', () => {
  const parOrigine = {};
  recettes.forEach((r) => {
    const o = origineCourte(r.origine);
    parOrigine[o] = (parOrigine[o] || 0) + 1;
  });
  assert.ok(!parOrigine.Autre, `origines non classees : ${JSON.stringify(parOrigine)}`);
  assert.strictEqual(
    Object.values(parOrigine).reduce((a, b) => a + b, 0),
    17
  );
  assert.strictEqual(origineCourte('Italie (plat italien), version familiale française'), 'Italienne');
  assert.strictEqual(origineCourte('Provençale / française'), 'Provençale');
  assert.strictEqual(origineCourte('Américaine déduite du cheesecake, variante belge'), 'Américaine');
});

test('difficulteCourte normalise les 4 formulations du jeu de donnees', () => {
  assert.strictEqual(difficulteCourte('Facile'), 'Facile');
  assert.strictEqual(difficulteCourte('Facile (mention explicite du site)'), 'Facile');
  assert.strictEqual(difficulteCourte('Facile, déduit du texte source'), 'Facile');
  assert.strictEqual(difficulteCourte('Technique / non indiquée explicitement'), 'Technique');
  recettes.forEach((r) => {
    assert.notStrictEqual(difficulteCourte(r.difficulte), 'Non indiquée', `non classee : ${r.difficulte}`);
  });
});

test('trancheTemps place les bornes au bon endroit', () => {
  assert.strictEqual(trancheTemps(30), 'rapide');
  assert.strictEqual(trancheTemps(31), 'moyen');
  assert.strictEqual(trancheTemps(60), 'moyen');
  assert.strictEqual(trancheTemps(61), 'long');
  assert.strictEqual(trancheTemps(120), 'long');
  assert.strictEqual(trancheTemps(121), 'tres-long');
  assert.strictEqual(trancheTemps(null), null);
});

// --- filters.js --------------------------------------------------------------

test('normaliser retire accents et apostrophes typographiques', () => {
  assert.strictEqual(normaliser('Crème Brûlée'), 'creme brulee');
  assert.strictEqual(normaliser('huile d’olive'), "huile d'olive");
});

test('sans critere, toutes les recettes ressortent', () => {
  assert.strictEqual(filterRecipes(recettes, {}).length, 17);
  assert.strictEqual(filterRecipes(recettes).length, 17);
});

test('la recherche porte aussi sur les ingredients et les etapes', () => {
  const parIngredient = filterRecipes(recettes, { recherche: 'mascarpone' });
  assert.ok(parIngredient.length >= 1, 'mascarpone introuvable');
  assert.ok(parIngredient.some((r) => r.id === 'tiramisu-classique'));

  const sansAccent = filterRecipes(recettes, { recherche: 'creme' });
  assert.ok(sansAccent.length >= 1, 'recherche insensible aux accents cassee');
});

test('la recherche multi-mots est conjonctive', () => {
  const deuxMots = filterRecipes(recettes, { recherche: 'lasagnes saumon' });
  assert.strictEqual(deuxMots.length, 1);
  assert.strictEqual(deuxMots[0].id, 'lasagnes-au-saumon-et-aux-courgettes');
});

test('la recherche sans resultat retourne un tableau vide', () => {
  assert.deepStrictEqual(filterRecipes(recettes, { recherche: 'zzzzzz' }), []);
});

test('le filtre categorie respecte le decompte reel', () => {
  assert.strictEqual(filterRecipes(recettes, { categorie: 'Dessert' }).length, 10);
  assert.strictEqual(filterRecipes(recettes, { categorie: 'Plat' }).length, 4);
  assert.strictEqual(filterRecipes(recettes, { categorie: 'Entrée' }).length, 3);
});

test('les filtres se combinent', () => {
  const resultat = filterRecipes(recettes, { categorie: 'Dessert', origine: 'Américaine' });
  assert.strictEqual(resultat.length, 4);
  resultat.forEach((r) => {
    assert.strictEqual(r.categorie, 'Dessert');
    assert.strictEqual(origineCourte(r.origine), 'Américaine');
  });
});

test('le filtre temps exclut les recettes sans duree exploitable', () => {
  const rapides = filterRecipes(recettes, { temps: 'rapide' });
  rapides.forEach((r) => {
    const m = parseMinutes(r.temps.total);
    assert.ok(m !== null && m <= 30, `${r.id} : ${r.temps.total}`);
  });
  const toutesTranches = ['rapide', 'moyen', 'long', 'tres-long'].reduce(
    (n, t) => n + filterRecipes(recettes, { temps: t }).length,
    0
  );
  const sansDuree = recettes.filter((r) => parseMinutes(r.temps.total) === null).length;
  assert.strictEqual(toutesTranches + sansDuree, 17, 'des recettes sont perdues ou comptees deux fois');
});

test('optionsDisponibles ne propose que des valeurs presentes', () => {
  const options = optionsDisponibles(recettes);
  assert.deepStrictEqual(options.categories, ['Dessert', 'Entrée', 'Plat']);
  options.origines.forEach((o) => {
    assert.ok(filterRecipes(recettes, { origine: o }).length > 0, `origine vide : ${o}`);
  });
  options.difficultes.forEach((d) => {
    assert.ok(filterRecipes(recettes, { difficulte: d }).length > 0, `difficulte vide : ${d}`);
  });
});

test('texteIndexable couvre les 17 recettes sans lever', () => {
  recettes.forEach((r) => {
    assert.ok(texteIndexable(r).length > 20, `index trop court : ${r.id}`);
  });
});

// --- flow.js ----------------------------------------------------------------

test('resolveGrid produit un rectangle plein sur les 17 recettes', () => {
  recettes.forEach((r) => {
    const { nbColonnes, grille } = resolveGrid(r.flowTable);
    assert.ok(nbColonnes > 0, `grille vide : ${r.id}`);
    grille.forEach((ligne, i) => {
      assert.strictEqual(ligne.length, nbColonnes, `${r.id} ligne ${i} : largeur ${ligne.length}`);
    });
  });
});

test('resolveGrid resout les rowspan des lasagnes sur 5 colonnes', () => {
  const lasagnes = recettes.find((r) => r.id === 'lasagnes-bolognaise-la-meilleure-recette');
  const { nbColonnes, grille } = resolveGrid(lasagnes.flowTable);
  assert.strictEqual(nbColonnes, 5);
  assert.strictEqual(grille.length, 17);

  // Ligne 0 : consigne pleine largeur.
  assert.strictEqual(grille[0][0].colspan, 5);
  assert.ok(grille[0][0].texte.startsWith('Beurrer'));

  // Ligne 2, colonne 1 : « Faire revenir l'oignon... » avec rowspan 7,
  // donc les lignes 3 a 8 doivent pointer vers cette ancre.
  assert.strictEqual(grille[2][1].rowspan, 7);
  for (let l = 3; l <= 8; l += 1) {
    assert.deepStrictEqual(grille[l][1].couvertePar, [2, 1], `ligne ${l} mal couverte`);
  }
  // La ligne 9 ouvre une nouvelle cellule d'action (la viande).
  assert.strictEqual(grille[9][1].origine, true);

  // Les colonnes 3 et 4 de la ligne 2 ont un rowspan 15 : elles couvrent jusqu'a la ligne 16.
  assert.strictEqual(grille[2][3].rowspan, 15);
  assert.deepStrictEqual(grille[16][3].couvertePar, [2, 3]);
});

test('resolveGrid gere un rowspan qui depasse le nombre de lignes', () => {
  const { nbColonnes, grille } = resolveGrid({
    headers: [],
    rows: [[{ text: 'a', rowspan: 9, colspan: 1 }, { text: 'b', rowspan: 1, colspan: 1 }]],
  });
  assert.strictEqual(nbColonnes, 2);
  assert.strictEqual(grille.length, 1);
  assert.strictEqual(grille[0][0].texte, 'a');
});

test('isFlowTableInformative ne retient que le tableau construit a la main', () => {
  const informatifs = recettes.filter((r) => isFlowTableInformative(r.flowTable)).map((r) => r.id);
  assert.deepStrictEqual(informatifs, ['lasagnes-bolognaise-la-meilleure-recette']);
});

test('buildFlowPhases extrait le preambule et regroupe les ingredients', () => {
  const lasagnes = recettes.find((r) => r.id === 'lasagnes-bolognaise-la-meilleure-recette');
  const { preambule, phases } = buildFlowPhases(lasagnes.flowTable);

  assert.strictEqual(preambule.length, 2);
  assert.ok(preambule[0].startsWith('Beurrer'));
  assert.ok(preambule[1].startsWith('Préchauffer'));

  assert.ok(phases.length >= 4, `trop peu de phases : ${phases.length}`);

  // La phase de la sauce tomate regroupe les 7 lignes couvertes par le rowspan 7.
  const sauce = phases.find((p) => p.etapes.some((e) => e.texte.startsWith("Faire revenir l'oignon")));
  assert.ok(sauce, 'phase sauce tomate introuvable');
  assert.strictEqual(sauce.elements.length, 7);
  assert.ok(sauce.elements[0].startsWith('Oignon'));

  // La phase bechamel regroupe ses 4 ingredients.
  const bechamel = phases.find((p) => p.etapes.some((e) => e.texte === 'Béchamel'));
  assert.ok(bechamel, 'phase bechamel introuvable');
  assert.strictEqual(bechamel.elements.length, 4);

  // Chaque ingredient de la premiere colonne apparait exactement une fois.
  const tousElements = phases.flatMap((p) => p.elements);
  assert.strictEqual(new Set(tousElements).size, tousElements.length, 'doublons dans les elements');
  assert.strictEqual(tousElements.length, 15, 'le tableau de flux detaille 15 lignes d ingredients');
});

test('buildFlowPhases ne leve sur aucune des 17 recettes', () => {
  recettes.forEach((r) => {
    const resultat = buildFlowPhases(r.flowTable);
    assert.ok(Array.isArray(resultat.phases), `phases invalides : ${r.id}`);
    assert.ok(Array.isArray(resultat.preambule), `preambule invalide : ${r.id}`);
  });
});

test('buildFlowPhases tolere un tableau vide ou absent', () => {
  assert.deepStrictEqual(buildFlowPhases(null), { preambule: [], phases: [], colonnes: [] });
  assert.deepStrictEqual(buildFlowPhases({ headers: [], rows: [] }), {
    preambule: [],
    phases: [],
    colonnes: [],
  });
});

// --- linking.js : sous-chemin de deploiement ---------------------------------

const BASE = '/Cahier-de-recette';

test('stripBasePath retire le sous-chemin des URL entrantes', () => {
  assert.strictEqual(stripBasePath('/Cahier-de-recette/', BASE), '/');
  assert.strictEqual(stripBasePath('/Cahier-de-recette', BASE), '/');
  assert.strictEqual(stripBasePath('/Cahier-de-recette/liste-de-courses', BASE), '/liste-de-courses');
  assert.strictEqual(stripBasePath('/Cahier-de-recette/recette/tapenade-maison', BASE), '/recette/tapenade-maison');
});

test('stripBasePath laisse passer un chemin sans prefixe et le cas racine', () => {
  assert.strictEqual(stripBasePath('/recette/brookies', BASE), '/recette/brookies');
  assert.strictEqual(stripBasePath('/recette/brookies', ''), '/recette/brookies');
  assert.strictEqual(stripBasePath('/', ''), '/');
});

test('addBasePath prefixe les chemins produits par le routeur', () => {
  assert.strictEqual(addBasePath('/', BASE), '/Cahier-de-recette/');
  assert.strictEqual(addBasePath('/liste-de-courses', BASE), '/Cahier-de-recette/liste-de-courses');
  assert.strictEqual(addBasePath('/recette/brookies', BASE), '/Cahier-de-recette/recette/brookies');
});

test('addBasePath ne double jamais le prefixe', () => {
  assert.strictEqual(addBasePath('/Cahier-de-recette/liste-de-courses', BASE), '/Cahier-de-recette/liste-de-courses');
  assert.strictEqual(addBasePath('/liste-de-courses', ''), '/liste-de-courses');
});

test('les deux fonctions sont reciproques sur toutes les routes', () => {
  ['/', '/liste-de-courses', '/recette/tapenade-maison'].forEach((chemin) => {
    assert.strictEqual(stripBasePath(addBasePath(chemin, BASE), BASE), chemin === '/' ? '/' : chemin);
  });
});

test('le sous-chemin de base-path.json est coherent', () => {
  const config = JSON.parse(fs.readFileSync(path.join(racine, 'src/config/base-path.json'), 'utf8'));
  assert.strictEqual(typeof config.basePath, 'string');
  if (config.basePath !== '') {
    assert.ok(config.basePath.startsWith('/'), 'le sous-chemin doit commencer par /');
    assert.ok(!config.basePath.endsWith('/'), 'le sous-chemin ne doit pas finir par /');
  }
});

// --- integrite du jeu de donnees --------------------------------------------

test('les 17 recettes respectent le schema attendu', () => {
  const champs = [
    'id',
    'titre',
    'categorie',
    'origine',
    'difficulte',
    'portions',
    'temps',
    'source',
    'ingredients',
    'instructions',
    'astuces',
    'variantes',
    'manquants',
    'flowTable',
  ];
  assert.strictEqual(recettes.length, 17);
  const ids = new Set();
  recettes.forEach((r) => {
    champs.forEach((c) => assert.ok(c in r, `${r.id} : champ ${c} manquant`));
    assert.ok(!ids.has(r.id), `id en doublon : ${r.id}`);
    ids.add(r.id);
    assert.ok(['Entrée', 'Plat', 'Dessert'].includes(r.categorie), `${r.id} : categorie ${r.categorie}`);
    assert.ok(/^https?:\/\//.test(r.source.url), `${r.id} : url source invalide`);
    ['preparation', 'cuisson', 'repos', 'total'].forEach((c) =>
      assert.ok(c in r.temps, `${r.id} : temps.${c} manquant`)
    );
    r.instructions.forEach((etape) => {
      // `numero` n'est pas toujours un entier : la source des lasagnes bolognaise
      // libelle sa derniere etape « Pour finir ». On ne corrige pas la donnee,
      // l'interface doit accepter les deux formes (voir test suivant).
      assert.ok(
        typeof etape.numero === 'number' || typeof etape.numero === 'string',
        `${r.id} : numero de type ${typeof etape.numero}`
      );
      assert.ok(typeof etape.texte === 'string' && etape.texte.length > 0);
    });
    assert.ok(r.ingredients.length > 0, `${r.id} : aucun ingredient`);
  });
});

test('le seul numero d etape non entier est bien celui repere', () => {
  const anomalies = [];
  recettes.forEach((r) => {
    r.instructions.forEach((etape) => {
      if (typeof etape.numero !== 'number') anomalies.push([r.id, etape.numero]);
    });
  });
  // Si cette assertion casse apres l'ajout d'une recette, c'est un signal utile :
  // une nouvelle source libelle ses etapes autrement, il faut le constater.
  assert.deepStrictEqual(anomalies, [['lasagnes-bolognaise-la-meilleure-recette', 'Pour finir']]);
});

// --- restitution -------------------------------------------------------------

console.log(`\n${reussis} test(s) reussi(s), ${echecs.length} echec(s)\n`);
if (echecs.length > 0) {
  echecs.forEach((e) => console.error(`ECHEC  ${e.nom}\n       ${e.message}\n`));
  process.exit(1);
}
