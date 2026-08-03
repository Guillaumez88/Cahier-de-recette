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
  ['js/firebase-config.js', 'js/sync.js', 'js/storage.js'].forEach((relatif) => {
    delete require.cache[require.resolve(path.join(racine, relatif))];
  });
  const config = require(path.join(racine, 'js/firebase-config.js'));
  config.baseFirestore = `http://127.0.0.1:${PORT}/__firestore/v1`;
  config.baseAuth = `http://127.0.0.1:${PORT}/__auth/v1`;
  config.baseSecureToken = `http://127.0.0.1:${PORT}/__auth/v1`;
  config.projectId = 'projet-de-test';
  const Sync = require(path.join(racine, 'js/sync.js'));
  const Storage = require(path.join(racine, 'js/storage.js'));
  return { config, Sync, Storage };
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

  // --- Restitution -----------------------------------------------------------

  serveur.close();
  console.log(`\n${reussis} test(s) reussi(s), ${echecs.length} echec(s)\n`);
  if (echecs.length > 0) {
    echecs.forEach((e) => console.error(`ECHEC  ${e.nom}\n       ${e.message}\n`));
    process.exit(1);
  }
});
