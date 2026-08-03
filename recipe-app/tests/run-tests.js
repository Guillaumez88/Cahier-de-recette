// Tests de la logique metier, sans navigateur ni dependance : node tests/run-tests.js
//
// js/logic.js et js/storage.js s'exportent en CommonJS sous Node et sur window dans
// le navigateur : ils sont donc chargeables directement ici, sans transpilation.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const racine = path.join(__dirname, '..');
const L = require(path.join(racine, 'js/logic.js'));

const recettes = JSON.parse(fs.readFileSync(path.join(racine, 'data/recipes.json'), 'utf8'));

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

// --- Durees ------------------------------------------------------------------

test('parseMinutes lit les heures et les minutes', () => {
  assert.strictEqual(L.parseMinutes('1 h 20'), 80);
  assert.strictEqual(L.parseMinutes('1h30'), 90);
  assert.strictEqual(L.parseMinutes('45 min'), 45);
  assert.strictEqual(L.parseMinutes('1 h'), 60);
  assert.strictEqual(L.parseMinutes('0 min'), 0);
  assert.strictEqual(L.parseMinutes('13 h 15'), 795);
});

test('parseMinutes ignore les commentaires entre parentheses', () => {
  assert.strictEqual(L.parseMinutes('1 h (dont 45 min au four, le reste sur le feu)'), 60);
});

test('parseMinutes retourne null sans duree', () => {
  assert.strictEqual(L.parseMinutes('Non indiqué'), null);
  assert.strictEqual(L.parseMinutes('Non indiqué précisément'), null);
  assert.strictEqual(L.parseMinutes(null), null);
  assert.strictEqual(L.parseMinutes(undefined), null);
});

test('trancheTemps place les bornes au bon endroit', () => {
  assert.strictEqual(L.trancheTemps(30), 'rapide');
  assert.strictEqual(L.trancheTemps(31), 'moyen');
  assert.strictEqual(L.trancheTemps(60), 'moyen');
  assert.strictEqual(L.trancheTemps(61), 'long');
  assert.strictEqual(L.trancheTemps(120), 'long');
  assert.strictEqual(L.trancheTemps(121), 'tres-long');
  assert.strictEqual(L.trancheTemps(null), null);
});

// --- Champs en texte libre ---------------------------------------------------

test('stripTipPrefix retire les prefixes redondants', () => {
  assert.strictEqual(L.stripTipPrefix('Astuce de la recette : faire revenir'), 'faire revenir');
  assert.strictEqual(L.stripTipPrefix('Note de la recette : ajouter'), 'ajouter');
  assert.strictEqual(L.stripTipPrefix('Texte sans prefixe'), 'Texte sans prefixe');
});

test('origineCourte classe les 17 recettes sans reste', () => {
  const parOrigine = {};
  recettes.forEach((r) => {
    const o = L.origineCourte(r.origine);
    parOrigine[o] = (parOrigine[o] || 0) + 1;
  });
  assert.ok(!parOrigine.Autre, `origines non classees : ${JSON.stringify(parOrigine)}`);
  assert.strictEqual(
    Object.values(parOrigine).reduce((a, b) => a + b, 0),
    17
  );
  assert.strictEqual(L.origineCourte('Italie (plat italien), version familiale française'), 'Italienne');
  assert.strictEqual(L.origineCourte('Provençale / française'), 'Provençale');
  assert.strictEqual(L.origineCourte('Américaine déduite du cheesecake, variante belge'), 'Américaine');
});

test('difficulteCourte normalise les 4 formulations du jeu de donnees', () => {
  assert.strictEqual(L.difficulteCourte('Facile'), 'Facile');
  assert.strictEqual(L.difficulteCourte('Facile (mention explicite du site)'), 'Facile');
  assert.strictEqual(L.difficulteCourte('Facile, déduit du texte source'), 'Facile');
  assert.strictEqual(L.difficulteCourte('Technique / non indiquée explicitement'), 'Technique');
  recettes.forEach((r) => {
    assert.notStrictEqual(L.difficulteCourte(r.difficulte), 'Non indiquée', `non classee : ${r.difficulte}`);
  });
});

// --- Recherche et filtres ----------------------------------------------------

test('normaliser retire accents et apostrophes typographiques', () => {
  assert.strictEqual(L.normaliser('Crème Brûlée'), 'creme brulee');
  assert.strictEqual(L.normaliser('huile d’olive'), "huile d'olive");
});

test('sans critere, toutes les recettes ressortent', () => {
  assert.strictEqual(L.filterRecipes(recettes, {}).length, 17);
  assert.strictEqual(L.filterRecipes(recettes).length, 17);
});

test('la recherche porte aussi sur les ingredients et les etapes', () => {
  const parIngredient = L.filterRecipes(recettes, { recherche: 'mascarpone' });
  assert.ok(parIngredient.some((r) => r.id === 'tiramisu-classique'));
  assert.ok(L.filterRecipes(recettes, { recherche: 'creme' }).length >= 1, 'recherche sans accent cassee');
});

test('la recherche multi-mots est conjonctive', () => {
  const deuxMots = L.filterRecipes(recettes, { recherche: 'lasagnes saumon' });
  assert.strictEqual(deuxMots.length, 1);
  assert.strictEqual(deuxMots[0].id, 'lasagnes-au-saumon-et-aux-courgettes');
});

test('la recherche sans resultat retourne un tableau vide', () => {
  assert.deepStrictEqual(L.filterRecipes(recettes, { recherche: 'zzzzzz' }), []);
});

test('le filtre categorie respecte le decompte reel', () => {
  assert.strictEqual(L.filterRecipes(recettes, { categorie: 'Dessert' }).length, 10);
  assert.strictEqual(L.filterRecipes(recettes, { categorie: 'Plat' }).length, 4);
  assert.strictEqual(L.filterRecipes(recettes, { categorie: 'Entrée' }).length, 3);
});

test('les filtres se combinent', () => {
  const resultat = L.filterRecipes(recettes, { categorie: 'Dessert', origine: 'Américaine' });
  assert.strictEqual(resultat.length, 4);
  resultat.forEach((r) => {
    assert.strictEqual(r.categorie, 'Dessert');
    assert.strictEqual(L.origineCourte(r.origine), 'Américaine');
  });
});

test('le filtre temps exclut les recettes sans duree exploitable', () => {
  L.filterRecipes(recettes, { temps: 'rapide' }).forEach((r) => {
    const m = L.parseMinutes(r.temps.total);
    assert.ok(m !== null && m <= 30, `${r.id} : ${r.temps.total}`);
  });
  const toutesTranches = ['rapide', 'moyen', 'long', 'tres-long'].reduce(
    (n, t) => n + L.filterRecipes(recettes, { temps: t }).length,
    0
  );
  const sansDuree = recettes.filter((r) => L.parseMinutes(r.temps.total) === null).length;
  assert.strictEqual(toutesTranches + sansDuree, 17, 'des recettes sont perdues ou comptees deux fois');
});

test('optionsDisponibles ne propose que des valeurs presentes', () => {
  const options = L.optionsDisponibles(recettes);
  assert.deepStrictEqual(options.categories, ['Dessert', 'Entrée', 'Plat']);
  options.origines.forEach((o) => {
    assert.ok(L.filterRecipes(recettes, { origine: o }).length > 0, `origine vide : ${o}`);
  });
  options.difficultes.forEach((d) => {
    assert.ok(L.filterRecipes(recettes, { difficulte: d }).length > 0, `difficulte vide : ${d}`);
  });
});

test('texteIndexable couvre les 17 recettes', () => {
  recettes.forEach((r) => {
    assert.ok(L.texteIndexable(r).length > 20, `index trop court : ${r.id}`);
  });
});

// --- Tableau de flux ---------------------------------------------------------

test('isFlowTableInformative ne retient que le tableau construit a la main', () => {
  const informatifs = recettes.filter((r) => L.isFlowTableInformative(r.flowTable)).map((r) => r.id);
  assert.deepStrictEqual(informatifs, ['lasagnes-bolognaise-la-meilleure-recette']);
});

test('isFlowTableInformative tolere un tableau vide ou absent', () => {
  assert.strictEqual(L.isFlowTableInformative(null), false);
  assert.strictEqual(L.isFlowTableInformative({ headers: [], rows: [] }), false);
});

test('largeurGrille donne 5 colonnes pour le tableau des lasagnes', () => {
  const lasagnes = recettes.find((r) => r.id === 'lasagnes-bolognaise-la-meilleure-recette');
  assert.strictEqual(L.largeurGrille(lasagnes.flowTable), 5);
  assert.strictEqual(L.largeurGrille(null), 0);
});

test('chaque tableau de flux a une largeur exploitable', () => {
  recettes.forEach((r) => {
    assert.ok(L.largeurGrille(r.flowTable) > 0, `grille vide : ${r.id}`);
  });
});

// --- Liste de courses --------------------------------------------------------
//
// storage.js s'appuie sur localStorage : on en fournit une implementation minimale
// pour tester la logique de la liste sans navigateur.

function chargerStockage() {
  const chemin = require.resolve(path.join(racine, 'js/storage.js'));
  delete require.cache[chemin];
  return require(chemin);
}

test('la liste de courses suit le cycle complet', () => {
  const memoire = {};
  global.localStorage = {
    getItem: (c) => (c in memoire ? memoire[c] : null),
    setItem: (c, v) => {
      memoire[c] = String(v);
    },
    removeItem: (c) => {
      delete memoire[c];
    },
  };
  const St = chargerStockage();

  const lasagnes = recettes.find((r) => r.id === 'lasagnes-bolognaise-la-meilleure-recette');
  const nbIngredients = lasagnes.ingredients.reduce((n, g) => n + g.items.length, 0);

  assert.deepStrictEqual(St.getShoppingList(), [], 'la liste devrait partir vide');

  St.addRecipeToList(lasagnes);
  let articles = St.getShoppingList();
  assert.strictEqual(articles.length, nbIngredients, `${articles.length} articles pour ${nbIngredients} ingredients`);
  assert.ok(St.recetteDansListe(articles, lasagnes.id));

  // Un second ajout ne doit rien dupliquer.
  St.addRecipeToList(lasagnes);
  assert.strictEqual(St.getShoppingList().length, nbIngredients, 'doublons apres un second ajout');

  // Cocher, puis decocher.
  const cle = articles[0].cle;
  St.toggleArticle(cle);
  assert.strictEqual(St.getShoppingList().find((a) => a.cle === cle).coche, true);
  St.toggleArticle(cle);
  assert.strictEqual(St.getShoppingList().find((a) => a.cle === cle).coche, false);

  // Ajouter une seconde recette, puis n'en retirer qu'une.
  const tapenade = recettes.find((r) => r.id === 'tapenade-maison');
  St.addRecipeToList(tapenade);
  assert.strictEqual(St.grouperParRecette(St.getShoppingList()).length, 2, 'deux groupes attendus');
  St.removeRecipeFromList(lasagnes.id);
  articles = St.getShoppingList();
  assert.ok(!St.recetteDansListe(articles, lasagnes.id));
  assert.ok(St.recetteDansListe(articles, tapenade.id), 'la seconde recette a ete retiree a tort');

  // Supprimer un article isole, puis vider.
  const avant = articles.length;
  St.removeArticle(articles[0].cle);
  assert.strictEqual(St.getShoppingList().length, avant - 1);
  St.clearShoppingList();
  assert.deepStrictEqual(St.getShoppingList(), []);

  delete global.localStorage;
});

test('les abonnes sont notifies a chaque ecriture', () => {
  const memoire = {};
  global.localStorage = {
    getItem: (c) => (c in memoire ? memoire[c] : null),
    setItem: (c, v) => {
      memoire[c] = String(v);
    },
    removeItem: (c) => {
      delete memoire[c];
    },
  };
  const St = chargerStockage();

  let appels = 0;
  St.surChangement(() => {
    appels += 1;
  });

  St.addRecipeToList(recettes.find((r) => r.id === 'tapenade-maison'));
  assert.strictEqual(appels, 1, 'un ajout doit notifier');
  St.clearShoppingList();
  assert.strictEqual(appels, 2, 'un vidage doit notifier');

  delete global.localStorage;
});

test('la liste de courses resiste a un stockage corrompu', () => {
  global.localStorage = {
    getItem: () => '{ceci n est pas du JSON',
    setItem: () => {},
    removeItem: () => {},
  };
  const St = chargerStockage();
  assert.deepStrictEqual(St.getShoppingList(), [], 'un stockage illisible doit donner une liste vide');
  delete global.localStorage;
});

// --- Integrite du jeu de donnees ---------------------------------------------

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
      // le rendu accepte les deux formes.
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

// --- Restitution -------------------------------------------------------------

console.log(`\n${reussis} test(s) reussi(s), ${echecs.length} echec(s)\n`);
if (echecs.length > 0) {
  echecs.forEach((e) => console.error(`ECHEC  ${e.nom}\n       ${e.message}\n`));
  process.exit(1);
}
