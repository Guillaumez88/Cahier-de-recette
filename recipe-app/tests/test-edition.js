/* Test de la modification des recettes et du changement de nombre de parts,
 * dans un vrai navigateur.
 *
 * Deux contextes Chromium isoles verifient que la modification est bien partagee.
 * Le contrôle le plus important : apres un doublement des parts, les durees et les
 * temperatures des instructions doivent etre inchangees, et la liste de courses doit
 * reprendre les quantites recalculees.
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
const ID = 'lasagnes-bolognaise-la-meilleure-recette';

const echecs = [];
const ok = [];
function verifier(nom, condition, detail = '') {
  if (condition) ok.push(nom);
  else echecs.push(`${nom}${detail ? ' -> ' + detail : ''}`);
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function attendreTexte(page, motif, limite = 8000) {
  const debut = Date.now();
  while (Date.now() - debut < limite) {
    if (motif.test(await page.evaluate(() => document.body.textContent))) return true;
    await attendre(250);
  }
  return false;
}

(async () => {
  const navigateur = await chromium.launch(OPTIONS_LANCEMENT);
  const contexteA = await navigateur.newContext({ viewport: { width: 1100, height: 900 } });
  const contexteB = await navigateur.newContext({ viewport: { width: 1100, height: 900 } });
  const pageA = await contexteA.newPage();
  const pageB = await contexteB.newPage();

  const erreurs = [];
  [pageA, pageB].forEach((page, i) => {
    page.on('pageerror', (e) => erreurs.push(`page${i === 0 ? 'A' : 'B'} : ${e.message}`));
  });

  const texteDe = (page) => page.evaluate(() => document.body.textContent);
  await pageA.request.get(new URL('__stub/etat?reinitialiser=1', BASE).href);

  /**
   * Ouvre une section de l'editeur en accordeon.
   * Depuis la refonte, une seule section est ouverte a la fois : atteindre un champ
   * demande d'abord d'ouvrir la sienne, exactement comme a la main.
   */
  const ouvrirSection = async (page, cle) => {
    if ((await page.locator(`[data-section-ouverte="${cle}"]`).count()) === 1) return;
    await page.locator(`[data-section="${cle}"]`).click();
    await attendre(400);
  };

  /** Valeurs actuelles des champs du formulaire d'ingredients. */
  const ingredients = (page) =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('.liste-edition li')).map((li) => ({
        nom: li.querySelector('.champ-edition--nom').value,
        quantite: li.querySelector('.champ-edition--quantite').value,
        rayon: li.querySelector('.rayon-indique').textContent,
      }))
    );

  /** Contenu des zones de texte des etapes. */
  const etapes = (page) =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('.etape-edition textarea')).map((t) => t.value)
    );

  // --- 1. Acces a l'editeur ---------------------------------------------------

  await pageA.goto(`${BASE}#/recette/${ID}`, { waitUntil: 'networkidle' });
  await attendre(1200);
  verifier('la fiche propose de la modifier', (await pageA.locator('#modifier-recette').count()) === 1);
  verifier('la fiche n est pas signalee comme modifiee au depart', !/fiche modifiée/.test(await texteDe(pageA)));

  await pageA.locator('#modifier-recette').click();
  await attendre(800);
  verifier("l editeur s ouvre", /Modifier la recette/.test(await texteDe(pageA)), pageA.url());
  verifier("l URL de l editeur est adressable", pageA.url().includes('/modifier'), pageA.url());

  await ouvrirSection(pageA, 'ingredients');
  const avantIngredients = await ingredients(pageA);
  verifier('les 14 ingredients sont editables', avantIngredients.length === 14, `${avantIngredients.length} lignes`);
  verifier(
    'le rayon deduit est affiche a cote de chaque ingredient',
    avantIngredients.every((i) => i.rayon && i.rayon.length > 2),
    JSON.stringify(avantIngredients.slice(0, 2))
  );

  await ouvrirSection(pageA, 'instructions');
  const avantEtapes = await etapes(pageA);
  await ouvrirSection(pageA, 'parts');
  const nbParts = await pageA.locator('#nombre-parts').inputValue();
  verifier('le nombre de parts est repris', nbParts === '6', `« ${nbParts} »`);

  // --- 2. Doubler les parts ---------------------------------------------------

  await pageA.locator('#nombre-parts').fill('12');
  await pageA.locator('#nombre-parts').press('Enter');
  await attendre(800);

  // Le rapport de recalcul reste dans la section des parts : on le lit avant de
  // partir voir les ingredients.
  const rapport = await pageA.locator('#rapport-echelonnage').textContent();
  verifier('un rapport de recalcul est affiche', /facteur 2/.test(rapport), rapport);
  verifier('le rapport annonce les quantites ajustees dans les instructions', /ajustée/.test(rapport), rapport);
  verifier('le rapport signale ce qui a ete laisse inchange', /Sel, poivre/.test(rapport), rapport);
  verifier('le nombre de parts affiche est 12', (await pageA.locator('#nombre-parts').inputValue()) === '12');
  verifier('le libelle des parts est conserve', /personnes/.test(await texteDe(pageA)));

  await ouvrirSection(pageA, 'ingredients');
  const apresIngredients = await ingredients(pageA);
  const parNom = (liste, nom) => (liste.find((i) => i.nom === nom) || {}).quantite;

  verifier('la viande est doublee', parNom(apresIngredients, 'Bœuf haché') === '600 g', parNom(apresIngredients, 'Bœuf haché'));
  verifier('l unite denombrable est accordee', parNom(apresIngredients, 'Ail') === '2 gousses', parNom(apresIngredients, 'Ail'));
  verifier('les morceaux de sucre sont doubles', parNom(apresIngredients, 'Sucre') === '4 morceaux', parNom(apresIngredients, 'Sucre'));
  verifier(
    'une quantite non chiffrable reste intacte',
    parNom(apresIngredients, 'Sel, poivre') === 'Selon le goût',
    parNom(apresIngredients, 'Sel, poivre')
  );
  // Le controle decisif : aucune duree ni temperature ne doit avoir bouge.
  await ouvrirSection(pageA, 'instructions');
  const apresEtapes = await etapes(pageA);
  const motifTemps = /(\d+(?:[.,]\d+)?)\s*(minutes?|mn|min|heures?|h\b|°\s*C|cm|mm)/gi;
  let tempsIdentiques = true;
  let detailTemps = '';
  avantEtapes.forEach((texte, i) => {
    const a = (texte.match(motifTemps) || []).join('|');
    const b = ((apresEtapes[i] || '').match(motifTemps) || []).join('|');
    if (a !== b) {
      tempsIdentiques = false;
      detailTemps += `etape ${i + 1} : « ${a} » -> « ${b} » ; `;
    }
  });
  verifier('aucune duree ni temperature n a ete multipliee', tempsIdentiques, detailTemps);

  const etapesJointes = apresEtapes.join(' ');
  verifier('les grammes des instructions sont doubles', /1600 g/.test(etapesJointes));
  verifier("l ancienne valeur ne subsiste pas", !/800 g/.test(etapesJointes));

  // --- 2 bis. Le tableau de flux de la fiche suit aussi -----------------------

  await pageA.locator('#enregistrer').click();
  await attendre(1200);
  const ficheApresParts = await texteDe(pageA);
  verifier(
    'le tableau de flux de la fiche est mis a l echelle',
    /Bœuf haché : 600 g/.test(ficheApresParts),
    (ficheApresParts.match(/Bœuf haché : [^|]{0,12}/) || [''])[0]
  );
  verifier(
    'un nombre nu du tableau suit aussi',
    /Oignon : 2/.test(ficheApresParts),
    (ficheApresParts.match(/Oignon : ./) || [''])[0]
  );
  verifier("la valeur d origine ne subsiste pas dans le tableau", !/Bœuf haché : 300 g/.test(ficheApresParts));
  verifier(
    'les durees du tableau sont intactes',
    /45 min/.test(ficheApresParts) && /165 °C/.test(ficheApresParts) && !/90 min/.test(ficheApresParts),
    'une durée ou une température du tableau a bougé'
  );

  // On revient a l editeur pour la suite du parcours.
  await pageA.locator('#modifier-recette').click();
  await attendre(1000);

  // --- 3. Modifier un champ et enregistrer ------------------------------------

  await ouvrirSection(pageA, 'fiche');
  await pageA.locator('.ligne-edition .champ-edition').first().fill('Lasagnes pour douze');
  await pageA.locator('#enregistrer').click();
  await attendre(1200);

  const fiche = await texteDe(pageA);
  verifier('on revient a la fiche apres enregistrement', pageA.url().endsWith('#/recette/' + ID), pageA.url());
  verifier('le nouveau titre est affiche', /Lasagnes pour douze/.test(fiche), fiche.slice(0, 200));
  verifier('la fiche est signalee comme modifiee', /fiche modifiée/.test(fiche));
  verifier('les nouvelles parts sont affichees', /12 personnes/.test(fiche));
  verifier('la quantite recalculee est sur la fiche', /600 g/.test(fiche));
  verifier('la source d origine reste citee', /Journal des Femmes Cuisine/.test(fiche));

  let etatStub = await (await pageA.request.get(new URL('__stub/etat', BASE).href)).json();
  verifier('un document recette a ete ecrit', etatStub.nbRecettes === 1, `${etatStub.nbRecettes} documents`);

  // --- 4. Le livre reflete la modification -------------------------------------

  await pageA.goto(`${BASE}#/livre`, { waitUntil: 'networkidle' });
  await attendre(1000);
  verifier("le livre affiche le nouveau titre", /Lasagnes pour douze/.test(await texteDe(pageA)));
  verifier('le carnet compte toujours 21 recettes', (await pageA.locator('.carte').count()) === 21);

  // --- 5. La modification est partagee ----------------------------------------

  await pageB.goto(`${BASE}#/recette/${ID}`, { waitUntil: 'networkidle' });
  const vuParB = await attendreTexte(pageB, /Lasagnes pour douze/);
  verifier('le second appareil voit la recette modifiee', vuParB, (await texteDe(pageB)).slice(0, 200));
  verifier('le second appareil voit les quantites recalculees', /600 g/.test(await texteDe(pageB)));

  // --- 6. La liste de courses reprend les quantites recalculees ---------------

  await pageB.getByText('Tout ajouter à la liste', { exact: true }).click();
  await attendre(1000);
  await pageB.locator('.bouton-entete[href="#/liste-de-courses"]').click();
  await attendre(1000);
  const courses = await texteDe(pageB);
  verifier('la liste reprend la quantite recalculee', /600 g/.test(courses), courses.slice(0, 400));
  verifier('la liste est rangee par rayon', /Viandes et poissons/.test(courses));
  verifier(
    'la liste porte le nouveau titre de recette',
    /Lasagnes pour douze/.test(courses),
    courses.slice(0, 500)
  );

  // --- 7. Retablir l originale ------------------------------------------------

  await pageA.goto(`${BASE}#/recette/${ID}/modifier`, { waitUntil: 'networkidle' });
  await attendre(1000);
  verifier('le bouton de retablissement est propose', (await pageA.locator('#reinitialiser').count()) === 1);
  await pageA.locator('#reinitialiser').click();
  await attendre(1200);

  const retablie = await texteDe(pageA);
  verifier('le titre d origine revient', /Lasagnes bolognaise : la meilleure recette/.test(retablie), retablie.slice(0, 200));
  verifier('les parts d origine reviennent', /6 personnes/.test(retablie));
  verifier('la quantite d origine revient', /300 g/.test(retablie));
  verifier('la fiche n est plus signalee comme modifiee', !/fiche modifiée/.test(retablie));

  etatStub = await (await pageA.request.get(new URL('__stub/etat', BASE).href)).json();
  verifier('le document de modification est supprime', etatStub.nbRecettes === 0, `${etatStub.nbRecettes} documents`);

  // --- 8. Annuler ne modifie rien ---------------------------------------------

  await pageA.locator('#modifier-recette').click();
  await attendre(800);
  await ouvrirSection(pageA, 'fiche');
  await pageA.locator('.ligne-edition .champ-edition').first().fill('Titre jamais enregistré');
  await pageA.locator('#annuler').click();
  await attendre(800);
  verifier(
    'annuler laisse la recette intacte',
    !/Titre jamais enregistré/.test(await texteDe(pageA)),
    (await texteDe(pageA)).slice(0, 200)
  );

  // --- 9. Ajout et retrait d une ligne ----------------------------------------

  await pageA.locator('#modifier-recette').click();
  await attendre(800);
  await ouvrirSection(pageA, 'ingredients');
  const avantAjout = (await ingredients(pageA)).length;
  await pageA.getByText('Ajouter un ingrédient', { exact: true }).first().click();
  await attendre(500);
  verifier('ajouter un ingredient ajoute une ligne', (await ingredients(pageA)).length === avantAjout + 1);

  // Une ligne laissee vide ne doit pas etre enregistree.
  await pageA.locator('#enregistrer').click();
  await attendre(1200);
  await pageA.locator('#modifier-recette').click();
  await attendre(1000);
  await ouvrirSection(pageA, 'ingredients');
  verifier(
    'une ligne vide n est pas enregistree',
    (await ingredients(pageA)).length === avantAjout,
    `${(await ingredients(pageA)).length} lignes au lieu de ${avantAjout}`
  );

  // --- 10. Refus du serveur : l utilisateur doit etre averti ------------------
  //
  // Cas concret : les regles de securite du projet n'ont pas ete republiees apres
  // l'ajout de la collection des recettes. L'enregistrement echoue. Sans avertir,
  // la modification resterait visible puis disparaitrait au rechargement.

  await pageA.request.post(new URL('__stub/refuser-recettes', BASE).href, { data: { refuser: true } });
  await pageA.goto(`${BASE}#/recette/${ID}/modifier`, { waitUntil: 'networkidle' });
  await attendre(1000);

  await ouvrirSection(pageA, 'fiche');
  await pageA.locator('.ligne-edition .champ-edition').first().fill('Titre qui ne passera pas');
  await pageA.locator('#enregistrer').click();
  await attendre(1200);

  verifier(
    'un refus du serveur ne fait pas croire a un enregistrement',
    pageA.url().includes('/modifier'),
    pageA.url()
  );
  verifier(
    'le refus est explique a l utilisateur',
    (await pageA.locator('#erreur-recettes').count()) === 1,
    (await texteDe(pageA)).slice(0, 300)
  );
  const messageRefus = (await pageA.locator('#erreur-recettes').textContent()) || '';
  verifier(
    'le message nomme les regles de securite a republier',
    /firestore\.rules/.test(messageRefus),
    messageRefus
  );
  // textContent n'inclut pas la valeur d'un champ : on lit le champ lui-meme.
  const titreConserve = await pageA.locator('.ligne-edition .champ-edition').first().inputValue();
  verifier('la saisie n est pas perdue', titreConserve === 'Titre qui ne passera pas', titreConserve);

  // Le retablissement de l'originale passe par le meme chemin que l'enregistrement :
  // il applique en local puis tente l'envoi, sans rejeter si l'envoi echoue. Sans
  // verification, il annoncait une remise a zero que le serveur n'avait pas enregistree,
  // et la version modifiee revenait au rafraichissement suivant.
  await pageA.request.post(new URL('__stub/refuser-recettes', BASE).href, { data: { refuser: false } });
  await pageA.goto(`${BASE}#/recette/${ID}/modifier`, { waitUntil: 'networkidle' });
  await attendre(900);
  await ouvrirSection(pageA, 'fiche');
  await pageA.locator('.ligne-edition .champ-edition').first().fill('Titre a retablir ensuite');
  await pageA.locator('#enregistrer').click();
  await attendre(1200);

  await pageA.request.post(new URL('__stub/refuser-recettes', BASE).href, { data: { refuser: true } });
  await pageA.goto(`${BASE}#/recette/${ID}/modifier`, { waitUntil: 'networkidle' });
  await attendre(900);
  verifier(
    'le bouton de retablissement est propose sur une recette modifiee',
    (await pageA.locator('#reinitialiser').count()) === 1
  );
  await pageA.locator('#reinitialiser').click();
  await attendre(1200);
  verifier(
    'un retablissement refuse ne fait pas croire a une remise a zero',
    pageA.url().includes('/modifier'),
    pageA.url()
  );
  verifier(
    'le retablissement refuse est explique',
    /n’a pas pu être supprimée du serveur/.test(await texteDe(pageA)),
    (await texteDe(pageA)).slice(0, 400)
  );

  await pageA.request.post(new URL('__stub/refuser-recettes', BASE).href, { data: { refuser: false } });
  // On retablit reellement, pour que la suite du parcours parte d'une recette intacte.
  await pageA.goto(`${BASE}#/recette/${ID}/modifier`, { waitUntil: 'networkidle' });
  await attendre(900);
  if ((await pageA.locator('#reinitialiser').count()) === 1) {
    await pageA.locator('#reinitialiser').click();
    await attendre(1200);
  }

  // --- 11. Deroule reconstitue sur une recette sans tableau fourni ------------

  await pageB.goto(`${BASE}#/recette/tapenade-maison`, { waitUntil: 'networkidle' });
  await attendre(1200);
  const tapenade = await texteDe(pageB);

  verifier('un deroule est propose sans tableau fourni', /Déroulé des préparations/.test(tapenade), tapenade.slice(0, 400));
  verifier(
    'le deroule est annonce comme reconstitue',
    /Reconstitué automatiquement/.test(tapenade),
    tapenade.slice(0, 500)
  );
  verifier(
    'le deroule a les trois colonnes attendues',
    /Étape/.test(tapenade) && /Ingrédients qui entrent/.test(tapenade) && /Ce qu’on en fait/.test(tapenade)
  );

  const lignesDeroule = await pageB.evaluate(() =>
    Array.from(document.querySelectorAll('.tableau-flux--genere tbody tr')).map((tr) => ({
      etape: tr.querySelector('.deroule__etape').textContent,
      ingredients: Array.from(tr.querySelectorAll('.deroule__ligne .nom')).map((n) => n.textContent),
      quantites: Array.from(tr.querySelectorAll('.deroule__ligne .quantite')).map((n) => n.textContent),
    }))
  );
  verifier('le deroule compte deux etapes utiles', lignesDeroule.length === 2, JSON.stringify(lignesDeroule));
  verifier(
    'l ail est place a l etape ou il est hache',
    lignesDeroule[0] && lignesDeroule[0].ingredients.includes('Ail'),
    JSON.stringify(lignesDeroule[0])
  );
  verifier(
    'les quantites figurent dans le deroule',
    lignesDeroule.some((l) => l.quantites.includes('200 g')),
    JSON.stringify(lignesDeroule.map((l) => l.quantites))
  );

  // La fondue nomme « les fromages » sans les lister : ils doivent etre signales.
  await pageB.goto(`${BASE}#/recette/veritable-fondue-savoyarde`, { waitUntil: 'networkidle' });
  await attendre(1200);
  const fondue = await texteDe(pageB);
  verifier(
    'ce qu aucune etape ne nomme est signale sous le tableau',
    /Non rattaché à une étape/.test(fondue),
    fondue.slice(0, 500)
  );
  verifier(
    'les trois fromages sont nommes dans ce signalement',
    /Beaufort/.test(fondue) && /Comté/.test(fondue) && /Tomme de Savoie/.test(fondue)
  );

  // --- 11 bis. L editeur en accordeon -----------------------------------------
  //
  // Une seule section ouverte a la fois, les autres reduites a un resume d'une
  // ligne : on vient corriger une chose, pas parcourir un formulaire.

  // Rechargement explicite : un brouillon en cours conserve deliberement la section
  // ouverte, pour ne pas deplacer l'utilisateur sous ses doigts. Le defaut ne
  // s'observe donc que sur une entree neuve.
  await pageA.goto(`${BASE}#/recette/${ID}/modifier`, { waitUntil: 'networkidle' });
  await pageA.reload({ waitUntil: 'networkidle' });
  await attendre(1000);

  verifier(
    'une seule section est ouverte a la fois',
    (await pageA.locator('[data-section-ouverte]').count()) === 1,
    String(await pageA.locator('[data-section-ouverte]').count())
  );
  verifier(
    'les cinq autres sections sont pliees',
    (await pageA.locator('[data-section-pliee]').count()) === 5,
    String(await pageA.locator('[data-section-pliee]').count())
  );
  verifier(
    'la section des parts est ouverte par defaut en modification',
    (await pageA.locator('[data-section-ouverte="parts"]').count()) === 1,
    'ouverte : ' + (await pageA.locator('[data-section-ouverte]').getAttribute('data-section-ouverte'))
  );
  verifier(
    'une section pliee resume son contenu en une ligne',
    /\d+ lignes/.test(await pageA.locator('[data-section-pliee="ingredients"]').textContent()),
    await pageA.locator('[data-section-pliee="ingredients"]').textContent()
  );
  verifier(
    'le resume des instructions compte les etapes',
    /\d+ étapes/.test(await pageA.locator('[data-section-pliee="instructions"]').textContent()),
    await pageA.locator('[data-section-pliee="instructions"]').textContent()
  );

  // Les raccourcis sautent directement a une section.
  await pageA.locator('[data-section="temps"]').click();
  await attendre(400);
  verifier(
    'un raccourci ouvre sa section et referme la precedente',
    (await pageA.locator('[data-section-ouverte="temps"]').count()) === 1 &&
      (await pageA.locator('[data-section-ouverte]').count()) === 1
  );

  // Cliquer une section pliee l'ouvre aussi.
  await pageA.locator('[data-section-pliee="instructions"]').click();
  await attendre(400);
  verifier(
    'cliquer une section pliee l ouvre',
    (await pageA.locator('[data-section-ouverte="instructions"]').count()) === 1
  );

  // Et une entree dans l'editeur avec un brouillon en cours garde la section
  // ouverte : deplacer l'utilisateur sous ses doigts serait pire que le contraire.
  await pageA.locator('[data-section="temps"]').click();
  await attendre(400);
  await pageA.goto(`${BASE}#/recette/${ID}/modifier`, { waitUntil: 'networkidle' });
  await attendre(500);
  verifier(
    'la section ouverte survit a une nouvelle entree dans l editeur',
    (await pageA.locator('[data-section-ouverte="temps"]').count()) === 1,
    'ouverte : ' + (await pageA.locator('[data-section-ouverte]').getAttribute('data-section-ouverte'))
  );

  // Les deux issues restent atteignables sans defiler, meme au bas d'une longue
  // section : c'est la raison d'etre de la barre collante.
  await pageA.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await attendre(400);
  const barreVisible = await pageA.evaluate(() => {
    const barre = document.querySelector('.barre-editeur');
    if (!barre) return false;
    const rect = barre.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  });
  verifier('la barre Annuler / Enregistrer reste visible en bas de page', barreVisible);

  // Les actions lourdes de consequence ne sont pas dans cette barre.
  verifier(
    'les actions rares sont a part, hors de la barre du haut',
    await pageA.evaluate(() => {
      const rare = document.querySelector('.actions-rares');
      const barre = document.querySelector('.barre-editeur');
      return Boolean(rare) && Boolean(barre) && !barre.contains(rare);
    })
  );

  // --- 12. Aucune erreur JavaScript ------------------------------------------

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
