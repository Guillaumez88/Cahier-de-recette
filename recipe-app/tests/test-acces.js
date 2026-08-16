/* Le partage en lecture seule, dans un vrai navigateur.
 *
 * Ce que cette suite doit prouver, et qu'aucun test unitaire ne prouve :
 *
 * 1. Un visiteur qui ouvre l'adresse **voit tout** : l'accueil, une fiche complète,
 *    la liste de courses, la bibliothèque. C'est la moitié utile du partage.
 * 2. Il ne voit **aucune commande de modification**, et coller l'adresse d'un écran
 *    d'édition ne l'y mène pas.
 * 3. S'il force malgré tout une écriture, **le serveur la refuse** et la file locale
 *    ne la garde pas : pas de bannière « hors ligne » perpétuelle sur un appareil qui
 *    est en ligne.
 * 4. Le code de la maison déverrouille l'appareil, un mauvais code ne déverrouille
 *    rien, et le déverrouillage survit au rechargement.
 * 5. Les deux appareils sont indépendants : déverrouiller l'un ne déverrouille pas
 *    l'autre. Deux contextes Chromium isolés, comme pour la liste commune.
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
const CODE = 'chataigne-des-cevennes';

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
  const visiteur = await contexteA.newPage();
  const maison = await contexteB.newPage();

  const erreurs = [];
  [visiteur, maison].forEach((page, i) => {
    page.on('pageerror', (e) => erreurs.push(`page${i}: ${e.message}`));
    page.on('console', (m) => {
      // Les 403 et 404 attendus (appareil inconnu, illustrations absentes) sont
      // journalisés par le navigateur : ce sont les erreurs JavaScript qui comptent.
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) {
        erreurs.push(`page${i} console: ${m.text()}`);
      }
    });
  });

  // Base vide, verrou serveur armé, code posé : c'est l'état d'un vrai projet.
  await visiteur.request.get(new URL('__stub/etat?reinitialiser=1', BASE).href);
  await visiteur.request.post(new URL('__stub/exiger-maison', BASE).href, {
    data: { exiger: true, code: CODE },
  });

  // --- 1. Le visiteur lit tout ----------------------------------------------

  await visiteur.goto(BASE, { waitUntil: 'networkidle' });
  await attendre(900);

  const texteAccueil = await visiteur.evaluate(() => document.body.textContent);
  verifier('le visiteur voit l’accueil', /Les repas de la semaine/.test(texteAccueil));
  verifier('le visiteur voit le carnet en lecture seule', /lecture seule/i.test(texteAccueil));

  await visiteur.goto(`${BASE}#/recette/tapenade-maison`, { waitUntil: 'networkidle' });
  await attendre(600);
  const ficheVisiteur = await visiteur.evaluate(() => document.body.textContent);
  verifier('le visiteur voit une fiche entière', /Tapenade maison/.test(ficheVisiteur));
  verifier('la fiche montre ses ingrédients', /Olives noires/.test(ficheVisiteur));

  // --- 2. Aucune commande de modification -----------------------------------

  verifier('pas de bouton Modifier sur la fiche', (await visiteur.locator('#modifier-recette').count()) === 0);
  verifier('le partage reste proposé', (await visiteur.locator('#partager-recette').count()) === 1);
  verifier(
    'pas de case pour ajouter un ingrédient à la liste',
    (await visiteur.locator('.case-ingredient:not([disabled])').count()) === 0
  );

  await visiteur.goto(`${BASE}#/livre`, { waitUntil: 'networkidle' });
  await attendre(500);
  verifier('pas de bouton Ajouter une recette', (await visiteur.locator('#ajouter-recette').count()) === 0);
  verifier('pas de bouton Importer', (await visiteur.locator('#importer-recette').count()) === 0);

  await visiteur.goto(`${BASE}#/bibliotheque`, { waitUntil: 'networkidle' });
  await attendre(500);
  verifier('pas de bouton Créer un livre', (await visiteur.locator('#creer-livre').count()) === 0);

  await visiteur.goto(`${BASE}#/liste-de-courses`, { waitUntil: 'networkidle' });
  await attendre(500);
  verifier('pas de formulaire d’ajout libre', (await visiteur.locator('#ajout-valider').count()) === 0);
  verifier('pas de bouton Placard', (await visiteur.locator('#ouvrir-placard').count()) === 0);

  await visiteur.goto(BASE, { waitUntil: 'networkidle' });
  await attendre(500);
  verifier('pas de bouton Modifier la semaine', (await visiteur.locator('#modifier-semaine').count()) === 0);

  // --- 3. Une adresse d'édition collée ne mène nulle part --------------------

  await visiteur.goto(`${BASE}#/recette/nouvelle`, { waitUntil: 'networkidle' });
  await attendre(700);
  verifier(
    'l’éditeur de création renvoie à l’accueil',
    (await visiteur.evaluate(() => window.location.hash)) === '#/',
    await visiteur.evaluate(() => window.location.hash)
  );

  await visiteur.goto(`${BASE}#/recette/tapenade-maison/modifier`, { waitUntil: 'networkidle' });
  await attendre(700);
  verifier(
    'l’éditeur d’une recette renvoie à sa fiche',
    (await visiteur.evaluate(() => window.location.hash)) === '#/recette/tapenade-maison',
    await visiteur.evaluate(() => window.location.hash)
  );

  // --- 4. Le serveur refuse, et la file ne s'encombre pas --------------------

  const refus = await visiteur.evaluate(async () => {
    // On lève le verrou d'interface pour ne tester que le serveur : c'est ce que
    // ferait quelqu'un depuis la console du navigateur.
    window.CarnetSync.definirLectureSeule(false);
    await window.CarnetStorage.addFreeItem('Sel de contrebande', '1 pincée');
    return window.CarnetStorage.etatSync();
  });
  verifier('le serveur refuse l’écriture d’un visiteur', refus.statut === 403, JSON.stringify(refus.statut));
  verifier('la file locale ne garde pas le refus', refus.enAttente === 0, String(refus.enAttente));

  const apresRefus = await visiteur.request.get(new URL('__stub/etat', BASE).href);
  verifier('rien n’est arrivé côté serveur', (await apresRefus.json()).nbArticles === 0);

  // --- 5. Le code déverrouille, le mauvais code ne fait rien -----------------

  await maison.goto(`${BASE}#/acces`, { waitUntil: 'networkidle' });
  await attendre(700);
  verifier('l’écran d’accès demande un code', (await maison.locator('#code-maison').count()) === 1);

  await maison.fill('#code-maison', 'pas-le-bon-code');
  await maison.click('#valider-code');
  await attendre(900);
  verifier(
    'un mauvais code est refusé',
    /refusé/i.test(await maison.evaluate(() => document.getElementById('acces-message').textContent))
  );
  verifier(
    'un mauvais code laisse l’appareil en lecture seule',
    (await maison.evaluate(() => window.location.hash)) === '#/acces'
  );

  await maison.fill('#code-maison', CODE);
  await maison.click('#valider-code');
  await attendre(1200);
  verifier(
    'le bon code ramène à l’accueil',
    (await maison.evaluate(() => window.location.hash)) === '#/'
  );
  verifier('l’appareil de la maison peut modifier la semaine', (await maison.locator('#modifier-semaine').count()) === 1);

  await maison.goto(`${BASE}#/recette/tapenade-maison`, { waitUntil: 'networkidle' });
  await attendre(600);
  verifier('la fiche retrouve son bouton Modifier', (await maison.locator('#modifier-recette').count()) === 1);

  // --- 6. Le déverrouillage tient, et n'est pas contagieux -------------------

  await maison.reload({ waitUntil: 'networkidle' });
  await attendre(900);
  verifier(
    'le déverrouillage survit au rechargement',
    (await maison.locator('#modifier-recette').count()) === 1
  );

  // Un appareil de la maison qui a effacé son stockage : il ne se reconnaît pas tout
  // seul (ce serait une lecture Firestore à chaque visite de chaque lecteur), mais
  // l'écran d'accès sait le lui demander.
  await maison.evaluate(() => window.localStorage.removeItem('carnet-de-recettes:maison'));
  // Un changement d'ancre ne relit pas le stockage : l'état de l'appareil est décidé
  // une fois, au chargement. Il faut donc recharger vraiment.
  await maison.goto(`${BASE}#/acces`, { waitUntil: 'networkidle' });
  await maison.reload({ waitUntil: 'networkidle' });
  await attendre(900);
  verifier('après effacement, l’appareil redemande le code', (await maison.locator('#code-maison').count()) === 1);
  await maison.click('#verifier-inscription');
  await attendre(1200);
  verifier(
    'la vérification à la demande le reconnaît',
    (await maison.evaluate(() => window.location.hash)) === '#/',
    await maison.evaluate(() => window.location.hash)
  );

  await maison.goto(`${BASE}#/liste-de-courses`, { waitUntil: 'networkidle' });
  await attendre(600);
  await maison.fill('#ajout-nom', 'Farine');
  await maison.click('#ajout-valider');
  await attendre(900);
  const etatFinal = await (await maison.request.get(new URL('__stub/etat', BASE).href)).json();
  verifier('l’appareil de la maison écrit vraiment', etatFinal.nbArticles === 1, String(etatFinal.nbArticles));
  verifier('un seul appareil est inscrit', etatFinal.nbAppareils === 1, String(etatFinal.nbAppareils));

  // Un simple changement d'ancre ne relit pas la base : la liste n'est lue qu'au
  // chargement. Il faut donc recharger vraiment pour voir ce qu'un autre appareil a
  // écrit, comme le ferait quelqu'un qui rouvre le lien.
  await visiteur.goto(`${BASE}#/liste-de-courses`, { waitUntil: 'networkidle' });
  await visiteur.reload({ waitUntil: 'networkidle' });
  await attendre(1200);
  verifier(
    'le visiteur reste en lecture seule',
    (await visiteur.locator('#ajout-valider').count()) === 0
  );
  verifier(
    'le visiteur voit pourtant l’article ajouté',
    /Farine/.test(await visiteur.evaluate(() => document.body.textContent))
  );

  // --- 7. Aucune erreur JavaScript ------------------------------------------

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
