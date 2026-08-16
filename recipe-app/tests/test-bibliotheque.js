/* Test de la bibliothèque, dans un vrai navigateur.
 *
 * Ce que cette suite doit prouver, et qui est le cœur de la fonctionnalité :
 *
 * 1. Une recette rattachée à un livre **n'entre pas** dans le planning de la semaine.
 *    C'est la promesse tenue par l'écran, et la seule qu'un test unitaire ne suffit
 *    pas à vérifier : elle passe par la réserve de plats et par la boîte de choix
 *    d'un créneau, qui sont du rendu.
 * 2. Remontée dans le livre de cuisine, elle y entre. Redescendue, elle en sort.
 * 3. La recherche de la bibliothèque traverse tous les livres, celle d'un livre ne
 *    regarde que ses recettes, et les filtres d'un livre ne proposent que ce qu'il
 *    contient.
 * 4. Un livre créé sur un appareil apparaît sur l'autre. Deux contextes Chromium
 *    isolés, comme pour la liste commune et le semainier : c'est le seul montage qui
 *    prouve réellement le partage.
 */

function chargerChromium() {
  try {
    return require(process.env.PLAYWRIGHT_MODULE || 'playwright').chromium;
  } catch (erreur) {
    console.error(
      'Playwright est introuvable. Installer avec « npm i -D playwright && npx playwright install chromium »,\n' +
        'ou designer une installation existante via PLAYWRIGHT_MODULE.'
    );
    process.exit(3);
  }
}
const chromium = chargerChromium();
const OPTIONS_LANCEMENT = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};

const BASE = process.argv[2] || 'http://127.0.0.1:8104/';

const echecs = [];
const ok = [];
function verifier(nom, condition, detail = '') {
  if (condition) ok.push(nom);
  else echecs.push(`${nom}${detail ? ' -> ' + detail : ''}`);
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/** Attend qu'un motif apparaisse dans la page, ou rend false au bout de `limite`. */
async function attendreTexte(page, motif, limite = 8000) {
  const debut = Date.now();
  while (Date.now() - debut < limite) {
    const texte = await page.evaluate(() => document.body.textContent);
    if (motif.test(texte)) return true;
    await attendre(200);
  }
  return false;
}

// Un PNG de 4 x 4 pixels, le meme que celui du test du semainier : le
// redimensionnement a besoin d'une image que le navigateur sache decoder.
const PNG_ROUGE =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVR42mP8z8Dwn4EIwESMIkbi' +
  'FAEAoQ4F/1sYzE0AAAAASUVORK5CYII=';

  // Ces suites testent un carnet ouvert par quelqu'un de connecté et autorisé : c'est
  // l'usage normal. La session est posée avant le premier rendu, comme le ferait une
  // connexion faite la veille ; sans elle l'application s'ouvre en lecture seule et
  // aucun bouton de modification n'existe. Voir js/acces.js et tests/test-acces.js.
  const CONNECTE = () => {
    window.localStorage.setItem(
      'carnet-de-recettes:session-compte',
      JSON.stringify({
        idToken:
          'jeton-compte-test.eyJ1c2VyX2lkIjogImNvbXB0ZS10ZXN0IiwgInN1YiI6ICJjb21wdGUtdGVzdCIsICJlbWFpbCI6ICJ0ZXN0QG1haXNvbi5mciJ9.signature',
        refreshToken: 'refresh-compte-compte-test',
        expireLe: Date.now() + 3600000,
        uid: 'compte-test',
        email: 'test@maison.fr',
      })
    );
    window.localStorage.setItem('carnet-de-recettes:compte-autorise', 'oui');
  };

(async () => {
  const navigateur = await chromium.launch(OPTIONS_LANCEMENT);
  const contexteA = await navigateur.newContext({ viewport: { width: 1280, height: 1100 } });
  await contexteA.addInitScript(CONNECTE);
  const contexteB = await navigateur.newContext({ viewport: { width: 1280, height: 1100 } });
  await contexteB.addInitScript(CONNECTE);
  const pageA = await contexteA.newPage();
  const pageB = await contexteB.newPage();

  const erreurs = [];
  [pageA, pageB].forEach((page, i) => {
    page.on('pageerror', (e) => erreurs.push(`page${i}: ${e.message}`));
    page.on('console', (m) => {
      // Une recette sans illustration d'étape n'a pas de document dans
      // `illustrations` : Firestore répond 404, l'application le traite comme « aucune
      // illustration », et le navigateur le journalise quand même. Ce 404 est attendu,
      // ce sont les erreurs JavaScript qui ne le sont pas.
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) {
        erreurs.push(`page${i} console: ${m.text()}`);
      }
    });
  });

  const texteDe = (page) => page.evaluate(() => document.body.textContent);

  // Base vide : les décomptes de cette suite ne doivent pas dépendre de l'ordre
  // d'exécution des autres.
  await pageA.request.get(new URL('__stub/etat?reinitialiser=1', BASE).href);

  await pageA.goto(`${BASE}#/bibliotheque`, { waitUntil: 'networkidle' });
  await attendre(900);

  // --- 1. L'écran vide dit quoi faire ---------------------------------------

  verifier('la bibliothèque vide le dit', (await pageA.locator('#bibliotheque-vide').count()) === 1);
  verifier('la bibliothèque vide propose de créer un livre', (await pageA.locator('#creer-livre').count()) === 1);

  // --- 2. Créer un livre depuis la boîte ------------------------------------

  await pageA.click('#creer-livre');
  await attendre(300);
  verifier('la boîte de création s’ouvre', (await pageA.locator('#voile').count()) === 1);
  verifier(
    'créer est refusé sans titre',
    await pageA.locator('#valider-livre').isDisabled(),
    'le bouton est actif alors que le titre est vide'
  );

  await pageA.fill('#titre-livre', 'Ferrandi — Pâtisserie');
  await pageA.fill('#auteur-livre', 'Ferrandi Paris');
  await pageA.click('[data-theme-propose="Pâtisserie"]');
  await attendre(200);
  verifier('le titre active le bouton', !(await pageA.locator('#valider-livre').isDisabled()));
  await pageA.click('#valider-livre');
  await attendre(800);

  verifier(
    'la création ouvre le livre',
    pageA.url().includes('#/bibliotheque/ferrandi-patisserie'),
    pageA.url()
  );
  const surLivre = await texteDe(pageA);
  verifier('le livre porte son titre', /Ferrandi — Pâtisserie/.test(surLivre));
  verifier('le livre porte son auteur', /Ferrandi Paris/.test(surLivre));
  verifier('un livre neuf annonce qu’il est vide', /Aucune recette rattachée à ce livre/.test(surLivre), surLivre.slice(0, 400));

  const etat1 = await (await pageA.request.get(new URL('__stub/etat', BASE).href)).json();
  verifier('un document livre a été écrit', etat1.nbLivres === 1, `${etat1.nbLivres} documents`);
  verifier(
    'le document porte le thème et l’auteur',
    etat1.livres[0].fields.theme.stringValue === 'Pâtisserie' &&
      etat1.livres[0].fields.auteur.stringValue === 'Ferrandi Paris',
    JSON.stringify(etat1.livres[0].fields)
  );

  // --- 3. Le second appareil voit le livre ----------------------------------

  await pageB.goto(`${BASE}#/bibliotheque`, { waitUntil: 'networkidle' });
  await attendre(900);
  verifier(
    'le second appareil voit le livre créé par le premier',
    /Ferrandi — Pâtisserie/.test(await texteDe(pageB)),
    (await texteDe(pageB)).slice(0, 300)
  );

  // --- 4. Ajouter une recette dans le livre ---------------------------------

  await pageA.click('#ajouter-recette');
  await attendre(500);
  verifier(
    'l’ajout depuis un livre ouvre l’éditeur',
    (await pageA.locator('#champ-titre').count()) === 1,
    pageA.url()
  );
  await pageA.fill('#champ-titre', 'Paris-Brest');
  await pageA.click('#enregistrer');
  await attendre(900);
  verifier('la recette créée ouvre sa fiche', pageA.url().includes('#/recette/paris-brest'), pageA.url());

  const fiche = await texteDe(pageA);
  verifier('la fiche cite son livre', /Ferrandi — Pâtisserie/.test(fiche));
  // La recette est bien rattachée, et sa source est l'ouvrage : une recette venue
  // d'un livre papier a une source, et c'est ce livre.
  const rattachement = await pageA.evaluate(() => {
    const r = window.CarnetRecettes.parId('paris-brest');
    return { livre: r.livre, source: r.source.label, auLivre: Boolean(r.auLivre) };
  });
  verifier(
    'la recette porte son livre et sa source',
    rattachement.livre === 'ferrandi-patisserie' &&
      rattachement.source === 'Ferrandi — Pâtisserie' &&
      rattachement.auLivre === false,
    JSON.stringify(rattachement)
  );
  verifier(
    'une recette neuve n’est pas annoncée comme fiche modifiée',
    !/fiche modifiée/.test(fiche),
    'la marque de divergence est affichée sur une recette sans original'
  );
  verifier(
    'la fiche propose de l’ajouter au livre de cuisine',
    (await pageA.locator('#basculer-livre-cuisine').count()) === 1
  );

  // --- 5. Elle n'est pas dans le livre de cuisine ----------------------------

  await pageA.goto(`${BASE}#/livre`, { waitUntil: 'networkidle' });
  await attendre(600);
  verifier(
    'la recette du livre n’est pas dans le livre de cuisine',
    !/Paris-Brest/.test(await texteDe(pageA)),
    'une recette de la bibliothèque est apparue dans le livre de cuisine'
  );

  // --- 6. Ni dans le planning -----------------------------------------------

  await pageA.goto(BASE, { waitUntil: 'networkidle' });
  await attendre(700);
  await pageA.click('#modifier-semaine');
  await attendre(400);
  await pageA.fill('#recherche-reserve', 'Paris-Brest');
  await attendre(400);
  verifier(
    'la réserve de plats ignore les recettes de la bibliothèque',
    (await pageA.locator('#reserve [data-reserve]').count()) === 0,
    `${await pageA.locator('#reserve [data-reserve]').count()} plats proposés`
  );

  await pageA.locator('.creneau__vide').first().click();
  await attendre(400);
  await pageA.fill('#recherche-plat', 'Paris-Brest');
  await attendre(400);
  verifier(
    'la boîte de choix d’un repas ignore la bibliothèque',
    (await pageA.locator('[data-choix]').count()) === 0,
    `${await pageA.locator('[data-choix]').count()} choix proposés`
  );
  await pageA.click('#fermer-boite');
  await attendre(200);

  // --- 7. Remontée dans le livre de cuisine ---------------------------------

  await pageA.goto(`${BASE}#/recette/paris-brest`, { waitUntil: 'networkidle' });
  await attendre(600);
  await pageA.click('#basculer-livre-cuisine');
  await attendre(800);

  const apresRemontee = await texteDe(pageA);
  verifier('la fiche dit qu’elle est dans le livre de cuisine', /dans le livre de cuisine/.test(apresRemontee));
  verifier(
    'le bouton propose maintenant de la retirer',
    /Retirer du livre de cuisine/.test(await pageA.locator('#basculer-livre-cuisine').textContent())
  );

  await pageA.goto(`${BASE}#/livre`, { waitUntil: 'networkidle' });
  await attendre(600);
  verifier(
    'remontée, elle est dans le livre de cuisine',
    /Paris-Brest/.test(await texteDe(pageA)),
    'la recette remontée n’apparaît pas dans le livre de cuisine'
  );

  await pageA.goto(BASE, { waitUntil: 'networkidle' });
  await attendre(700);
  await pageA.click('#modifier-semaine');
  await attendre(400);
  await pageA.fill('#recherche-reserve', 'Paris-Brest');
  await attendre(400);
  verifier(
    'remontée, elle est proposée dans la réserve',
    (await pageA.locator('#reserve [data-reserve]').count()) === 1,
    `${await pageA.locator('#reserve [data-reserve]').count()} plats proposés`
  );

  // Elle reste dans son livre : remonter n'est pas déplacer.
  await pageA.goto(`${BASE}#/bibliotheque/ferrandi-patisserie`, { waitUntil: 'networkidle' });
  await attendre(600);
  verifier(
    'remontée, elle reste dans son livre',
    /Paris-Brest/.test(await texteDe(pageA)),
    'la recette a quitté son livre en étant remontée'
  );

  // --- 8. Redescendue, elle ressort -----------------------------------------

  await pageA.goto(`${BASE}#/recette/paris-brest`, { waitUntil: 'networkidle' });
  await attendre(600);
  await pageA.click('#basculer-livre-cuisine');
  await attendre(800);
  await pageA.goto(`${BASE}#/livre`, { waitUntil: 'networkidle' });
  await attendre(600);
  verifier(
    'redescendue, elle quitte le livre de cuisine',
    !/Paris-Brest/.test(await texteDe(pageA)),
    'la recette redescendue est restée dans le livre de cuisine'
  );

  // --- 9. Recherches et filtres, chacun sur son périmètre -------------------

  // Un second livre, avec une recette, pour vérifier que les périmètres tiennent.
  await pageA.evaluate(async () => {
    await window.CarnetLivres.creer('Recettes de nos grand-mères', 'Plats');
    const R = window.CarnetRecettes;
    await R.creer(
      Object.assign(R.recetteVide({ id: 'recettes-de-nos-grand-meres', titre: 'Recettes de nos grand-mères' }), {
        titre: 'Blanquette de veau',
        categorie: 'Plat',
        ingredients: [{ groupe: null, items: [{ nom: 'Veau', quantite: '800 g' }] }],
        instructions: [{ numero: 1, texte: 'Cuire doucement.', astuce: '' }],
      })
    );
  });

  await pageA.goto(`${BASE}#/bibliotheque`, { waitUntil: 'networkidle' });
  await attendre(700);
  verifier('les deux livres sont listés', (await pageA.locator('.livre-carte[data-livre]').count()) === 2);
  verifier('les thèmes servent de filtre', (await pageA.locator('[data-theme-livre]').count()) === 3, 'Tous + deux thèmes');

  await pageA.click('[data-theme-livre="Plats"]');
  await attendre(400);
  verifier(
    'un thème filtré ne montre que ses livres',
    (await pageA.locator('.livre-carte[data-livre]').count()) === 1,
    `${await pageA.locator('.livre-carte[data-livre]').count()} livres affichés`
  );
  await pageA.click('[data-theme-livre="Plats"]');
  await attendre(400);

  await pageA.fill('#recherche-bibliotheque', 'blanquette');
  await attendre(500);
  verifier(
    'la recherche de la bibliothèque traverse tous les livres',
    (await pageA.locator('#resultats-bibliotheque .carte').count()) === 1,
    `${await pageA.locator('#resultats-bibliotheque .carte').count()} résultats`
  );
  verifier(
    'le résultat porte le nom de son livre',
    /Recettes de nos grand-mères/.test(await pageA.locator('#resultats-bibliotheque').textContent())
  );

  await pageA.fill('#recherche-bibliotheque', 'lasagnes');
  await attendre(500);
  verifier(
    'la recherche de la bibliothèque ignore le livre de cuisine',
    (await pageA.locator('#resultats-bibliotheque').count()) === 0,
    'une recette du livre de cuisine est apparue dans les résultats de la bibliothèque'
  );

  // La recherche de la bibliothèque est effacée avant de repasser à la grille : elle
  // survit à la navigation, comme les filtres du livre.
  await pageA.click('#effacer-recherche-bibliotheque');
  await attendre(400);
  verifier(
    'effacer la recherche ramène la grille des livres',
    (await pageA.locator('.livre-carte[data-livre]').count()) === 2,
    `${await pageA.locator('.livre-carte[data-livre]').count()} livres affichés`
  );

  await pageA.goto(`${BASE}#/bibliotheque/ferrandi-patisserie`, { waitUntil: 'networkidle' });
  await attendre(600);
  const filtresDuLivre = await pageA.evaluate(() =>
    [...document.querySelectorAll('[data-filtre]')].map((n) => n.getAttribute('data-filtre'))
  );
  // Paris-Brest est la seule recette de ce livre, et l'éditeur donne « Plat » par
  // défaut : une seule puce de catégorie doit donc être proposée, la sienne. La
  // blanquette de l'autre livre ne doit pas y ajouter la sienne.
  verifier(
    'les filtres d’un livre ne proposent que ses catégories',
    filtresDuLivre.filter((f) => f.indexOf('categorie:') === 0).join(',') === 'categorie:Plat',
    filtresDuLivre.join(' | ')
  );

  await pageA.fill('.champ-recherche', 'blanquette');
  await attendre(500);
  verifier(
    'la recherche d’un livre ne regarde que ses recettes',
    /Aucune recette ne correspond/.test(await texteDe(pageA)),
    'une recette d’un autre livre est apparue'
  );

  // --- 10. Supprimer un livre ------------------------------------------------

  await pageA.evaluate(() => window.CarnetLivres.creer('Livre créé par erreur', 'Autres'));
  await pageA.goto(`${BASE}#/bibliotheque/livre-cree-par-erreur`, { waitUntil: 'networkidle' });
  await attendre(600);
  verifier('un livre vide peut être supprimé', (await pageA.locator('#supprimer-livre').count()) === 1);

  await pageA.goto(`${BASE}#/bibliotheque/ferrandi-patisserie`, { waitUntil: 'networkidle' });
  await attendre(600);
  verifier(
    'un livre garni ne propose pas la suppression',
    (await pageA.locator('#supprimer-livre').count()) === 0,
    'la suppression est proposée sur un livre qui contient des recettes'
  );

  await pageA.goto(`${BASE}#/bibliotheque/livre-cree-par-erreur`, { waitUntil: 'networkidle' });
  await attendre(600);
  await pageA.click('#supprimer-livre');
  await attendre(900);
  verifier('la suppression ramène à la bibliothèque', pageA.url().includes('#/bibliotheque'), pageA.url());
  // On interroge la grille et non le texte de la page : le bandeau d'annulation porte
  // lui aussi le titre du livre, et le chercher dans tout le corps le trouverait là.
  verifier(
    'le livre supprimé a disparu de la grille',
    (await pageA.locator('.livre-carte[data-livre="livre-cree-par-erreur"]').count()) === 0,
    'le livre supprimé est encore listé'
  );
  verifier(
    'la suppression propose de revenir en arrière',
    (await pageA.locator('#annulation').count()) === 1,
    'aucun bandeau d’annulation après la suppression d’un livre'
  );

  // --- 11. Renommer un livre, et sa couverture ------------------------------

  await pageA.goto(`${BASE}#/bibliotheque/ferrandi-patisserie`, { waitUntil: 'networkidle' });
  await attendre(600);
  verifier('un livre propose d’être modifié', (await pageA.locator('#modifier-livre').count()) === 1);
  await pageA.click('#modifier-livre');
  await attendre(400);
  verifier('la boîte de modification s’ouvre', (await pageA.locator('#voile').count()) === 1);
  verifier(
    'la boîte est pré-remplie avec le livre',
    (await pageA.locator('#titre-livre').inputValue()) === 'Ferrandi — Pâtisserie' &&
      (await pageA.locator('#auteur-livre').inputValue()) === 'Ferrandi Paris'
  );

  // La couverture, dans la même boîte : c'est l'identité du livre.
  verifier('la boîte propose une couverture', (await pageA.locator('#couverture-fichier').count()) === 1);
  verifier('aucune couverture au départ', /Aucune couverture/.test(await texteDe(pageA)));
  await pageA.locator('#couverture-fichier').setInputFiles({
    name: 'couverture.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_ROUGE, 'base64'),
  });
  verifier(
    'l’enregistrement de la couverture est confirmé',
    await attendreTexte(pageA, /Couverture enregistrée et partagée/, 12000),
    await texteDe(pageA)
  );

  const etatCouverture = await (await pageA.request.get(new URL('__stub/etat', BASE).href)).json();
  const couverture = etatCouverture.photos.find((p) => p.recetteId === 'livre::ferrandi-patisserie');
  verifier(
    'la couverture est rangée sous la clé du livre',
    Boolean(couverture) && couverture.tailleVignette > 0 && couverture.tailleGrande > 0,
    JSON.stringify(etatCouverture.photos.map((p) => p.recetteId))
  );

  await pageA.fill('#titre-livre', 'Ferrandi, le grand livre');
  await pageA.click('[data-theme-propose="Plats"]');
  await attendre(300);
  await pageA.click('#valider-livre');
  await attendre(900);

  verifier('la boîte se referme après enregistrement', (await pageA.locator('#voile').count()) === 0);
  // L'identifiant ne change pas avec le titre : les recettes citent leur livre par lui.
  verifier(
    'le livre garde son adresse après renommage',
    pageA.url().includes('#/bibliotheque/ferrandi-patisserie'),
    pageA.url()
  );
  const apresRenommage = await texteDe(pageA);
  verifier('le livre porte son nouveau titre', /Ferrandi, le grand livre/.test(apresRenommage));
  verifier('le livre porte son nouveau thème', /Plats/.test(apresRenommage));
  verifier(
    'la recette rattachée a survécu au renommage',
    /Paris-Brest/.test(apresRenommage),
    'la recette a perdu son livre au renommage'
  );
  verifier('la couverture s’affiche sur l’écran du livre', (await pageA.locator('.livre__couverture img').count()) === 1);

  await pageA.goto(`${BASE}#/bibliotheque`, { waitUntil: 'networkidle' });
  await attendre(700);
  verifier(
    'la couverture s’affiche sur la carte du livre',
    (await pageA.locator('[data-livre="ferrandi-patisserie"] .livre-carte__image').count()) === 1
  );
  verifier(
    'un livre sans couverture garde son aplat',
    (await pageA.locator('[data-livre="recettes-de-nos-grand-meres"] .livre-carte__image').count()) === 0
  );

  // --- 12. Déplacer une recette d'un livre à un autre -----------------------

  await pageA.goto(`${BASE}#/recette/paris-brest/modifier`, { waitUntil: 'networkidle' });
  await attendre(800);
  verifier('l’éditeur propose de déplacer la recette', (await pageA.locator('#deplacer-recette').count()) === 1);
  await pageA.click('#deplacer-recette');
  await attendre(400);
  verifier('la boîte de déplacement s’ouvre', (await pageA.locator('#destinations-livre').count()) === 1);
  verifier(
    'le livre où elle est déjà n’est pas proposé',
    await pageA.locator('[data-destination="ferrandi-patisserie"]').isDisabled()
  );
  verifier(
    'le livre de cuisine est une destination',
    (await pageA.locator('[data-destination="livre-de-cuisine"]').count()) === 1
  );

  await pageA.click('[data-destination="recettes-de-nos-grand-meres"]');
  await attendre(1000);
  const apresDeplacement = await pageA.evaluate(() => {
    const r = window.CarnetRecettes.parId('paris-brest');
    return { livre: r.livre, titre: r.titre };
  });
  verifier(
    'la recette a changé de livre',
    apresDeplacement.livre === 'recettes-de-nos-grand-meres' && apresDeplacement.titre === 'Paris-Brest',
    JSON.stringify(apresDeplacement)
  );

  await pageA.goto(`${BASE}#/bibliotheque/ferrandi-patisserie`, { waitUntil: 'networkidle' });
  await attendre(600);
  verifier(
    'elle a quitté son ancien livre',
    !/Paris-Brest/.test(await texteDe(pageA)),
    'la recette est restée dans son ancien livre'
  );

  // Vers le livre de cuisine : elle sort de la bibliothèque.
  await pageA.goto(`${BASE}#/recette/paris-brest/modifier`, { waitUntil: 'networkidle' });
  await attendre(800);
  await pageA.click('#deplacer-recette');
  await attendre(400);
  await pageA.click('[data-destination="livre-de-cuisine"]');
  await attendre(1000);
  const sortie = await pageA.evaluate(() => {
    const r = window.CarnetRecettes.parId('paris-brest');
    return { livre: r.livre === undefined ? null : r.livre, auLivre: Boolean(r.auLivre) };
  });
  verifier(
    'déplacée vers le livre de cuisine, elle quitte la bibliothèque',
    sortie.livre === null && sortie.auLivre === false,
    JSON.stringify(sortie)
  );
  await pageA.goto(`${BASE}#/livre`, { waitUntil: 'networkidle' });
  await attendre(600);
  verifier(
    'elle est alors dans le livre de cuisine',
    /Paris-Brest/.test(await texteDe(pageA)),
    'la recette sortie de la bibliothèque n’est pas dans le livre de cuisine'
  );

  // --- 13. Un livre inconnu le dit ------------------------------------------


  await pageA.goto(`${BASE}#/bibliotheque/livre-qui-n-existe-pas`, { waitUntil: 'networkidle' });
  await attendre(500);
  verifier('un identifiant de livre inconnu affiche un message clair', /Livre introuvable/.test(await texteDe(pageA)));

  // --- 14. Pas de débordement sur un écran de téléphone ---------------------

  await pageA.setViewportSize({ width: 360, height: 780 });
  await pageA.goto(`${BASE}#/bibliotheque`, { waitUntil: 'networkidle' });
  await attendre(600);
  const debordement = await pageA.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  verifier('aucun débordement horizontal en 360 px', debordement <= 1, `${debordement} px`);

  // --- 15. Aucune erreur JavaScript ----------------------------------------

  verifier('aucune erreur JavaScript', erreurs.length === 0, erreurs.slice(0, 3).join(' | '));

  await navigateur.close();

  console.log(`\n${ok.length} verification(s) OK, ${echecs.length} echec(s)\n`);
  if (echecs.length) {
    echecs.forEach((e) => console.error('ECHEC  ' + e));
    process.exit(1);
  }
})().catch((e) => {
  console.error('Le test a leve :', e.message);
  process.exit(2);
});
