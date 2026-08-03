// Test navigateur reel du carnet, dans un vrai Chromium.
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

const BASE = process.argv[2] || 'http://127.0.0.1:8102/';

const echecs = [];
const ok = [];
function verifier(nom, condition, detail = '') {
  if (condition) ok.push(nom);
  else echecs.push(`${nom}${detail ? ' -> ' + detail : ''}`);
}

(async () => {
  const navigateur = await chromium.launch(OPTIONS_LANCEMENT);
  const page = await navigateur.newPage({ viewport: { width: 1100, height: 900 } });

  const erreursConsole = [];
  const requetesEchouees = [];
  page.on('console', (m) => {
    if (m.type() === 'error') erreursConsole.push(`${m.text()} @ ${JSON.stringify(m.location())}`);
  });
  page.on('pageerror', (e) => erreursConsole.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) requetesEchouees.push(`${r.status()} ${r.url()}`);
  });

  // L'emulation de Firestore est partagee entre les suites : on repart d'une base
  // vide, sinon les decomptes d'articles dependraient de l'ordre d'execution.
  await page.request.get(new URL('__stub/etat?reinitialiser=1', BASE).href);

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const texte = () => page.evaluate(() => document.body.textContent);

  verifier('aucune requete en echec', requetesEchouees.length === 0, requetesEchouees.join(' | '));
  verifier('aucune erreur console', erreursConsole.length === 0, erreursConsole.slice(0, 3).join(' | '));

  let corps = await texte();
  verifier("le carnet s'affiche", /Mon carnet de recettes/.test(corps));
  verifier('17 recettes annoncees', /17 recettes rassemblées/.test(corps), corps.slice(0, 150));
  // Lu sur l'element plutot que dans tout le texte de la page : « 17 recettes »
  // apparait aussi dans l'accroche, l'assertion ne prouverait rien.
  const compteur = () => page.locator('.barre-resultats span').first().textContent();
  verifier('le decompte des resultats est affiche', (await compteur()).trim() === '17 recettes', await compteur());

  const nbCartes = await page.locator('.carte').count();
  verifier('17 vignettes rendues', nbCartes === 17, `${nbCartes} trouvees`);

  // Recherche
  const champ = page.locator('.champ-recherche');
  await champ.fill('mascarpone');
  await page.waitForTimeout(300);
  verifier('la recherche filtre a 1 resultat', (await page.locator('.carte').count()) === 1, String(await page.locator('.carte').count()));
  verifier('le resultat est le tiramisu', /Tiramisu/.test(await texte()));

  // Le focus doit survivre au re-rendu, sinon la saisie est inutilisable.
  const focusConserve = await page.evaluate(() => document.activeElement.classList.contains('champ-recherche'));
  verifier('le focus reste dans le champ de recherche apres saisie', focusConserve);

  await champ.fill('creme');
  await page.waitForTimeout(300);
  verifier('la recherche ignore les accents', (await page.locator('.carte').count()) >= 1);

  await champ.fill('zzzzzz');
  await page.waitForTimeout(300);
  verifier('aucun resultat affiche le message dedie', /Aucune recette ne correspond/.test(await texte()));

  await champ.fill('');
  await page.waitForTimeout(300);

  // Filtres
  await page.locator('.rangee-filtre').nth(0).getByText('Entrée', { exact: true }).click();
  await page.waitForTimeout(300);
  verifier('le filtre Entrée ramene 3 recettes', (await page.locator('.carte').count()) === 3, String(await page.locator('.carte').count()));

  await page.locator('.rangee-filtre').nth(3).getByText('30 min ou moins', { exact: true }).click();
  await page.waitForTimeout(300);
  const combine = await page.locator('.carte').count();
  verifier('les filtres se combinent', combine > 0 && combine < 3, `${combine} recettes`);

  await page.getByText('Tout effacer', { exact: true }).click();
  await page.waitForTimeout(300);
  verifier('« Tout effacer » remet les 17 recettes', (await page.locator('.carte').count()) === 17);

  // Fiche : les lasagnes, seule recette au tableau de flux informatif
  await page.locator('.carte', { hasText: 'Lasagnes bolognaise' }).first().click();
  await page.waitForTimeout(500);
  const fiche = await texte();
  verifier('le routage par ancre mene a la fiche', page.url().includes('#/recette/lasagnes-bolognaise'), page.url());
  verifier('le titre du document suit la recette', (await page.title()).includes('Lasagnes bolognaise'), await page.title());
  verifier('les temps sont affiches', /Préparation/.test(fiche) && /1 h 20/.test(fiche));
  verifier('les groupes d ingredients sont rendus', /Pour la béchamel/.test(fiche));
  verifier('l astuce d etape perd son prefixe', /Astuce/.test(fiche) && !/Astuce de la recette :/.test(fiche));
  verifier("l etape libellee « Pour finir » est rendue", /Pour finir/.test(fiche));
  verifier('la section des manquants est rendue', /Ce que la source ne donne pas/.test(fiche));
  verifier('la source est citee', /Journal des Femmes Cuisine/.test(fiche));

  // Le tableau de flux : structure reelle avec cellules fusionnees
  verifier('le tableau de flux est rendu', /Déroulé des préparations/.test(fiche));
  const flux = await page.evaluate(() => {
    const t = document.querySelector('.tableau-flux');
    if (!t) return null;
    const lignes = Array.from(t.querySelectorAll('tbody tr'));
    // Largeur reelle de la grille, en resolvant les rowspan comme le fait le navigateur.
    const occupe = {};
    let maxCol = 0;
    lignes.forEach((tr, l) => {
      let c = 0;
      Array.from(tr.children).forEach((td) => {
        while (occupe[`${l}:${c}`]) c += 1;
        const rs = td.rowSpan || 1;
        const cs = td.colSpan || 1;
        for (let dl = 0; dl < rs; dl += 1) for (let dc = 0; dc < cs; dc += 1) occupe[`${l + dl}:${c + dc}`] = true;
        c += cs;
        maxCol = Math.max(maxCol, c);
      });
    });
    return {
      nbLignes: lignes.length,
      nbColonnes: maxCol,
      cellulesFusionnees: Array.from(t.querySelectorAll('td')).filter((td) => (td.rowSpan || 1) > 1 || (td.colSpan || 1) > 1).length,
      pleineLargeur: t.querySelectorAll('td.pleine-largeur').length,
      contientBeurrer: /Beurrer un plat/.test(t.textContent),
      contientBechamel: /Béchamel/.test(t.textContent),
    };
  });
  verifier('le tableau de flux a 17 lignes', flux && flux.nbLignes === 17, JSON.stringify(flux));
  verifier('la grille resolue fait 5 colonnes', flux && flux.nbColonnes === 5, JSON.stringify(flux));
  verifier('des cellules sont bien fusionnees', flux && flux.cellulesFusionnees >= 6, JSON.stringify(flux));
  verifier('les consignes pleine largeur sont marquees', flux && flux.pleineLargeur === 2, JSON.stringify(flux));
  verifier('le tableau contient bien son contenu', flux && flux.contientBeurrer && flux.contientBechamel);

  // Liste de courses commune : ajout de la recette entiere
  await page.getByText('Tout ajouter à la liste', { exact: true }).click();
  await page.waitForTimeout(700);
  verifier(
    'un bouton de retrait apparait apres ajout',
    /Retirer cette recette de la liste/.test(await texte()),
    (await texte()).slice(0, 200)
  );
  const badge = await page.locator('#badge-courses').textContent();
  verifier('le badge d en-tete affiche 14', badge.trim() === '14', `badge = "${badge}"`);
  verifier(
    'les ingredients deja dans la liste sont marques',
    (await page.locator('.liste-ingredients li.deja-dans-liste').count()) === 14,
    `${await page.locator('.liste-ingredients li.deja-dans-liste').count()} marques`
  );
  verifier(
    'les cases des ingredients deja presents sont desactivees',
    (await page.locator('.case-ingredient[disabled]').count()) === 14
  );

  // Le lien d'en-tete contient aussi le badge : cibler la classe, pas le texte exact.
  await page.locator('.bouton-entete').click();
  await page.waitForTimeout(700);
  const courses = await texte();
  verifier('la liste de courses est atteinte', page.url().includes('#/liste-de-courses'), page.url());
  verifier('le titre annonce une liste commune', /Liste de courses commune/.test(courses));
  // Rangement par rayon : les 14 ingredients des lasagnes couvrent 6 rayons.
  const rayonsAffiches = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.rayon__titre span:first-child')).map((n) => n.textContent)
  );
  verifier(
    'les rayons suivent l ordre du magasin',
    JSON.stringify(rayonsAffiches) ===
      JSON.stringify([
        'Fruits et légumes',
        'Viandes et poissons',
        'Crèmerie',
        'Épices et herbes',
        'Épicerie salée',
        'Épicerie sucrée',
      ]),
    JSON.stringify(rayonsAffiches)
  );
  verifier('le boeuf hache est au rayon des viandes', /Viandes et poissons[\s\S]{0,90}Bœuf haché/.test(courses));
  verifier('le beurre est a la cremerie', /Crèmerie[\s\S]{0,140}Beurre/.test(courses));
  verifier('la recette reste accessible depuis la liste', /1 recette dans la liste/.test(courses), courses.slice(0, 500));
  verifier('la liste compte 14 lignes', /sur 14/.test(courses), courses.slice(0, 250));
  verifier('les quantites sont reprises', /300 g/.test(courses));
  verifier("l etat de synchronisation est affiche", /à jour/.test(courses), courses.slice(0, 250));

  await page.locator('.liste-courses input[type="checkbox"]').first().click();
  await page.waitForTimeout(700);
  verifier('cocher decremente le compteur', /13 lignes à acheter sur 14/.test(await texte()), (await texte()).slice(0, 250));
  verifier('la ligne cochee est barree', (await page.locator('.liste-courses li.coche').count()) === 1);
  verifier('un bouton de retrait des coches apparait', /Retirer les 1 cochés/.test(await texte()));

  // Persistance : la liste vient desormais du serveur, pas du seul cache local
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  verifier('la liste survit au rechargement', /13 lignes à acheter sur 14/.test(await texte()), (await texte()).slice(0, 250));

  // Retirer uniquement les articles coches
  await page.locator('#retirer-coches').click();
  await page.waitForTimeout(700);
  // Pas d'ancre \b ici : dans textContent les elements sont colles (« Ajouter13
  // articles... »), il n'y a donc pas de limite de mot autour des nombres.
  verifier(
    'retirer les coches ne laisse que les lignes restantes',
    /13 lignes à acheter sur 13/.test(await texte()),
    (await page.locator('.barre-resultats span').first().textContent()) || ''
  );
  verifier(
    'plus aucune ligne cochee apres retrait',
    (await page.locator('.liste-courses li.coche').count()) === 0
  );
  verifier('13 lignes restent affichees', (await page.locator('.liste-courses li').count()) === 13);

  // Supprimer un article isole
  await page.locator('.supprimer').first().click();
  await page.waitForTimeout(700);
  verifier('supprimer un article met la liste a jour', /sur 12/.test(await texte()), (await texte()).slice(0, 250));

  await page.getByText('Vider la liste', { exact: true }).click();
  await page.waitForTimeout(900);
  verifier('vider la liste affiche l etat vide', /La liste est vide/.test(await texte()), (await texte()).slice(0, 250));
  verifier('le badge disparait', await page.locator('#badge-courses').isHidden());

  // Identifiant inconnu
  await page.goto(`${BASE}#/recette/inexistant`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  verifier('un identifiant inconnu affiche un message clair', /Recette introuvable/.test(await texte()));

  // Impression : la navigation et les actions doivent disparaitre
  await page.goto(`${BASE}#/recette/tapenade-maison`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  verifier('la fiche tapenade est atteinte', /Tapenade maison/.test(await texte()));
  verifier(
    'le tableau de flux non informatif est masque',
    !/Déroulé des préparations/.test(await texte()),
    'la section vide de sens est affichee'
  );

  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(300);
  const impression = await page.evaluate(() => {
    const cache = (sel) => {
      const n = document.querySelector(sel);
      return n ? getComputedStyle(n).display === 'none' : null;
    };
    return {
      entete: cache('.entete'),
      actions: cache('.actions-fiche'),
      retour: cache('.retour'),
      pied: cache('.pied'),
      sectionVisible: getComputedStyle(document.querySelector('.section')).display !== 'none',
    };
  });
  verifier('l impression masque l en-tete', impression.entete === true, JSON.stringify(impression));
  verifier('l impression masque les boutons d action', impression.actions === true, JSON.stringify(impression));
  verifier('l impression masque le lien de retour', impression.retour === true, JSON.stringify(impression));
  verifier('l impression masque le pied de page', impression.pied === true, JSON.stringify(impression));
  verifier('l impression garde le contenu de la fiche', impression.sectionVisible === true, JSON.stringify(impression));
  await page.emulateMedia({ media: 'screen' });

  // Responsive : pas de debordement horizontal sur petit ecran
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  verifier('aucun debordement horizontal en 360 px', debordement <= 1, `${debordement} px de debordement`);

  await navigateur.close();

  console.log(`\n${ok.length} verification(s) OK, ${echecs.length} echec(s)\n`);
  if (requetesEchouees.length) console.log('Requetes >=400 :\n  ' + requetesEchouees.join('\n  ') + '\n');
  if (erreursConsole.length) console.log('Erreurs console :\n  ' + erreursConsole.slice(0, 5).join('\n  ') + '\n');
  if (echecs.length) {
    echecs.forEach((e) => console.error('ECHEC  ' + e));
    process.exit(1);
  }
})().catch((e) => {
  console.error('Le test a leve :', e.message);
  process.exit(2);
});
