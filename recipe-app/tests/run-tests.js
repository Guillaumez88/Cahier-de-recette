// Tests de la logique metier, sans navigateur ni dependance : node tests/run-tests.js
//
// js/logic.js et js/storage.js s'exportent en CommonJS sous Node et sur window dans
// le navigateur : ils sont donc chargeables directement ici, sans transpilation.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const racine = path.join(__dirname, '..');
const L = require(path.join(racine, 'js/logic.js'));
const Q = require(path.join(racine, 'js/quantites.js'));
const Ry = require(path.join(racine, 'js/rayons.js'));
const Fx = require(path.join(racine, 'js/flux.js'));
const Sn = require(path.join(racine, 'js/semaine.js'));
const Ic = require(path.join(racine, 'js/icones.js'));

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

test('origineCourte classe les 21 recettes sans reste', () => {
  const parOrigine = {};
  recettes.forEach((r) => {
    const o = L.origineCourte(r.origine);
    parOrigine[o] = (parOrigine[o] || 0) + 1;
  });
  assert.ok(!parOrigine.Autre, `origines non classees : ${JSON.stringify(parOrigine)}`);
  assert.strictEqual(
    Object.values(parOrigine).reduce((a, b) => a + b, 0),
    21
  );
  assert.strictEqual(L.origineCourte('Italie (plat italien), version familiale française'), 'Italienne');
  assert.strictEqual(L.origineCourte('Provençale / française'), 'Provençale');
  // La regle maghrebine passe avant la francaise : sans cela « Maghrébine, version
  // familiale française » ressortait « Française », l'ordre des regles etant
  // significatif.
  assert.strictEqual(L.origineCourte('Maghrébine, version familiale française'), 'Maghrébine');
  assert.strictEqual(L.origineCourte('Marocaine'), 'Maghrébine');
  assert.strictEqual(L.origineCourte('Américaine déduite du cheesecake, variante belge'), 'Américaine');
});

test('difficulteCourte normalise les 4 formulations du jeu de donnees', () => {
  assert.strictEqual(L.difficulteCourte('Facile'), 'Facile');
  assert.strictEqual(L.difficulteCourte('Facile (mention explicite du site)'), 'Facile');
  assert.strictEqual(L.difficulteCourte('Facile, déduit du texte source'), 'Facile');
  assert.strictEqual(L.difficulteCourte('Technique / non indiquée explicitement'), 'Technique');
  // Une seule recette du carnet ne porte aucune difficulte : sa source est une page
  // de livre photographiee, qui n'en donne pas. La liste est figee pour qu'une
  // difficulte perdue ailleurs ressorte au lieu de passer pour normale.
  const sansDifficulte = recettes
    .filter((r) => L.difficulteCourte(r.difficulte) === 'Non indiquée')
    .map((r) => r.id);
  assert.deepStrictEqual(sansDifficulte, ['couscous-poulet-merguez']);
});

// --- Recherche et filtres ----------------------------------------------------

test('normaliser retire accents et apostrophes typographiques', () => {
  assert.strictEqual(L.normaliser('Crème Brûlée'), 'creme brulee');
  assert.strictEqual(L.normaliser('huile d’olive'), "huile d'olive");
});

test('sans critere, toutes les recettes ressortent', () => {
  assert.strictEqual(L.filterRecipes(recettes, {}).length, 21);
  assert.strictEqual(L.filterRecipes(recettes).length, 21);
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
  assert.strictEqual(L.filterRecipes(recettes, { categorie: 'Plat' }).length, 5);
  assert.strictEqual(L.filterRecipes(recettes, { categorie: 'Entrée' }).length, 6);
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
  assert.strictEqual(
    toutesTranches + sansDuree,
    recettes.length,
    'des recettes sont perdues ou comptees deux fois'
  );
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

test('texteIndexable couvre les 20 recettes', () => {
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

// Les recettes de la derniere extraction n'embarquent pas de tableau : celui de la
// source ne contient que des marqueurs repetes (« ✓ », « Selon recette »), et
// l'application reconstitue le deroule depuis les etapes. On verifie donc que tout
// tableau present est exploitable, et on fige la liste de ceux qui sont absents pour
// qu'une disparition silencieuse ressorte.
const SANS_TABLEAU_FOURNI = [
  'gougeres-de-courgettes-et-comte',
  'mini-cakes-de-courgettes-au-fromage-et-tomates-confites',
  'focaccia-maison-moelleuse',
  // Page de livre photographiee : elle ne porte aucun tableau, le deroule est
  // reconstitue depuis les etapes.
  'couscous-poulet-merguez',
];

test('tout tableau de flux fourni a une largeur exploitable', () => {
  const vides = recettes.filter((r) => L.largeurGrille(r.flowTable) === 0).map((r) => r.id);
  assert.deepStrictEqual(vides, SANS_TABLEAU_FOURNI);
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

// --- quantites.js : lecture ---------------------------------------------------

test('analyser lit les nombres, unites et fractions', () => {
  assert.strictEqual(Q.analyser('200 g').valeur, 200);
  assert.strictEqual(Q.analyser('200 g').unite, 'g');
  assert.strictEqual(Q.analyser('1,5 kg').valeur, 1.5);
  assert.strictEqual(Q.analyser('3/4 l').valeur, 0.75);
  assert.strictEqual(Q.analyser('1/2 c. à c.').unite, 'c. à c.');
  assert.strictEqual(Q.analyser('8').unite, '');
  assert.strictEqual(Q.analyser('1 gousse').unite, 'gousse');
});

test('analyser conserve le texte residuel au lieu de le perdre', () => {
  const q = Q.analyser('130 g, plus pour le moule');
  assert.strictEqual(q.valeur, 130);
  assert.strictEqual(q.unite, 'g');
  assert.strictEqual(q.reste, 'plus pour le moule');
});

test('une fourchette est conservee mot pour mot et jamais multipliee', () => {
  // « 6 à 8 c. à c. » porte deux nombres, pas un : multiplier reviendrait a choisir
  // lequel compte. Sans cette regle, doubler donnait « 12, à 8 c. à c. ».
  ['6 à 8 c. à c.', '2-3 gousses', '1 à 2 pincées', '10 – 12 min'].forEach((t) => {
    assert.strictEqual(Q.analyser(t).lisible, false, `${t} devrait etre intouchable`);
    assert.strictEqual(Q.echelonner(t, 2), t, `${t} ne doit pas bouger`);
  });
  // Une fraction reste une fraction : « 1/2 sachet » n'est pas une fourchette, et
  // « 6/8 » est indistinguable de six-huitiemes. Une source qui ecrit « 6/8 » pour
  // « 6 a 8 » doit etre transcrite « 6 à 8 » dans la donnee.
  assert.strictEqual(Q.analyser('1/2 sachet').lisible, true);
  assert.strictEqual(Q.echelonner('1/2 sachet', 2), '1 sachet');
  assert.strictEqual(Q.estFourchette('6/8 c. à c.'), false);
});

test('analyser signale une quantite sans nombre', () => {
  ['Selon goût', 'Pour le plat', 'Quelques pincées', ''].forEach((t) => {
    assert.strictEqual(Q.analyser(t).lisible, false, `${t} devrait etre illisible`);
  });
});

test('les 209 quantites du carnet sont analysees sans lever', () => {
  let lisibles = 0;
  recettes.forEach((r) =>
    r.ingredients.forEach((g) =>
      g.items.forEach((i) => {
        const q = Q.analyser(i.quantite);
        assert.ok(typeof q.lisible === 'boolean');
        if (q.lisible) lisibles += 1;
      })
    )
  );
  // Le reste est du texte libre (« Selon goût »), conserve tel quel.
  // 183 et non 184 : « 6 à 8 c. à c. » est une fourchette, donc intouchable.
  assert.strictEqual(lisibles, 183, `${lisibles} quantites lisibles au lieu de 183`);
});

// --- quantites.js : addition -------------------------------------------------

test('additionner somme les memes unites', () => {
  assert.strictEqual(Q.additionner(['300 g', '125 g']), '425 g');
  assert.strictEqual(Q.additionner(['70 g', '50 g', '250 g']), '370 g');
});

test('additionner convertit dans une meme famille', () => {
  assert.strictEqual(Q.additionner(['50 cl', '1 l']), '1,5 l');
  assert.strictEqual(Q.additionner(['500 g', '600 g']), '1,1 kg');
  // 200 ml + 30 cl = 500 ml, exprimes en centilitres : plus lisible en cuisine.
  assert.strictEqual(Q.additionner(['200 ml', '30 cl']), '50 cl');
  // En dessous de 100 ml on reste en millilitres.
  assert.strictEqual(Q.additionner(['20 ml', '5 ml']), '25 ml');
});

test('additionner ne melange pas des familles differentes', () => {
  assert.strictEqual(Q.additionner(['3 c. à s.', '200 g']), '3 c. à s. + 200 g');
  // Cuillere a soupe et cuillere a cafe ne sont pas interchangeables.
  assert.strictEqual(Q.additionner(['1 c. à s.', '1 c. à c.']), '1 c. à s. + 1 c. à c.');
});

test('additionner accorde les unites denombrables', () => {
  assert.strictEqual(Q.additionner(['1 gousse', '1 gousse', '1 gousse']), '3 gousses');
  assert.strictEqual(Q.additionner(['2 morceaux', '1 morceau']), '3 morceaux');
  assert.strictEqual(Q.additionner(['1 pincée', '2 pincées']), '3 pincées');
  assert.strictEqual(Q.additionner(['2', '4', '3']), '9');
});

test('additionner conserve ce qui n est pas chiffrable', () => {
  assert.strictEqual(Q.additionner(['Selon goût', '3 c. à s.']), '3 c. à s. + Selon goût');
  // Un commentaire ne se fond pas dans un total : il serait perdu.
  assert.strictEqual(Q.additionner(['130 g, plus pour le moule', '70 g']), '70 g + 130 g, plus pour le moule');
  // Deux mentions identiques ne sont pas repetees.
  assert.strictEqual(Q.additionner(['Selon goût', 'Selon goût']), 'Selon goût');
});

test('additionner rend une quantite seule mot pour mot', () => {
  assert.strictEqual(Q.additionner(['200 g']), '200 g');
  assert.strictEqual(Q.additionner(['Selon goût']), 'Selon goût');
  assert.strictEqual(Q.additionner([]), '');
});

// --- quantites.js : mise a l echelle -----------------------------------------

test('echelonner multiplie en gardant l unite et le residu', () => {
  assert.strictEqual(Q.echelonner('200 g', 1.5), '300 g');
  assert.strictEqual(Q.echelonner('1/2 c. à c.', 2), '1 c. à c.');
  assert.strictEqual(Q.echelonner('1 gousse', 2), '2 gousses');
  assert.strictEqual(Q.echelonner('130 g, plus pour le moule', 2), '260 g, plus pour le moule');
});

test('echelonner laisse intacte une quantite sans nombre', () => {
  assert.strictEqual(Q.echelonner('Selon goût', 2), 'Selon goût');
  assert.strictEqual(Q.echelonner('Pour le moule', 3), 'Pour le moule');
});

test('echelonner refuse un facteur absurde', () => {
  assert.strictEqual(Q.echelonner('200 g', 0), '200 g');
  assert.strictEqual(Q.echelonner('200 g', -1), '200 g');
  assert.strictEqual(Q.echelonner('200 g', NaN), '200 g');
});

test('echelonnerTexte ne touche ni aux durees ni aux temperatures', () => {
  const source = 'Enfourner 45 minutes à 165 °C, thermostat 6, pendant 2 heures, sur 22 cm.';
  const r = Q.echelonnerTexte(source, 2);
  assert.strictEqual(r.texte, source, 'un temps ou une temperature a ete multiplie');
  assert.strictEqual(r.remplacements.length, 0);
});

test('echelonnerTexte multiplie les masses et les volumes', () => {
  const r = Q.echelonnerTexte('Ajouter 800 g de pulpe et 50 cl de lait.', 2);
  assert.strictEqual(r.texte, 'Ajouter 1600 g de pulpe et 100 cl de lait.');
  assert.strictEqual(r.remplacements.length, 2);
});

test('echelonnerTexte ne touche jamais a un nombre nu', () => {
  // « thermostat 6 » ou « étape 2 » n'ont pas d'unite : les multiplier serait faux.
  const r = Q.echelonnerTexte('Thermostat 6, four numéro 2, 3 fois de suite.', 2);
  assert.strictEqual(r.texte, 'Thermostat 6, four numéro 2, 3 fois de suite.');
});

test('echelonnerTexte laisse les 20 recettes intactes a facteur 1', () => {
  recettes.forEach((r) =>
    r.instructions.forEach((etape) => {
      assert.strictEqual(Q.echelonnerTexte(etape.texte, 1).texte, etape.texte);
    })
  );
});

test('aucune duree ni temperature des 20 recettes n est modifiee par un doublement', () => {
  const motifsInterdits = /(\d+)\s*(minutes?|mn|min|heures?|h\b|°\s*C|cm|mm)/gi;
  recettes.forEach((r) =>
    r.instructions.forEach((etape) => {
      const avant = (etape.texte.match(motifsInterdits) || []).join('|');
      const apres = (Q.echelonnerTexte(etape.texte, 2).texte.match(motifsInterdits) || []).join('|');
      assert.strictEqual(apres, avant, `${r.id} : une durée ou une température a bougé`);
    })
  );
});

// --- quantites.js : portions -------------------------------------------------

test('analyserPortions lit le nombre et garde le libelle', () => {
  assert.deepStrictEqual(Q.analyserPortions('6 personnes'), { nombre: 6, libelle: 'personnes' });
  assert.deepStrictEqual(Q.analyserPortions('4 gros gourmands'), { nombre: 4, libelle: 'gros gourmands' });
  assert.deepStrictEqual(Q.analyserPortions('1 galette de 22 cm'), { nombre: 1, libelle: 'galette de 22 cm' });
});

// Une seule recette echappe a la regle : la source des gougeres ne donne pas de
// nombre de parts (« Non indiqué »). Rien n'a ete invente, la recette le declare
// dans son champ « manquants » et le recalcul des quantites y est desactive.
const SANS_PORTIONS = ['gougeres-de-courgettes-et-comte'];

test('les portions de 19 des 20 recettes sont lisibles', () => {
  const illisibles = recettes
    .filter((r) => {
      const p = Q.analyserPortions(r.portions);
      return !(typeof p.nombre === 'number' && p.nombre > 0);
    })
    .map((r) => r.id);
  assert.deepStrictEqual(illisibles, SANS_PORTIONS);
  SANS_PORTIONS.forEach((id) => {
    const r = recettes.find((x) => x.id === id);
    assert.ok(
      (r.manquants || []).some((m) => /nombre de parts/.test(m)),
      `${id} : le manque de portions n est pas declare dans « manquants »`
    );
  });
});

test('ecrirePortions est la reciproque', () => {
  assert.strictEqual(Q.ecrirePortions(12, 'personnes'), '12 personnes');
  assert.strictEqual(Q.ecrirePortions(1.5, 'galette de 22 cm'), '1,5 galette de 22 cm');
});

// --- rayons.js ---------------------------------------------------------------

test('les 133 ingredients du carnet sont tous classes', () => {
  const noms = [...new Set(recettes.flatMap((r) => r.ingredients.flatMap((g) => g.items.map((i) => i.nom))))];
  const nonClasses = noms.filter((n) => Ry.rayonDe(n) === Ry.RAYON_DEFAUT);
  assert.deepStrictEqual(nonClasses, [], `${nonClasses.length} ingredient(s) sans rayon`);
  assert.strictEqual(noms.length, 133, `${noms.length} noms distincts au lieu de 133`);
});

test('la ligature oe ne fait pas echouer le classement', () => {
  assert.strictEqual(Ry.rayonDe('Œufs'), 'Crèmerie');
  assert.strictEqual(Ry.rayonDe('Jaune d’œuf'), 'Crèmerie');
  // Et « boeuf » ne doit pas etre pris pour un oeuf.
  assert.strictEqual(Ry.rayonDe('Bœuf haché'), 'Viandes et poissons');
});

test('ce qui suit « pour » est un usage, pas le produit', () => {
  assert.strictEqual(Ry.rayonDe('Farine pour beurre manié'), 'Épicerie sucrée');
  assert.strictEqual(Ry.rayonDe('Beurre froid pour beurre manié'), 'Crèmerie');
  assert.strictEqual(Ry.rayonDe('Sucre et eau pour sirop'), 'Épicerie sucrée');
  assert.strictEqual(Ry.rayonDe('Maïzena pour crème pâtissière'), 'Épicerie sucrée');
});

test('les pieges de mots-cles sont desamorces', () => {
  assert.strictEqual(Ry.rayonDe('Vinaigre de vin'), 'Épicerie salée');
  assert.strictEqual(Ry.rayonDe('Vin blanc sec'), 'Boissons');
  assert.strictEqual(Ry.rayonDe('Noix de muscade'), 'Épices et herbes');
  assert.strictEqual(Ry.rayonDe('Noix de pécan'), 'Épicerie sucrée');
  assert.strictEqual(Ry.rayonDe('Beurre aux cristaux de sel'), 'Crèmerie');
  assert.strictEqual(Ry.rayonDe('Coulis de framboise'), 'Épicerie sucrée');
  assert.strictEqual(
    Ry.rayonDe('Pulpe de tomate en conserve (ou 500 g de tomates fraîches)'),
    'Épicerie salée'
  );
});

test('grouperParRayon respecte l ordre de parcours du magasin', () => {
  const groupes = Ry.grouperParRayon([
    { nom: 'Sucre' },
    { nom: 'Courgettes' },
    { nom: 'Lait' },
    { nom: 'Vin blanc sec' },
  ]);
  assert.deepStrictEqual(
    groupes.map((g) => g.rayon),
    ['Fruits et légumes', 'Crèmerie', 'Épicerie sucrée', 'Boissons']
  );
});

test('un rayon inconnu est place en fin de parcours', () => {
  assert.ok(Ry.ordreRayon('Autre') >= Ry.RAYONS.length - 1);
  assert.strictEqual(Ry.ordreRayon('Rayon imaginaire'), Ry.RAYONS.length);
});

// --- flux.js : deroule reconstitue -------------------------------------------

test('le deroule est reconstitue pour les 20 recettes', () => {
  recettes.forEach((r) => {
    const d = Fx.genererDeroule(r);
    assert.ok(Array.isArray(d.phases), `${r.id} : phases invalides`);
    assert.ok(d.phases.length > 0, `${r.id} : aucune phase`);
    assert.strictEqual(
      d.couverture.total,
      r.ingredients.reduce((n, g) => n + g.items.length, 0),
      `${r.id} : total d ingredients incoherent`
    );
  });
});

test('aucun ingredient n est perdu entre les phases et le reste', () => {
  recettes.forEach((r) => {
    const d = Fx.genererDeroule(r);
    const places = d.phases.reduce((n, p) => n + p.ingredients.length, 0);
    assert.strictEqual(
      places + d.nonRattaches.length,
      d.couverture.total,
      `${r.id} : ${places} + ${d.nonRattaches.length} au lieu de ${d.couverture.total}`
    );
  });
});

test('la couverture globale reste au niveau mesure', () => {
  let places = 0;
  let total = 0;
  recettes.forEach((r) => {
    const d = Fx.genererDeroule(r);
    places += d.couverture.places;
    total += d.couverture.total;
  });
  // 193/209 au moment de l ecriture, soit 92 %. Le test protege contre une
  // regression, pas contre une amelioration : on verifie un plancher.
  assert.strictEqual(total, 209);
  assert.ok(places >= 193, `couverture tombee a ${places}/209`);
});

test('un ingredient est place a la premiere etape qui le nomme', () => {
  const tapenade = recettes.find((r) => r.id === 'tapenade-maison');
  const d = Fx.genererDeroule(tapenade);
  // L ail est hache a l etape 1, puis remis au mixeur a l etape 2 : c est la
  // premiere qui compte.
  const etape1 = d.phases.find((p) => p.numero === '1');
  assert.ok(
    etape1.ingredients.some((i) => i.nom === 'Ail'),
    JSON.stringify(etape1.ingredients.map((i) => i.nom))
  );
  d.phases
    .filter((p) => p.numero !== '1')
    .forEach((p) => {
      assert.ok(!p.ingredients.some((i) => i.nom === 'Ail'), 'l ail est place deux fois');
    });
});

test('le deroule reprend les quantites des ingredients', () => {
  const tapenade = recettes.find((r) => r.id === 'tapenade-maison');
  const d = Fx.genererDeroule(tapenade);
  const olives = d.phases.flatMap((p) => p.ingredients).find((i) => i.nom === 'Olives noires');
  assert.strictEqual(olives.quantite, '200 g');
});

test('ce qu aucune etape ne nomme est signale, pas place au hasard', () => {
  // La fondue parle des « fromages » sans les nommer : les trois fromages doivent
  // se retrouver dans nonRattaches et nulle part ailleurs.
  const fondue = recettes.find((r) => r.id === 'veritable-fondue-savoyarde');
  const d = Fx.genererDeroule(fondue);
  const restes = d.nonRattaches.map((i) => i.nom);
  ['Beaufort', 'Comté', 'Tomme de Savoie'].forEach((nom) => {
    assert.ok(restes.includes(nom), `${nom} devrait etre signale comme non rattache`);
    assert.ok(
      !d.phases.some((p) => p.ingredients.some((i) => i.nom === nom)),
      `${nom} a ete place alors qu aucune etape ne le nomme`
    );
  });
});

test('motsCles ecarte les qualificatifs de forme', () => {
  assert.deepStrictEqual(Fx.motsCles('Beurre mou'), ['beurre']);
  assert.deepStrictEqual(Fx.motsCles('Emmental râpé'), ['emmental']);
  assert.deepStrictEqual(Fx.motsCles('Farine pour beurre manié'), ['farine']);
  assert.deepStrictEqual(Fx.motsCles('Pulpe de tomate en conserve (ou 500 g de tomates fraîches)'), [
    'pulpe',
    'tomate',
    'conserve',
  ]);
});

test('actionCourte garde la premiere phrase', () => {
  assert.strictEqual(Fx.actionCourte('Hacher l’ail. Puis mixer le tout.'), 'Hacher l’ail');
  assert.ok(Fx.actionCourte('a'.repeat(300)).length <= 161);
});

// --- flux.js : mise a l echelle du tableau fourni -----------------------------

test('les cellules « Nom : quantite » du tableau suivent le facteur', () => {
  const lasagnes = recettes.find((r) => r.id === 'lasagnes-bolognaise-la-meilleure-recette');
  const r = Fx.echelonnerFlowTable(lasagnes.flowTable, 2);
  const cellules = r.flowTable.rows.flat().map((c) => c.text);

  assert.ok(cellules.includes('Bœuf haché : 600 g'), 'la viande n a pas ete doublee');
  assert.ok(cellules.includes('Oignon : 2'), 'un nombre nu apres deux-points n a pas ete double');
  assert.ok(cellules.includes('Ail : 2 gousses'), 'le pluriel n a pas ete accorde');
  assert.ok(cellules.includes('Lait : 100 cl'));
  assert.ok(cellules.includes('Sucre : 4 morceaux'));
  assert.ok(!cellules.includes('Bœuf haché : 300 g'), 'la valeur d origine subsiste');
});

test('le tableau garde ses fusions de cellules apres mise a l echelle', () => {
  const lasagnes = recettes.find((r) => r.id === 'lasagnes-bolognaise-la-meilleure-recette');
  const r = Fx.echelonnerFlowTable(lasagnes.flowTable, 2);
  assert.strictEqual(r.flowTable.rows.length, lasagnes.flowTable.rows.length);
  lasagnes.flowTable.rows.forEach((ligne, i) => {
    assert.strictEqual(r.flowTable.rows[i].length, ligne.length, `ligne ${i} : nombre de cellules`);
    ligne.forEach((cellule, j) => {
      assert.strictEqual(r.flowTable.rows[i][j].rowspan, cellule.rowspan, `ligne ${i} cellule ${j} : rowspan`);
      assert.strictEqual(r.flowTable.rows[i][j].colspan, cellule.colspan, `ligne ${i} cellule ${j} : colspan`);
    });
  });
});

test('aucune duree ni temperature du tableau ne bouge', () => {
  const lasagnes = recettes.find((r) => r.id === 'lasagnes-bolognaise-la-meilleure-recette');
  const r = Fx.echelonnerFlowTable(lasagnes.flowTable, 3);
  const motif = /(\d+(?:[.,]\d+)?)\s*(minutes?|mn|min|heures?|h\b|°\s*C|cm|mm)/gi;

  lasagnes.flowTable.rows.forEach((ligne, i) => {
    ligne.forEach((cellule, j) => {
      const avant = (cellule.text.match(motif) || []).join('|');
      const apres = (r.flowTable.rows[i][j].text.match(motif) || []).join('|');
      assert.strictEqual(apres, avant, `ligne ${i} cellule ${j} : une durée ou une température a bougé`);
    });
  });
});

test('echelonnerFlowTable ne modifie pas le tableau source', () => {
  const lasagnes = recettes.find((r) => r.id === 'lasagnes-bolognaise-la-meilleure-recette');
  const copie = JSON.parse(JSON.stringify(lasagnes.flowTable));
  Fx.echelonnerFlowTable(lasagnes.flowTable, 2);
  assert.deepStrictEqual(lasagnes.flowTable, copie, 'le tableau d origine a ete modifie sur place');
});

test('echelonnerFlowTable tolere un tableau absent ou un facteur neutre', () => {
  assert.deepStrictEqual(Fx.echelonnerFlowTable(null, 2).flowTable, null);
  const t = { headers: [], rows: [[{ text: 'x : 2 g', rowspan: 1, colspan: 1 }]] };
  assert.strictEqual(Fx.echelonnerFlowTable(t, 1).flowTable, t, 'un facteur 1 devrait rendre le tableau tel quel');
});

test('echelonnerCellule laisse une cellule sans quantite intacte', () => {
  assert.strictEqual(Fx.echelonnerCellule('Sel, poivre', 2).texte, 'Sel, poivre');
  assert.strictEqual(
    Fx.echelonnerCellule('Mélanger la sauce tomate et la viande : sauce bolognaise', 2).texte,
    'Mélanger la sauce tomate et la viande : sauce bolognaise'
  );
});

// --- Integrite du jeu de donnees ---------------------------------------------

test('les 21 recettes respectent le schema attendu', () => {
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
  assert.strictEqual(recettes.length, 21);
  const ids = new Set();
  recettes.forEach((r) => {
    champs.forEach((c) => assert.ok(c in r, `${r.id} : champ ${c} manquant`));
    assert.ok(!ids.has(r.id), `id en doublon : ${r.id}`);
    ids.add(r.id);
    assert.ok(['Entrée', 'Plat', 'Dessert'].includes(r.categorie), `${r.id} : categorie ${r.categorie}`);
    // La source est toujours nommee. L'adresse, elle, peut manquer : une page de
    // livre photographiee n'a pas d'URL, et en inventer une serait pire que de ne
    // rien mettre.
    assert.ok(
      typeof r.source.label === 'string' && r.source.label.length > 0,
      `${r.id} : source sans intitule`
    );
    assert.ok(
      r.source.url === null || /^https?:\/\//.test(r.source.url),
      `${r.id} : url source invalide`
    );
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

// --- cuisson.js : ou l'on en est dans une recette -----------------------------

const Cu = (function () {
  global.localStorage = global.localStorage || {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  return require(path.join(racine, 'js/cuisson.js'));
})();

function cuissonNeuve() {
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
  const chemin = require.resolve(path.join(racine, 'js/cuisson.js'));
  delete require.cache[chemin];
  return require(chemin);
}

test('le mode par defaut est la consultation', () => {
  const C = cuissonNeuve();
  assert.strictEqual(C.mode('tapenade-maison'), 'consulter');
  assert.strictEqual(C.etape('tapenade-maison', 5), 0);
});

test('le mode et l etape sont retenus par recette', () => {
  const C = cuissonNeuve();
  C.definirMode('tapenade', 'cuisiner');
  C.definirEtape('tapenade', 2);
  assert.strictEqual(C.mode('tapenade'), 'cuisiner');
  assert.strictEqual(C.etape('tapenade', 5), 2);
  // Une autre recette n'est pas affectee : on peut cuisiner l'une en consultant
  // l'autre.
  assert.strictEqual(C.mode('brookies'), 'consulter');
  assert.strictEqual(C.etape('brookies', 5), 0);
});

test('un mode inconnu retombe sur la consultation', () => {
  const C = cuissonNeuve();
  C.definirMode('x', 'plein-ecran');
  assert.strictEqual(C.mode('x'), 'consulter');
});

test('l etape est bornee au nombre d etapes, a la lecture', () => {
  const C = cuissonNeuve();
  C.definirEtape('x', 12);
  // La recette a ete raccourcie depuis : sans bornage a la lecture, l'ecran
  // resterait vide sur une etape qui n'existe plus.
  assert.strictEqual(C.etape('x', 4), 3);
  assert.strictEqual(C.etape('x', 1), 0);
  assert.strictEqual(C.etape('x', 0), 0);
});

test('une etape negative ou absurde vaut zero', () => {
  const C = cuissonNeuve();
  C.definirEtape('x', -4);
  assert.strictEqual(C.etape('x', 6), 0);
  C.definirEtape('x', 2.7);
  assert.strictEqual(C.etape('x', 6), 2);
});

test('oublier une recette efface son mode et son etape', () => {
  const C = cuissonNeuve();
  C.definirMode('x', 'cuisiner');
  C.definirEtape('x', 3);
  C.oublier('x');
  assert.strictEqual(C.mode('x'), 'consulter');
  assert.strictEqual(C.etape('x', 6), 0);
});

test('un stockage illisible ne fait pas tomber la lecture', () => {
  const memoire = { 'carnet-de-recettes:cuisson': 'ceci n est pas du json' };
  global.localStorage = {
    getItem: (c) => (c in memoire ? memoire[c] : null),
    setItem: () => {},
    removeItem: () => {},
  };
  const chemin = require.resolve(path.join(racine, 'js/cuisson.js'));
  delete require.cache[chemin];
  const C = require(chemin);
  assert.strictEqual(C.mode('x'), 'consulter');
  assert.strictEqual(C.etape('x', 4), 0);
});

// --- Regroupement visuel des lignes proches ----------------------------------
//
// Purement calculatoire : aucune donnee stockee n'entre en jeu, seul le module doit
// etre charge, avec le localStorage minimal qu'il attend au chargement.

const St = (function () {
  global.localStorage = global.localStorage || {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  return require(path.join(racine, 'js/storage.js'));
})();


test('les lignes du meme produit sont regroupees sans etre fusionnees', () => {
  const l = (nom, quantite) => ({ nom, quantite, articles: [] });
  const entrees = St.grouperProches([
    l('Beurre', '70 g'),
    l('Beurre aux cristaux de sel', '75 g'),
    l('Beurre aux cristaux de sel ramolli', '120 g'),
    l('Emmental râpé', '100 g'),
    l('Lait', '50 cl'),
  ]);

  assert.strictEqual(entrees.length, 3, JSON.stringify(entrees.map((e) => e.type)));
  assert.strictEqual(entrees[0].type, 'groupe');
  assert.strictEqual(entrees[0].tete, 'Beurre');
  assert.strictEqual(entrees[0].lignes.length, 3);
  // Aucune fusion : les trois quantites restent distinctes, telles quelles.
  assert.deepStrictEqual(
    entrees[0].lignes.map((x) => x.quantite),
    ['70 g', '75 g', '120 g']
  );
  assert.strictEqual(entrees[1].type, 'ligne');
  assert.strictEqual(entrees[2].ligne.nom, 'Lait');
});

test('le regroupement traite le pluriel et la ligature', () => {
  const l = (nom) => ({ nom, quantite: '', articles: [] });
  const entrees = St.grouperProches([l('Œuf pour cookie'), l('Œufs pour brownie')]);
  assert.strictEqual(entrees.length, 1);
  assert.strictEqual(entrees[0].type, 'groupe');
  // Le libelle reprend le mot tel qu'il est ecrit, ligature comprise.
  assert.strictEqual(entrees[0].tete, 'Œuf');
  assert.strictEqual(entrees[0].cle, 'oeuf');
});

test('un mot de tete trop court ne declenche aucun regroupement', () => {
  const l = (nom) => ({ nom, quantite: '', articles: [] });
  // « sel » et « ail » sont courts et sans variantes : les regrouper avec
  // « Sel, poivre » n'apporterait rien et ferait des cadres pour rien.
  const entrees = St.grouperProches([l('Sel'), l('Sel, poivre'), l('Ail')]);
  assert.deepStrictEqual(
    entrees.map((e) => e.type),
    ['ligne', 'ligne', 'ligne']
  );
});

test('une ligne seule de son espece n est pas encadree', () => {
  const entrees = St.grouperProches([{ nom: 'Farine T65', quantite: '250 g', articles: [] }]);
  assert.deepStrictEqual(entrees, [{ type: 'ligne', ligne: entrees[0].ligne }]);
});

test('un groupe prend la place de son premier membre dans l ordre', () => {
  const l = (nom) => ({ nom, quantite: '', articles: [] });
  const entrees = St.grouperProches([l('Amandes'), l('Farine'), l('Farine T65'), l('Sucre roux')]);
  assert.deepStrictEqual(
    entrees.map((e) => (e.type === 'groupe' ? e.tete : e.ligne.nom)),
    ['Amandes', 'Farine', 'Sucre roux']
  );
});

test('le regroupement tolere une liste vide ou absente', () => {
  assert.deepStrictEqual(St.grouperProches([]), []);
  assert.deepStrictEqual(St.grouperProches(null), []);
});

test('motDeTete isole le premier mot significatif', () => {
  assert.strictEqual(St.motDeTete('Farine T65 pour brownie'), 'farine');
  assert.strictEqual(St.motDeTete('Œufs pour brownie'), 'oeuf');
  assert.strictEqual(St.motDeTete('Pulpe de tomate en conserve (ou 500 g)'), 'pulpe');
  assert.strictEqual(St.motDeTete('Sel, poivre'), 'sel');
  assert.strictEqual(St.motDeTete(''), '');
});

// --- Filtre sur les realisations ---------------------------------------------

test('le filtre des realisations separe le jamais fait du deja fait', () => {
  const comptes = { 'tapenade-maison': 3, anchoiade: 1 };
  const jamais = L.filterRecipes(recettes, { realisations: 'jamais' }, comptes).map((r) => r.id);
  assert.ok(!jamais.includes('tapenade-maison'));
  assert.ok(!jamais.includes('anchoiade'));
  assert.strictEqual(jamais.length, recettes.length - 2);

  const deja = L.filterRecipes(recettes, { realisations: 'deja' }, comptes).map((r) => r.id);
  assert.deepStrictEqual(deja.sort(), ['anchoiade', 'tapenade-maison']);
});

test('sans table de comptes, tout est considere jamais fait', () => {
  // C'est le cas d'un carnet dont le semainier n'a pas encore d'historique : mieux
  // vaut ce comportement previsible qu'une erreur sur une table absente.
  assert.strictEqual(L.filterRecipes(recettes, { realisations: 'jamais' }).length, recettes.length);
  assert.strictEqual(L.filterRecipes(recettes, { realisations: 'deja' }).length, 0);
});

test('le filtre des realisations se combine aux autres', () => {
  const comptes = { 'tapenade-maison': 2, 'tiramisu-classique': 1 };
  const resultat = L.filterRecipes(recettes, { realisations: 'deja', categorie: 'Dessert' }, comptes);
  assert.deepStrictEqual(
    resultat.map((r) => r.id),
    ['tiramisu-classique']
  );
});

test('criteresVides comprend le critere des realisations', () => {
  assert.strictEqual(L.criteresVides().realisations, null);
});

// --- semaine.js : calendrier du semainier ------------------------------------

test('cleJour utilise la date locale et non UTC', () => {
  // 23 h le 3 aout : toISOString() rendrait le 4 dans tout fuseau a l'est de
  // Greenwich. La cle doit rester le 3, sinon un diner tombe le lendemain.
  const soir = new Date(2026, 7, 3, 23, 30, 0, 0);
  assert.strictEqual(Sn.cleJour(soir), '2026-08-03');
  const matin = new Date(2026, 0, 1, 0, 15, 0, 0);
  assert.strictEqual(Sn.cleJour(matin), '2026-01-01');
});

test('depuisCle relit une date locale et rejette les cles invalides', () => {
  const date = Sn.depuisCle('2026-08-03');
  assert.strictEqual(date.getFullYear(), 2026);
  assert.strictEqual(date.getMonth(), 7);
  assert.strictEqual(date.getDate(), 3, 'le jour a glisse : la cle a ete lue en UTC');
  assert.strictEqual(date.getHours(), 12, 'midi met la date a l abri des changements d heure');
  assert.strictEqual(Sn.depuisCle('2026-02-31'), null, 'le 31 fevrier devrait etre refuse');
  assert.strictEqual(Sn.depuisCle('2026-13-01'), null);
  assert.strictEqual(Sn.depuisCle('03/08/2026'), null);
  assert.strictEqual(Sn.depuisCle(''), null);
  assert.strictEqual(Sn.depuisCle(null), null);
});

test('lundiDe recule au bon lundi, dimanche compris', () => {
  // Le 3 aout 2026 est un lundi, le 9 le dimanche suivant.
  const lundi = new Date(2026, 7, 3, 12);
  const dimanche = new Date(2026, 7, 9, 12);
  assert.strictEqual(Sn.cleJour(Sn.lundiDe(lundi)), '2026-08-03');
  assert.strictEqual(Sn.cleJour(Sn.lundiDe(new Date(2026, 7, 6, 12))), '2026-08-03');
  // Le piege : getDay() vaut 0 le dimanche, un calcul naif ne reculerait pas.
  assert.strictEqual(Sn.cleJour(Sn.lundiDe(dimanche)), '2026-08-03');
  assert.strictEqual(Sn.cleJour(Sn.lundiDe(new Date(2026, 7, 10, 12))), '2026-08-10');
});

test('lundiDe ne modifie pas la date recue', () => {
  const origine = new Date(2026, 7, 6, 9, 30);
  const copie = new Date(origine.getTime());
  Sn.lundiDe(origine);
  assert.strictEqual(origine.getTime(), copie.getTime(), 'la date d entree a ete modifiee sur place');
});

test('une semaine compte sept jours du lundi au dimanche', () => {
  const sem = Sn.semaine(new Date(2026, 7, 5, 12), new Date(2026, 7, 5, 12));
  assert.strictEqual(sem.cle, '2026-08-03');
  assert.strictEqual(sem.jours.length, 7);
  assert.deepStrictEqual(
    sem.jours.map((j) => j.nom),
    ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
  );
  assert.deepStrictEqual(
    sem.jours.map((j) => j.cle),
    [
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
      '2026-08-09',
    ]
  );
  assert.strictEqual(sem.contientAujourdhui, true);
  assert.deepStrictEqual(
    sem.jours.filter((j) => j.estAujourdhui).map((j) => j.cle),
    ['2026-08-05']
  );
  assert.deepStrictEqual(
    sem.jours.filter((j) => j.estPasse).map((j) => j.cle),
    ['2026-08-03', '2026-08-04']
  );
});

test('une semaine a cheval sur deux mois reste correcte', () => {
  const sem = Sn.semaine(new Date(2026, 7, 31, 12), new Date(2026, 7, 31, 12));
  assert.strictEqual(sem.cle, '2026-08-31');
  assert.strictEqual(sem.jours[6].cle, '2026-09-06');
  assert.strictEqual(sem.libelle, 'du lundi 31 août au dimanche 6 septembre');
});

test('le libelle ne repete pas le mois quand il ne change pas', () => {
  assert.strictEqual(Sn.libelleSemaine(new Date(2026, 7, 3, 12)), 'du lundi 3 au dimanche 9 août');
});

test('une semaine a cheval sur deux annees reste correcte', () => {
  // 28 decembre 2026 est un lundi : la semaine finit le 3 janvier 2027.
  const sem = Sn.semaine(new Date(2026, 11, 28, 12), null);
  assert.strictEqual(sem.cle, '2026-12-28');
  assert.strictEqual(sem.jours[6].cle, '2027-01-03');
});

test('semaines rend les semaines demandees a partir de celle du jour', () => {
  const liste = Sn.semaines(new Date(2026, 7, 5, 12), 2);
  assert.strictEqual(liste.length, 2);
  assert.strictEqual(liste[0].cle, '2026-08-03');
  assert.strictEqual(liste[1].cle, '2026-08-10');
  assert.strictEqual(liste[0].contientAujourdhui, true);
  assert.strictEqual(liste[1].contientAujourdhui, false);
  // Aucune semaine passee : le semainier ne sert ni aux courses ni a la cuisine
  // pour un repas deja mange.
  assert.ok(liste.every((s) => s.cle >= '2026-08-03'));
  assert.strictEqual(Sn.semaines(new Date(2026, 7, 5, 12), 0).length, 1, 'au moins une semaine');
});

/* --- rappel des ingredients de l'etape en cours --------------------------- */

const RECETTE_RAPPEL = {
  id: 'test-rappel',
  titre: 'Test',
  ingredients: [
    {
      groupe: '',
      items: [
        { nom: 'Oignon', quantite: '1' },
        { nom: 'Ail', quantite: '1 gousse' },
        { nom: "Huile d'olive", quantite: '2 c. à s.' },
        { nom: 'Œufs', quantite: '3' },
        { nom: 'Crème fraîche', quantite: '20 cl' },
      ],
    },
  ],
  instructions: [
    { numero: 1, texte: "Couper un oignon et une gousse d'ail, faire revenir dans l'huile." },
    { numero: 2, texte: 'Battre les œufs.' },
    { numero: 3, texte: 'Laisser reposer la préparation une heure.' },
  ],
};

test('le rappel d etape retrouve les ingredients cites, apostrophe comprise', () => {
  const rappel = L.ingredientsDeLEtape(RECETTE_RAPPEL, RECETTE_RAPPEL.instructions[0]);
  assert.deepStrictEqual(
    rappel.map((i) => i.nom),
    ['Oignon', 'Ail', "Huile d'olive"]
  );
  // La quantite accompagne le nom : c'est ce qu'on vient verifier en cuisine.
  assert.strictEqual(rappel[1].quantite, '1 gousse');
});

test('le rappel d etape accorde le singulier et le pluriel', () => {
  // « les oeufs » dans l'etape doit rencontrer « Oeufs » dans la liste, et l'accent
  // ne doit pas empecher le rapprochement.
  assert.deepStrictEqual(
    L.ingredientsDeLEtape(RECETTE_RAPPEL, RECETTE_RAPPEL.instructions[1]).map((i) => i.nom),
    ['Œufs']
  );
});

test('une etape qui ne cite aucun ingredient ne rappelle rien', () => {
  // Le rappel vide est le comportement voulu : deviner serait pire que se taire,
  // et la liste complete reste accessible d'un pli.
  assert.deepStrictEqual(L.ingredientsDeLEtape(RECETTE_RAPPEL, RECETTE_RAPPEL.instructions[2]), []);
  assert.deepStrictEqual(L.ingredientsDeLEtape(RECETTE_RAPPEL, null), []);
  assert.deepStrictEqual(L.ingredientsDeLEtape(null, RECETTE_RAPPEL.instructions[0]), []);
});

test('le rappel d etape lit aussi l astuce de l etape', () => {
  const rappel = L.ingredientsDeLEtape(RECETTE_RAPPEL, {
    numero: 1,
    texte: 'Mélanger le tout.',
    astuce: 'Astuce : une cuillère de crème fraîche adoucit la sauce.',
  });
  assert.deepStrictEqual(
    rappel.map((i) => i.nom),
    ['Crème fraîche']
  );
});

test('le rappel d etape ne remonte jamais un ingredient deux fois', () => {
  // Le meme ingredient peut figurer dans deux groupes de la fiche : c'est le meme
  // bocal, il ne doit apparaitre qu'une fois dans le rappel.
  const recette = {
    ingredients: [
      { groupe: 'Pâte', items: [{ nom: 'Beurre', quantite: '100 g' }] },
      { groupe: 'Garniture', items: [{ nom: 'Beurre', quantite: '100 g' }] },
    ],
  };
  assert.deepStrictEqual(
    L.ingredientsDeLEtape(recette, { texte: 'Faire fondre le beurre.' }).map((i) => i.nom),
    ['Beurre']
  );
});

test('le rappel d etape couvre la majorite des etapes du carnet', () => {
  // Mesure sur les vraies fiches, pas sur un exemple : la deduction ne vaut que ce
  // qu'elle donne sur les 140 etapes reellement ecrites. Le seuil est un garde-fou
  // contre une regression silencieuse, pas un objectif.
  let total = 0;
  let avecRappel = 0;
  recettes.forEach((recette) => {
    (recette.instructions || []).forEach((etape) => {
      total += 1;
      if (L.ingredientsDeLEtape(recette, etape).length > 0) avecRappel += 1;
    });
  });
  assert.strictEqual(total, 145, total + ' etapes au lieu de 145');
  assert.ok(avecRappel >= 105, avecRappel + ' etapes sur ' + total + ' seulement portent un rappel');
});

test('les cles de creneau se composent et se decoupent', () => {
  assert.strictEqual(Sn.cleCreneau('2026-08-03', 'dejeuner'), '2026-08-03::dejeuner');
  // Cle historique, a deux morceaux : elle designe l'unique plat de son repas.
  assert.deepStrictEqual(Sn.decouperCreneau('2026-08-03::diner'), {
    jour: '2026-08-03',
    moment: 'diner',
    suffixe: null,
    cleCreneau: '2026-08-03::diner',
  });
  assert.strictEqual(Sn.decouperCreneau('2026-08-03'), null);
  assert.strictEqual(Sn.decouperCreneau('pas-une-date::diner'), null);
  assert.strictEqual(Sn.decouperCreneau('a::b::c'), null);
  assert.strictEqual(Sn.decouperCreneau(''), null);
});

test('une cle de plat porte un suffixe et se rattache a son repas', () => {
  assert.strictEqual(Sn.cleItem('2026-08-03', 'dejeuner', 'k3f9za'), '2026-08-03::dejeuner::k3f9za');
  assert.deepStrictEqual(Sn.decouperCreneau('2026-08-03::dejeuner::k3f9za'), {
    jour: '2026-08-03',
    moment: 'dejeuner',
    suffixe: 'k3f9za',
    cleCreneau: '2026-08-03::dejeuner',
  });
  // Un suffixe vide n'identifie rien : la cle est refusee plutot que confondue avec
  // la forme a deux morceaux.
  assert.strictEqual(Sn.decouperCreneau('2026-08-03::dejeuner::'), null);
});

test('les suffixes de plat ne se repetent pas sur une serie courte', () => {
  // Deux plats poses dans le meme repas doivent aboutir a deux documents : un
  // suffixe repete en ecraserait un des deux sans un mot.
  const vus = new Set();
  for (let i = 0; i < 500; i += 1) vus.add(Sn.suffixeItem());
  assert.strictEqual(vus.size, 500, 'suffixes en collision : ' + (500 - vus.size));
});

test('les trois moments de la journee sont ordonnes et dimensionnes', () => {
  assert.deepStrictEqual(
    Sn.MOMENTS.map((m) => m.cle),
    ['petit-dejeuner', 'dejeuner', 'diner']
  );
  // Le dejeuner et le diner sont les repas qu'on cuisine : ils ont plus de place.
  assert.deepStrictEqual(
    Sn.MOMENTS.map((m) => m.taille),
    ['courte', 'haute', 'haute']
  );
  assert.strictEqual(Sn.estMomentConnu('dejeuner'), true);
  assert.strictEqual(Sn.estMomentConnu('gouter'), false);
});

test('la grille et l entete de journee emploient le meme vocabulaire', () => {
  // « Matin / Midi / Soir » dans la grille et « Petit-dejeuner / Dejeuner / Diner »
  // dans le recap du jour faisaient deux noms pour le meme creneau.
  assert.deepStrictEqual(
    Sn.MOMENTS.map((m) => m.libelle),
    ['Petit-déjeuner', 'Déjeuner', 'Dîner']
  );
  Sn.MOMENTS.forEach((m) => {
    assert.strictEqual(m.court, m.libelle, m.cle + ' porte deux libelles differents');
  });
});

test('les repas hors carnet couvrent les habitudes de la maison', () => {
  const titres = Sn.REPAS_LIBRES.map((r) => r.titre);
  ['Japonais', 'Pizzas', 'Restaurant', 'Burger King', 'McDonnalds', 'La boucherie', 'Au bureau'].forEach((attendu) => {
    assert.ok(titres.includes(attendu), attendu + ' manque dans REPAS_LIBRES');
  });
  // Chaque entree porte un pictogramme qui existe : sinon la pastille sort vide.
  Sn.REPAS_LIBRES.forEach((r) => {
    assert.strictEqual(Ic.existe(r.icone), true, r.titre + ' : pictogramme ' + r.icone + ' inconnu');
  });
});

test('creneauxDe couvre les 21 repas d une semaine sans doublon', () => {
  const sem = Sn.semaine(new Date(2026, 7, 3, 12), null);
  const creneaux = Sn.creneauxDe(sem);
  assert.strictEqual(creneaux.length, 21);
  assert.strictEqual(new Set(creneaux.map((c) => c.cle)).size, 21);
  assert.strictEqual(creneaux[0].cle, '2026-08-03::petit-dejeuner');
  assert.strictEqual(creneaux[20].cle, '2026-08-09::diner');
});

test('les repas hors carnet ont tous un pictogramme existant', () => {
  assert.ok(Sn.REPAS_LIBRES.length >= 3);
  Sn.REPAS_LIBRES.forEach((repas) => {
    assert.ok(repas.titre && repas.titre.length > 0);
    assert.ok(Ic.existe(repas.icone), `pictogramme manquant : ${repas.icone}`);
  });
  // Ceux que la demande nomme explicitement doivent y etre.
  const titres = Sn.REPAS_LIBRES.map((r) => r.titre);
  ['Restaurant', 'Pizzas', 'Japonais'].forEach((attendu) => {
    assert.ok(titres.includes(attendu), `${attendu} devrait figurer parmi les repas hors carnet`);
  });
});

// --- icones.js ---------------------------------------------------------------

test('chaque rayon et chaque categorie a un pictogramme existant', () => {
  Ry.RAYONS.forEach((rayon) => {
    assert.ok(Ic.existe(Ic.pourRayon(rayon)), `rayon sans pictogramme : ${rayon}`);
  });
  ['Entrée', 'Plat', 'Dessert'].forEach((categorie) => {
    assert.ok(Ic.existe(Ic.pourCategorie(categorie)), `categorie sans pictogramme : ${categorie}`);
  });
  // Une valeur inconnue ne doit pas rendre un nom inexistant.
  assert.ok(Ic.existe(Ic.pourRayon('Rayon imaginaire')));
  assert.ok(Ic.existe(Ic.pourCategorie('Amuse-bouche')));
});

test('les moments de la journee ont aussi leur pictogramme', () => {
  Sn.MOMENTS.forEach((moment) => {
    assert.ok(Ic.existe(moment.cle), `pictogramme manquant pour ${moment.cle}`);
  });
});

test('dessiner rend null pour un nom inconnu plutot que de lever', () => {
  const faux = { createElementNS: () => ({ setAttribute() {}, appendChild() {} }) };
  assert.strictEqual(Ic.dessiner(faux, 'nom-qui-n-existe-pas'), null);
});

// --- Restitution -------------------------------------------------------------

console.log(`\n${reussis} test(s) reussi(s), ${echecs.length} echec(s)\n`);
if (echecs.length > 0) {
  echecs.forEach((e) => console.error(`ECHEC  ${e.nom}\n       ${e.message}\n`));
  process.exit(1);
}
