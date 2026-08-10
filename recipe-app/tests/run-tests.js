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
const Im = require(path.join(racine, 'js/import-recette.js'));
const Pt = require(path.join(racine, 'js/partage.js'));
const Pdf = require(path.join(racine, 'js/pdf.js'));
const MPdf = require(path.join(racine, 'js/menu-pdf.js'));

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

/* --- import d'une recette depuis une page web ------------------------------ */
//
// Les deux pages de test sont écrites à partir de la spécification schema.org et
// non capturées sur un site réel : l'environnement de développement n'a pas accès
// à internet. Elles reproduisent les formes que les sites emploient réellement
// (un @graph, des HowToStep, des durées ISO 8601, des entités HTML), mais aucun
// import contre un vrai site n'a été joué. C'est la limite de cette couverture.

const PAGE_JSONLD = fs.readFileSync(path.join(racine, 'tests/pages/recette-jsonld.html'), 'utf8');
const PAGE_MICRO = fs.readFileSync(path.join(racine, 'tests/pages/recette-microdonnees.html'), 'utf8');

test('une page JSON-LD donne une recette complete', () => {
  const r = Im.importer(PAGE_JSONLD);
  assert.ok(!r.erreur, r.erreur);
  assert.strictEqual(r.recette.titre, 'Tarte aux pommes de mamie');
  assert.strictEqual(r.recette.categorie, 'Dessert');
  assert.strictEqual(r.recette.origine, 'Française');
  assert.strictEqual(r.recette.portions, '6 personnes');
  assert.strictEqual(r.recette.calories, 320);
  assert.strictEqual(r.recette.source.url, 'https://exemple.test/recettes/tarte-aux-pommes');
  assert.strictEqual(r.recette.instructions.length, 4);
  assert.strictEqual(r.recette.ingredients[0].items.length, 6);
});

test('l import trouve la recette au fond d un @graph, malgre un bloc casse', () => {
  // Les pages portent souvent plusieurs blocs JSON-LD, dont un mal formé. Un seul
  // bloc cassé ne doit pas faire échouer l'import.
  assert.strictEqual(Im.blocsJsonLd(PAGE_JSONLD).length, 2, 'le bloc cassé aurait dû être ignoré');
  assert.ok(Im.recetteJsonLd(PAGE_JSONLD), 'la recette du @graph n a pas été trouvée');
});

test('les durees ISO deviennent le format du carnet', () => {
  assert.strictEqual(Im.dureeIso('PT25M'), '25 min');
  assert.strictEqual(Im.dureeIso('PT1H5M'), '1 h 05');
  assert.strictEqual(Im.dureeIso('PT2H'), '2 h');
  // Une durée nulle ou illisible ne devient pas « 0 min » : ce serait une durée
  // mesurée là où la source ne dit rien.
  assert.strictEqual(Im.dureeIso('PT0S'), null);
  assert.strictEqual(Im.dureeIso('bientôt'), null);
  assert.strictEqual(Im.dureeIso(''), null);
  // Et le format produit doit être relisible par le carnet lui-même.
  assert.strictEqual(L.parseMinutes(Im.dureeIso('PT1H5M')), 65);
});

test('les quantites sont separees du nom sans etre inventees', () => {
  assert.deepStrictEqual(Im.decouperIngredient('200 g d’olives noires'), {
    nom: 'Olives noires',
    quantite: '200 g',
  });
  assert.deepStrictEqual(Im.decouperIngredient('1 gousse d’ail'), { nom: 'Ail', quantite: '1 gousse' });
  // Sans nombre, tout le texte reste le nom : deviner « 1 » serait une invention.
  assert.deepStrictEqual(Im.decouperIngredient('Sel'), { nom: 'Sel', quantite: '' });
  assert.deepStrictEqual(Im.decouperIngredient('Selon goût'), { nom: 'Selon goût', quantite: '' });
  assert.strictEqual(Im.decouperIngredient(''), null);
});

test('les entites HTML sont decodees en respectant la casse', () => {
  // `&Eacute;` est un E majuscule : le confondre avec `&eacute;` mettait « éplucher »
  // en tête d'étape.
  assert.strictEqual(Im.decoderEntites('&Eacute;plucher'), 'Éplucher');
  assert.strictEqual(Im.decoderEntites('&eacute;plucher'), 'éplucher');
  assert.strictEqual(Im.decoderEntites('180 &deg;C'), '180 °C');
  assert.strictEqual(Im.decoderEntites('l&rsquo;ail &amp; le sel'), 'l’ail & le sel');
  assert.strictEqual(Im.decoderEntites('&oelig;ufs'), 'œufs');
  // Une entité inconnue est laissée telle quelle plutôt que supprimée.
  assert.strictEqual(Im.decoderEntites('&inconnue;'), '&inconnue;');
});

test('l import declare ce que la source ne donne pas', () => {
  // C'est la règle du projet : un trou se déclare, il ne se comble pas.
  const r = Im.importer(PAGE_JSONLD);
  assert.ok(r.recette.manquants.length > 0, 'aucun manquant relevé');
  assert.ok(
    r.recette.manquants.some((m) => /quantité lisible/.test(m)),
    'la cannelle sans quantité n a pas été signalée'
  );
  assert.strictEqual(r.recette.temps.repos, 'Non indiqué');
});

test('une source sans duree ni categorie le declare au lieu de deviner', () => {
  const r = Im.importer(
    JSON.stringify({ '@type': 'Recipe', name: 'Truc', recipeIngredient: ['2 œufs'] })
  );
  assert.ok(!r.erreur, r.erreur);
  assert.strictEqual(r.recette.temps.total, 'Non indiqué');
  assert.strictEqual(r.recette.portions, 'Non indiqué');
  // « Plat » est un défaut, pas une donnée : il doit être annoncé comme tel.
  assert.strictEqual(r.recette.categorie, 'Plat');
  assert.ok(
    r.recette.manquants.some((m) => /catégorie/.test(m) && /défaut/.test(m)),
    'le défaut de catégorie n est pas déclaré'
  );
  assert.ok(r.recette.manquants.some((m) => /aucune durée/.test(m)));
  assert.ok(r.recette.manquants.some((m) => /nombre de parts/.test(m)));
});

test('le temps total n est jamais calcule a partir des autres', () => {
  // Additionner préparation et cuisson supposerait qu'elles ne se chevauchent pas,
  // ce que la source ne dit pas.
  const r = Im.importer(
    JSON.stringify({
      '@type': 'Recipe',
      name: 'Truc',
      recipeIngredient: ['2 œufs'],
      prepTime: 'PT20M',
      cookTime: 'PT30M',
    })
  );
  assert.strictEqual(r.recette.temps.total, 'Non indiqué');
  assert.ok(r.recette.manquants.some((m) => /temps total/.test(m)));
});

test('une page en microdonnees est importee aussi', () => {
  const r = Im.importer(PAGE_MICRO);
  assert.ok(!r.erreur, r.erreur);
  assert.strictEqual(r.recette.titre, 'Soupe de potiron');
  assert.strictEqual(r.recette.categorie, 'Entrée');
  assert.strictEqual(r.recette.portions, '4 personnes');
  assert.strictEqual(r.recette.temps.preparation, '15 min');
  assert.strictEqual(r.recette.ingredients[0].items.length, 4);
  assert.strictEqual(r.recette.instructions.length, 3);
});

test('une page sans recette est refusee avec une raison', () => {
  const r = Im.importer('<html><body><h1>Bonjour</h1></body></html>');
  assert.ok(r.erreur, 'une page quelconque a été acceptée comme recette');
  assert.ok(/schema.org|copie/.test(r.erreur), r.erreur);
  assert.strictEqual(Im.importer('').erreur, 'rien n’a été collé');

  // Un schema.org sans ingrédient n'est pas une recette exploitable.
  const sansIngredient = Im.importer(JSON.stringify({ '@type': 'Recipe', name: 'Truc' }));
  assert.ok(/ingrédient/.test(sansIngredient.erreur), sansIngredient.erreur);
});

test('un contenu hostile ne peut ni s executer ni salir la fiche', () => {
  // Deux garanties distinctes, et il faut les deux :
  //   - rien ne s'execute, parce que `el()` de app.js ne pose que du texte, jamais
  //     du HTML. Un test navigateur le verifie sur la page reelle ;
  //   - rien ne salit la fiche : les balises sont retirees ici, sinon un titre
  //     ressortirait en « <img src=x onerror=…>Tarte » dans le livre.
  const hostile = JSON.stringify({
    '@type': 'Recipe',
    name: '<img src=x onerror=alert(1)>Piège',
    url: 'javascript:alert(1)',
    recipeIngredient: ['200 g de <script>alert(1)</script>poivre'],
    recipeInstructions: [{ '@type': 'HowToStep', text: '<b>Gras</b> et <script>alert(1)</script> fin' }],
  });
  const r = Im.importer(hostile);
  assert.strictEqual(r.recette.titre, 'Piège');
  assert.strictEqual(r.recette.ingredients[0].items[0].nom, 'Poivre');
  assert.strictEqual(r.recette.instructions[0].texte, 'Gras et fin');
  // Une URL `javascript:` n'est jamais retenue : elle deviendrait un lien piege sur
  // la fiche. Seuls http et https passent.
  assert.strictEqual(r.recette.source.url, '');
  ['<', '>', 'onerror', 'script'].forEach((motif) => {
    assert.ok(!JSON.stringify(r.recette).includes(motif), `« ${motif} » a survécu à l import`);
  });
});

test('la recette importee respecte le schema du carnet', () => {
  // Une recette importée doit passer les mêmes contrôles qu'une recette du fichier :
  // sinon elle casserait un écran une fois enregistrée.
  const r = Im.importer(PAGE_JSONLD).recette;
  ['id', 'titre', 'categorie', 'origine', 'difficulte', 'portions', 'temps', 'calories', 'source',
   'ingredients', 'instructions', 'astuces', 'variantes', 'manquants', 'flowTable'].forEach((champ) => {
    assert.ok(champ in r, `champ manquant : ${champ}`);
  });
  assert.ok(['Entrée', 'Plat', 'Dessert'].includes(r.categorie));
  assert.ok(r.source.url === '' || /^https?:\/\//.test(r.source.url));
  ['preparation', 'cuisson', 'repos', 'total'].forEach((c) => assert.ok(c in r.temps));
  r.instructions.forEach((e) => {
    assert.strictEqual(typeof e.numero, 'number');
    assert.ok(typeof e.texte === 'string' && e.texte.length > 0);
  });
  // Et les ingrédients importés doivent tous se ranger dans un rayon.
  r.ingredients[0].items.forEach((i) => {
    assert.notStrictEqual(Ry.rayonDe(i.nom), Ry.RAYON_DEFAUT, `sans rayon : ${i.nom}`);
  });
});

test('la coquille du service worker couvre tous les fichiers de la page', () => {
  // Un module ajoute a index.html et oublie dans sw.js casserait le hors ligne en
  // silence : la page s'ouvrirait sans reseau, puis echouerait sur un script absent.
  const sw = fs.readFileSync(path.join(racine, 'sw.js'), 'utf8');
  const html = fs.readFileSync(path.join(racine, 'index.html'), 'utf8');

  const scripts = [...html.matchAll(/<script src="(js\/[a-z-]+\.js)">/g)].map((m) => './' + m[1]);
  assert.ok(scripts.length > 0, 'aucun script trouve dans index.html');
  scripts.forEach((f) => {
    assert.ok(sw.includes(`'${f}'`), `${f} est dans index.html mais absent de la coquille de sw.js`);
  });

  // Et les autres fichiers servis, qui ne sont pas des scripts. Les icônes en font
  // partie : sans elles, l'application installée sur un téléphone perdrait son icône
  // dès que le réseau manque.
  ['./index.html', './favicon.svg', './css/style.css', './data/recipes.json',
   './manifest.webmanifest', './icones/apple-touch-icon.png'].forEach((f) => {
    assert.ok(sw.includes(`'${f}'`), `${f} est absent de la coquille de sw.js`);
  });

  // Toute icône déclarée par le manifeste doit être dans la coquille.
  const manifeste = JSON.parse(fs.readFileSync(path.join(racine, 'manifest.webmanifest'), 'utf8'));
  manifeste.icons.forEach((i) => {
    assert.ok(sw.includes(`'./${i.src}'`), `${i.src} est déclarée au manifeste mais absente de la coquille`);
  });

  // Chaque entree de la coquille doit exister sur le disque, sinon `cache.addAll`
  // rejette en bloc et le service worker ne s'installe pas du tout.
  const coquille = [...sw.matchAll(/'(\.\/[^']*)'/g)].map((m) => m[1]).filter((f) => f !== './');
  coquille.forEach((f) => {
    assert.ok(fs.existsSync(path.join(racine, f.slice(2))), `${f} est dans la coquille mais absent du dépôt`);
  });
});

test('le manifeste porte des icones matricielles, dont une maskable', () => {
  const manifeste = JSON.parse(fs.readFileSync(path.join(racine, 'manifest.webmanifest'), 'utf8'));

  // Un SVG seul ne suffit pas : Android et iOS demandent du PNG pour l'écran
  // d'accueil, et sans 512 px l'écran de démarrage généré n'est pas proposé.
  const png = manifeste.icons.filter((i) => i.type === 'image/png');
  assert.ok(png.length >= 2, 'il faut au moins deux tailles PNG');
  assert.ok(png.some((i) => i.sizes === '512x512'), 'la taille 512 manque');
  assert.ok(png.some((i) => i.sizes === '192x192'), 'la taille 192 manque');

  // « maskable » : Android rogne un cercle dans le carré. Sans une icône prévue pour,
  // le dessin est coupé sur les bords.
  assert.ok(
    manifeste.icons.some((i) => i.purpose === 'maskable'),
    'aucune icône maskable : Android rognerait le dessin'
  );

  manifeste.icons.forEach((i) => {
    assert.ok(fs.existsSync(path.join(racine, i.src)), `icône absente : ${i.src}`);
  });

  // L'écran de démarrage généré par Android reprend le fond du manifeste : il doit
  // être celui de l'application, sinon le lancement passe par un aplat étranger.
  assert.strictEqual(manifeste.background_color, '#f5ead8');
});

test('l ecran de demarrage ne peut pas rester coince', () => {
  // Il est dans le HTML pour être peint avant tout script. La contrepartie est qu'il
  // recouvre la page : il lui faut donc une sortie qui ne dépende pas de JavaScript.
  const html = fs.readFileSync(path.join(racine, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(racine, 'css/style.css'), 'utf8');
  const app = fs.readFileSync(path.join(racine, 'js/app.js'), 'utf8');

  assert.ok(/id="demarrage"/.test(html), 'l écran de démarrage est absent de index.html');
  assert.ok(/animation: demarrage-secours/.test(css), 'la sortie de secours CSS est absente');
  assert.ok(/@keyframes demarrage-secours/.test(css), 'l animation de secours n est pas définie');
  assert.ok(/demarrage--parti/.test(app), 'app.js ne retire jamais l écran de démarrage');
  // Y compris quand le mouvement est désactivé : sans cette règle, l'animation de
  // secours ne s exécuterait pas et l écran resterait affiché.
  assert.ok(
    /prefers-reduced-motion[\s\S]*demarrage-secours/.test(css),
    'sous prefers-reduced-motion, l écran de démarrage n a plus de sortie'
  );
});

test('le manifeste decrit une application installable', () => {
  const manifeste = JSON.parse(fs.readFileSync(path.join(racine, 'manifest.webmanifest'), 'utf8'));
  assert.strictEqual(manifeste.name, 'Miam miam !');
  assert.strictEqual(manifeste.display, 'standalone');
  // Les chemins sont relatifs : le site est publie sous /Cahier-de-recette/ et non
  // a la racine du domaine, une URL absolue sortirait de la portee.
  assert.ok(manifeste.start_url.startsWith('./'), 'start_url doit etre relatif');
  assert.ok(manifeste.scope.startsWith('./'), 'scope doit etre relatif');
  assert.ok(manifeste.icons.length > 0, 'aucune icone');
  manifeste.icons.forEach((i) => {
    assert.ok(fs.existsSync(path.join(racine, i.src)), `icone absente : ${i.src}`);
  });
});

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

// --- partage.js --------------------------------------------------------------

test('lien construit une adresse de fiche depuis l adresse courante', () => {
  const r = { id: 'tapenade-maison' };
  assert.strictEqual(
    Pt.lien(r, 'https://exemple.fr/Cahier-de-recette/#/liste-de-courses'),
    'https://exemple.fr/Cahier-de-recette/#/recette/tapenade-maison'
  );
  // Un index.html explicite, une barre finale ou une chaine de requete ne doivent pas
  // se retrouver au milieu de l adresse.
  assert.strictEqual(
    Pt.lien(r, 'https://exemple.fr/carnet/index.html'),
    'https://exemple.fr/carnet/#/recette/tapenade-maison'
  );
  assert.strictEqual(Pt.lien(r, 'https://exemple.fr/carnet///'), 'https://exemple.fr/carnet/#/recette/tapenade-maison');
  assert.strictEqual(Pt.lien(r, 'https://exemple.fr/carnet/?x=1'), 'https://exemple.fr/carnet/#/recette/tapenade-maison');
  // L identifiant est encode : sans cela un identifiant a espace casserait l adresse.
  assert.ok(Pt.lien({ id: 'a b' }, 'https://exemple.fr/c/').endsWith('/#/recette/a%20b'));
});

test('lien rend une chaine vide sans identifiant', () => {
  assert.strictEqual(Pt.lien(null, 'https://exemple.fr/'), '');
  assert.strictEqual(Pt.lien({}, 'https://exemple.fr/'), '');
});

test('partageable interdit le lien d une recette ajoutee jamais envoyee', () => {
  const etat = Pt.partageable({ id: 'x' }, { ajoutee: true, erreurEcriture: 'réseau injoignable' });
  assert.strictEqual(etat.possible, false);
  assert.ok(/réseau injoignable/.test(etat.raison), etat.raison);
});

test('partageable autorise le lien d une recette modifiee, avec une reserve', () => {
  const etat = Pt.partageable({ id: 'x' }, { ajoutee: false, erreurEcriture: 'réseau injoignable' });
  assert.strictEqual(etat.possible, true);
  assert.ok(/version précédente/.test(etat.reserve), etat.reserve);
});

test('partageable ne pose aucune reserve quand tout est parti', () => {
  const etat = Pt.partageable({ id: 'x' }, { ajoutee: true, erreurEcriture: null });
  assert.deepStrictEqual(etat, { possible: true, raison: null, reserve: null });
});

test('enTexte rend une recette lisible telle quelle', () => {
  const recette = {
    id: 'essai',
    titre: 'Soupe à l’oignon',
    portions: '4 personnes',
    temps: { total: '1 h 10' },
    ingredients: [
      { groupe: 'Base', items: [{ nom: 'Oignons', quantite: '1 kg' }, { nom: 'Sel', quantite: '' }] },
    ],
    instructions: [
      { numero: 1, texte: 'Émincer les oignons.', astuce: 'Astuce : au robot.' },
      { numero: 'Pour finir', texte: 'Servir chaud.' },
    ],
    manquants: ['Le temps de cuisson n’est pas donné'],
    source: { label: 'Livre de la maison', url: 'https://exemple.fr/soupe' },
  };
  const texte = Pt.enTexte(recette, { lien: 'https://exemple.fr/c/#/recette/essai' });

  assert.ok(texte.startsWith('Soupe à l’oignon\n4 personnes · 1 h 10'), texte.slice(0, 80));
  assert.ok(texte.includes('- Oignons : 1 kg'), texte);
  // Un ingredient sans quantite ne doit pas trainer de separateur vide.
  assert.ok(texte.includes('- Sel\n') && !texte.includes('Sel :'), texte);
  assert.ok(texte.includes('1. Émincer les oignons.'), texte);
  assert.ok(texte.includes('   Astuce : au robot.'), texte);
  // Une etape dont le numero n est pas un entier est comptee, sinon la liste
  // porterait « Pour finir. Servir chaud ».
  assert.ok(texte.includes('2. Servir chaud.'), texte);
  assert.ok(texte.includes('À savoir') && texte.includes('temps de cuisson'), texte);
  assert.ok(texte.includes('Source : Livre de la maison (https://exemple.fr/soupe)'), texte);
  assert.ok(texte.trimEnd().endsWith('La fiche : https://exemple.fr/c/#/recette/essai'), texte);
});

test('enTexte tait ce que la recette ne dit pas', () => {
  const texte = Pt.enTexte({
    titre: 'Essai',
    portions: 'Non indiqué',
    temps: { total: 'Non indiquée' },
    ingredients: [{ groupe: '', items: [{ nom: 'Eau', quantite: '1 l' }] }],
    instructions: [],
    manquants: [],
  });
  assert.ok(!/Non indiqu/.test(texte), texte);
  assert.ok(!/Préparation/.test(texte), texte);
  assert.ok(!/À savoir/.test(texte), texte);
});

test('enTexte annonce les parts mises a l echelle et non celles de la fiche', () => {
  const recette = {
    titre: 'Essai',
    portions: '4 personnes',
    temps: {},
    ingredients: [{ groupe: '', items: [{ nom: 'Farine', quantite: '500 g' }] }],
    instructions: [],
  };
  assert.ok(Pt.enTexte(recette, { parts: '8 personnes' }).includes('8 personnes'));
  assert.ok(!Pt.enTexte(recette, { parts: '8 personnes' }).includes('4 personnes'));
});

test('chargeDePartage ne repete pas le lien dans le texte', () => {
  const recette = recettes[0];
  const charge = Pt.chargeDePartage(recette, 'https://exemple.fr/c/#/livre');
  assert.strictEqual(charge.title, recette.titre);
  assert.strictEqual(charge.url, 'https://exemple.fr/c/#/recette/' + recette.id);
  assert.ok(!charge.text.includes('La fiche :'), charge.text.slice(-120));
});

test('chargeDePartage omet l adresse plutot que d en inventer une', () => {
  const charge = Pt.chargeDePartage({ titre: 'Essai', ingredients: [], instructions: [] }, '');
  assert.strictEqual('url' in charge, false, JSON.stringify(charge));
});

test('le texte d une recette du carnet cite tous ses ingredients', () => {
  const recette = recettes.find((r) => r.ingredients.some((g) => g.items.length > 3));
  const texte = Pt.enTexte(recette);
  recette.ingredients.forEach((groupe) => {
    groupe.items.forEach((item) => {
      assert.ok(texte.includes(item.nom), `${item.nom} absent du texte partage`);
    });
  });
});

// --- pdf.js ------------------------------------------------------------------

function octetsDe(chaine) {
  return Array.from(chaine).map((c) => c.charCodeAt(0));
}

test('versWinAnsi place la ponctuation typographique aux codes attendus', () => {
  assert.deepStrictEqual(octetsDe(Pdf.versWinAnsi('’')), [0x92]);
  assert.deepStrictEqual(octetsDe(Pdf.versWinAnsi('…')), [0x85]);
  assert.deepStrictEqual(octetsDe(Pdf.versWinAnsi('€')), [0x80]);
  // Les six caracteres hors ASCII des titres du carnet.
  assert.deepStrictEqual(octetsDe(Pdf.versWinAnsi('ïéâèà')), [0xef, 0xe9, 0xe2, 0xe8, 0xe0]);
});

test('versWinAnsi degrade un caractere absent de l encodage sans rendre un octet faux', () => {
  // Une lettre accentuee hors WinAnsi perd son accent plutot que sa lettre.
  assert.strictEqual(Pdf.versWinAnsi('ā'), 'a');
  // Ce qui n a aucun equivalent est marque, pour se voir a la relecture.
  assert.strictEqual(Pdf.versWinAnsi('中'), '?');
  // Un saut de ligne devient un espace : dans un flux PDF il n aurait aucun effet.
  assert.strictEqual(Pdf.versWinAnsi('a\nb'), 'a b');
});

test('largeurTexte suit les largeurs Adobe des polices de base', () => {
  // Valeurs de la specification : A vaut 667 milliemes en Helvetica, 722 en gras.
  assert.strictEqual(Pdf.largeurTexte('A', 1000, false), 667);
  assert.strictEqual(Pdf.largeurTexte('A', 1000, true), 722);
  // Une lettre accentuee a la largeur de sa lettre de base.
  assert.strictEqual(Pdf.largeurTexte('é', 1000, false), Pdf.largeurTexte('e', 1000, false));
  // La police n est pas a espacement fixe : le carnet en depend pour couper juste.
  assert.ok(Pdf.largeurTexte('iii', 10, false) < Pdf.largeurTexte('mmm', 10, false));
  assert.strictEqual(Pdf.largeurTexte('', 12, false), 0);
});

test('couper respecte la largeur demandee', () => {
  const lignes = Pdf.couper('Tarte aux pommes et à la cannelle de la maison', 80, 10, false);
  assert.ok(lignes.length > 1, JSON.stringify(lignes));
  lignes.forEach((ligne) => {
    assert.ok(Pdf.largeurTexte(ligne, 10, false) <= 80, `ligne trop large : ${ligne}`);
  });
  // Rien ne doit se perdre a la coupure.
  assert.strictEqual(lignes.join(' '), 'Tarte aux pommes et à la cannelle de la maison');
});

test('couper decoupe un mot plus large que la colonne au lieu de le laisser depasser', () => {
  const lignes = Pdf.couper('Anticonstitutionnellement', 40, 10, false);
  assert.ok(lignes.length > 1, JSON.stringify(lignes));
  lignes.forEach((ligne) => assert.ok(Pdf.largeurTexte(ligne, 10, false) <= 40, ligne));
  assert.strictEqual(lignes.join(''), 'Anticonstitutionnellement');
});

test('couper rend une liste vide pour un texte vide', () => {
  assert.deepStrictEqual(Pdf.couper('', 100, 10, false), []);
  assert.deepStrictEqual(Pdf.couper('   ', 100, 10, false), []);
});

test('couleur lit un code hexadecimal et refuse d inventer', () => {
  assert.deepStrictEqual(Pdf.couleur('#ffffff'), [1, 1, 1]);
  assert.deepStrictEqual(Pdf.couleur('#000'), [0, 0, 0]);
  assert.deepStrictEqual(Pdf.couleur('pas une couleur'), [0, 0, 0]);
});

test('un document rendu est un PDF structurellement valide', () => {
  const doc = Pdf.creer({ titre: 'Essai', horodatage: Pdf.horodatage(new Date(0)) });
  doc.page();
  doc.texte(40, 60, 'Bonjour l’été', { taille: 14, gras: true });
  doc.rectangle(40, 80, 200, 40, { fond: '#f5ead8', contour: '#c67139', rayon: 8 });
  doc.page();
  doc.texte(40, 60, 'Page deux');

  const fichier = Buffer.from(doc.octets()).toString('latin1');
  assert.ok(fichier.startsWith('%PDF-1.4\n'), fichier.slice(0, 20));
  assert.ok(fichier.trimEnd().endsWith('%%EOF'), fichier.slice(-40));
  assert.strictEqual(doc.nbPages(), 2);
  assert.strictEqual((fichier.match(/\/Type \/Page[^s]/g) || []).length, 2);

  // La table xref porte des offsets en octets : chacun doit tomber exactement sur la
  // declaration de son objet. C est ce que verifie un lecteur de PDF avant d ouvrir.
  const tableau = fichier.slice(fichier.lastIndexOf('\nxref\n') + 6);
  const entetes = tableau.split('\n');
  const nbObjets = Number(entetes[0].split(' ')[1]) - 1;
  for (let i = 1; i <= nbObjets; i += 1) {
    // entetes[0] est « 0 N », entetes[1] l entree libre : l objet i est en i + 1.
    const offset = Number(entetes[i + 1].slice(0, 10));
    assert.ok(
      fichier.startsWith(`${i} 0 obj`, offset),
      `offset xref faux pour l objet ${i} : ${JSON.stringify(fichier.slice(offset, offset + 20))}`
    );
  }

  // startxref doit designer le debut de la table.
  const startxref = Number(/startxref\n(\d+)/.exec(fichier)[1]);
  assert.ok(fichier.startsWith('xref\n', startxref), fichier.slice(startxref, startxref + 10));

  // La longueur declaree de chaque flux doit valoir sa longueur reelle, sinon les
  // lecteurs stricts refusent la page.
  const flux = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g;
  let trouve;
  let nbFlux = 0;
  while ((trouve = flux.exec(fichier)) !== null) {
    nbFlux += 1;
    assert.strictEqual(trouve[2].length, Number(trouve[1]), 'longueur de flux declaree fausse');
  }
  assert.strictEqual(nbFlux, 2);
});

test('les parentheses d un titre sont echappees dans le flux', () => {
  const doc = Pdf.creer({});
  doc.texte(10, 10, 'Poulet (basquaise) \\ maison');
  const fichier = Buffer.from(doc.octets()).toString('latin1');
  assert.ok(fichier.includes('(Poulet \\(basquaise\\) \\\\ maison) Tj'), fichier);
});

// --- menu-pdf.js -------------------------------------------------------------

function semaineDEssai() {
  const aujourdhui = new Date(2026, 7, 12, 12, 0, 0);
  return { sem: Sn.semaine(aujourdhui, aujourdhui), aujourdhui };
}

function poser(plats, jourCle, moment, titre) {
  const cle = Sn.cleCreneau(jourCle, moment);
  plats[cle] = plats[cle] || [];
  plats[cle].push({
    cle: Sn.cleItem(jourCle, moment, 'e' + plats[cle].length),
    jour: jourCle,
    moment,
    type: 'recette',
    recetteId: 'r',
    titre,
  });
  return plats;
}

test('plan repartit les sept jours sur une page pour une semaine ordinaire', () => {
  const { sem } = semaineDEssai();
  const plats = {};
  poser(plats, sem.jours[0].cle, 'dejeuner', 'Couscous poulet merguez');
  poser(plats, sem.jours[0].cle, 'diner', 'Soupe à l’oignon');
  poser(plats, sem.jours[3].cle, 'dejeuner', 'Au bureau');

  const p = MPdf.plan({ semaine: sem, plats });
  assert.strictEqual(p.pages.length, 1);
  assert.strictEqual(p.pages[0].length, 7);
  assert.strictEqual(p.nbPlats, 3);
});

test('plan passe a la page suivante sans couper un jour en deux', () => {
  const { sem } = semaineDEssai();
  const plats = {};
  sem.jours.forEach((jour) => {
    ['petit-dejeuner', 'dejeuner', 'diner'].forEach((moment) => {
      for (let i = 0; i < 3; i += 1) poser(plats, jour.cle, moment, `Blanquette de veau à l’ancienne ${i}`);
    });
  });

  const p = MPdf.plan({ semaine: sem, plats });
  assert.ok(p.pages.length > 1, `une semaine de ${p.nbPlats} plats devrait tenir sur plusieurs pages`);
  assert.strictEqual(p.nbPlats, 63);
  // Chaque jour figure une fois et une seule, entier.
  const jours = p.pages.flat().map((c) => c.jour.cle);
  assert.deepStrictEqual(jours, sem.jours.map((j) => j.cle));
  // Aucune carte ne depasse le bas de la zone de contenu.
  p.pages.forEach((cartes) => {
    cartes.forEach((carte) => {
      assert.ok(carte.haut + carte.hauteur <= Pdf.HAUTEUR_A4 - 54 + 0.01, `carte hors page : ${carte.jour.cle}`);
    });
  });
});

test('plan n affiche que les creneaux garnis', () => {
  const { sem } = semaineDEssai();
  const plats = poser({}, sem.jours[2].cle, 'diner', 'Pizzas');
  const p = MPdf.plan({ semaine: sem, plats });
  const mercredi = p.pages[0][2];
  assert.deepStrictEqual(mercredi.moments.map((m) => m.cle), ['diner']);
  assert.deepStrictEqual(p.pages[0][0].moments, []);
});

test('nomFichier porte la date de la semaine decrite', () => {
  const { sem } = semaineDEssai();
  assert.strictEqual(MPdf.nomFichier(sem), 'menu-semaine-du-2026-08-10.pdf');
});

test('construire ecrit les plats, les jours et le jour vide', () => {
  const { sem, aujourdhui } = semaineDEssai();
  const plats = poser({}, sem.jours[0].cle, 'dejeuner', 'Couscous poulet merguez');
  const fichier = Buffer.from(MPdf.construire({ semaine: sem, plats, genereLe: aujourdhui })).toString('latin1');

  assert.ok(fichier.includes('(Couscous poulet merguez) Tj'), 'le plat pose devrait etre ecrit');
  assert.ok(fichier.includes('(Lundi) Tj') && fichier.includes('(Dimanche) Tj'), 'les sept jours devraient etre ecrits');
  assert.ok(fichier.includes('(D' + String.fromCharCode(0xe9) + 'jeuner) Tj'), 'le creneau garni devrait etre nomme');
  // Un jour sans rien de prevu le dit : sur du papier, un blanc est un doute.
  assert.ok(fichier.includes('(' + String.fromCharCode(0xe0) + ' d' + String.fromCharCode(0xe9) + 'finir) Tj'));
  // Un creneau vide n est pas nomme : sept fois « Petit-dejeuner : rien » ne sert a rien.
  assert.ok(!fichier.includes('(Petit-d' + String.fromCharCode(0xe9) + 'jeuner) Tj'));
  // La date d impression vient de l argument, jamais de l horloge de la machine.
  assert.ok(fichier.includes('imprim' + String.fromCharCode(0xe9) + ' le 12 ao' + String.fromCharCode(0xfb) + 't 2026'));
});

test('construire numerote les pages seulement quand il y en a plusieurs', () => {
  const { sem, aujourdhui } = semaineDEssai();
  const legere = Buffer.from(MPdf.construire({ semaine: sem, plats: {}, genereLe: aujourdhui })).toString('latin1');
  assert.ok(!/page 1 sur/.test(legere), 'une feuille unique ne se numerote pas');

  const plats = {};
  sem.jours.forEach((jour) => {
    ['petit-dejeuner', 'dejeuner', 'diner'].forEach((moment) => {
      for (let i = 0; i < 3; i += 1) poser(plats, jour.cle, moment, `Blanquette de veau ${i}`);
    });
  });
  const chargee = Buffer.from(MPdf.construire({ semaine: sem, plats, genereLe: aujourdhui })).toString('latin1');
  assert.ok(/\(page 1 sur 2\) Tj/.test(chargee), 'les feuilles multiples se numerotent');
});

test('un titre de plat trop long est coupe et non tronque', () => {
  const { sem, aujourdhui } = semaineDEssai();
  const long = 'Tarte aux pommes et à la cannelle façon grand-mère avec un titre exagérément long';
  const plats = poser({}, sem.jours[1].cle, 'dejeuner', long);
  const p = MPdf.plan({ semaine: sem, plats });
  const lignes = p.pages[0][1].moments[0].lignes;
  assert.ok(lignes.length > 1, JSON.stringify(lignes));
  assert.strictEqual(lignes.join(' '), long);

  const fichier = Buffer.from(MPdf.construire({ semaine: sem, plats, genereLe: aujourdhui })).toString('latin1');
  lignes.forEach((ligne) => {
    assert.ok(fichier.includes('(' + Pdf.versWinAnsi(ligne) + ') Tj'), `ligne absente du PDF : ${ligne}`);
  });
});

// --- Restitution -------------------------------------------------------------


console.log(`\n${reussis} test(s) reussi(s), ${echecs.length} echec(s)\n`);
if (echecs.length > 0) {
  echecs.forEach((e) => console.error(`ECHEC  ${e.nom}\n       ${e.message}\n`));
  process.exit(1);
}
