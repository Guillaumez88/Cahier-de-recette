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

(async () => {
  const navigateur = await chromium.launch(OPTIONS_LANCEMENT);
  const contexteA = await navigateur.newContext({ viewport: { width: 1280, height: 1100 } });
  const contexteB = await navigateur.newContext({ viewport: { width: 1280, height: 1100 } });
  const pageA = await contexteA.newPage();
  const pageB = await contexteB.newPage();

  const erreurs = [];
  [pageA, pageB].forEach((page, i) => {
    page.on('pageerror', (e) => erreurs.push(`page${i}: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') erreurs.push(`page${i} console: ${m.text()}`);
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

  // --- 11. Un livre inconnu le dit ------------------------------------------

  await pageA.goto(`${BASE}#/bibliotheque/livre-qui-n-existe-pas`, { waitUntil: 'networkidle' });
  await attendre(500);
  verifier('un identifiant de livre inconnu affiche un message clair', /Livre introuvable/.test(await texteDe(pageA)));

  // --- 12. Pas de débordement sur un écran de téléphone ---------------------

  await pageA.setViewportSize({ width: 360, height: 780 });
  await pageA.goto(`${BASE}#/bibliotheque`, { waitUntil: 'networkidle' });
  await attendre(600);
  const debordement = await pageA.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  verifier('aucun débordement horizontal en 360 px', debordement <= 1, `${debordement} px`);

  // --- 13. Aucune erreur JavaScript ----------------------------------------

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
