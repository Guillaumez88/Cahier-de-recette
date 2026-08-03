/* Tests de la synchronisation, sous Node : node tests/run-sync-tests.js
 *
 * Ces tests ne touchent jamais le projet Firebase reel. Ils lancent l'emulation de
 * tests/stub-firestore.js sur un port local et font pointer la configuration
 * dessus. Tout le chemin est donc exerce pour de vrai : authentification anonyme,
 * jeton porte dans l'en-tete, encodage des valeurs Firestore, masque de champs,
 * suppression, et surtout la file d'attente hors ligne.
 */

const http = require('http');
const path = require('path');
const assert = require('assert');

const stub = require('./stub-firestore.js');

const racine = path.join(__dirname, '..');
const PORT = Number(process.env.PORT_STUB || 8155);

let reussis = 0;
const echecs = [];

async function test(nom, fn) {
  try {
    await fn();
    reussis += 1;
  } catch (erreur) {
    echecs.push({ nom, message: erreur.message });
  }
}

// --- Environnement de test ---------------------------------------------------

/** localStorage minimal, remplacable entre les tests pour repartir a zero. */
function faireLocalStorage() {
  const memoire = new Map();
  return {
    getItem: (c) => (memoire.has(c) ? memoire.get(c) : null),
    setItem: (c, v) => memoire.set(c, String(v)),
    removeItem: (c) => memoire.delete(c),
    _memoire: memoire,
  };
}

/** Recharge config, sync et storage pour que chacun reprenne le localStorage courant. */
function chargerModules() {
  [
    'js/firebase-config.js',
    'js/sync.js',
    'js/recettes.js',
    'js/storage.js',
    'js/semainier.js',
    'js/photos.js',
  ].forEach((relatif) => {
    delete require.cache[require.resolve(path.join(racine, relatif))];
  });
  const config = require(path.join(racine, 'js/firebase-config.js'));
  config.baseFirestore = `http://127.0.0.1:${PORT}/__firestore/v1`;
  config.baseAuth = `http://127.0.0.1:${PORT}/__auth/v1`;
  config.baseSecureToken = `http://127.0.0.1:${PORT}/__auth/v1`;
  config.projectId = 'projet-de-test';
  const Sync = require(path.join(racine, 'js/sync.js'));
  const Recettes = require(path.join(racine, 'js/recettes.js'));
  const Storage = require(path.join(racine, 'js/storage.js'));
  const Semainier = require(path.join(racine, 'js/semainier.js'));
  const Photos = require(path.join(racine, 'js/photos.js'));
  return { config, Sync, Recettes, Storage, Semainier, Photos };
}

function neuf() {
  stub.reinitialiser();
  global.localStorage = faireLocalStorage();
  return chargerModules();
}

const RECETTE = {
  id: 'tapenade-maison',
  titre: 'Tapenade maison',
  ingredients: [
    {
      groupe: null,
      items: [
        { nom: 'Olives noires', quantite: '200 g' },
        { nom: 'Câpres', quantite: '8' },
        { nom: 'Huile d’olive', quantite: '3 c. à s.' },
      ],
    },
  ],
};

async function basculerPanne(panne) {
  await fetch(`http://127.0.0.1:${PORT}/__stub/panne`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ panne }),
  });
}

// --- Deroulement -------------------------------------------------------------

const serveur = http.createServer(async (requete, reponse) => {
  if (await stub.traiter(requete, reponse)) return;
  reponse.writeHead(404).end();
});

serveur.listen(PORT, '127.0.0.1', async () => {
  // --- Encodage des valeurs --------------------------------------------------

  await test('les valeurs sont encodees et decodees sans perte', () => {
    const { Sync } = neuf();
    const objet = { nom: 'Câpres', quantite: '8', coche: false, groupe: null, n: 3 };
    const retour = Sync.champsVersObjet(Sync.objetVersChamps(objet));
    assert.deepStrictEqual(retour, objet);
  });

  await test('un booleen faux ne devient pas une chaine', () => {
    const { Sync } = neuf();
    assert.deepStrictEqual(Sync.versFirestore(false), { booleanValue: false });
    assert.strictEqual(Sync.depuisFirestore({ booleanValue: false }), false);
  });

  await test('deux noms voisins donnent deux identifiants distincts', () => {
    const { Sync } = neuf();
    assert.notStrictEqual(Sync.idDocument('x::creme fraiche'), Sync.idDocument('x::crème fraîche'));
    // Et un identifiant ne contient jamais de barre oblique, interdite par Firestore.
    assert.ok(!Sync.idDocument('x::sel/poivre').includes('/'));
  });

  // --- Authentification ------------------------------------------------------

  await test('une session anonyme est creee puis reutilisee', async () => {
    const { Sync } = neuf();
    const premier = await Sync.obtenirJeton();
    const second = await Sync.obtenirJeton();
    assert.ok(premier, 'aucun jeton obtenu');
    assert.strictEqual(premier, second, 'un second jeton a ete demande inutilement');
    assert.strictEqual(stub.etat.appels.sessions, 1, `${stub.etat.appels.sessions} sessions creees`);
  });

  await test('un jeton expire est renouvele sans recreer de compte', async () => {
    const { Sync } = neuf();
    await Sync.obtenirJeton();
    assert.strictEqual(stub.etat.appels.sessions, 1);

    // On fait expirer le jeton enregistre.
    const cle = 'carnet-de-recettes:jeton-anonyme';
    const enregistre = JSON.parse(global.localStorage.getItem(cle));
    enregistre.expireLe = Date.now() - 1000;
    global.localStorage.setItem(cle, JSON.stringify(enregistre));

    // Le module doit relire le stockage : on le recharge comme le ferait la page.
    const rechargé = chargerModules().Sync;
    const renouvele = await rechargé.obtenirJeton();
    assert.ok(/renouvele/.test(renouvele), `jeton inattendu : ${renouvele}`);
    assert.strictEqual(stub.etat.appels.sessions, 1, 'un nouveau compte anonyme a ete cree a tort');
  });

  await test('Firestore refuse une requete sans jeton', async () => {
    neuf();
    const reponse = await fetch(
      `http://127.0.0.1:${PORT}/__firestore/v1/projects/x/databases/(default)/documents/listes/commune/articles`
    );
    assert.strictEqual(reponse.status, 401, `statut ${reponse.status}`);
  });

  // --- Cycle de la liste partagee -------------------------------------------

  await test('ajouter une recette ecrit un document par ingredient', async () => {
    const { Storage } = neuf();
    await Storage.addRecipeToList(RECETTE);
    assert.strictEqual(Storage.getShoppingList().length, 3);
    assert.strictEqual(stub.etat.articles.size, 3, `${stub.etat.articles.size} documents cote serveur`);
    assert.strictEqual(Storage.etatSync().enAttente, 0, 'la file devrait etre vide');
  });

  await test('un second appareil retrouve la liste', async () => {
    const { Storage } = neuf();
    await Storage.addRecipeToList(RECETTE);

    // Nouveau localStorage, meme serveur : c'est la situation d'un autre navigateur.
    global.localStorage = faireLocalStorage();
    const autre = chargerModules().Storage;
    assert.deepStrictEqual(autre.getShoppingList(), [], 'le cache local devrait partir vide');

    const articles = await autre.rafraichir();
    assert.strictEqual(articles.length, 3, `${articles.length} articles recus`);
    assert.ok(
      articles.some((a) => a.nom === 'Câpres' && a.quantite === '8'),
      'les accents ou les quantites ont ete perdus'
    );
  });

  await test('cocher chez l un se voit chez l autre', async () => {
    const { Storage } = neuf();
    await Storage.addRecipeToList(RECETTE);
    const cle = Storage.getShoppingList()[0].cle;
    await Storage.toggleArticle(cle);

    global.localStorage = faireLocalStorage();
    const autre = chargerModules().Storage;
    const articles = await autre.rafraichir();
    const article = articles.find((a) => a.cle === cle);
    assert.strictEqual(article.coche, true, 'le cochage n a pas ete propage');
  });

  await test('cocher n ecrit que le champ coche, sans ecraser le reste', async () => {
    const { Storage, Sync } = neuf();
    await Storage.addRecipeToList(RECETTE);
    const article = Storage.getShoppingList()[0];
    await Storage.toggleArticle(article.cle);

    const document_ = stub.etat.articles.get(Sync.idDocument(article.cle));
    assert.strictEqual(document_.fields.coche.booleanValue, true);
    assert.strictEqual(document_.fields.nom.stringValue, article.nom, 'le nom a ete perdu');
    assert.strictEqual(document_.fields.quantite.stringValue, article.quantite, 'la quantite a ete perdue');
  });

  await test('ajouter deux fois la meme recette ne duplique rien', async () => {
    const { Storage } = neuf();
    await Storage.addRecipeToList(RECETTE);
    await Storage.addRecipeToList(RECETTE);
    assert.strictEqual(Storage.getShoppingList().length, 3);
    assert.strictEqual(stub.etat.articles.size, 3);
  });

  await test('une selection partielle n ajoute que les ingredients choisis', async () => {
    const { Storage } = neuf();
    await Storage.addItemsToList(RECETTE, [{ nom: 'Câpres', quantite: '8', groupe: null }]);
    const articles = Storage.getShoppingList();
    assert.strictEqual(articles.length, 1);
    assert.strictEqual(articles[0].nom, 'Câpres');
    assert.strictEqual(stub.etat.articles.size, 1);
  });

  await test('nomsPresents signale ce qui est deja dans la liste', async () => {
    const { Storage } = neuf();
    await Storage.addItemsToList(RECETTE, [{ nom: 'Câpres', quantite: '8', groupe: null }]);
    const presents = Storage.nomsPresents(Storage.getShoppingList(), RECETTE.id);
    assert.strictEqual(presents['Câpres'], true);
    assert.strictEqual(presents['Olives noires'], undefined);
  });

  await test('un article libre s ajoute hors recette', async () => {
    const { Storage } = neuf();
    await Storage.addFreeItem('Pain', '1 baguette');
    const articles = Storage.getShoppingList();
    assert.strictEqual(articles.length, 1);
    assert.strictEqual(articles[0].recetteId, Storage.RECETTE_LIBRE);
    assert.strictEqual(articles[0].quantite, '1 baguette');

    // Un nom vide ou en double n'ajoute rien.
    await Storage.addFreeItem('   ', '');
    await Storage.addFreeItem('Pain', 'autre quantite');
    assert.strictEqual(Storage.getShoppingList().length, 1);
  });

  await test('retirer les articles coches ne touche pas aux autres', async () => {
    const { Storage } = neuf();
    await Storage.addRecipeToList(RECETTE);
    const articles = Storage.getShoppingList();
    await Storage.toggleArticle(articles[0].cle);
    await Storage.removeCheckedArticles();

    const restants = Storage.getShoppingList();
    assert.strictEqual(restants.length, 2);
    assert.ok(!restants.some((a) => a.cle === articles[0].cle));
    assert.strictEqual(stub.etat.articles.size, 2, 'le serveur n a pas ete mis a jour');
  });

  await test('vider la liste supprime tous les documents', async () => {
    const { Storage } = neuf();
    await Storage.addRecipeToList(RECETTE);
    await Storage.clearShoppingList();
    assert.deepStrictEqual(Storage.getShoppingList(), []);
    assert.strictEqual(stub.etat.articles.size, 0);
  });

  await test('supprimer un article deja absent n est pas une erreur', async () => {
    const { Storage, Sync } = neuf();
    await Storage.addRecipeToList(RECETTE);
    const cle = Storage.getShoppingList()[0].cle;
    stub.etat.articles.delete(Sync.idDocument(cle)); // supprime par quelqu un d autre
    await Storage.removeArticle(cle);
    assert.strictEqual(Storage.etatSync().enAttente, 0, 'la file est restee bloquee sur un 404');
    assert.strictEqual(Storage.etatSync().enLigne, true);
  });

  // --- Fusion par ingredient et rangement par rayon --------------------------

  const RECETTE_B = {
    id: 'brownie-verification',
    titre: 'Brownie',
    ingredients: [
      {
        groupe: null,
        items: [
          { nom: 'Beurre', quantite: '125 g' },
          { nom: 'Olives noires', quantite: '50 g' },
        ],
      },
    ],
  };
  const RECETTE_A = {
    id: 'flan-verification',
    titre: 'Flan',
    ingredients: [
      {
        groupe: null,
        items: [
          { nom: 'Beurre', quantite: '300 g' },
          { nom: 'Œufs', quantite: '3' },
        ],
      },
    ],
  };

  await test('le meme ingredient venu de deux recettes est additionne', async () => {
    const { Storage } = neuf();
    await Storage.addRecipeToList(RECETTE_A);
    await Storage.addRecipeToList(RECETTE_B);

    const lignes = Storage.fusionner(Storage.getShoppingList());
    const beurre = lignes.find((l) => l.nom === 'Beurre');
    assert.ok(beurre, 'ligne beurre introuvable');
    assert.strictEqual(beurre.quantite, '425 g', `quantite « ${beurre.quantite} »`);
    assert.strictEqual(beurre.nbSources, 2, 'la ligne devrait recouvrir deux articles');
    assert.deepStrictEqual(beurre.recettes.sort(), ['Brownie', 'Flan']);
  });

  await test('la fusion ne change rien en base : un document par contribution', async () => {
    const { Storage } = neuf();
    await Storage.addRecipeToList(RECETTE_A);
    await Storage.addRecipeToList(RECETTE_B);
    // 2 + 2 ingredients, dont un nom commun : 4 documents, 3 lignes affichees.
    assert.strictEqual(stub.etat.articles.size, 4, `${stub.etat.articles.size} documents`);
    assert.strictEqual(Storage.fusionner(Storage.getShoppingList()).length, 3);
  });

  await test('retirer une recette fait baisser le total additionne', async () => {
    const { Storage } = neuf();
    await Storage.addRecipeToList(RECETTE_A);
    await Storage.addRecipeToList(RECETTE_B);
    await Storage.removeRecipeFromList(RECETTE_B.id);

    const beurre = Storage.fusionner(Storage.getShoppingList()).find((l) => l.nom === 'Beurre');
    assert.strictEqual(beurre.quantite, '300 g', `quantite « ${beurre.quantite} »`);
    assert.strictEqual(beurre.nbSources, 1);
  });

  await test('cocher une ligne fusionnee coche ses deux contributions', async () => {
    const { Storage, Sync } = neuf();
    await Storage.addRecipeToList(RECETTE_A);
    await Storage.addRecipeToList(RECETTE_B);

    const beurre = Storage.fusionner(Storage.getShoppingList()).find((l) => l.nom === 'Beurre');
    await Storage.cocherArticles(beurre.articles, true);

    const distants = await Sync.lireArticles();
    const contributions = distants.filter((a) => a.nom === 'Beurre');
    assert.strictEqual(contributions.length, 2);
    contributions.forEach((c) => assert.strictEqual(c.coche, true, 'une contribution est restee decochee'));

    const apres = Storage.fusionner(Storage.getShoppingList()).find((l) => l.nom === 'Beurre');
    assert.strictEqual(apres.coche, true, 'la ligne fusionnee devrait etre cochee');
  });

  await test('une ligne fusionnee n est cochee que si tout est coche', async () => {
    const { Storage } = neuf();
    await Storage.addRecipeToList(RECETTE_A);
    await Storage.addRecipeToList(RECETTE_B);

    const beurre = Storage.fusionner(Storage.getShoppingList()).find((l) => l.nom === 'Beurre');
    await Storage.cocherArticles([beurre.articles[0]], true);

    const apres = Storage.fusionner(Storage.getShoppingList()).find((l) => l.nom === 'Beurre');
    assert.strictEqual(apres.coche, false, 'une seule contribution cochee ne suffit pas');
  });

  await test('supprimer une ligne fusionnee supprime ses deux contributions', async () => {
    const { Storage, Sync } = neuf();
    await Storage.addRecipeToList(RECETTE_A);
    await Storage.addRecipeToList(RECETTE_B);

    const beurre = Storage.fusionner(Storage.getShoppingList()).find((l) => l.nom === 'Beurre');
    await Storage.removeArticles(beurre.articles);

    const distants = await Sync.lireArticles();
    assert.strictEqual(distants.filter((a) => a.nom === 'Beurre').length, 0, 'du beurre subsiste en base');
    assert.strictEqual(distants.length, 2, `${distants.length} documents restants`);
  });

  await test('la liste est rangee par rayon dans l ordre du magasin', async () => {
    const { Storage } = neuf();
    await Storage.addRecipeToList(RECETTE_A);
    await Storage.addRecipeToList(RECETTE_B);
    await Storage.addFreeItem('Courgettes', '3');

    const groupes = Storage.listeParRayon(Storage.getShoppingList());
    assert.deepStrictEqual(
      groupes.map((g) => g.rayon),
      ['Fruits et légumes', 'Crèmerie', 'Épicerie salée']
    );
  });

  await test('les singuliers et pluriels d un meme ingredient se rejoignent', async () => {
    const { Storage } = neuf();
    await Storage.addItemsToList(RECETTE_A, [{ nom: 'Œufs', quantite: '3', groupe: null }]);
    await Storage.addItemsToList(RECETTE_B, [{ nom: 'Œuf', quantite: '1', groupe: null }]);

    const lignes = Storage.fusionner(Storage.getShoppingList());
    assert.strictEqual(lignes.length, 1, `${lignes.length} lignes au lieu d une seule`);
    assert.strictEqual(lignes[0].quantite, '4');
  });

  await test('deux sucres differents ne sont pas confondus', async () => {
    const { Storage } = neuf();
    await Storage.addItemsToList(RECETTE_A, [
      { nom: 'Sucre glace', quantite: '80 g', groupe: null },
      { nom: 'Sucre en poudre', quantite: '160 g', groupe: null },
    ]);
    const lignes = Storage.fusionner(Storage.getShoppingList());
    assert.strictEqual(lignes.length, 2, 'deux produits distincts ont ete fusionnes a tort');
  });

  // --- Hors ligne ------------------------------------------------------------

  await test('hors ligne, cocher fonctionne et la modification est mise en attente', async () => {
    const { Storage } = neuf();
    await Storage.addRecipeToList(RECETTE);
    const cle = Storage.getShoppingList()[0].cle;

    await basculerPanne(true);
    await Storage.toggleArticle(cle);

    // L'affichage doit refleter le cochage malgre l'absence de reseau.
    assert.strictEqual(Storage.getShoppingList().find((a) => a.cle === cle).coche, true);
    const e = Storage.etatSync();
    assert.strictEqual(e.enLigne, false, 'l etat devrait indiquer hors ligne');
    assert.strictEqual(e.enAttente, 1, `${e.enAttente} operations en attente`);

    await basculerPanne(false);
  });

  await test('hors ligne, un rafraichissement conserve le cache au lieu de le vider', async () => {
    const { Storage } = neuf();
    await Storage.addRecipeToList(RECETTE);
    await basculerPanne(true);

    const articles = await Storage.rafraichir();
    assert.strictEqual(articles.length, 3, 'le cache local a ete perdu');
    assert.strictEqual(Storage.etatSync().enLigne, false);

    await basculerPanne(false);
  });

  await test('au retour du reseau, la file est envoyee dans l ordre', async () => {
    const { Storage } = neuf();
    await Storage.addRecipeToList(RECETTE);
    const cles = Storage.getShoppingList().map((a) => a.cle);

    await basculerPanne(true);
    await Storage.toggleArticle(cles[0]);
    await Storage.addFreeItem('Pain', '1');
    await Storage.removeArticle(cles[1]);
    assert.strictEqual(Storage.etatSync().enAttente, 3, 'les trois operations devraient attendre');

    await basculerPanne(false);
    const articles = await Storage.rafraichir();

    assert.strictEqual(Storage.etatSync().enAttente, 0, 'la file n a pas ete videe');
    assert.strictEqual(Storage.etatSync().enLigne, true);
    assert.strictEqual(articles.length, 3, `${articles.length} articles apres synchronisation`);
    assert.strictEqual(articles.find((a) => a.cle === cles[0]).coche, true, 'le cochage differe est perdu');
    assert.ok(!articles.some((a) => a.cle === cles[1]), 'la suppression differee est perdue');
    assert.ok(articles.some((a) => a.nom === 'Pain'), 'l ajout differe est perdu');
  });

  await test('une operation en echec reste en tete de file', async () => {
    const { Storage } = neuf();
    await basculerPanne(true);
    await Storage.addFreeItem('Pain', '1');
    assert.strictEqual(Storage.etatSync().enAttente, 1);

    // Un second essai infructueux ne doit ni dupliquer ni perdre l'operation.
    await Storage.rafraichir();
    assert.strictEqual(Storage.etatSync().enAttente, 1, 'la file a change de taille a tort');

    await basculerPanne(false);
    await Storage.rafraichir();
    assert.strictEqual(Storage.etatSync().enAttente, 0);
    assert.strictEqual(stub.etat.articles.size, 1);
  });

  await test('la file survit a un rechargement de page', async () => {
    const { Storage } = neuf();
    await basculerPanne(true);
    await Storage.addFreeItem('Pain', '1');
    assert.strictEqual(Storage.etatSync().enAttente, 1);

    // Meme localStorage, modules recharges : c'est un rechargement de page.
    const apresRechargement = chargerModules().Storage;
    assert.strictEqual(apresRechargement.etatSync().enAttente, 1, 'la file a ete perdue au rechargement');
    assert.strictEqual(apresRechargement.getShoppingList().length, 1, 'le cache a ete perdu');

    await basculerPanne(false);
    await apresRechargement.rafraichir();
    assert.strictEqual(stub.etat.articles.size, 1);
  });

  await test('une suppression pendant un rafraichissement en vol n est pas annulee', async () => {
    const { Storage } = neuf();
    await Storage.addRecipeToList(RECETTE);
    const cle = Storage.getShoppingList()[0].cle;

    // Le rafraichissement part, puis la suppression survient pendant que la lecture
    // est encore en vol : la reponse decrira donc les 3 articles d'origine. Sans
    // garde, elle ecraserait le cache et l'article supprime reapparaitrait.
    const lecture = Storage.rafraichir();
    const suppression = Storage.removeArticle(cle);
    await Promise.all([lecture, suppression]);

    const articles = Storage.getShoppingList();
    assert.strictEqual(articles.length, 2, `${articles.length} articles : la suppression a ete annulee`);
    assert.ok(!articles.some((a) => a.cle === cle), "l article supprime est revenu");

    // Et le sondage suivant confirme que le serveur est bien d'accord.
    const apres = await Storage.rafraichir();
    assert.strictEqual(apres.length, 2, `${apres.length} articles cote serveur`);
  });

  // --- Ordre et robustesse ---------------------------------------------------

  await test('l ordre de la liste est stable d un rafraichissement a l autre', async () => {
    const { Storage } = neuf();
    await Storage.addRecipeToList(RECETTE);
    await Storage.addFreeItem('Pain', '1');
    const premier = (await Storage.rafraichir()).map((a) => a.cle);
    const second = (await Storage.rafraichir()).map((a) => a.cle);
    assert.deepStrictEqual(second, premier, 'la liste change d ordre sans raison');
  });

  await test('un cache local corrompu ne bloque pas l application', async () => {
    neuf();
    global.localStorage.setItem('carnet-de-recettes:liste-commune', '{pas du JSON');
    global.localStorage.setItem('carnet-de-recettes:file-attente', 'non plus');
    const Storage = chargerModules().Storage;
    assert.deepStrictEqual(Storage.getShoppingList(), []);
    assert.strictEqual(Storage.etatSync().enAttente, 0);
    await Storage.addFreeItem('Pain', '1');
    assert.strictEqual(Storage.getShoppingList().length, 1);
  });

  await test('les abonnes sont notifies des changements', async () => {
    const { Storage } = neuf();
    let appels = 0;
    Storage.surChangement(() => {
      appels += 1;
    });
    await Storage.addFreeItem('Pain', '1');
    assert.ok(appels > 0, 'aucune notification recue');
  });

  // --- Recettes modifiees ----------------------------------------------------

  const CARNET = JSON.parse(
    require('fs').readFileSync(path.join(racine, 'data/recipes.json'), 'utf8')
  );
  const ID_LASAGNES = 'lasagnes-bolognaise-la-meilleure-recette';

  await test('sans modification, la liste effective est celle du fichier', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);
    await Recettes.rafraichir();
    assert.strictEqual(Recettes.toutes().length, 20);
    assert.strictEqual(Recettes.estModifiee(ID_LASAGNES), false);
  });

  await test('une modification est enregistree et relue', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);

    const modifiee = JSON.parse(JSON.stringify(Recettes.parId(ID_LASAGNES)));
    modifiee.titre = 'Lasagnes revisitées';
    await Recettes.enregistrer(modifiee);

    assert.strictEqual(Recettes.parId(ID_LASAGNES).titre, 'Lasagnes revisitées');
    assert.strictEqual(Recettes.estModifiee(ID_LASAGNES), true);
    assert.strictEqual(stub.etat.recettes.size, 1, `${stub.etat.recettes.size} documents recette`);

    // L'originale reste accessible : rien n'est ecrase.
    assert.strictEqual(Recettes.originale(ID_LASAGNES).titre, 'Lasagnes bolognaise : la meilleure recette');
  });

  await test('un autre appareil voit la recette modifiee', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);
    const modifiee = JSON.parse(JSON.stringify(Recettes.parId(ID_LASAGNES)));
    modifiee.titre = 'Lasagnes partagées';
    await Recettes.enregistrer(modifiee);

    global.localStorage = faireLocalStorage();
    const autre = chargerModules().Recettes;
    autre.definirBase(CARNET);
    assert.strictEqual(autre.parId(ID_LASAGNES).titre, 'Lasagnes bolognaise : la meilleure recette');

    await autre.rafraichir();
    assert.strictEqual(autre.parId(ID_LASAGNES).titre, 'Lasagnes partagées');
    assert.strictEqual(autre.toutes().length, 20, 'le nombre de recettes ne doit pas changer');
  });

  await test('reinitialiser retablit la recette d origine', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);
    const modifiee = JSON.parse(JSON.stringify(Recettes.parId(ID_LASAGNES)));
    modifiee.titre = 'À jeter';
    await Recettes.enregistrer(modifiee);
    await Recettes.reinitialiser(ID_LASAGNES);

    assert.strictEqual(Recettes.estModifiee(ID_LASAGNES), false);
    assert.strictEqual(Recettes.parId(ID_LASAGNES).titre, 'Lasagnes bolognaise : la meilleure recette');
    assert.strictEqual(stub.etat.recettes.size, 0, 'le document modifie devrait etre supprime');
  });

  await test('l ordre des recettes ne bouge pas apres une modification', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);
    const avant = Recettes.toutes().map((r) => r.id);

    const modifiee = JSON.parse(JSON.stringify(Recettes.parId('brookies')));
    modifiee.titre = 'Brookies maison';
    await Recettes.enregistrer(modifiee);

    assert.deepStrictEqual(Recettes.toutes().map((r) => r.id), avant);
  });

  await test('hors ligne, la modification reste visible en local', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);
    await basculerPanne(true);

    const modifiee = JSON.parse(JSON.stringify(Recettes.parId(ID_LASAGNES)));
    modifiee.titre = 'Modifié sans réseau';
    await Recettes.enregistrer(modifiee);

    assert.strictEqual(Recettes.parId(ID_LASAGNES).titre, 'Modifié sans réseau');
    assert.ok(Recettes.etatChargement().erreur, 'l echec d envoi devrait etre signale');

    await basculerPanne(false);
  });

  // --- Nombre de parts et mise a l echelle -----------------------------------

  await test('doubler les parts double les quantites des ingredients', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);
    const lasagnes = Recettes.parId(ID_LASAGNES);
    assert.strictEqual(lasagnes.portions, '6 personnes');

    const r = Recettes.echelonner(lasagnes, 12);
    assert.strictEqual(r.possible, true);
    assert.strictEqual(r.facteur, 2);
    assert.strictEqual(r.recette.portions, '12 personnes');

    const trouver = (recette, nom) =>
      recette.ingredients.flatMap((g) => g.items).find((i) => i.nom === nom);
    assert.strictEqual(trouver(r.recette, 'Bœuf haché').quantite, '600 g');
    assert.strictEqual(trouver(r.recette, 'Ail').quantite, '2 gousses');
    assert.strictEqual(trouver(r.recette, 'Sucre').quantite, '4 morceaux');
    assert.strictEqual(trouver(r.recette, 'Lait').quantite, '100 cl');
  });

  await test('une quantite non chiffrable est laissee telle quelle et signalee', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);
    const r = Recettes.echelonner(Recettes.parId(ID_LASAGNES), 12);
    const sel = r.recette.ingredients.flatMap((g) => g.items).find((i) => i.nom === 'Sel, poivre');
    assert.strictEqual(sel.quantite, 'Selon le goût');
    assert.deepStrictEqual(r.ignorees, ['Sel, poivre']);
  });

  await test('les durees et temperatures des instructions ne bougent jamais', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);

    CARNET.forEach((recette) => {
      const r = Recettes.echelonner(recette, 24);
      if (!r.possible) return;
      recette.instructions.forEach((etape, i) => {
        const motif = /(\d+(?:[.,]\d+)?)\s*(minutes?|mn|min|heures?|h\b|°\s*C|cm|mm)/gi;
        const avant = (etape.texte.match(motif) || []).join('|');
        const apres = (r.recette.instructions[i].texte.match(motif) || []).join('|');
        assert.strictEqual(apres, avant, `${recette.id} etape ${i + 1} : une durée ou une température a bougé`);
      });
    });
  });

  await test('les quantites des instructions sont mises a l echelle', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);
    const r = Recettes.echelonner(Recettes.parId(ID_LASAGNES), 12);
    assert.ok(r.remplacements.length >= 3, `${r.remplacements.length} remplacements`);
    const jointes = r.recette.instructions.map((e) => e.texte).join(' ');
    assert.ok(/1600 g/.test(jointes), 'les 800 g de pulpe n ont pas ete doubles');
    assert.ok(!/800 g/.test(jointes), 'la valeur d origine subsiste');
  });

  await test('diviser les parts fonctionne aussi', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);
    const r = Recettes.echelonner(Recettes.parId(ID_LASAGNES), 3);
    assert.strictEqual(r.facteur, 0.5);
    assert.strictEqual(r.recette.portions, '3 personnes');
    const boeuf = r.recette.ingredients.flatMap((g) => g.items).find((i) => i.nom === 'Bœuf haché');
    assert.strictEqual(boeuf.quantite, '150 g');
  });

  await test('deux mises a l echelle successives se composent', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);
    const une = Recettes.echelonner(Recettes.parId(ID_LASAGNES), 12);
    const deux = Recettes.echelonner(une.recette, 24);
    assert.strictEqual(deux.recette.portions, '24 personnes');
    const boeuf = deux.recette.ingredients.flatMap((g) => g.items).find((i) => i.nom === 'Bœuf haché');
    assert.strictEqual(boeuf.quantite, '1200 g');
  });

  await test('le tableau de flux fourni suit le nombre de parts', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);
    const r = Recettes.echelonner(Recettes.parId(ID_LASAGNES), 12);

    const cellules = r.recette.flowTable.rows.flat().map((c) => c.text);
    assert.ok(cellules.includes('Bœuf haché : 600 g'), 'la viande du tableau n a pas suivi');
    assert.ok(cellules.includes('Oignon : 2'), 'le nombre nu du tableau n a pas suivi');
    assert.ok(!cellules.includes('Beurre : 70 g'), 'la valeur d origine subsiste dans le tableau');

    // Coherence : la meme valeur des deux cotes de la fiche.
    const boeufIngredient = r.recette.ingredients
      .flatMap((g) => g.items)
      .find((i) => i.nom === 'Bœuf haché').quantite;
    assert.strictEqual(boeufIngredient, '600 g');
    assert.ok(
      cellules.some((c) => c.indexOf(boeufIngredient) !== -1),
      'la liste d ingredients et le tableau annoncent des valeurs differentes'
    );
  });

  await test('les durees du tableau de flux ne bougent pas non plus', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);
    const original = Recettes.parId(ID_LASAGNES);
    const r = Recettes.echelonner(original, 24);
    const motif = /(\d+(?:[.,]\d+)?)\s*(minutes?|mn|min|heures?|h\b|°\s*C|cm|mm)/gi;

    original.flowTable.rows.forEach((ligne, i) => {
      ligne.forEach((cellule, j) => {
        const avant = (cellule.text.match(motif) || []).join('|');
        const apres = (r.recette.flowTable.rows[i][j].text.match(motif) || []).join('|');
        assert.strictEqual(apres, avant, `tableau, ligne ${i} cellule ${j} : durée ou température modifiée`);
      });
    });
  });

  await test('une recette mise a l echelle conserve son tableau apres enregistrement', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);
    const r = Recettes.echelonner(Recettes.parId(ID_LASAGNES), 12);
    delete r.recette.__dernierEchelonnage;
    await Recettes.enregistrer(r.recette);

    global.localStorage = faireLocalStorage();
    const autre = chargerModules().Recettes;
    autre.definirBase(CARNET);
    await autre.rafraichir();

    const cellules = autre.parId(ID_LASAGNES).flowTable.rows.flat().map((c) => c.text);
    assert.ok(cellules.includes('Bœuf haché : 600 g'), 'le tableau n a pas survecu a l aller-retour');
    assert.strictEqual(
      autre.parId(ID_LASAGNES).flowTable.rows.length,
      CARNET.find((x) => x.id === ID_LASAGNES).flowTable.rows.length,
      'des lignes du tableau ont ete perdues'
    );
  });

  await test('un nombre de parts absurde est refuse', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);
    const lasagnes = Recettes.parId(ID_LASAGNES);
    [0, -3, NaN, 'six'].forEach((valeur) => {
      assert.strictEqual(Recettes.echelonner(lasagnes, valeur).possible, false, `${valeur} accepte a tort`);
    });
  });

  await test('la mise a l echelle ne modifie pas la recette source', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);
    const lasagnes = Recettes.parId(ID_LASAGNES);
    const copie = JSON.parse(JSON.stringify(lasagnes));
    Recettes.echelonner(lasagnes, 12);
    assert.deepStrictEqual(lasagnes, copie, 'la recette d origine a ete modifiee sur place');
  });

  await test('une recette mise a l echelle puis enregistree est bien persistee', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);
    const r = Recettes.echelonner(Recettes.parId(ID_LASAGNES), 12);
    delete r.recette.__dernierEchelonnage;
    await Recettes.enregistrer(r.recette);

    global.localStorage = faireLocalStorage();
    const autre = chargerModules().Recettes;
    autre.definirBase(CARNET);
    await autre.rafraichir();
    assert.strictEqual(autre.parId(ID_LASAGNES).portions, '12 personnes');
    const boeuf = autre
      .parId(ID_LASAGNES)
      .ingredients.flatMap((g) => g.items)
      .find((i) => i.nom === 'Bœuf haché');
    assert.strictEqual(boeuf.quantite, '600 g');
  });

  await test('addRecipesToList ajoute plusieurs recettes en une seule salve', async () => {
    const { Storage } = neuf();
    const autre = {
      id: 'anchoiade',
      titre: 'Anchoiade',
      ingredients: [{ groupe: null, items: [{ nom: 'Anchois', quantite: '100 g' }] }],
    };
    const avant = stub.etat.appels.lectures;
    const resultat = await Storage.addRecipesToList([RECETTE, autre]);
    assert.strictEqual(resultat.ajoutes, 4);
    assert.strictEqual(resultat.deja, 0);
    assert.strictEqual(Storage.getShoppingList().length, 4);
    assert.strictEqual(stub.etat.articles.size, 4);
    // Une seule relecture, pas une par recette : c'est la raison d'etre de la salve.
    assert.ok(stub.etat.appels.lectures - avant <= 1, 'une lecture par recette a ete faite');
  });

  await test('addRecipesToList compte ce qui etait deja en liste sans le dupliquer', async () => {
    const { Storage } = neuf();
    await Storage.addRecipeToList(RECETTE);
    const resultat = await Storage.addRecipesToList([RECETTE]);
    assert.strictEqual(resultat.ajoutes, 0);
    assert.strictEqual(resultat.deja, 3);
    assert.strictEqual(Storage.getShoppingList().length, 3, 'des articles ont ete dupliques');
  });

  await test('addRecipesToList tolere une recette absente dans la selection', async () => {
    const { Storage } = neuf();
    const resultat = await Storage.addRecipesToList([null, RECETTE, { titre: 'sans identifiant' }]);
    assert.strictEqual(resultat.ajoutes, 3);
    assert.strictEqual(Storage.getShoppingList().length, 3);
  });

  // --- Semainier -------------------------------------------------------------

  const Sn = require(path.join(racine, 'js/semaine.js'));
  const LUNDI = '2026-08-03';
  const MARDI = '2026-08-04';

  await test('un plat pose sur un creneau est ecrit puis relu a l identique', async () => {
    const { Semainier } = neuf();
    await Semainier.poser(LUNDI, 'dejeuner', {
      type: 'recette',
      recetteId: 'tapenade-maison',
      titre: 'Tapenade maison',
    });
    assert.strictEqual(stub.etat.creneaux.size, 1);

    global.localStorage = faireLocalStorage();
    const autre = chargerModules().Semainier;
    await autre.rafraichir();
    const creneau = autre.creneau(LUNDI, 'dejeuner');
    assert.ok(creneau, 'le creneau n a pas ete relu');
    assert.strictEqual(creneau.titre, 'Tapenade maison');
    assert.strictEqual(creneau.recetteId, 'tapenade-maison');
    assert.strictEqual(creneau.type, 'recette');
    assert.strictEqual(creneau.jour, LUNDI);
    assert.strictEqual(creneau.moment, 'dejeuner');
  });

  await test('un repas hors carnet se pose sans identifiant de recette', async () => {
    const { Semainier } = neuf();
    await Semainier.poser(LUNDI, 'diner', { type: 'libre', titre: 'Pizzas' });
    const creneau = Semainier.creneau(LUNDI, 'diner');
    assert.strictEqual(creneau.type, 'libre');
    assert.strictEqual(creneau.titre, 'Pizzas');
    assert.strictEqual(creneau.recetteId, '');
  });

  await test('poser un plat sur un creneau occupe remplace le precedent', async () => {
    const { Semainier } = neuf();
    await Semainier.poser(LUNDI, 'diner', { type: 'libre', titre: 'Pizzas' });
    await Semainier.poser(LUNDI, 'diner', { type: 'libre', titre: 'Restaurant' });
    assert.strictEqual(Semainier.tous().length, 1, 'les deux plats coexistent');
    assert.strictEqual(Semainier.creneau(LUNDI, 'diner').titre, 'Restaurant');
    assert.strictEqual(stub.etat.creneaux.size, 1);
  });

  await test('un creneau vide est un document supprime, pas un document vide', async () => {
    const { Semainier } = neuf();
    await Semainier.poser(LUNDI, 'dejeuner', { type: 'libre', titre: 'Restes' });
    assert.strictEqual(stub.etat.creneaux.size, 1);
    await Semainier.vider(LUNDI, 'dejeuner');
    assert.strictEqual(stub.etat.creneaux.size, 0, 'un document vide est reste en base');
    assert.strictEqual(Semainier.creneau(LUNDI, 'dejeuner'), null);
  });

  await test('vider un creneau deja vide n envoie rien', async () => {
    const { Semainier } = neuf();
    const avant = stub.etat.appels.suppressions;
    await Semainier.vider(LUNDI, 'dejeuner');
    assert.strictEqual(stub.etat.appels.suppressions, avant);
  });

  await test('deplacer un plat vers un creneau libre le deplace vraiment', async () => {
    const { Semainier } = neuf();
    await Semainier.poser(LUNDI, 'dejeuner', { type: 'libre', titre: 'Pizzas' });
    await Semainier.deplacer(LUNDI, 'dejeuner', MARDI, 'diner');
    assert.strictEqual(Semainier.creneau(LUNDI, 'dejeuner'), null, 'le depart n a pas ete vide');
    assert.strictEqual(Semainier.creneau(MARDI, 'diner').titre, 'Pizzas');
    assert.strictEqual(stub.etat.creneaux.size, 1, 'le plat existe en double');
  });

  await test('deplacer sur un creneau occupe echange les deux plats', async () => {
    const { Semainier } = neuf();
    await Semainier.poser(LUNDI, 'dejeuner', { type: 'libre', titre: 'Pizzas' });
    await Semainier.poser(MARDI, 'diner', { type: 'recette', recetteId: 'tapenade-maison', titre: 'Tapenade' });
    await Semainier.deplacer(LUNDI, 'dejeuner', MARDI, 'diner');
    // Un echange plutot qu un ecrasement : sans cela, glisser un diner sur un autre
    // effacerait le second sans le dire.
    assert.strictEqual(Semainier.creneau(MARDI, 'diner').titre, 'Pizzas');
    assert.strictEqual(Semainier.creneau(LUNDI, 'dejeuner').titre, 'Tapenade');
    assert.strictEqual(Semainier.creneau(LUNDI, 'dejeuner').recetteId, 'tapenade-maison');
    assert.strictEqual(stub.etat.creneaux.size, 2);
  });

  await test('deplacer sur place ne change rien', async () => {
    const { Semainier } = neuf();
    await Semainier.poser(LUNDI, 'dejeuner', { type: 'libre', titre: 'Pizzas' });
    const avant = stub.etat.appels.ecritures;
    await Semainier.deplacer(LUNDI, 'dejeuner', LUNDI, 'dejeuner');
    assert.strictEqual(stub.etat.appels.ecritures, avant);
    assert.strictEqual(Semainier.creneau(LUNDI, 'dejeuner').titre, 'Pizzas');
  });

  await test('poser hors ligne fonctionne et part au retour du reseau', async () => {
    const { Semainier } = neuf();
    await basculerPanne(true);
    await Semainier.poser(LUNDI, 'dejeuner', { type: 'libre', titre: 'Restaurant' });
    // Visible tout de suite malgre la panne : le semainier sert en cuisine, il ne
    // peut pas attendre le reseau.
    assert.strictEqual(Semainier.creneau(LUNDI, 'dejeuner').titre, 'Restaurant');
    assert.strictEqual(Semainier.etatSync().enLigne, false);
    assert.strictEqual(Semainier.etatSync().enAttente, 1);
    assert.strictEqual(stub.etat.creneaux.size, 0);

    await basculerPanne(false);
    await Semainier.rafraichir();
    assert.strictEqual(Semainier.etatSync().enAttente, 0, 'la file n a pas ete videe');
    assert.strictEqual(stub.etat.creneaux.size, 1);
    assert.strictEqual(Semainier.creneau(LUNDI, 'dejeuner').titre, 'Restaurant');
  });

  await test('un rafraichissement hors ligne conserve les menus affiches', async () => {
    const { Semainier } = neuf();
    await Semainier.poser(LUNDI, 'dejeuner', { type: 'libre', titre: 'Pizzas' });
    await basculerPanne(true);
    await Semainier.rafraichir();
    assert.strictEqual(Semainier.creneau(LUNDI, 'dejeuner').titre, 'Pizzas', 'les menus ont ete perdus');
    await basculerPanne(false);
  });

  await test('un document au format inattendu est ignore et non affiche', async () => {
    const { Semainier, Sync } = neuf();
    // Un residu, ou un appel malformé : la cle ne se decoupe pas en jour et moment.
    await Sync.ecrireCreneau({ cle: 'residu', jour: 'x', moment: 'y', type: 'libre', titre: 'Rien' });
    await Semainier.rafraichir();
    assert.deepStrictEqual(Semainier.tous(), [], 'un document illisible est remonte a l ecran');
  });

  await test('les creneaux sont rendus dans l ordre du calendrier', async () => {
    const { Semainier } = neuf();
    await Semainier.poser(MARDI, 'diner', { type: 'libre', titre: 'C' });
    await Semainier.poser(LUNDI, 'diner', { type: 'libre', titre: 'B' });
    await Semainier.poser(LUNDI, 'petit-dejeuner', { type: 'libre', titre: 'A' });
    await Semainier.rafraichir();
    assert.deepStrictEqual(
      Semainier.tous().map((c) => c.titre),
      ['A', 'B', 'C']
    );
  });

  await test('platsDeLaSemaine dedoublonne un plat prevu deux fois', async () => {
    const { Semainier } = neuf();
    await Semainier.poser(LUNDI, 'dejeuner', { type: 'recette', recetteId: 'tapenade-maison', titre: 'Tapenade' });
    await Semainier.poser(MARDI, 'diner', { type: 'recette', recetteId: 'tapenade-maison', titre: 'Tapenade' });
    await Semainier.poser(MARDI, 'dejeuner', { type: 'libre', titre: 'Pizzas' });

    const sem = Sn.semaine(Sn.depuisCle(LUNDI), null);
    const plats = Semainier.platsDeLaSemaine(sem);
    assert.strictEqual(plats.length, 2, 'le plat en double n a pas ete regroupe');
    const tapenade = plats.find((p) => p.recetteId === 'tapenade-maison');
    assert.strictEqual(tapenade.occurrences.length, 2);
    assert.strictEqual(plats.find((p) => p.type === 'libre').titre, 'Pizzas');
  });

  await test('platsDeLaSemaine ignore les plats des autres semaines', async () => {
    const { Semainier } = neuf();
    await Semainier.poser(LUNDI, 'dejeuner', { type: 'libre', titre: 'Dans la semaine' });
    await Semainier.poser('2026-08-11', 'dejeuner', { type: 'libre', titre: 'La semaine suivante' });
    const sem = Sn.semaine(Sn.depuisCle(LUNDI), null);
    assert.deepStrictEqual(
      Semainier.platsDeLaSemaine(sem).map((p) => p.titre),
      ['Dans la semaine']
    );
  });

  await test('retirerRecette enleve toutes ses occurrences', async () => {
    const { Semainier } = neuf();
    await Semainier.poser(LUNDI, 'dejeuner', { type: 'recette', recetteId: 'a-supprimer', titre: 'A' });
    await Semainier.poser(MARDI, 'diner', { type: 'recette', recetteId: 'a-supprimer', titre: 'A' });
    await Semainier.poser(MARDI, 'dejeuner', { type: 'libre', titre: 'Pizzas' });
    await Semainier.retirerRecette('a-supprimer');
    assert.deepStrictEqual(
      Semainier.tous().map((c) => c.titre),
      ['Pizzas']
    );
    assert.strictEqual(stub.etat.creneaux.size, 1);
  });

  await test('deux appareils voient le meme semainier', async () => {
    const { Semainier } = neuf();
    await Semainier.poser(LUNDI, 'diner', { type: 'libre', titre: 'Japonais' });

    const memoireA = global.localStorage;
    global.localStorage = faireLocalStorage();
    const autre = chargerModules().Semainier;
    await autre.rafraichir();
    assert.strictEqual(autre.creneau(LUNDI, 'diner').titre, 'Japonais');

    // L autre appareil vide le creneau : le premier doit le voir en se rafraichissant.
    await autre.vider(LUNDI, 'diner');
    global.localStorage = memoireA;
    const premier = chargerModules().Semainier;
    await premier.rafraichir();
    assert.strictEqual(premier.creneau(LUNDI, 'diner'), null, 'la suppression distante n est pas vue');
  });

  await test('poser un plat sans titre ne cree rien', async () => {
    const { Semainier } = neuf();
    await Semainier.poser(LUNDI, 'diner', { type: 'libre', titre: '' });
    assert.strictEqual(stub.etat.creneaux.size, 0);
    assert.deepStrictEqual(Semainier.tous(), []);
  });

  // --- Photos ----------------------------------------------------------------

  const VIGNETTE = 'data:image/jpeg;base64,' + 'A'.repeat(400);
  const GRANDE = 'data:image/jpeg;base64,' + 'B'.repeat(4000);

  await test('une photo est ecrite en deux tailles dans un seul document', async () => {
    const { Photos } = neuf();
    await Photos.enregistrer('tapenade-maison', { vignette: VIGNETTE, grande: GRANDE });
    assert.strictEqual(stub.etat.photos.size, 1);
    assert.strictEqual(Photos.vignette('tapenade-maison'), VIGNETTE);
    assert.strictEqual(await Photos.grande('tapenade-maison'), GRANDE);
  });

  await test('la liste des vignettes ne telecharge pas les grandes images', async () => {
    const { Photos, Sync } = neuf();
    await Photos.enregistrer('tapenade-maison', { vignette: VIGNETTE, grande: GRANDE });
    const vignettes = await Sync.lireVignettes();
    // C est tout l interet du masque de lecture : afficher vingt vignettes ne doit
    // pas faire descendre vingt grandes images.
    assert.deepStrictEqual(Object.keys(vignettes), ['tapenade-maison']);
    assert.strictEqual(vignettes['tapenade-maison'], VIGNETTE);
    assert.strictEqual(JSON.stringify(vignettes).includes('BBBB'), false, 'la grande image a ete transmise');
  });

  await test('les vignettes sont relues dans le cache local d un autre appareil', async () => {
    const { Photos } = neuf();
    await Photos.enregistrer('tapenade-maison', { vignette: VIGNETTE, grande: GRANDE });

    global.localStorage = faireLocalStorage();
    const autre = chargerModules().Photos;
    assert.strictEqual(autre.vignette('tapenade-maison'), null, 'le cache devrait etre vide au depart');
    await autre.rafraichirVignettes();
    assert.strictEqual(autre.vignette('tapenade-maison'), VIGNETTE);
    assert.strictEqual(autre.aUnePhoto('tapenade-maison'), true);
  });

  await test('la grande image d une recette sans photo vaut null', async () => {
    const { Photos } = neuf();
    assert.strictEqual(await Photos.grande('sans-photo'), null);
  });

  await test('supprimer une photo l enleve du serveur et du cache', async () => {
    const { Photos } = neuf();
    await Photos.enregistrer('tapenade-maison', { vignette: VIGNETTE, grande: GRANDE });
    await Photos.supprimer('tapenade-maison');
    assert.strictEqual(stub.etat.photos.size, 0);
    assert.strictEqual(Photos.vignette('tapenade-maison'), null);
    assert.strictEqual(await Photos.grande('tapenade-maison'), null);
  });

  await test('une photo refusee par le serveur n est pas annoncee comme enregistree', async () => {
    const { Photos } = neuf();
    await basculerPanne(true);
    let leve = null;
    try {
      await Photos.enregistrer('tapenade-maison', { vignette: VIGNETTE, grande: GRANDE });
    } catch (erreur) {
      leve = erreur;
    }
    await basculerPanne(false);
    assert.ok(leve, 'l echec d envoi n a pas ete signale');
    // Le cache est nettoye : laisser la vignette ferait croire que la photo est
    // partagee avec les autres appareils alors qu elle n est jamais partie.
    assert.strictEqual(Photos.vignette('tapenade-maison'), null);
    assert.strictEqual(stub.etat.photos.size, 0);
  });

  await test('dimensionsCibles garde les proportions et n agrandit jamais', async () => {
    const { Photos } = neuf();
    assert.deepStrictEqual(Photos.dimensionsCibles(4000, 3000, 320), { largeur: 320, hauteur: 240 });
    assert.deepStrictEqual(Photos.dimensionsCibles(3000, 4000, 320), { largeur: 240, hauteur: 320 });
    assert.deepStrictEqual(Photos.dimensionsCibles(200, 100, 320), { largeur: 200, hauteur: 100 });
    assert.deepStrictEqual(Photos.dimensionsCibles(0, 0, 320), { largeur: 1, hauteur: 1 });
  });

  await test('poidsBinaire retire l en-tete et le bourrage de la data URL', async () => {
    const { Photos } = neuf();
    // « AAAA » en base64 fait 3 octets ; avec un bourrage « == » il en fait 1.
    assert.strictEqual(Photos.poidsBinaire('data:image/jpeg;base64,AAAA'), 3);
    assert.strictEqual(Photos.poidsBinaire('data:image/jpeg;base64,AA=='), 1);
    assert.strictEqual(Photos.poidsBinaire('pas-une-data-url'), 0);
  });

  // --- Recettes ajoutees depuis l application ---------------------------------

  await test('une recette creee apparait dans le livre et survit a un rechargement', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);
    const avant = Recettes.toutes().length;
    const creee = await Recettes.creer(
      Object.assign(Recettes.recetteVide(), { titre: 'Soupe du jardin', categorie: 'Entrée' })
    );
    assert.strictEqual(creee.id, 'soupe-du-jardin');
    assert.strictEqual(Recettes.toutes().length, avant + 1);
    assert.strictEqual(Recettes.estAjoutee(creee.id), true);
    assert.strictEqual(Recettes.estModifiee(creee.id), true);

    global.localStorage = faireLocalStorage();
    const autre = chargerModules().Recettes;
    autre.definirBase(CARNET);
    await autre.rafraichir();
    assert.strictEqual(autre.parId('soupe-du-jardin').titre, 'Soupe du jardin');
    assert.strictEqual(autre.toutes().length, avant + 1);
  });

  await test('deux recettes de meme titre ne s ecrasent pas', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);
    const une = await Recettes.creer(Object.assign(Recettes.recetteVide(), { titre: 'Soupe' }));
    const deux = await Recettes.creer(Object.assign(Recettes.recetteVide(), { titre: 'Soupe' }));
    assert.strictEqual(une.id, 'soupe');
    assert.strictEqual(deux.id, 'soupe-2');
    assert.strictEqual(stub.etat.recettes.size, 2);
  });

  await test('une recette creee ne peut pas prendre l identifiant d une recette d origine', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);
    const creee = await Recettes.creer(
      Object.assign(Recettes.recetteVide(), { titre: 'Lasagnes bolognaise : la meilleure recette' })
    );
    assert.notStrictEqual(creee.id, ID_LASAGNES);
    assert.strictEqual(Recettes.parId(ID_LASAGNES).titre, 'Lasagnes bolognaise : la meilleure recette');
    assert.strictEqual(Recettes.originale(ID_LASAGNES).id, ID_LASAGNES);
  });

  await test('creer sans titre est refuse', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);
    let leve = null;
    try {
      await Recettes.creer(Recettes.recetteVide());
    } catch (erreur) {
      leve = erreur;
    }
    assert.ok(leve, 'une recette sans titre a ete acceptee');
    assert.strictEqual(stub.etat.recettes.size, 0);
  });

  await test('supprimer refuse de toucher a une recette du carnet d origine', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);
    await Recettes.enregistrer(Object.assign({}, Recettes.parId(ID_LASAGNES), { titre: 'Modifiee' }));
    let leve = null;
    try {
      await Recettes.supprimer(ID_LASAGNES);
    } catch (erreur) {
      leve = erreur;
    }
    assert.ok(leve, 'la suppression d une recette d origine a ete acceptee');
    // La modification est intacte : la tentative n a rien casse.
    assert.strictEqual(Recettes.parId(ID_LASAGNES).titre, 'Modifiee');
    assert.strictEqual(stub.etat.recettes.size, 1);
  });

  await test('supprimer une recette ajoutee la retire pour de bon', async () => {
    const { Recettes } = neuf();
    Recettes.definirBase(CARNET);
    const creee = await Recettes.creer(Object.assign(Recettes.recetteVide(), { titre: 'Soupe du jardin' }));
    await Recettes.supprimer(creee.id);
    assert.strictEqual(Recettes.parId(creee.id), null);
    assert.strictEqual(stub.etat.recettes.size, 0);
  });

  // --- Restitution -----------------------------------------------------------

  serveur.close();
  console.log(`\n${reussis} test(s) reussi(s), ${echecs.length} echec(s)\n`);
  if (echecs.length > 0) {
    echecs.forEach((e) => console.error(`ECHEC  ${e.nom}\n       ${e.message}\n`));
    process.exit(1);
  }
});
