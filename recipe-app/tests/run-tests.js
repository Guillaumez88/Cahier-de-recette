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

test('analyser signale une quantite sans nombre', () => {
  ['Selon goût', 'Pour le plat', 'Quelques pincées', ''].forEach((t) => {
    assert.strictEqual(Q.analyser(t).lisible, false, `${t} devrait etre illisible`);
  });
});

test('les 169 quantites du carnet sont analysees sans lever', () => {
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
  assert.strictEqual(lisibles, 150, `${lisibles} quantites lisibles au lieu de 150`);
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

test('echelonnerTexte laisse les 17 recettes intactes a facteur 1', () => {
  recettes.forEach((r) =>
    r.instructions.forEach((etape) => {
      assert.strictEqual(Q.echelonnerTexte(etape.texte, 1).texte, etape.texte);
    })
  );
});

test('aucune duree ni temperature des 17 recettes n est modifiee par un doublement', () => {
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

test('les portions des 17 recettes sont toutes lisibles', () => {
  recettes.forEach((r) => {
    const p = Q.analyserPortions(r.portions);
    assert.ok(typeof p.nombre === 'number' && p.nombre > 0, `${r.id} : portions « ${r.portions} »`);
  });
});

test('ecrirePortions est la reciproque', () => {
  assert.strictEqual(Q.ecrirePortions(12, 'personnes'), '12 personnes');
  assert.strictEqual(Q.ecrirePortions(1.5, 'galette de 22 cm'), '1,5 galette de 22 cm');
});

// --- rayons.js ---------------------------------------------------------------

test('les 114 ingredients du carnet sont tous classes', () => {
  const noms = [...new Set(recettes.flatMap((r) => r.ingredients.flatMap((g) => g.items.map((i) => i.nom))))];
  const nonClasses = noms.filter((n) => Ry.rayonDe(n) === Ry.RAYON_DEFAUT);
  assert.deepStrictEqual(nonClasses, [], `${nonClasses.length} ingredient(s) sans rayon`);
  assert.strictEqual(noms.length, 114, `${noms.length} noms distincts au lieu de 114`);
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

test('le deroule est reconstitue pour les 17 recettes', () => {
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
  // 158/169 au moment de l ecriture. Le test protege contre une regression, pas
  // contre une amelioration : on verifie un plancher.
  assert.strictEqual(total, 169);
  assert.ok(places >= 158, `couverture tombee a ${places}/169`);
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
