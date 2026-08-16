/* Les comptes, dans un vrai navigateur.
 *
 * Ce que cette suite doit prouver, et qu'aucun test unitaire ne prouve :
 *
 * 1. Sans compte, on lit tout et on ne modifie rien : aucune commande de modification
 *    à l'écran, et coller l'adresse d'un éditeur n'y mène pas.
 * 2. Une écriture forcée depuis la console est refusée par le serveur, et la file
 *    locale ne la garde pas.
 * 3. Créer un compte ne donne aucun droit. Le code de la maison, saisi une fois, les
 *    donne.
 * 4. Les droits suivent la personne, pas l'appareil : se déconnecter les retire, se
 *    reconnecter ailleurs les rend, sans ressaisir le code.
 * 5. Deux navigateurs isolés restent indépendants tant qu'ils ne partagent pas de
 *    compte.
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
const EMAIL = 'cuisine@maison.fr';
const MOT_DE_PASSE = 'brioche-tropezienne';

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
  const cuisinier = await contexteB.newPage();

  const erreurs = [];
  [visiteur, cuisinier].forEach((page, i) => {
    page.on('pageerror', (e) => erreurs.push(`page${i}: ${e.message}`));
    page.on('console', (m) => {
      // Les 403 et 404 attendus (compte non autorisé, illustrations absentes) sont
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

  // --- 1. Sans compte : on lit tout, on ne modifie rien ----------------------

  await visiteur.goto(BASE, { waitUntil: 'networkidle' });
  await attendre(900);

  const accueil = await visiteur.evaluate(() => document.body.textContent);
  verifier('le visiteur voit l’accueil', /Les repas de la semaine/.test(accueil));
  verifier('le visiteur voit qu’il est en lecture seule', /lecture seule/i.test(accueil));

  await visiteur.goto(`${BASE}#/recette/tapenade-maison`, { waitUntil: 'networkidle' });
  await attendre(600);
  const fiche = await visiteur.evaluate(() => document.body.textContent);
  verifier('le visiteur voit une fiche entière', /Tapenade maison/.test(fiche));
  verifier('la fiche montre ses ingrédients', /Olives noires/.test(fiche));
  verifier('pas de bouton Modifier', (await visiteur.locator('#modifier-recette').count()) === 0);
  verifier('le partage reste proposé', (await visiteur.locator('#partager-recette').count()) === 1);

  await visiteur.goto(`${BASE}#/liste-de-courses`, { waitUntil: 'networkidle' });
  await attendre(500);
  verifier('pas de formulaire d’ajout', (await visiteur.locator('#ajout-valider').count()) === 0);

  await visiteur.goto(`${BASE}#/recette/tapenade-maison/modifier`, { waitUntil: 'networkidle' });
  await attendre(700);
  verifier(
    'l’éditeur renvoie à la fiche',
    (await visiteur.evaluate(() => window.location.hash)) === '#/recette/tapenade-maison',
    await visiteur.evaluate(() => window.location.hash)
  );

  // --- 2. Le serveur refuse une écriture forcée ------------------------------

  const refus = await visiteur.evaluate(async () => {
    window.CarnetSync.definirLectureSeule(false);
    await window.CarnetStorage.addFreeItem('Sel de contrebande', '1 pincée');
    return window.CarnetStorage.etatSync();
  });
  verifier('le serveur refuse l’écriture sans compte', refus.statut === 403, JSON.stringify(refus.statut));
  verifier('la file locale ne garde pas le refus', refus.enAttente === 0, String(refus.enAttente));

  // --- 3. Créer un compte ne donne rien, le code donne tout ------------------

  await cuisinier.goto(`${BASE}#/compte`, { waitUntil: 'networkidle' });
  await attendre(700);
  verifier('l’écran de compte demande une adresse', (await cuisinier.locator('#email-compte').count()) === 1);

  await cuisinier.fill('#email-compte', EMAIL);
  await cuisinier.fill('#mot-de-passe', 'court');
  await cuisinier.click('#creer-compte');
  await attendre(900);
  verifier(
    'un mot de passe trop court est refusé',
    /six caractères/i.test(await cuisinier.locator('#acces-message').textContent()),
    await cuisinier.locator('#acces-message').textContent()
  );

  await cuisinier.fill('#mot-de-passe', MOT_DE_PASSE);
  await cuisinier.click('#creer-compte');
  await attendre(1200);
  const apresCreation = await cuisinier.evaluate(() => document.body.textContent);
  verifier('le compte créé est connecté', /Autoriser ce compte/.test(apresCreation), apresCreation.slice(0, 200));
  verifier('un compte neuf ne peut pas modifier', (await cuisinier.locator('#code-maison').count()) === 1);

  await cuisinier.fill('#code-maison', 'pas-le-bon-code');
  await cuisinier.click('#valider-code');
  await attendre(900);
  verifier(
    'un mauvais code est refusé',
    /refusé/i.test(await cuisinier.locator('#acces-message').textContent())
  );

  await cuisinier.fill('#code-maison', CODE);
  await cuisinier.click('#valider-code');
  await attendre(1200);
  verifier(
    'le bon code ramène à l’accueil',
    (await cuisinier.evaluate(() => window.location.hash)) === '#/',
    await cuisinier.evaluate(() => window.location.hash)
  );
  verifier('le compte autorisé peut modifier la semaine', (await cuisinier.locator('#modifier-semaine').count()) === 1);

  // --- 4. Le compte écrit vraiment ------------------------------------------

  await cuisinier.goto(`${BASE}#/liste-de-courses`, { waitUntil: 'networkidle' });
  await attendre(700);
  await cuisinier.fill('#ajout-nom', 'Farine');
  await cuisinier.click('#ajout-valider');
  await attendre(1000);
  const etat = await (await cuisinier.request.get(new URL('__stub/etat', BASE).href)).json();
  verifier('le compte autorisé écrit', etat.nbArticles === 1, String(etat.nbArticles));
  verifier('un seul compte est autorisé', etat.nbComptes === 1, String(etat.nbComptes));

  // --- 5. Les droits suivent la personne, pas l'appareil ---------------------

  await cuisinier.goto(`${BASE}#/compte`, { waitUntil: 'networkidle' });
  await attendre(600);
  await cuisinier.click('#deconnecter');
  await attendre(900);
  verifier(
    'déconnecté, l’écran redemande une adresse',
    (await cuisinier.locator('#email-compte').count()) === 1
  );

  await cuisinier.goto(`${BASE}#/recette/tapenade-maison`, { waitUntil: 'networkidle' });
  await attendre(700);
  verifier('déconnecté, plus de bouton Modifier', (await cuisinier.locator('#modifier-recette').count()) === 0);

  // Le second navigateur, qui n'a jamais vu le code, se connecte au même compte.
  await visiteur.goto(`${BASE}#/compte`, { waitUntil: 'networkidle' });
  await attendre(700);
  await visiteur.fill('#email-compte', EMAIL);
  await visiteur.fill('#mot-de-passe', MOT_DE_PASSE);
  await visiteur.click('#valider-connexion');
  await attendre(1400);
  verifier(
    'se connecter ailleurs rend les droits sans ressaisir le code',
    /Connecté/.test(await visiteur.evaluate(() => document.body.textContent)),
    (await visiteur.evaluate(() => document.body.textContent)).slice(0, 200)
  );

  await visiteur.goto(`${BASE}#/recette/tapenade-maison`, { waitUntil: 'networkidle' });
  await attendre(700);
  verifier('et le bouton Modifier revient', (await visiteur.locator('#modifier-recette').count()) === 1);

  // --- 6. Aucune erreur JavaScript ------------------------------------------

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
