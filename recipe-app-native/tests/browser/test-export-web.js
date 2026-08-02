// Test navigateur reel de l'export web Expo, servi sous le sous-chemin GitHub Pages.
// Resolution de Playwright et de Chromium.
// Playwright n'est pas une dependance du projet (elle pese lourd pour un carnet de
// recettes) : ces tests utilisent l'installation disponible sur la machine. Deux
// variables permettent de la designer :
//   PLAYWRIGHT_MODULE  chemin du module playwright   (defaut : resolution normale)
//   CHROMIUM_PATH      binaire Chromium a lancer     (defaut : celui de Playwright)
function chargerChromium() {
  const chemin = process.env.PLAYWRIGHT_MODULE;
  try {
    return require(chemin || 'playwright').chromium;
  } catch (erreur) {
    console.error(
      "Playwright est introuvable. Installer avec « npm i -D playwright && npx playwright install chromium »,\n" +
        'ou designer une installation existante via PLAYWRIGHT_MODULE=/chemin/vers/node_modules/playwright.'
    );
    process.exit(3);
  }
}
const chromium = chargerChromium();
const OPTIONS_LANCEMENT = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};

const BASE = process.argv[2] || 'http://127.0.0.1:8099/Cahier-de-recette/';

const echecs = [];
const ok = [];
function verifier(nom, condition, detail = '') {
  if (condition) ok.push(nom);
  else echecs.push(`${nom}${detail ? ' -> ' + detail : ''}`);
}


// Les ecrans precedents restent montes sous l'ecran courant : plusieurs noeuds
// peuvent porter le meme texte, dont des masques. On ne clique que le visible.
function visible(page, texte) {
  return page.getByText(texte, { exact: true }).filter({ visible: true }).first();
}

(async () => {
  const navigateur = await chromium.launch(OPTIONS_LANCEMENT);
  const page = await navigateur.newPage({ viewport: { width: 420, height: 900 } });

  const erreursConsole = [];
  const requetesEchouees = [];
  page.on('console', (m) => {
    if (m.type() === 'error') erreursConsole.push(m.text());
  });
  page.on('pageerror', (e) => erreursConsole.push(`pageerror: ${e.message}`));
  const repliesLienProfond = [];
  page.on('response', (r) => {
    if (r.status() < 400) return;
    // GitHub Pages sert 404.html avec un statut 404 pour un lien profond : c'est le
    // repli attendu en mode monopage, pas une anomalie. Une 404 sur un actif
    // (_expo/, assets/) en serait une, et signalerait un baseUrl mal reglé.
    if (r.request().resourceType() === 'document') repliesLienProfond.push(`${r.status()} ${r.url()}`);
    else requetesEchouees.push(`${r.status()} ${r.url()}`);
  });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const texte = () => page.evaluate(() => document.body.innerText);
  // innerText s'arrete au contenu visible : les fiches longues sont plus hautes que
  // la fenetre, on lit donc textContent pour verifier l'integralite du rendu.
  const texteIntegral = () => page.evaluate(() => document.body.textContent);

  // 1. L'application monte
  const corps = await texte();
  verifier('la page n est pas blanche', corps.trim().length > 50, `${corps.trim().length} caracteres`);
  verifier('le titre du carnet est affiche', corps.includes('Mon carnet de recettes'));
  verifier('l accroche annonce 17 recettes', /17 recettes/.test(corps), corps.slice(0, 120));

  // 2. Aucune 404 : c est le point de controle du reglage baseUrl
  verifier('aucun actif en 404 (controle du reglage baseUrl)', requetesEchouees.length === 0, requetesEchouees.join(' | '));
  verifier('aucune erreur console au chargement', erreursConsole.length === 0, erreursConsole.slice(0, 3).join(' | '));

  // 3. Les 17 vignettes sont rendues
  const compterCartes = () =>
    page.evaluate(() => {
      const noeuds = Array.from(document.querySelectorAll('[role="button"]'));
      return noeuds.filter((n) => /\d+ ingrédients/.test(n.innerText || '')).length;
    });
  verifier('17 vignettes de recette', (await compterCartes()) === 17, `${await compterCartes()} trouvees`);

  // 4. Recherche
  const champ = page.locator('input[type="text"], input:not([type])').first();
  await champ.fill('mascarpone');
  await page.waitForTimeout(700);
  let apres = await texte();
  verifier('la recherche « mascarpone » ramene le tiramisu', /Tiramisu/i.test(apres), apres.slice(0, 200));
  verifier('la recherche reduit le decompte', /\b1 recette\b/.test(apres), apres.slice(0, 200));

  await champ.fill('zzzzzz');
  await page.waitForTimeout(600);
  verifier('une recherche sans resultat affiche le message dedie', /Aucune recette ne correspond/.test(await texte()));

  await champ.fill('');
  await page.waitForTimeout(600);

  // 5. Filtre par categorie
  await visible(page, 'Entrée').click();
  await page.waitForTimeout(700);
  apres = await texte();
  verifier('le filtre Entrée ramene 3 recettes', /\b3 recettes\b/.test(apres), apres.slice(0, 200));
  verifier('« Tout effacer » apparait quand un filtre est actif', /Tout effacer/.test(apres));
  await visible(page, 'Tout effacer').click();
  await page.waitForTimeout(700);
  verifier('« Tout effacer » remet les 17 recettes', /\b17 recettes\b/.test(await texte()));

  // 6. Navigation vers une fiche : les lasagnes, seule recette a tableau de flux utile
  await page.getByText('Lasagnes bolognaise : la meilleure recette').filter({ visible: true }).first().click();
  await page.waitForTimeout(1200);
  const fiche = await texteIntegral();
  verifier('la fiche affiche les temps', /Préparation/.test(fiche) && /1 h 20/.test(fiche));
  verifier('la fiche affiche les ingredients', /Bœuf haché/.test(fiche));
  verifier('la fiche affiche les groupes d ingredients', /Pour la béchamel/i.test(fiche));
  verifier('la fiche affiche une astuce d etape sans son prefixe', /Astuce/.test(fiche) && !/Astuce de la recette :/.test(fiche));
  verifier('l etape libellee « Pour finir » est rendue', /Pour finir/i.test(fiche));
  verifier('le tableau de flux est rendu', /Déroulé des préparations/.test(fiche));
  verifier('le tableau de flux montre son preambule', /Avant de commencer/.test(fiche) && /Beurrer un plat/.test(fiche));
  verifier('la section des manquants est rendue', /Ce que la source ne donne pas/.test(fiche));
  verifier('la source est citee', /Journal des Femmes Cuisine/.test(fiche));

  // 7. URL adressable
  verifier('l URL de la fiche est adressable', page.url().includes('/recette/'), page.url());
  verifier(
    'l URL de la fiche porte le sous-chemin de deploiement',
    page.url().includes('/Cahier-de-recette/recette/'),
    page.url()
  );

  // 8. Liste de courses
  await visible(page, 'Ajouter à la liste de courses').click();
  await page.waitForTimeout(800);
  verifier('le bouton bascule apres ajout', /Retirer de la liste de courses/.test(await texte()));

  await visible(page, 'Courses').click();
  await page.waitForTimeout(1200);
  verifier(
    'l URL de la liste de courses porte le sous-chemin',
    page.url().includes('/Cahier-de-recette/liste-de-courses'),
    page.url()
  );
  const courses = await texteIntegral();
  verifier('la liste de courses affiche la recette', /Lasagnes bolognaise/.test(courses), courses.slice(0, 200));
  verifier('la liste de courses compte 14 articles', /sur 14/.test(courses), courses.slice(0, 200));
  verifier('les quantites sont reprises', /300 g/.test(courses));

  // Cocher un article
  const avant = courses.match(/(\d+) articles? à acheter/);
  await page.locator('[role="checkbox"]').filter({ visible: true }).first().click();
  await page.waitForTimeout(700);
  const apresCoche = (await texte()).match(/(\d+) articles? à acheter/);
  verifier(
    'cocher un article decremente le compteur',
    avant && apresCoche && Number(apresCoche[1]) === Number(avant[1]) - 1,
    `${avant && avant[1]} -> ${apresCoche && apresCoche[1]}`
  );

  // 9. Persistance apres rechargement
  // Rechargement sur /liste-de-courses : le serveur statique n'a pas ce fichier et
  // sert 404.html, dont le JS reprend le routage. On ignore donc le statut HTTP et
  // on verifie seulement que l'ecran se remonte avec ses donnees.
  await page.goto(page.url(), { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1500);
  verifier('la liste de courses survit au rechargement', /sur 14/.test(await texte()), (await texte()).slice(0, 200));

  // 10. Vider la liste
  await visible(page, 'Vider la liste').click();
  await page.waitForTimeout(700);
  verifier('vider la liste affiche l etat vide', /Liste de courses vide/.test(await texte()));

  // 11. Une fiche sans tableau de flux utile ne montre pas la section
  await page.goto(`${BASE}recette/tapenade-maison`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1500);
  const tapenade = await texteIntegral();
  verifier(
    'l URL profonde ouvre bien la fiche et non l accueil',
    /Ajouter à la liste de courses/.test(tapenade) && /Câpres/.test(tapenade),
    'l accueil s affiche a la place de la fiche : le sous-chemin n est pas retire du routage'
  );
  verifier('la fiche tapenade affiche ses etapes', /Mixer assez finement/.test(tapenade));
  verifier(
    'le tableau de flux non informatif est masque',
    !/Déroulé des préparations/.test(tapenade),
    'la section apparait alors qu elle ne porte aucune information'
  );
  verifier('la fiche tapenade liste ses variantes', /version végétarienne/i.test(tapenade));

  // 12. Langue du document et icone
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const lang = await page.evaluate(() => document.documentElement.lang);
  verifier('la langue du document est le francais', lang === 'fr', `lang="${lang}"`);

  const hrefIcone = await page.evaluate(() => {
    const l = document.querySelector('link[rel="icon"]');
    return l ? l.getAttribute('href') : null;
  });
  verifier('une icone est declaree', Boolean(hrefIcone), 'aucun <link rel="icon">');
  verifier(
    'l icone est prefixee par le sous-chemin',
    hrefIcone && hrefIcone.startsWith('/Cahier-de-recette/'),
    String(hrefIcone)
  );
  if (hrefIcone) {
    const reponse = await page.request.get(new URL(hrefIcone, BASE).href);
    verifier('l icone est servie en 200', reponse.status() === 200, `statut ${reponse.status()}`);
  }

  verifier(
    'aucun repli 404 hors du sous-chemin de deploiement',
    repliesLienProfond.every((u) => u.includes('/Cahier-de-recette/')),
    repliesLienProfond.filter((u) => !u.includes('/Cahier-de-recette/')).join(' | ')
  );

  await navigateur.close();

  console.log(`\n${ok.length} verification(s) OK, ${echecs.length} echec(s)\n`);
  if (requetesEchouees.length) console.log('Actifs >=400 :\n  ' + requetesEchouees.join('\n  ') + '\n');
  if (repliesLienProfond.length)
    console.log('Replis 404.html (attendus en monopage) :\n  ' + repliesLienProfond.join('\n  ') + '\n');
  if (erreursConsole.length) console.log('Erreurs console :\n  ' + erreursConsole.slice(0, 8).join('\n  ') + '\n');
  if (echecs.length) {
    echecs.forEach((e) => console.error('ECHEC  ' + e));
    process.exit(1);
  }
})().catch((e) => {
  console.error('Le test a leve :', e.message);
  process.exit(2);
});
