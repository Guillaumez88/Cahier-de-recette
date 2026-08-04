/* Test de la liste commune, dans un vrai navigateur.
 *
 * Deux contextes Chromium isoles (stockages locaux distincts, comme deux appareils)
 * pointent sur la meme emulation de Firestore. C'est le seul montage qui prouve
 * reellement le partage : ce que l'un ajoute doit apparaitre chez l'autre.
 *
 * Verifie aussi l'absence de sondage periodique, le bouton de rafraichissement,
 * l'ajout libre, la selection partielle d'ingredients, et le comportement hors
 * ligne, provoque par la panne simulee du stub.
 */

// Resolution de Playwright et de Chromium (voir aussi test-web.js).
//   PLAYWRIGHT_MODULE  chemin du module playwright
//   CHROMIUM_PATH      binaire Chromium a lancer
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

/** Attend qu'une condition sur le texte de la page devienne vraie, ou expire. */
async function attendreTexte(page, motif, limite = 8000) {
  const debut = Date.now();
  while (Date.now() - debut < limite) {
    const texte = await page.evaluate(() => document.body.textContent);
    if (motif.test(texte)) return true;
    await attendre(250);
  }
  return false;
}

(async () => {
  const navigateur = await chromium.launch(OPTIONS_LANCEMENT);

  const texteDe = (page) => page.evaluate(() => document.body.textContent);

  async function panne(page, actif) {
    await page.request.post(new URL('__stub/panne', BASE).href, { data: { panne: actif } });
  }
  async function reinitialiser(page) {
    await page.request.get(new URL('__stub/etat?reinitialiser=1', BASE).href);
  }
  async function etatStub(page) {
    const reponse = await page.request.get(new URL('__stub/etat', BASE).href);
    return reponse.json();
  }

  // Deux contextes = deux stockages locaux = deux appareils distincts.
  const contexteA = await navigateur.newContext({ viewport: { width: 1000, height: 900 } });
  const contexteB = await navigateur.newContext({ viewport: { width: 1000, height: 900 } });
  const pageA = await contexteA.newPage();
  const pageB = await contexteB.newPage();

  const erreurs = [];
  [pageA, pageB].forEach((page, i) => {
    page.on('pageerror', (e) => erreurs.push(`page${i === 0 ? 'A' : 'B'} : ${e.message}`));
  });

  await reinitialiser(pageA);

  // --- 1. Une liste vide au depart -------------------------------------------

  await pageA.goto(`${BASE}#/liste-de-courses`, { waitUntil: 'networkidle' });
  await attendre(1200);
  verifier('la liste commune part vide', /La liste est vide/.test(await texteDe(pageA)), (await texteDe(pageA)).slice(0, 200));
  verifier(
    "l etat de synchronisation indique que la liste est a jour",
    /à jour/.test(await texteDe(pageA)),
    (await texteDe(pageA)).slice(0, 250)
  );

  // --- 2. Selection partielle d'ingredients ----------------------------------

  await pageA.goto(`${BASE}#/recette/tapenade-maison`, { waitUntil: 'networkidle' });
  await attendre(900);

  const nbCases = await pageA.locator('.case-ingredient').count();
  verifier('chaque ingredient a une case a cocher', nbCases === 5, `${nbCases} cases pour 5 ingredients`);
  verifier(
    'le bouton de selection est desactive sans selection',
    await pageA.locator('#ajouter-selection').isDisabled()
  );

  await pageA.locator('.case-ingredient').nth(0).check();
  await pageA.locator('.case-ingredient').nth(2).check();
  await attendre(200);
  verifier(
    'le bouton de selection compte les ingredients choisis',
    /Ajouter la sélection \(2\)/.test(await texteDe(pageA)),
    (await pageA.locator('#ajouter-selection').textContent()) || ''
  );

  await pageA.locator('#ajouter-selection').click();
  await attendre(900);
  verifier(
    'seuls les ingredients selectionnes sont marques comme presents',
    (await pageA.locator('.liste-ingredients li.deja-dans-liste').count()) === 2,
    `${await pageA.locator('.liste-ingredients li.deja-dans-liste').count()} marques`
  );

  let etat = await etatStub(pageA);
  verifier('deux documents seulement ont ete ecrits', etat.nbArticles === 2, `${etat.nbArticles} documents`);

  // --- 3. Partage entre deux appareils ---------------------------------------

  await pageB.goto(`${BASE}#/liste-de-courses`, { waitUntil: 'networkidle' });
  const vuParB = await attendreTexte(pageB, /Tapenade maison/);
  verifier('le second appareil voit la liste du premier', vuParB, (await texteDe(pageB)).slice(0, 300));
  verifier('le second appareil voit le bon decompte', /2 lignes sur 2/.test(await texteDe(pageB)), (await texteDe(pageB)).slice(0, 300));

  // B coche un article. A ne le verra qu'en rechargeant ou en rafraichissant : il
  // n'y a plus de sondage periodique, c'est le choix assume depuis l'epuisement du
  // quota Firestore.
  await pageB.locator('.liste-courses input[type="checkbox"]').first().check();
  await attendre(800);
  verifier('le cochage est pris en compte chez B', /1 ligne sur 2/.test(await texteDe(pageB)), (await texteDe(pageB)).slice(0, 300));

  await pageA.goto(`${BASE}#/liste-de-courses`, { waitUntil: 'networkidle' });
  await pageA.reload({ waitUntil: 'networkidle' });
  const cochageVuParA = await attendreTexte(pageA, /1 ligne sur 2/);
  verifier('le premier appareil voit le cochage du second', cochageVuParA, (await texteDe(pageA)).slice(0, 300));
  verifier('la ligne cochee est barree chez A', (await pageA.locator('.liste-courses li.coche').count()) === 1);

  // --- 4. Aucun sondage periodique -------------------------------------------

  await pageB.locator('#ajout-nom').fill('Pain de campagne');
  await pageB.locator('#ajout-quantite').fill('1');
  await pageB.locator('#ajout-valider').click();
  await attendre(900);
  verifier('l ajout libre apparait chez B', /Pain de campagne/.test(await texteDe(pageB)), (await texteDe(pageB)).slice(0, 300));
  // Un ajout libre est classe par rayon comme les autres : « Pain de campagne »
  // va en boulangerie, il n'existe plus de groupe « Ajouts libres ».
  verifier(
    'l ajout libre est classe dans son rayon',
    /Boulangerie[\s\S]{0,90}Pain de campagne/.test(await texteDe(pageB)),
    (await texteDe(pageB)).slice(0, 400)
  );

  // A ne touche a rien : la nouveaute ne doit PAS arriver toute seule. C'est le coeur
  // du correctif de quota : 720 sondages par heure et par onglet epuisaient le palier
  // gratuit de Firestore en deux heures.
  const lectures = async () =>
    (await (await pageA.request.get(new URL('__stub/etat', BASE).href)).json()).appels.lectures;
  const lecturesAvant = await lectures();
  await attendre(4000);
  const lecturesApres = await lectures();
  verifier(
    'aucune lecture Firestore pendant quatre secondes d inactivite',
    lecturesApres === lecturesAvant,
    `${lecturesApres - lecturesAvant} lecture(s) pendant l attente`
  );
  verifier(
    'la nouveaute de l autre appareil n arrive pas sans rafraichir',
    !/Pain de campagne/.test(await texteDe(pageA)),
    (await texteDe(pageA)).slice(0, 300)
  );

  // Et l age de la donnee affichee est signale, ce qui remplace le sondage. La phrase
  // d'explication a ete retiree a la demande : l'age et le bouton d'en-tete la portent.
  verifier(
    'la phrase d invite au rafraichissement a disparu',
    !/Rafraîchir pour voir les modifications/.test(await texteDe(pageA)),
    (await texteDe(pageA)).slice(0, 400)
  );
  verifier(
    'le bouton d en-tete signale que la donnee a vieilli',
    (await pageA.locator('#rafraichir.bouton-rafraichir--vieux').count()) === 1,
    await pageA.locator('#rafraichir').getAttribute('class')
  );
  verifier(
    'le bouton d en-tete porte l age de la donnee',
    /il y a|à l’instant/.test(await pageA.locator('.bouton-rafraichir__age').textContent()),
    await pageA.locator('.bouton-rafraichir__age').textContent()
  );
  verifier(
    'le bandeau passe en etat vieillissant',
    (await pageA.locator('.sync--age').count()) === 1,
    await pageA.locator('.sync').first().getAttribute('class')
  );

  // --- 5. Bouton de rafraichissement manuel ----------------------------------

  verifier('le bouton de rafraichissement existe', (await pageA.locator('#rafraichir').count()) === 1);
  await pageA.locator('#rafraichir').click();
  await attendre(900);
  verifier(
    'le rafraichissement manuel ramene la nouveaute',
    /Pain de campagne/.test(await texteDe(pageA)),
    (await texteDe(pageA)).slice(0, 300)
  );
  verifier(
    'le bandeau repasse a jour apres rafraichissement',
    (await pageA.locator('.sync--ok').count()) === 1,
    await pageA.locator('.sync').first().getAttribute('class')
  );

  // --- 6. Hors ligne ---------------------------------------------------------

  await panne(pageA, true);
  // Sans sondage periodique, une coupure ne se manifeste qu'au premier echange :
  // c'est le rafraichissement manuel qui la revele. Le dire est plus honnete que
  // d'afficher « hors ligne » sur la foi d'un sondage qu'on ne fait plus.
  await pageA.locator('#rafraichir').click();
  const passeHorsLigne = await attendreTexte(pageA, /Hors ligne/);
  verifier('la coupure reseau est signalee au premier echange', passeHorsLigne, (await texteDe(pageA)).slice(0, 300));
  verifier(
    'la cause est expliquee et distinguee d un refus de la base',
    /Les modifications faites ici sont conservées/.test(await texteDe(pageA)) &&
      (await pageA.locator('.sync--hors-ligne').count()) === 1,
    (await texteDe(pageA)).slice(0, 400)
  );

  const avantCoupure = await texteDe(pageA);
  verifier('la liste reste affichee hors ligne', /Pain de campagne/.test(avantCoupure), avantCoupure.slice(0, 300));

  // Cocher hors ligne doit fonctionner et etre mis en attente.
  const nonCochees = pageA.locator('.liste-courses li:not(.coche) input[type="checkbox"]');
  await nonCochees.first().check();
  await attendre(700);
  verifier(
    'cocher hors ligne modifie bien l affichage',
    (await pageA.locator('.liste-courses li.coche').count()) >= 2,
    `${await pageA.locator('.liste-courses li.coche').count()} articles barres`
  );
  verifier(
    'les modifications en attente sont annoncees',
    /modification en attente/.test(await texteDe(pageA)),
    (await texteDe(pageA)).slice(0, 300)
  );

  // Rien ne doit avoir atteint le serveur pendant la panne. Le retour n'est pas
  // detecte tout seul : c'est le bouton qui le constate.
  await panne(pageA, false);
  await pageA.locator('#rafraichir').click();
  const revenuEnLigne = await attendreTexte(pageA, /à jour/, 10000);
  verifier('le retour du reseau est constate au rafraichissement', revenuEnLigne, (await texteDe(pageA)).slice(0, 300));
  verifier(
    'plus aucune modification en attente apres reconnexion',
    !/modification en attente/.test(await texteDe(pageA)),
    (await texteDe(pageA)).slice(0, 300)
  );

  // Le cochage fait hors ligne doit maintenant etre visible sur l'autre appareil.
  const nbCochesA = await pageA.locator('.liste-courses li.coche').count();
  await pageB.locator('#rafraichir').click();
  await attendre(900);
  const nbCochesB = await pageB.locator('.liste-courses li.coche').count();
  verifier(
    'le cochage fait hors ligne a bien ete propage',
    nbCochesB === nbCochesA && nbCochesB >= 2,
    `A en compte ${nbCochesA}, B en compte ${nbCochesB}`
  );

  // --- 6 bis. Lignes proches encadrees sans fusion ---------------------------
  //
  // Trois beurres et deux farines dans la meme liste : en magasin c'est un seul
  // produit a prendre a chaque fois. Le cadre les rassemble, sans additionner.

  for (const nom of ['Beurre', 'Beurre demi-sel', 'Beurre doux', 'Farine', 'Farine T65']) {
    await pageB.locator('#ajout-nom').fill(nom);
    await pageB.locator('#ajout-quantite').fill('100 g');
    await pageB.locator('#ajout-valider').click();
    await attendre(400);
  }
  await attendre(600);

  verifier(
    'les lignes proches sont encadrees ensemble',
    (await pageB.locator('[data-proches="beurre"]').count()) === 1 &&
      (await pageB.locator('[data-proches="farine"]').count()) === 1,
    `beurre ${await pageB.locator('[data-proches="beurre"]').count()}, farine ${await pageB
      .locator('[data-proches="farine"]')
      .count()}`
  );
  verifier(
    'le cadre annonce le nombre de lignes proches',
    /Beurre — 3 lignes proches/.test(await texteDe(pageB)),
    (await texteDe(pageB)).slice(0, 600)
  );
  verifier(
    'chaque ligne du cadre reste distincte et cochable',
    (await pageB.locator('[data-proches="beurre"] input[type="checkbox"]').count()) === 3
  );

  // Aucune fusion de donnees : cocher une ligne du cadre ne coche pas les autres.
  await pageB.locator('[data-proches="beurre"] input[type="checkbox"]').first().check();
  await attendre(700);
  verifier(
    'cocher une ligne proche ne coche pas ses voisines',
    (await pageB.locator('[data-proches="beurre"] li.coche').count()) === 1,
    String(await pageB.locator('[data-proches="beurre"] li.coche').count())
  );
  await pageB.locator('[data-proches="beurre"] input[type="checkbox"]').first().uncheck();
  await attendre(700);

  // On retire les cinq articles de ce controle : les sections suivantes comparent
  // l'affichage au contenu du serveur, elles ont besoin d'un etat connu.
  for (const nom of ['Beurre', 'Beurre demi-sel', 'Beurre doux', 'Farine', 'Farine T65']) {
    await pageB.locator(`.liste-courses li:has-text("${nom}") .supprimer`).first().click();
    await attendre(500);
  }
  await attendre(600);
  verifier(
    'les cadres de lignes proches disparaissent avec leurs lignes',
    (await pageB.locator('[data-proches]').count()) === 0,
    String(await pageB.locator('[data-proches]').count())
  );
  await pageA.locator('#rafraichir').click();
  await attendre(900);

  // --- 7. Retrait des articles coches ----------------------------------------

  await pageA.locator('#retirer-coches').click();
  await attendre(900);
  const apresRetrait = await texteDe(pageA);
  verifier(
    'retirer les coches ne laisse que les lignes restantes',
    (await pageA.locator('.liste-courses li.coche').count()) === 0,
    apresRetrait.slice(0, 300)
  );

  const disparuChezB = await attendreTexte(pageB, /lignes? sur/);
  const etatFinal = await etatStub(pageA);
  const restantsA = await pageA.locator('.liste-courses li').count();
  verifier(
    'le serveur reflete exactement la liste affichee',
    etatFinal.nbArticles === restantsA,
    `${etatFinal.nbArticles} documents pour ${restantsA} lignes affichees`
  );
  verifier('le second appareil reste fonctionnel', disparuChezB);

  // --- 8. Aucune erreur JavaScript -------------------------------------------

  verifier('aucune erreur JavaScript sur les deux appareils', erreurs.length === 0, erreurs.slice(0, 3).join(' | '));

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
