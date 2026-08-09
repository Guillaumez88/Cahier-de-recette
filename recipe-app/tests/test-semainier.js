/* Test du semainier, des photos et de la creation de recettes, dans un vrai
 * navigateur.
 *
 * Deux contextes Chromium isoles jouent deux appareils de la maison : ce que l'un
 * pose dans le semainier, l'autre doit le voir. C'est le seul moyen de verifier
 * qu'un menu est reellement commun et non local a un navigateur.
 *
 * Les controles qui comptent le plus, parce qu'ils portent sur des promesses faites
 * a l'ecran :
 * - la boite « Ajouter aux courses » n'ajoute que les plats restes coches ;
 * - un plat dont tous les ingredients sont deja en liste arrive decoche ;
 * - un repas hors carnet (Restaurant) n'est pas ajoutable, et le dit ;
 * - une photo est bien reduite avant l'envoi, et rangee en deux tailles ;
 * - la page ne deborde pas horizontalement sur un ecran de telephone, ou le
 *   semainier sert le plus.
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

async function attendreTexte(page, motif, limite = 8000) {
  const debut = Date.now();
  while (Date.now() - debut < limite) {
    if (motif.test(await page.evaluate(() => document.body.textContent))) return true;
    await attendre(200);
  }
  return false;
}

/** Deux chiffres, comme dans les cles de jour. */
function d2(n) {
  return n < 10 ? '0' + n : String(n);
}

/**
 * Cles de jour de la semaine en cours, calculees ici et non demandees a la page :
 * un test qui reutiliserait la fonction testee ne prouverait rien.
 */
function joursDeLaSemaine() {
  const aujourdhui = new Date();
  const lundi = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate(), 12);
  lundi.setDate(lundi.getDate() - ((lundi.getDay() + 6) % 7));
  const cles = [];
  for (let i = 0; i < 7; i += 1) {
    const jour = new Date(lundi.getFullYear(), lundi.getMonth(), lundi.getDate() + i, 12);
    cles.push(`${jour.getFullYear()}-${d2(jour.getMonth() + 1)}-${d2(jour.getDate())}`);
  }
  return cles;
}

// Un PNG rouge de 4 x 4 pixels, ecrit en base64 : suffisant pour exercer tout le
// chemin de redimensionnement sans embarquer un fichier binaire dans le depot.
const PNG_ROUGE =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVR42mP8z8Dwn4EIwESMIkbi' +
  'FAEAoQ4F/1sYzE0AAAAASUVORK5CYII=';

(async () => {
  const navigateur = await chromium.launch(OPTIONS_LANCEMENT);
  // 1400 px de haut : la reserve est en tete de page et la grille dessous. Sur une
  // fenetre plus courte, Playwright doit faire defiler pendant un glisser-deposer, ce
  // qui annule le geste sans lever d'erreur et ferait echouer le test pour une raison
  // qui n'a rien a voir avec le produit.
  const contexteA = await navigateur.newContext({ viewport: { width: 1280, height: 1400 } });
  const contexteB = await navigateur.newContext({ viewport: { width: 1280, height: 1400 } });
  const pageA = await contexteA.newPage();
  const pageB = await contexteB.newPage();

  const erreurs = [];
  [pageA, pageB].forEach((page, i) => {
    const nom = `page${i === 0 ? 'A' : 'B'}`;
    page.on('pageerror', (e) => erreurs.push(`${nom} : ${e.message}`));
    page.on('console', (m) => {
      // Le test coupe volontairement le serveur pour verifier le mode hors ligne :
      // les 503 qui en decoulent sont attendus, ce sont les erreurs JavaScript qui
      // ne le sont pas.
      if (m.type() === 'error' && !/503|Failed to load resource/.test(m.text())) {
        erreurs.push(`console ${nom} : ${m.text()}`);
      }
    });
  });

  const texteDe = (page) => page.evaluate(() => document.body.textContent);
  const etatStub = async () => (await pageA.request.get(new URL('__stub/etat', BASE).href)).json();

  await pageA.request.get(new URL('__stub/etat?reinitialiser=1', BASE).href);

  const JOURS = joursDeLaSemaine();
  const LUNDI = JOURS[0];
  const MARDI = JOURS[1];
  const creneau = (page, jour, moment) => page.locator(`[data-creneau="${jour}::${moment}"]`);

  /**
   * Glisse une pastille de la reserve dans une case.
   *
   * La case est amenee a l'ecran avant de commencer : la reserve est en haut de page
   * et la grille dessous, si bien que Playwright fait defiler la page pendant le
   * glissement, ce qui annule le geste sans lever d'erreur. Un utilisateur, lui, voit
   * sa cible avant de partir.
   */
  const glisserDeLaReserve = async (page, cleReserve, jour, moment) => {
    const cible = creneau(page, jour, moment);
    await cible.scrollIntoViewIfNeeded();
    await attendre(200);
    await page.locator(`[data-reserve="${cleReserve}"]`).dragTo(cible);
    await attendre(900);
  };

  /**
   * Bascule l'accueil en mode edition si ce n'est pas deja fait.
   *
   * L'accueil s'ouvre en lecture : les cases n'y sont pas cliquables et n'affichent
   * pas de « + ». Tout ce qui modifie la semaine passe donc par ce bouton, comme pour
   * un utilisateur.
   */
  const passerEnEdition = async (page) => {
    const bouton = page.locator('#modifier-semaine');
    if ((await bouton.getAttribute('aria-pressed')) === 'true') return;
    await bouton.click();
    await attendre(400);
  };

  // --- 1. L accueil affiche le semainier --------------------------------------

  await pageA.goto(BASE, { waitUntil: 'networkidle' });
  await attendre(900);

  verifier('l accueil pose la question du repas', /Qu’est-ce qu’on mange/.test(await texteDe(pageA)));
  // La semaine suivante est vide au demarrage : elle est repliee, et n'occupe donc
  // pas la moitie de la hauteur de page pour vingt-et-une cases a remplir.
  verifier('une seule semaine est depliee au depart', (await pageA.locator('.semaine').count()) === 1);
  verifier('la semaine suivante est repliee', (await pageA.locator('[data-semaine-repliee]').count()) === 1);
  verifier(
    'le bandeau replie dit qu il n y a rien de prevu',
    /rien de prévu pour l’instant/.test(await texteDe(pageA)),
    (await texteDe(pageA)).slice(0, 400)
  );
  await pageA.locator('#deplier-semaine').click();
  await attendre(500);
  verifier('la semaine suivante se deplie d un clic', (await pageA.locator('.semaine').count()) === 2);
  verifier('chaque semaine a sept jours', (await pageA.locator('.semaine').first().locator('.jour').count()) === 7);
  // Quatorze cases et non vingt-et-une : le petit-dejeuner est masque tant qu il ne
  // porte rien, c'est le repas le moins souvent prevu et sept cases vides en tete de
  // grille repoussaient le dejeuner et le diner.
  verifier(
    'une semaine vide n affiche que le dejeuner et le diner',
    (await pageA.locator('.semaine').first().locator('.creneau').count()) === 14,
    String(await pageA.locator('.semaine').first().locator('.creneau').count())
  );
  verifier(
    'le petit-dejeuner est masque tant qu il est vide',
    (await creneau(pageA, LUNDI, 'petit-dejeuner').count()) === 0
  );
  verifier('le creneau du lundi midi existe', (await creneau(pageA, LUNDI, 'dejeuner').count()) === 1);
  verifier('aucun repas n est prevu au depart', /aucun repas encore prévu/.test(await texteDe(pageA)));

  // Le jour courant est marque : sans repere, on pose un plat au mauvais jour.
  verifier('le jour courant est marque', (await pageA.locator('.jour--aujourdhui').count()) === 1);

  // --- 1 bis. L accueil s ouvre en lecture ------------------------------------
  //
  // La grille montre le menu : ni « + » dans les cases, ni reserve de plats a glisser.
  // Sans cela l'accueil demandait de composer la semaine avant de pouvoir la lire.

  verifier('aucun « + » dans les cases en lecture', (await pageA.locator('.creneau__vide').count()) === 0);
  verifier('la reserve de plats est absente en lecture', (await pageA.locator('#reserve').count()) === 0);
  verifier(
    'les cases ne sont pas des boutons en lecture',
    (await pageA.locator('button.creneau').count()) === 0,
    String(await pageA.locator('button.creneau').count())
  );
  verifier('le bouton Modifier est propose', (await pageA.locator('#modifier-semaine').count()) === 1);

  await passerEnEdition(pageA);
  verifier(
    'en edition, le petit-dejeuner reparait',
    (await creneau(pageA, LUNDI, 'petit-dejeuner').count()) === 1
  );
  verifier(
    'en edition, chaque semaine a vingt-et-un creneaux',
    (await pageA.locator('.semaine').first().locator('.creneau').count()) === 21,
    String(await pageA.locator('.semaine').first().locator('.creneau').count())
  );
  verifier('en edition, chaque case vide porte un « + »', (await pageA.locator('.creneau__vide').count()) === 42);
  verifier('en edition, la reserve de plats apparait', (await pageA.locator('#reserve').count()) === 1);

  // Le dejeuner et le diner ont plus de place que le petit-dejeuner. Mesure en mode
  // edition, seul mode ou les trois cases coexistent sur une semaine vide.
  const hauteurs = await pageA.evaluate((lundi) => {
    const h = (m) => document.querySelector(`[data-creneau="${lundi}::${m}"]`).getBoundingClientRect().height;
    return { matin: h('petit-dejeuner'), midi: h('dejeuner'), soir: h('diner') };
  }, LUNDI);
  verifier(
    'le dejeuner et le diner sont plus hauts que le petit-dejeuner',
    hauteurs.midi > hauteurs.matin && hauteurs.soir > hauteurs.matin,
    JSON.stringify(hauteurs)
  );

  // --- 2. Poser un plat du livre ----------------------------------------------

  await creneau(pageA, LUNDI, 'dejeuner').click();
  await attendre(400);
  verifier('la boite de choix s ouvre', (await pageA.locator('#voile').count()) === 1);
  verifier('la boite nomme le repas visé', /Déjeuner du lundi/.test(await texteDe(pageA)));

  await pageA.locator('#recherche-plat').fill('tapenade');
  await attendre(400);
  const choix = await pageA.locator('.choix-plat').count();
  verifier('la recherche de la boite filtre les plats', choix === 1, `${choix} plats`);

  await pageA.locator('[data-choix="tapenade-maison"]').click();
  await attendre(700);
  verifier('la boite se referme apres le choix', (await pageA.locator('#voile').count()) === 0);
  verifier(
    'le plat apparait dans la case',
    /Tapenade maison/.test(await creneau(pageA, LUNDI, 'dejeuner').textContent())
  );
  verifier('le resume compte un repas', /1 repas prévu/.test(await texteDe(pageA)));

  let etat = await etatStub();
  verifier('un document creneau a ete ecrit', etat.nbCreneaux === 1, `${etat.nbCreneaux} documents`);
  const champsCreneau = etat.creneaux[0].fields;
  verifier('le creneau porte le jour et le moment', champsCreneau.jour.stringValue === LUNDI, JSON.stringify(champsCreneau.jour));
  verifier('le creneau porte le moment', champsCreneau.moment.stringValue === 'dejeuner');
  verifier('le creneau porte l identifiant de recette', champsCreneau.recetteId.stringValue === 'tapenade-maison');

  // --- 3. Le semainier est commun ---------------------------------------------

  await pageB.goto(BASE, { waitUntil: 'networkidle' });
  verifier(
    'le second appareil voit le plat pose par le premier',
    await attendreTexte(pageB, /Tapenade maison/),
    (await texteDe(pageB)).slice(0, 300)
  );

  // --- 4. Un repas hors carnet ------------------------------------------------

  await creneau(pageA, LUNDI, 'diner').click();
  await attendre(400);
  await pageA.locator('[data-repas-libre="Pizzas"]').click();
  await attendre(700);
  verifier('un repas hors carnet se pose', /Pizzas/.test(await creneau(pageA, LUNDI, 'diner').textContent()));

  await creneau(pageA, MARDI, 'diner').click();
  await attendre(400);
  await pageA.locator('#repas-libre').fill('Chez les voisins');
  await pageA.locator('#poser-libre').click();
  await attendre(700);
  verifier(
    'un repas saisi a la main se pose aussi',
    /Chez les voisins/.test(await creneau(pageA, MARDI, 'diner').textContent())
  );

  // --- 5. Plusieurs plats par repas, retirer et vider -------------------------
  //
  // Un repas peut porter un plat et un dessert : poser un second plat s'ajoute au
  // premier au lieu de l'ecraser, et chaque plat se retire seul.

  await creneau(pageA, MARDI, 'diner').click();
  await attendre(400);
  verifier('la boite rappelle le plat deja prevu', /Chez les voisins/.test(await texteDe(pageA)));
  await pageA.locator('[data-repas-libre="Restaurant"]').click();
  await attendre(700);
  verifier(
    'un second plat s ajoute au repas sans effacer le premier',
    /Restaurant/.test(await creneau(pageA, MARDI, 'diner').textContent()) &&
      /Chez les voisins/.test(await creneau(pageA, MARDI, 'diner').textContent()),
    await creneau(pageA, MARDI, 'diner').textContent()
  );
  verifier(
    'la case porte deux plats distincts',
    (await creneau(pageA, MARDI, 'diner').locator('.creneau__plat').count()) === 2
  );

  etat = await etatStub();
  verifier('chaque plat a son propre document', etat.nbCreneaux === 4, `${etat.nbCreneaux} documents`);

  // Retirer un seul plat, par sa croix, depuis la grille.
  await creneau(pageA, MARDI, 'diner').locator('.creneau__retirer').first().click();
  await attendre(900);
  verifier(
    'la croix retire un seul plat du repas',
    !/Chez les voisins/.test(await creneau(pageA, MARDI, 'diner').textContent()) &&
      /Restaurant/.test(await creneau(pageA, MARDI, 'diner').textContent()),
    await creneau(pageA, MARDI, 'diner').textContent()
  );
  etat = await etatStub();
  verifier('retirer un plat supprime son document', etat.nbCreneaux === 3, `${etat.nbCreneaux} documents`);

  // « Vider ce repas » n'est propose qu a partir de deux plats : avec un seul, c'est
  // le bouton « Retirer » de sa ligne, et deux boutons pour le meme effet font hesiter.
  await creneau(pageA, MARDI, 'diner').click();
  await attendre(400);
  verifier('un repas d un seul plat ne propose pas « Vider »', (await pageA.locator('#vider-creneau').count()) === 0);
  await pageA.locator('[data-repas-libre="Pizzas"]').click();
  await attendre(700);
  await creneau(pageA, MARDI, 'diner').click();
  await attendre(400);
  verifier('un repas de deux plats propose « Vider »', (await pageA.locator('#vider-creneau').count()) === 1);
  await pageA.locator('#vider-creneau').click();
  await attendre(900);
  verifier(
    'vider une case efface tous ses plats',
    (await creneau(pageA, MARDI, 'diner').locator('.creneau__plat').count()) === 0,
    await creneau(pageA, MARDI, 'diner').textContent()
  );
  etat = await etatStub();
  verifier('un creneau vide est un document supprime', etat.nbCreneaux === 2, `${etat.nbCreneaux} documents`);

  // --- 6. Glisser-deposer entre deux cases ------------------------------------

  // C'est le plat qui est glissable, pas la case : la case porte aussi son « + »
  // d'ajout, et viser son centre ne saisirait pas forcement le plat.
  await creneau(pageA, LUNDI, 'diner').locator('[data-plat]').first().dragTo(creneau(pageA, MARDI, 'dejeuner'));
  await attendre(900);
  verifier(
    'le plat glisse a change de case',
    /Pizzas/.test(await creneau(pageA, MARDI, 'dejeuner').textContent()),
    await creneau(pageA, MARDI, 'dejeuner').textContent()
  );
  verifier(
    'la case de depart est vide apres le glissement',
    !/Pizzas/.test(await creneau(pageA, LUNDI, 'diner').textContent())
  );
  etat = await etatStub();
  verifier('le glissement n a pas duplique le plat', etat.nbCreneaux === 2, `${etat.nbCreneaux} documents`);

  // Glisser sur une case occupee ajoute le plat au repas : il n y a plus d echange,
  // le repas peut porter les deux, et rien n est deplace sans l avoir demande.
  await creneau(pageA, MARDI, 'dejeuner').locator('[data-plat]').first().dragTo(creneau(pageA, LUNDI, 'dejeuner'));
  await attendre(900);
  verifier(
    'glisser sur une case occupee ajoute au lieu d echanger',
    /Pizzas/.test(await creneau(pageA, LUNDI, 'dejeuner').textContent()) &&
      /Tapenade maison/.test(await creneau(pageA, LUNDI, 'dejeuner').textContent()) &&
      (await creneau(pageA, MARDI, 'dejeuner').locator('.creneau__plat').count()) === 0,
    (await creneau(pageA, LUNDI, 'dejeuner').textContent()) +
      ' | ' +
      (await creneau(pageA, MARDI, 'dejeuner').textContent())
  );

  // Remettre le plat surnumeraire a sa case d origine : la suite du parcours compte
  // sur un plat par repas, et le deplacer verifie au passage qu on peut sortir un
  // plat d un repas qui en porte deux.
  await creneau(pageA, LUNDI, 'dejeuner').locator('[data-plat]').last().dragTo(creneau(pageA, LUNDI, 'diner'));
  await attendre(900);
  verifier(
    'un plat sort d un repas qui en porte deux',
    /Pizzas/.test(await creneau(pageA, LUNDI, 'diner').textContent()) &&
      (await creneau(pageA, LUNDI, 'dejeuner').locator('.creneau__plat').count()) === 1,
    (await creneau(pageA, LUNDI, 'dejeuner').textContent()) +
      ' | ' +
      (await creneau(pageA, LUNDI, 'diner').textContent())
  );

  // --- 6 bis. Le filtre de la reserve -----------------------------------------
  //
  // Quatre familles : Entrees, Plats, Desserts, Autres. « Autres » ne vient pas du
  // carnet, ce sont les repas qu on ne cuisine pas.

  verifier('la reserve porte quatre familles', (await pageA.locator('.segment[data-famille]').count()) === 4);
  verifier(
    'les plats sont la famille par defaut',
    (await pageA.locator('.segment[data-famille="Plat"]').getAttribute('aria-selected')) === 'true'
  );
  await pageA.locator('.segment[data-famille="Autres"]').click();
  await attendre(400);
  verifier(
    'la famille Autres propose les repas hors carnet',
    (await pageA.locator('[data-reserve="Burger King"]').count()) === 1 &&
      (await pageA.locator('[data-reserve="La boucherie"]').count()) === 1 &&
      (await pageA.locator('[data-reserve="Au bureau"]').count()) === 1,
    await pageA.locator('#reserve').textContent()
  );
  verifier(
    'la famille Autres ne melange pas les recettes du carnet',
    (await pageA.locator('[data-reserve="tapenade-maison"]').count()) === 0
  );

  // Un repas hors carnet se glisse comme un plat du livre.
  await glisserDeLaReserve(pageA, 'Japonais', JOURS[3], 'diner');
  verifier(
    'un repas hors carnet se glisse depuis la reserve',
    /Japonais/.test(await creneau(pageA, JOURS[3], 'diner').textContent()),
    await creneau(pageA, JOURS[3], 'diner').textContent()
  );
  await creneau(pageA, JOURS[3], 'diner').locator('.creneau__retirer').first().click();
  await attendre(900);

  // Glisser un plat du carnet depuis la reserve. L anchoiade est une entree : il faut
  // sa famille, la recherche ne cherche que dans la famille affichee.
  await pageA.locator('.segment[data-famille="Entrée"]').click();
  await attendre(400);
  await pageA.locator('#recherche-reserve').fill('anchoiade');
  await attendre(400);
  await glisserDeLaReserve(pageA, 'anchoiade', JOURS[2], 'diner');
  verifier(
    'un plat de la reserve se glisse dans une case',
    /Anchoïade/.test(await creneau(pageA, JOURS[2], 'diner').textContent()),
    await creneau(pageA, JOURS[2], 'diner').textContent()
  );

  // --- 7. Le bloc « Aujourd'hui » ---------------------------------------------
  //
  // Les trois repas du jour, en haut de page, atteignables sans defilement.

  verifier('le bloc du jour est present', (await pageA.locator('#aujourdhui').count()) === 1);
  verifier(
    'le bloc du jour porte les trois repas',
    (await pageA.locator('[data-repas-jour]').count()) === 3,
    String(await pageA.locator('[data-repas-jour]').count())
  );
  // Assertion relationnelle, et sur le jour reellement courant : le plat de midi a
  // change plusieurs fois au fil des controles, et la suite peut etre jouee
  // n'importe quel jour de la semaine. Ce qui compte est que le bloc du jour dise la
  // meme chose que la case correspondante du semainier.
  const cleAujourdhui = await pageA.evaluate(() => {
    const cases = document.querySelectorAll('.jour--aujourdhui [data-creneau]');
    return cases.length ? cases[0].getAttribute('data-creneau').split('::')[0] : null;
  });
  verifier('le jour courant est identifiable dans la grille', cleAujourdhui !== null);
  const platDeMidi = (await creneau(pageA, cleAujourdhui, 'dejeuner').textContent())
    .replace(/^\s*Déjeuner\s*/i, '')
    .trim();
  verifier(
    'le bloc du jour dit la meme chose que la case du semainier',
    (await pageA.locator('[data-repas-jour="dejeuner"]').textContent()).includes(platDeMidi),
    `case « ${platDeMidi} », bloc « ${await pageA.locator('[data-repas-jour="dejeuner"]').textContent()} »`
  );
  verifier(
    'un repas non prevu est annonce comme tel',
    /Rien de prévu/.test(await pageA.locator('[data-repas-jour="petit-dejeuner"]').textContent()) ||
      /Restes/.test(await pageA.locator('[data-repas-jour="petit-dejeuner"]').textContent()),
    await pageA.locator('[data-repas-jour="petit-dejeuner"]').textContent()
  );

  // Le « + » du bloc du jour ouvre la meme boite que la case du semainier. Il reste
  // present en lecture : c'est le geste du jour meme, celui qu'on fait le plus.
  await pageA.locator('[data-modifier-jour="diner"]').click();
  await attendre(400);
  verifier('le « + » du jour ouvre le choix de plat', (await pageA.locator('#voile').count()) === 1);
  await pageA.locator('#fermer-boite').click();
  await attendre(300);

  // Cible tactile : 44 px de cote, c'est ce qu'on vise les mains occupees.
  const tailleAjout = await pageA.evaluate(() => {
    const n = document.querySelector('[data-modifier-jour="diner"]').getBoundingClientRect();
    return { l: Math.round(n.width), h: Math.round(n.height) };
  });
  verifier(
    'le « + » du jour fait au moins 44 px de cote',
    tailleAjout.l >= 44 && tailleAjout.h >= 44,
    JSON.stringify(tailleAjout)
  );

  // --- 8. Ajouter les plats de la semaine a la liste de courses ---------------
  //
  // Etat a ce stade sur la semaine en cours : Tapenade maison (lundi midi), Pizzas
  // (lundi soir), Anchoiade (mercredi soir).

  await pageA.locator(`[data-courses-semaine="${LUNDI}"]`).click();
  await attendre(500);

  const boite = await texteDe(pageA);
  verifier('la boite de validation s ouvre', (await pageA.locator('#voile').count()) === 1);
  verifier('les trois plats de la semaine sont listes', (await pageA.locator('.validation-plat').count()) === 3, boite);
  verifier(
    'un repas hors carnet est signale comme non ajoutable',
    /repas hors carnet, sans ingrédients/.test(boite),
    boite
  );
  verifier(
    'les plats du carnet sont coches par defaut',
    (await pageA.locator('.validation-plat input:checked').count()) === 2
  );
  verifier(
    'le repas hors carnet n est pas cochable',
    (await pageA.locator('[data-valider="l::Pizzas"]:disabled').count()) === 1
  );

  // On decoche l'anchoiade : seule la tapenade doit partir en liste.
  await pageA.locator('[data-valider="r::anchoiade"]').uncheck();
  await attendre(300);
  verifier(
    'le bouton compte les plats restes coches',
    /Ajouter 1 plat à la liste/.test(await pageA.locator('#valider-courses-semaine').textContent()),
    await pageA.locator('#valider-courses-semaine').textContent()
  );

  await pageA.locator('#valider-courses-semaine').click();
  await attendre(900);
  verifier('le resultat de l ajout est annonce', (await pageA.locator('#resultat-courses').count()) === 1);

  etat = await etatStub();
  // La tapenade et l'anchoiade ont 5 ingredients chacune : seuls les 5 de la
  // tapenade doivent etre partis. C'est le coeur de la demande, on n'ajoute que ce
  // qui reste coche.
  verifier(
    'seuls les ingredients du plat coche ont ete ajoutes',
    etat.nbArticles === 5,
    `${etat.nbArticles} articles`
  );
  const noms = etat.articles.map((a) => a.fields.recetteId.stringValue);
  verifier(
    'aucun ingredient du plat decoche n est en liste',
    noms.every((n) => n === 'tapenade-maison'),
    JSON.stringify([...new Set(noms)])
  );

  // --- 9. Un plat deja en liste arrive decoche --------------------------------

  await pageA.locator('.boite__actions .bouton--secondaire, #fermer-boite').first().click();
  await attendre(400);
  await pageA.locator(`[data-courses-semaine="${LUNDI}"]`).click();
  await attendre(500);
  verifier(
    'le plat deja en liste est decoche et signale',
    /déjà entièrement dans la liste/.test(await texteDe(pageA)),
    await texteDe(pageA)
  );
  verifier(
    'seul le plat non encore achete reste coche',
    (await pageA.locator('.validation-plat input:checked').count()) === 1
  );
  await pageA.locator('#fermer-boite').click();
  await attendre(300);

  // --- 10. Un plat prevu deux fois n est compte qu une fois -------------------

  await creneau(pageA, JOURS[4], 'diner').click();
  await attendre(400);
  await pageA.locator('#recherche-plat').fill('tapenade');
  await attendre(400);
  await pageA.locator('[data-choix="tapenade-maison"]').click();
  await attendre(800);

  await pageA.locator(`[data-courses-semaine="${LUNDI}"]`).click();
  await attendre(500);
  verifier(
    'un plat prevu deux fois n apparait qu une fois dans la validation',
    (await pageA.locator('.validation-plat').count()) === 3,
    String(await pageA.locator('.validation-plat').count())
  );
  verifier(
    'la boite dit que les quantites ne sont pas doublees',
    /prévu 2 fois cette semaine, compté une seule/.test(await texteDe(pageA)),
    await texteDe(pageA)
  );
  await pageA.locator('#fermer-boite').click();
  await attendre(300);

  // --- 11. Photo d une recette ------------------------------------------------

  await pageA.goto(`${BASE}#/recette/tapenade-maison/modifier`, { waitUntil: 'networkidle' });
  await attendre(800);
  // L'editeur est un accordeon : la section Photo doit etre ouverte pour atteindre
  // son champ de fichier.
  await pageA.locator('[data-section="photo"]').click();
  await attendre(400);
  verifier('l editeur propose d ajouter une photo', (await pageA.locator('#photo-fichier').count()) === 1);
  verifier('aucune photo au depart', /Aucune photo/.test(await texteDe(pageA)));

  await pageA.locator('#photo-fichier').setInputFiles({
    name: 'tapenade.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_ROUGE, 'base64'),
  });
  verifier(
    'l enregistrement de la photo est confirme',
    await attendreTexte(pageA, /Photo enregistrée et partagée/, 12000),
    await texteDe(pageA)
  );

  etat = await etatStub();
  verifier('un document photo a ete ecrit', etat.nbPhotos === 1, `${etat.nbPhotos} documents`);
  const photo = etat.photos[0];
  verifier('la photo est rangee sous l identifiant de la recette', photo.recetteId === 'tapenade-maison', photo.recetteId);
  verifier('la photo est stockee en deux tailles', photo.tailleVignette > 0 && photo.tailleGrande > 0, JSON.stringify(photo));
  // Les bornes des regles Firestore : 80 000 et 700 000 caracteres. Une image qui
  // les depasserait serait refusee par le serveur.
  verifier(
    'les deux tailles tiennent dans les bornes des regles',
    photo.tailleVignette <= 80000 && photo.tailleGrande <= 700000,
    JSON.stringify(photo)
  );

  await pageA.goto(`${BASE}#/recette/tapenade-maison`, { waitUntil: 'networkidle' });
  await attendre(800);
  verifier('la fiche affiche la photo', (await pageA.locator('#photo-fiche img').count()) === 1);

  // La reserve de plats ne porte plus de vignette photo : demande explicite. Une
  // pastille est un nom de plat a saisir, pas une image a regarder.
  await pageA.goto(BASE, { waitUntil: 'networkidle' });
  await attendre(900);
  // Le rechargement remet l accueil en lecture : la reserve n existe qu en edition.
  await passerEnEdition(pageA);
  await pageA.locator('.segment[data-famille="Entrée"]').click();
  await attendre(300);
  await pageA.locator('#recherche-reserve').fill('tapenade');
  await attendre(400);
  verifier(
    'la reserve affiche la pastille du plat',
    (await pageA.locator('[data-reserve="tapenade-maison"]').count()) === 1
  );
  verifier(
    'la reserve n utilise aucune photo',
    (await pageA.locator('.reserve .vignette__image').count()) === 0,
    String(await pageA.locator('.reserve .vignette__image').count())
  );

  await pageA.goto(`${BASE}#/livre`, { waitUntil: 'networkidle' });
  await attendre(800);
  const vignettesLivre = await pageA.locator('.carte .vignette__image').count();
  verifier('la carte du livre porte la vignette', vignettesLivre === 1, `${vignettesLivre} vignettes`);
  // Sans photo, la carte tient en texte seul : c'est le cas de dix-neuf recettes sur
  // vingt, et la pastille de categorie porte deja la couleur.
  verifier(
    'chaque carte porte sa pastille de categorie',
    (await pageA.locator('.carte .etiquette').count()) === 21,
    String(await pageA.locator('.carte .etiquette').count())
  );
  verifier(
    'aucune carte ne porte de liseret de couleur',
    (await pageA.locator('.carte .carte__liseret').count()) === 0
  );

  // La photo est partagee : le second appareil doit la voir sans l avoir envoyee.
  //
  // Le rechargement est explicite et non decoratif : les vignettes sont relues au
  // chargement de la page, et une navigation qui ne change que l'ancre n'en est pas
  // un. C'est la limite assumee de photos.js, ce test la fixe.
  await pageB.goto(`${BASE}#/recette/tapenade-maison`, { waitUntil: 'networkidle' });
  await pageB.reload({ waitUntil: 'networkidle' });
  const vuParB = await pageB
    .locator('#photo-fiche img')
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  verifier('le second appareil voit la photo', vuParB, (await texteDe(pageB)).slice(0, 200));

  // --- 12. Retirer la photo ---------------------------------------------------

  await pageA.goto(`${BASE}#/recette/tapenade-maison/modifier`, { waitUntil: 'networkidle' });
  await attendre(800);
  await pageA.locator('[data-section="photo"]').click();
  await attendre(400);
  await pageA.locator('#retirer-photo').click();
  verifier('le retrait de la photo est confirme', await attendreTexte(pageA, /Photo retirée/, 8000));
  etat = await etatStub();
  verifier('le document photo a ete supprime', etat.nbPhotos === 0, `${etat.nbPhotos} documents`);

  // --- 13. Ajouter une recette depuis le livre --------------------------------

  await pageA.goto(`${BASE}#/livre`, { waitUntil: 'networkidle' });
  await attendre(600);
  verifier('le livre propose d ajouter une recette', (await pageA.locator('#ajouter-recette').count()) === 1);
  await pageA.locator('#ajouter-recette').click();
  await attendre(700);
  verifier('l ecran de creation s ouvre', pageA.url().includes('#/recette/nouvelle'), pageA.url());
  // En creation la section Fiche est ouverte d'emblee : sans titre, la recette
  // serait introuvable, c'est donc par la qu'on commence.
  verifier('la section Fiche est ouverte en creation', (await pageA.locator('[data-section-ouverte="fiche"]').count()) === 1);
  verifier('le formulaire est vide', (await pageA.locator('#champ-titre').inputValue()) === '');
  // Le resume de la section pliee le dit, et la section ouverte l'explique.
  verifier(
    'la section Photo annonce qu elle attend le premier enregistrement',
    /après le premier enregistrement/.test(
      await pageA.locator('[data-section-pliee="photo"]').textContent()
    ),
    await pageA.locator('[data-section-pliee="photo"]').textContent()
  );
  await pageA.locator('[data-section="photo"]').click();
  await attendre(400);
  verifier(
    'la photo est annoncee comme possible apres enregistrement',
    /La photo pourra être ajoutée après le premier enregistrement/.test(await texteDe(pageA))
  );
  await pageA.locator('[data-section="fiche"]').click();
  await attendre(400);

  // Un titre vide est refuse : sans titre, la fiche serait introuvable.
  await pageA.locator('#enregistrer').click();
  await attendre(500);
  verifier('enregistrer sans titre est refuse', (await pageA.locator('#erreur-editeur').count()) === 1);
  verifier('la creation reste a l ecran', pageA.url().includes('#/recette/nouvelle'), pageA.url());
  etat = await etatStub();
  verifier('aucune recette sans titre n a ete ecrite', etat.nbRecettes === 0, `${etat.nbRecettes} documents`);

  await pageA.locator('#champ-titre').fill('Soupe du jardin');
  await pageA.locator('#enregistrer').click();
  await attendre(1200);
  verifier(
    'la recette creee mene a sa fiche',
    pageA.url().includes('#/recette/soupe-du-jardin'),
    pageA.url()
  );
  verifier('la fiche porte le titre saisi', /Soupe du jardin/.test(await texteDe(pageA)));

  await pageA.goto(`${BASE}#/livre`, { waitUntil: 'networkidle' });
  await attendre(800);
  verifier('le livre compte une recette de plus', (await pageA.locator('.carte').count()) === 22);
  verifier('le livre annonce 22 recettes', /22 recettes rassemblées/.test(await texteDe(pageA)));

  // --- 14. Supprimer une recette ajoutee --------------------------------------

  await pageA.goto(`${BASE}#/recette/soupe-du-jardin/modifier`, { waitUntil: 'networkidle' });
  await attendre(800);
  verifier(
    'une recette ajoutee se supprime et ne se retablit pas',
    (await pageA.locator('#supprimer-recette').count()) === 1 &&
      (await pageA.locator('#reinitialiser').count()) === 0
  );

  await pageA.goto(`${BASE}#/recette/lasagnes-bolognaise-la-meilleure-recette/modifier`, { waitUntil: 'networkidle' });
  await attendre(800);
  verifier(
    'une recette du carnet d origine ne propose pas la suppression',
    (await pageA.locator('#supprimer-recette').count()) === 0
  );

  await pageA.goto(`${BASE}#/recette/soupe-du-jardin/modifier`, { waitUntil: 'networkidle' });
  await attendre(800);
  await pageA.locator('#supprimer-recette').click();
  await attendre(400);
  verifier('la suppression demande confirmation', (await pageA.locator('#confirmer-suppression').count()) === 1);
  await pageA.locator('#confirmer-suppression').click();
  await attendre(1200);
  verifier('la suppression ramene au livre', pageA.url().includes('#/livre'), pageA.url());
  verifier('le livre revient a vingt-et-une recettes', (await pageA.locator('.carte').count()) === 21);

  // --- 15. Poser un repas hors ligne ------------------------------------------

  await pageA.goto(BASE, { waitUntil: 'networkidle' });
  await attendre(900);
  await pageA.request.post(new URL('__stub/panne', BASE).href, { data: { panne: true } });

  await passerEnEdition(pageA);
  await creneau(pageA, JOURS[5], 'diner').click();
  await attendre(400);
  await pageA.locator('[data-repas-libre="Japonais"]').click();
  await attendre(900);
  verifier(
    'un repas pose hors ligne est visible tout de suite',
    /Japonais/.test(await creneau(pageA, JOURS[5], 'diner').textContent())
  );
  verifier(
    'l etat hors ligne est annonce avec les envois en attente',
    /Hors ligne, 1 modification en attente/.test(await texteDe(pageA)),
    await texteDe(pageA)
  );

  await pageA.request.post(new URL('__stub/panne', BASE).href, { data: { panne: false } });
  // Le rafraichissement est desormais unique, dans l'en-tete : il relit la liste et
  // les menus d'un seul geste.
  await pageA.locator('#rafraichir').click();
  // Le bandeau d'etat disparait quand tout va bien : la preuve du retour du reseau
  // est donc l'absence de « Hors ligne », et non la presence d'un libelle.
  verifier(
    'le repas part au retour du reseau',
    await attendreTexte(pageA, /^(?![\s\S]*Hors ligne)[\s\S]*Japonais/, 10000),
    (await texteDe(pageA)).slice(0, 300)
  );
  etat = await etatStub();
  verifier(
    'le repas pose hors ligne est bien arrive en base',
    etat.creneaux.some((c) => c.fields.titre.stringValue === 'Japonais'),
    JSON.stringify(etat.creneaux.map((c) => c.fields.titre.stringValue))
  );

  // --- 16. Telephone : pas de debordement horizontal --------------------------

  const telephone = await contexteA.newPage();
  await telephone.goto(BASE, { waitUntil: 'networkidle' });
  await telephone.setViewportSize({ width: 360, height: 780 });
  await attendre(900);
  const debordement = await telephone.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  verifier('aucun debordement horizontal en 360 px', debordement <= 1, `${debordement} px`);
  // Quatorze cases : la semaine suivante est vide donc repliee sur un ecran neuf, et
  // le petit-dejeuner de la semaine en cours est masque, aucun n'etant prevu.
  verifier(
    'le semainier reste utilisable sur telephone',
    (await telephone.locator('.creneau').count()) === 14,
    String(await telephone.locator('.creneau').count())
  );
  verifier(
    'le bloc du jour est atteignable sans defilement sur telephone',
    await telephone.evaluate(() => {
      const bloc = document.getElementById('aujourdhui');
      if (!bloc) return false;
      const bas = bloc.getBoundingClientRect().bottom;
      return bas > 0 && bas <= window.innerHeight;
    }),
    await telephone.evaluate(() => {
      const bloc = document.getElementById('aujourdhui');
      return bloc ? Math.round(bloc.getBoundingClientRect().bottom) + ' px pour ' + window.innerHeight : 'absent';
    })
  );
  // La reserve de plats est masquee au tactile : le glissement HTML5 n'y existe pas.
  verifier(
    'la reserve glissable est masquee sur un ecran etroit',
    await telephone.evaluate(() => {
      const noeud = document.getElementById('reserve');
      return noeud === null || getComputedStyle(noeud).display === 'none';
    })
  );
  await telephone.close();

  // --- 17. Compteur de realisations -------------------------------------------
  //
  // On pose des plats sur des jours passes : ce sont eux, et eux seuls, qui comptent
  // comme faits. Les jours utilises sont anterieurs a la semaine affichee, donc
  // atteignables uniquement par l'API du module, ce qui est le cas reel d'un
  // historique accumule au fil des semaines.

  // Le semainier est vide avant de compter. Les sections precedentes ont pose des
  // plats sur la semaine en cours, dont certains jours sont deja passes selon le jour
  // ou la suite tourne : sans remise a zero, le decompte attendu dependrait du jour
  // de la semaine, ce qui n'est pas une propriete du produit.
  await pageA.evaluate(async () => {
    const Sm = window.CarnetSemainier;
    for (const plat of Sm.tous()) await Sm.retirer(plat.cle);
  });
  await pageA.goto(`${BASE}#/livre`, { waitUntil: 'networkidle' });
  await attendre(700);
  const avantHistorique = await texteDe(pageA);
  // Sans repas passe, tous les plats sont « jamais faits » : aucun ne peut afficher
  // un decompte.
  verifier(
    'sans repas passe, aucun plat n est compte comme fait',
    !/Fait \d+ fois/.test(avantHistorique),
    avantHistorique.slice(0, 200)
  );

  // Trois realisations passees de la tapenade, une de l anchoiade.
  await pageA.evaluate(async () => {
    const poser = (jour, moment, id, titre) =>
      window.CarnetSemainier.poser(jour, moment, { type: 'recette', recetteId: id, titre });
    await poser('2026-01-05', 'diner', 'tapenade-maison', 'Tapenade maison');
    await poser('2026-01-12', 'diner', 'tapenade-maison', 'Tapenade maison');
    await poser('2026-02-02', 'dejeuner', 'tapenade-maison', 'Tapenade maison');
    await poser('2026-03-09', 'diner', 'anchoiade', 'Anchoïade');
    await poser('2026-03-10', 'diner', 'restaurant-hors-carnet', 'Restaurant');
  });
  // Rechargement explicite : une navigation vers la meme ancre ne re-rend rien.
  await pageA.reload({ waitUntil: 'networkidle' });
  await attendre(1000);

  const carteTapenade = pageA.locator('.carte', { hasText: 'Tapenade maison' }).first();
  verifier(
    'la carte annonce le nombre de fois que le plat a ete fait',
    /Fait 3 fois/.test(await carteTapenade.textContent()),
    await carteTapenade.textContent()
  );
  verifier(
    'la carte donne la date de la derniere fois',
    /la dernière le 2 février/.test(await carteTapenade.textContent()),
    await carteTapenade.textContent()
  );
  verifier(
    'un plat fait une seule fois est compte',
    /Fait 1 fois/.test(await pageA.locator('.carte', { hasText: 'Anchoïade' }).first().textContent()),
    await pageA.locator('.carte', { hasText: 'Anchoïade' }).first().textContent()
  );
  verifier(
    'les plats jamais faits sont signales',
    (await pageA.locator('.carte__realisations--jamais').count()) === 19,
    String(await pageA.locator('.carte__realisations--jamais').count())
  );

  // Le filtre n apparait qu avec un historique, et separe les deux populations.
  verifier(
    'le filtre des realisations est propose',
    (await pageA.locator('[data-filtre="realisations:jamais"]').count()) === 1
  );
  await pageA.locator('[data-filtre="realisations:jamais"]').click();
  await attendre(500);
  verifier(
    'le filtre « jamais fait » ecarte les plats deja faits',
    (await pageA.locator('.carte').count()) === 19,
    String(await pageA.locator('.carte').count())
  );
  await pageA.locator('[data-filtre="realisations:deja"]').click();
  await attendre(500);
  verifier(
    'le filtre « deja fait » ne garde que les deux plats realises',
    (await pageA.locator('.carte').count()) === 2,
    String(await pageA.locator('.carte').count())
  );

  // Le premier du mois s ecrit « 1er », pas « 1 ».
  await pageA.evaluate(() =>
    window.CarnetSemainier.poser('2026-05-01', 'diner', {
      type: 'recette',
      recetteId: 'cake-aux-olives',
      titre: 'Cake aux olives',
    })
  );
  await attendre(700);
  verifier(
    'le premier du mois est ecrit « 1er »',
    /la dernière le 1er mai/.test(await pageA.locator('.carte', { hasText: 'Cake aux olives' }).first().textContent()),
    await pageA.locator('.carte', { hasText: 'Cake aux olives' }).first().textContent()
  );

  // Le compteur du livre suit un changement de menus sans rechargement : il est lu
  // dans le semainier, il ne doit pas rester perime sur les cartes.
  await pageA.evaluate(() =>
    window.CarnetSemainier.poser('2026-04-06', 'diner', {
      type: 'recette',
      recetteId: 'tapenade-maison',
      titre: 'Tapenade maison',
    })
  );
  await attendre(700);
  verifier(
    'le compteur du livre suit un changement de menus sans rechargement',
    /Fait 4 fois/.test(await pageA.locator('.carte', { hasText: 'Tapenade maison' }).first().textContent()),
    await pageA.locator('.carte', { hasText: 'Tapenade maison' }).first().textContent()
  );

  // Et la fiche porte la meme information.
  await pageA.goto(`${BASE}#/recette/tapenade-maison`, { waitUntil: 'networkidle' });
  await attendre(700);
  // Quatre, et non trois : un creneau d avril a ete ajoute au controle precedent.
  verifier(
    'la fiche porte le compteur de realisations',
    (await pageA.locator('.marque-realisations').count()) === 1 &&
      /Fait 4 fois/.test(await texteDe(pageA)),
    (await texteDe(pageA)).slice(0, 300)
  );
  await pageA.goto(`${BASE}#/recette/focaccia-maison-moelleuse`, { waitUntil: 'networkidle' });
  await attendre(700);
  verifier(
    'une recette jamais faite le dit sur sa fiche',
    (await pageA.locator('.marque-realisations--jamais').count()) === 1,
    (await texteDe(pageA)).slice(0, 300)
  );

  // --- 18. Aucune erreur JavaScript ------------------------------------------

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
