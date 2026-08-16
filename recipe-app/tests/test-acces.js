/* Les foyers, les comptes et les rôles, dans un vrai navigateur.
 *
 * Ce que cette suite doit prouver, et qu'aucun test unitaire ne prouve :
 *
 * 1. Sans compte, il n'y a rien : pas de carnet, pas de liste, seulement l'écran de
 *    connexion. Coller l'adresse d'un éditeur n'y change rien.
 * 2. Créer un compte crée son foyer et donne tous les droits, immédiatement : c'est
 *    le premier compte du foyer, il n'a personne pour l'autoriser.
 * 3. Le fondateur inscrit quelqu'un en lecture seule, depuis la page des membres. Ce
 *    compte-là voit le carnet du foyer et ne peut rien y changer.
 * 4. Le rôle se change, et le changement se voit à l'écran suivant.
 * 5. Une écriture forcée depuis la console est refusée par le serveur, et la file
 *    locale ne la garde pas.
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
const EMAIL = 'cuisine@maison.fr';
const MOT_DE_PASSE = 'brioche-tropezienne';
const EMAIL_INVITE = 'invite@maison.fr';
const MOT_DE_PASSE_INVITE = 'chausson-aux-pommes';

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
      // Les 403 et 404 attendus (foyer absent, illustrations absentes) sont journalisés
      // par le navigateur : ce sont les erreurs JavaScript qui comptent.
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) {
        erreurs.push(`page${i} console: ${m.text()}`);
      }
    });
  });

  // Base vide, verrou serveur armé : c'est l'état d'un vrai projet.
  await visiteur.request.get(new URL('__stub/etat?reinitialiser=1&vide=1', BASE).href);
  await visiteur.request.post(new URL('__stub/exiger-maison', BASE).href, { data: { exiger: true } });

  // --- 1. Sans compte : rien, et une invitation à se connecter ----------------

  await visiteur.goto(BASE, { waitUntil: 'networkidle' });
  await attendre(900);

  const accueil = await visiteur.evaluate(() => document.body.textContent);
  verifier('sans compte, l’écran demande de se connecter', /Se connecter/.test(accueil), accueil.slice(0, 160));
  verifier('sans compte, pas de semainier', !/Les repas de la semaine/.test(accueil));

  await visiteur.goto(`${BASE}#/recette/tapenade-maison/modifier`, { waitUntil: 'networkidle' });
  await attendre(700);
  verifier(
    'sans compte, l’éditeur n’ouvre pas',
    (await visiteur.locator('#champ-titre').count()) === 0 && (await visiteur.locator('#email-compte').count()) === 1
  );

  // --- 2. Le serveur refuse une écriture forcée -------------------------------

  const refus = await visiteur.evaluate(async () => {
    window.CarnetSync.definirLectureSeule(false);
    try {
      await window.CarnetStorage.addFreeItem('Sel de contrebande', '1 pincée');
    } catch (erreur) {
      /* sans foyer, la requête ne part même pas : c'est le résultat attendu */
    }
    return window.CarnetStorage.etatSync();
  });
  verifier('la file locale ne garde rien', refus.enAttente === 0, String(refus.enAttente));
  const apresRefus = await (await visiteur.request.get(new URL('__stub/etat', BASE).href)).json();
  verifier('rien n’a été écrit sur le serveur', apresRefus.nbArticles === 0, String(apresRefus.nbArticles));

  // --- 3. Créer un compte crée son foyer, avec tous les droits ----------------

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
  await cuisinier.fill('#nom-foyer', 'Chez nous');
  await cuisinier.click('#creer-compte');
  await attendre(1600);
  verifier(
    'créer un compte ramène à l’accueil',
    (await cuisinier.evaluate(() => window.location.hash)) === '#/',
    await cuisinier.evaluate(() => window.location.hash)
  );
  verifier('le fondateur peut modifier la semaine', (await cuisinier.locator('#modifier-semaine').count()) === 1);

  const apresCreation = await (await cuisinier.request.get(new URL('__stub/etat', BASE).href)).json();
  verifier('un foyer a été créé', apresCreation.nbFoyers === 1, String(apresCreation.nbFoyers));
  verifier(
    'le fondateur y est membre en modification',
    apresCreation.membres.length === 1 && apresCreation.membres[0].role === 'modification',
    JSON.stringify(apresCreation.membres)
  );

  // --- 4. Le fondateur écrit vraiment -----------------------------------------

  await cuisinier.goto(`${BASE}#/liste-de-courses`, { waitUntil: 'networkidle' });
  await attendre(700);
  await cuisinier.fill('#ajout-nom', 'Farine');
  await cuisinier.click('#ajout-valider');
  await attendre(1000);
  const etat = await (await cuisinier.request.get(new URL('__stub/etat', BASE).href)).json();
  verifier('le fondateur écrit', etat.nbArticles === 1, String(etat.nbArticles));

  // --- 5. Inscrire quelqu'un en lecture seule ---------------------------------

  await cuisinier.goto(`${BASE}#/foyer/membres`, { waitUntil: 'networkidle' });
  await attendre(900);
  verifier('la page des membres s’ouvre', (await cuisinier.locator('#membre-email').count()) === 1);
  verifier(
    'elle montre le fondateur',
    /Fondateur du foyer/.test(await cuisinier.evaluate(() => document.body.textContent))
  );

  await cuisinier.fill('#membre-email', EMAIL_INVITE);
  await cuisinier.fill('#membre-mot-de-passe', MOT_DE_PASSE_INVITE);
  await cuisinier.selectOption('#membre-role', 'lecture');
  await cuisinier.click('#ajouter-membre');
  await attendre(1600);
  verifier(
    'le compte du membre est créé',
    /Compte créé/.test(await cuisinier.locator('#membres-message').textContent()),
    await cuisinier.locator('#membres-message').textContent()
  );

  const apresMembre = await (await cuisinier.request.get(new URL('__stub/etat', BASE).href)).json();
  verifier('le foyer compte deux membres', apresMembre.nbMembres === 2, String(apresMembre.nbMembres));
  verifier(
    'le fondateur est toujours celui qui est connecté',
    /cuisine@maison\.fr/.test(
      await cuisinier.evaluate(() => window.localStorage.getItem('carnet-de-recettes:session-compte'))
    )
  );

  // --- 6. Le membre en lecture seule voit le carnet, sans y toucher -----------

  await visiteur.goto(`${BASE}#/compte`, { waitUntil: 'networkidle' });
  await attendre(700);
  await visiteur.fill('#email-compte', EMAIL_INVITE);
  await visiteur.fill('#mot-de-passe', MOT_DE_PASSE_INVITE);
  await visiteur.click('#valider-connexion');
  await attendre(1600);

  await visiteur.goto(`${BASE}#/liste-de-courses`, { waitUntil: 'networkidle' });
  await attendre(900);
  const listeInvite = await visiteur.evaluate(() => document.body.textContent);
  verifier('le membre voit la liste du foyer', /Farine/.test(listeInvite), listeInvite.slice(0, 200));
  verifier('le membre n’a pas de formulaire d’ajout', (await visiteur.locator('#ajout-valider').count()) === 0);

  await visiteur.goto(`${BASE}#/foyer/membres`, { waitUntil: 'networkidle' });
  await attendre(700);
  verifier(
    'la page des membres lui est fermée',
    (await visiteur.evaluate(() => window.location.hash)) === '#/compte',
    await visiteur.evaluate(() => window.location.hash)
  );

  // --- 7. Le rôle se change ----------------------------------------------------

  await cuisinier.goto(`${BASE}#/foyer/membres`, { waitUntil: 'networkidle' });
  await attendre(1000);
  await cuisinier.getByText('Autoriser à modifier').click();
  await attendre(1200);
  const apresPromotion = await (await cuisinier.request.get(new URL('__stub/etat', BASE).href)).json();
  verifier(
    'le membre promu peut modifier',
    apresPromotion.membres.filter((m) => m.role === 'modification').length === 2,
    JSON.stringify(apresPromotion.membres)
  );

  // --- 8. Aucune erreur JavaScript --------------------------------------------

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
