/* Emulation minimale, en memoire, des deux API REST utilisees par le carnet :
   Firestore (lecture, ecriture, masque de champs, suppression) et l'authentification
   anonyme d'Identity Platform.

   Sert a deux choses :
   - tester la synchronisation pour de vrai, y compris dans un navigateur, sans
     toucher au projet Firebase reel ;
   - simuler une panne reseau a la demande, pour verifier que la file d'attente hors
     ligne fonctionne, ce qu'un vrai serveur ne permet pas de provoquer facilement.

   Ce n'est pas un clone de Firestore : seuls les comportements dont l'application
   depend sont reproduits. */

const etat = {
  articles: new Map(), // idDocument -> { fields }, collection listes/<id>/articles
  recettes: new Map(), // idDocument -> { fields }, collection recettes
  creneaux: new Map(), // idDocument -> { fields }, semainiers/<id>/creneaux
  photos: new Map(), // idDocument -> { fields }, collection photos
  placard: new Map(), // idDocument -> { fields }, collection placard
  livres: new Map(), // idDocument -> { fields }, collection livres (la bibliotheque)
  illustrations: new Map(), // idDocument -> { fields }, illustrations des etapes
  // Les appareils de la maison : un document par identifiant anonyme, comme en
  // production. Le code n'est comparé qu'ici, comme les règles le font avec un
  // document que le client ne peut pas lire.
  appareils: new Map(),
  // Les comptes autorisés à écrire, et les comptes tout court : le stub tient les deux,
  // comme Firebase tient l'authentification d'un côté et Firestore de l'autre.
  comptes: new Map(),
  utilisateurs: new Map(), // email -> { uid, motDePasse } : le côté authentification
  // Le côté Firestore des foyers : la fiche d'un compte (« à quel foyer j'appartiens »),
  // les foyers eux-mêmes, et leurs membres avec leur rôle. `fiches` porte la collection
  // `utilisateurs` de la base, que `etat.utilisateurs` ne peut pas nommer : celui-là
  // tient les comptes d'Identity Toolkit, ce n'est pas la même chose.
  fiches: new Map(), // uid -> { fields }, collection utilisateurs
  foyers: new Map(), // foyerId -> { fields }, collection foyers
  membres: new Map(), // uid -> { fields }, foyers/<id>/membres (un seul foyer par test)
  // Le partage entre foyers : l'annuaire des comptes, les manifestes, et les avis
  // déposés chez les bénéficiaires.
  annuaire: new Map(), // adresse normalisée -> { fields }
  partages: new Map(), // uid du bénéficiaire -> { fields }
  recus: new Map(), // identifiant du foyer partageur -> { fields }
  codeMaison: 'code-de-la-maison',
  // Quand vrai, l'écriture est refusée à qui n'est pas membre du foyer en modification :
  // c'est le comportement réel des règles. Faux par défaut, pour que les suites écrites
  // avant le verrou continuent d'écrire sans s'inscrire.
  exigerMaison: false,
  sessions: new Map(), // refreshToken -> compteur
  panne: false, // quand vrai, toute requete Firestore repond 503
  // Quand vrai, seule la collection `recettes` est refusee, comme le ferait un
  // projet dont les regles de securite n'ont pas encore ete republiees.
  refuserRecettes: false,
  appels: { lectures: 0, ecritures: 0, suppressions: 0, sessions: 0 },
};

/**
 * Le foyer de test, et son membre fondateur.
 *
 * Les suites qui ne parlent pas de comptes ouvrent le carnet avec une session déjà
 * posée (voir la constante CONNECTE de chaque suite). Depuis les foyers, cette session
 * ne suffit plus : l'application demande au serveur à quel foyer le compte appartient,
 * et sans réponse elle n'affiche que l'écran de connexion. Le foyer est donc recréé à
 * chaque réinitialisation, sauf demande explicite (`?vide=1`), dont se sert la suite
 * qui teste précisément la création d'un foyer.
 */
const FOYER_DE_TEST = 'compte-test';

function poserFoyerDeTest() {
  etat.foyers.set(FOYER_DE_TEST, {
    fields: {
      nom: { stringValue: 'Foyer de test' },
      proprietaire: { stringValue: FOYER_DE_TEST },
    },
  });
  etat.membres.set(FOYER_DE_TEST, {
    fields: { email: { stringValue: 'test@maison.fr' }, role: { stringValue: 'modification' } },
  });
  etat.fiches.set(FOYER_DE_TEST, {
    fields: { email: { stringValue: 'test@maison.fr' }, foyer: { stringValue: FOYER_DE_TEST } },
  });
}

function reinitialiser(avecFoyer = true) {
  etat.articles.clear();
  etat.recettes.clear();
  etat.creneaux.clear();
  etat.photos.clear();
  etat.placard.clear();
  etat.livres.clear();
  etat.illustrations.clear();
  etat.appareils.clear();
  etat.comptes.clear();
  etat.utilisateurs.clear();
  etat.fiches.clear();
  etat.foyers.clear();
  etat.membres.clear();
  etat.annuaire.clear();
  etat.partages.clear();
  etat.recus.clear();
  etat.sessions.clear();
  etat.panne = false;
  etat.refuserRecettes = false;
  etat.exigerMaison = false;
  etat.appels = { lectures: 0, ecritures: 0, suppressions: 0, sessions: 0 };
  if (avecFoyer) poserFoyerDeTest();
}

/**
 * Un jeton de la forme d'un JWT : trois parties, dont une charge utile lisible.
 *
 * L'application y lit l'identifiant de l'appareil (`user_id`) pour savoir sous quel
 * nom l'inscrire. Un jeton opaque « jeton-3 » suffisait tant que personne ne le
 * décodait ; il ne suffit plus.
 */
/** Un jeton signé par un compte : sa charge utile porte l'identifiant du compte. */
function jetonDeCompte(uid, email) {
  const charge = Buffer.from(JSON.stringify({ user_id: uid, sub: uid, email }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `jeton-${uid}.${charge}.signature`;
}

function jetonFactice(n, suffixe) {
  const charge = Buffer.from(JSON.stringify({ user_id: `anonyme-${n}`, sub: `anonyme-${n}` }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `jeton-${n}${suffixe ? '-' + suffixe : ''}.${charge}.signature`;
}

function repondre(reponse, statut, corps) {
  const texte = corps === null || corps === undefined ? '' : JSON.stringify(corps);
  reponse.writeHead(statut, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  reponse.end(texte);
}

function lireCorps(requete) {
  return new Promise((resoudre) => {
    let donnees = '';
    requete.on('data', (morceau) => {
      donnees += morceau;
    });
    requete.on('end', () => resoudre(donnees));
  });
}

/**
 * Traite une requete visant l'emulation. Retourne true si elle a ete prise en
 * charge, false si elle ne concerne pas le stub (le serveur sert alors un fichier).
 *
 * Conventions de chemin, choisies pour tenir sur le meme port que le site et eviter
 * toute question de CORS :
 *   /__auth/v1/accounts:signUp     authentification anonyme
 *   /__auth/v1/token               rafraichissement de jeton
 *   /__firestore/v1/<chemin>       Firestore
 *   /__stub/panne                  bascule de la panne simulee
 *   /__stub/etat                   inspection (compteurs, contenu)
 */
async function traiter(requete, reponse) {
  const url = new URL(requete.url, 'http://127.0.0.1');
  const chemin = url.pathname;

  if (!chemin.startsWith('/__auth/') && !chemin.startsWith('/__firestore/') && !chemin.startsWith('/__stub/')) {
    return false;
  }

  // --- Pilotage du stub ------------------------------------------------------

  if (chemin === '/__stub/panne') {
    const corps = await lireCorps(requete);
    let demande = {};
    try {
      demande = corps ? JSON.parse(corps) : {};
    } catch (erreur) {
      demande = {};
    }
    etat.panne = Boolean(demande.panne);
    repondre(reponse, 200, { panne: etat.panne });
    return true;
  }

  if (chemin === '/__stub/exiger-maison') {
    const corps = await lireCorps(requete);
    let demande = {};
    try {
      demande = corps ? JSON.parse(corps) : {};
    } catch (erreur) {
      demande = {};
    }
    etat.exigerMaison = Boolean(demande.exiger);
    if (demande.code) etat.codeMaison = String(demande.code);
    repondre(reponse, 200, { exigerMaison: etat.exigerMaison, nbAppareils: etat.appareils.size });
    return true;
  }

  if (chemin === '/__stub/refuser-recettes') {
    const corps = await lireCorps(requete);
    let demande = {};
    try {
      demande = corps ? JSON.parse(corps) : {};
    } catch (erreur) {
      demande = {};
    }
    etat.refuserRecettes = Boolean(demande.refuser);
    repondre(reponse, 200, { refuserRecettes: etat.refuserRecettes });
    return true;
  }

  if (chemin === '/__stub/etat') {
    if (url.searchParams.get('reinitialiser') === '1') reinitialiser(url.searchParams.get('vide') !== '1');
    repondre(reponse, 200, {
      panne: etat.panne,
      refuserRecettes: etat.refuserRecettes,
      exigerMaison: etat.exigerMaison,
      nbAppareils: etat.appareils.size,
      nbComptes: etat.comptes.size,
      nbFoyers: etat.foyers.size,
      nbMembres: etat.membres.size,
      nbAnnuaire: etat.annuaire.size,
      nbPartages: etat.partages.size,
      nbRecus: etat.recus.size,
      partages: [...etat.partages.entries()].map(([uid, doc]) => ({
        uid,
        email: ((doc.fields || {}).emailBeneficiaire || {}).stringValue || '',
        recettes: (((doc.fields || {}).recettes || {}).arrayValue || {}).values
          ? doc.fields.recettes.arrayValue.values.map((v) => v.stringValue)
          : [],
        livres: (((doc.fields || {}).livres || {}).arrayValue || {}).values
          ? doc.fields.livres.arrayValue.values.map((v) => v.stringValue)
          : [],
      })),
      membres: [...etat.membres.entries()].map(([uid, doc]) => ({
        uid,
        email: ((doc.fields || {}).email || {}).stringValue || '',
        role: ((doc.fields || {}).role || {}).stringValue || '',
      })),
      nbUtilisateurs: etat.utilisateurs.size,
      nbArticles: etat.articles.size,
      nbRecettes: etat.recettes.size,
      nbCreneaux: etat.creneaux.size,
      nbPhotos: etat.photos.size,
      nbPlacard: etat.placard.size,
      nbLivres: etat.livres.size,
      nbIllustrations: etat.illustrations.size,
      appels: etat.appels,
      articles: [...etat.articles.entries()].map(([id, doc]) => ({ id, fields: doc.fields })),
      recettes: [...etat.recettes.keys()],
      creneaux: [...etat.creneaux.entries()].map(([id, doc]) => ({ id, fields: doc.fields })),
      placard: [...etat.placard.entries()].map(([id, doc]) => ({ id, fields: doc.fields })),
      livres: [...etat.livres.entries()].map(([id, doc]) => ({ id, fields: doc.fields })),
      // Les illustrations sont volumineuses : on n'expose que leur nombre et leur poids.
      illustrations: [...etat.illustrations.entries()].map(([id, doc]) => ({
        id,
        recetteId: doc.fields.recetteId ? doc.fields.recetteId.stringValue : null,
        rangs: doc.fields.json ? Object.keys(JSON.parse(doc.fields.json.stringValue)) : [],
        taille: doc.fields.json ? String(doc.fields.json.stringValue).length : 0,
      })),
      // Les photos sont volumineuses : on n'expose que leur taille, pas leur contenu.
      photos: [...etat.photos.entries()].map(([id, doc]) => ({
        id,
        recetteId: doc.fields.recetteId ? doc.fields.recetteId.stringValue : null,
        tailleVignette: doc.fields.vignette ? String(doc.fields.vignette.stringValue).length : 0,
        tailleGrande: doc.fields.grande ? String(doc.fields.grande.stringValue).length : 0,
      })),
    });
    return true;
  }

  // --- Authentification anonyme ---------------------------------------------

  if (chemin === '/__auth/v1/accounts:signUp') {
    const corpsInscription = await lireCorps(requete);
    if (!url.searchParams.get('key')) {
      repondre(reponse, 400, { error: { code: 400, message: 'API key manquante' } });
      return true;
    }

    // Avec une adresse : c'est la création d'un compte. Sans : la session anonyme.
    let demandeCompte = {};
    try {
      demandeCompte = corpsInscription ? JSON.parse(corpsInscription) : {};
    } catch (erreur) {
      demandeCompte = {};
    }
    if (demandeCompte.email) {
      const email = String(demandeCompte.email).trim().toLowerCase();
      const motDePasse = String(demandeCompte.password || '');
      if (!/.+@.+\..+/.test(email)) {
        repondre(reponse, 400, { error: { code: 400, message: 'INVALID_EMAIL' } });
        return true;
      }
      if (motDePasse.length < 6) {
        repondre(reponse, 400, { error: { code: 400, message: 'WEAK_PASSWORD : Password should be at least 6 characters' } });
        return true;
      }
      if (etat.utilisateurs.has(email)) {
        repondre(reponse, 400, { error: { code: 400, message: 'EMAIL_EXISTS' } });
        return true;
      }
      const uid = 'compte-' + (etat.utilisateurs.size + 1);
      etat.utilisateurs.set(email, { uid, motDePasse });
      repondre(reponse, 200, {
        idToken: jetonDeCompte(uid, email),
        refreshToken: 'refresh-compte-' + uid,
        expiresIn: '3600',
        localId: uid,
        email,
      });
      return true;
    }
    etat.appels.sessions += 1;
    const refreshToken = `refresh-${etat.appels.sessions}`;
    etat.sessions.set(refreshToken, 0);
    repondre(reponse, 200, {
      idToken: jetonFactice(etat.appels.sessions),
      refreshToken,
      expiresIn: '3600',
      localId: `anonyme-${etat.appels.sessions}`,
    });
    return true;
  }

  if (chemin === '/__auth/v1/accounts:signInWithPassword') {
    const corpsConnexion = await lireCorps(requete);
    let demandeConnexion = {};
    try {
      demandeConnexion = corpsConnexion ? JSON.parse(corpsConnexion) : {};
    } catch (erreur) {
      demandeConnexion = {};
    }
    const email = String(demandeConnexion.email || '').trim().toLowerCase();
    const utilisateur = etat.utilisateurs.get(email);
    if (!utilisateur || utilisateur.motDePasse !== String(demandeConnexion.password || '')) {
      repondre(reponse, 400, { error: { code: 400, message: 'INVALID_LOGIN_CREDENTIALS' } });
      return true;
    }
    repondre(reponse, 200, {
      idToken: jetonDeCompte(utilisateur.uid, email),
      refreshToken: 'refresh-compte-' + utilisateur.uid,
      expiresIn: '3600',
      localId: utilisateur.uid,
      email,
    });
    return true;
  }

  if (chemin === '/__auth/v1/accounts:sendOobCode') {
    await lireCorps(requete);
    repondre(reponse, 200, { email: 'envoye' });
    return true;
  }

  if (chemin === '/__auth/v1/token') {
    const corps = await lireCorps(requete);
    const parametres = new URLSearchParams(corps);
    const refreshToken = parametres.get('refresh_token');
    if (!etat.sessions.has(refreshToken)) {
      repondre(reponse, 400, { error: { code: 400, message: 'TOKEN_EXPIRED' } });
      return true;
    }
    const n = etat.sessions.get(refreshToken) + 1;
    etat.sessions.set(refreshToken, n);
    // Le jeton change à chaque renouvellement, l'identité de l'appareil non : c'est
    // le même appareil, sinon son inscription dans la maison serait perdue à chaque
    // heure. Le numéro de session est celui du refresh token, « refresh-3 ».
    if (String(refreshToken).startsWith('refresh-compte-')) {
      const uidCompte = String(refreshToken).replace('refresh-compte-', '');
      repondre(reponse, 200, {
        id_token: jetonDeCompte(uidCompte, ''),
        refresh_token: refreshToken,
        expires_in: '3600',
        user_id: uidCompte,
      });
      return true;
    }
    const numeroSession = Number(String(refreshToken).replace('refresh-', '')) || 0;
    repondre(reponse, 200, {
      id_token: jetonFactice(numeroSession, `renouvele-${n}`),
      refresh_token: refreshToken,
      expires_in: '3600',
    });
    return true;
  }

  // --- Firestore -------------------------------------------------------------

  if (etat.panne) {
    repondre(reponse, 503, { error: { code: 503, message: 'panne simulee' } });
    return true;
  }

  // Toute requete Firestore doit porter un jeton : c'est ce qu'imposeront les
  // regles de securite reelles (request.auth != null).
  const autorisation = requete.headers.authorization || '';
  if (!/^Bearer .+/.test(autorisation)) {
    repondre(reponse, 401, { error: { code: 401, message: 'jeton absent' } });
    return true;
  }

  // Sept collections sont emulees : les articles de la liste, les recettes modifiees,
  // les creneaux du semainier, les photos, les illustrations d'etapes, le placard et les
  // livres. On ne verifie pas la structure complete du chemin, seulement le nom de la
  // collection visee. L'ordre compte : « illustrations » avant « recettes », sinon le
  // chemin /illustrations/... ne serait jamais reconnu comme tel.
  let collection = null;
  let reste = null;
  // L'ordre compte deux fois : « illustrations » avant « recettes », sinon le chemin
  // /illustrations/... ne serait jamais reconnu comme tel ; et « foyers » en dernier,
  // parce que tout le contenu vit sous foyers/<id>/<collection> et doit être reconnu
  // par le nom de sa propre collection, pas par celui du foyer qui la porte.
  const NOMS = {
    appareils: 'appareils',
    comptes: 'comptes',
    annuaire: 'annuaire',
    // « recus » et « partages » avant « utilisateurs » et « foyers » : ce sont des
    // sous-collections, et c'est leur propre nom qui doit les désigner.
    recus: 'recus',
    partages: 'partages',
    utilisateurs: 'fiches',
    membres: 'membres',
    articles: 'articles',
    illustrations: 'illustrations',
    recettes: 'recettes',
    creneaux: 'creneaux',
    photos: 'photos',
    placard: 'placard',
    livres: 'livres',
    foyers: 'foyers',
  };
  Object.keys(NOMS).forEach((nom) => {
    if (collection) return;
    // Deux formes possibles : le chemin de la collection, qui finit par son nom, et
    // celui d'un document, ou le nom est suivi de l'identifiant. On coupe sur la
    // derniere occurrence : un identifiant qui contiendrait le nom de sa collection
    // ferait sinon lire une requete de document comme une requete de collection.
    if (chemin.endsWith('/' + nom)) {
      collection = etat[NOMS[nom]];
      reste = '';
      return;
    }
    const marque = '/' + nom + '/';
    const position = chemin.lastIndexOf(marque);
    if (position !== -1) {
      collection = etat[NOMS[nom]];
      reste = chemin.slice(position + marque.length);
    }
  });

  if (!collection) {
    repondre(reponse, 404, { error: { code: 404, message: 'collection inconnue' } });
    return true;
  }

  // L'appareil courant, déduit du jeton porteur : « jeton-3 » vaut pour l'appareil 3.
  const porteur = String(requete.headers.authorization || '').replace('Bearer ', '');
  let appareil = '';
  try {
    const charge = porteur.split('.')[1];
    appareil = JSON.parse(Buffer.from(charge, 'base64').toString('utf8')).user_id || '';
  } catch (erreur) {
    appareil = '';
  }

  if (collection === etat.comptes) {
    if (requete.method === 'GET') {
      etat.appels.lectures += 1;
      if (!etat.exigerMaison) {
        repondre(reponse, 200, { name: reste, fields: {} });
        return true;
      }
      const inscrit = etat.comptes.get(decodeURIComponent(reste));
      if (!inscrit) {
        repondre(reponse, 404, { error: { code: 404, message: 'compte non autorisé' } });
        return true;
      }
      repondre(reponse, 200, { name: reste, fields: inscrit.fields });
      return true;
    }
    if (requete.method === 'PATCH') {
      const corpsCompte = await lireCorps(requete);
      let demandeCompte2 = {};
      try {
        demandeCompte2 = JSON.parse(corpsCompte || '{}');
      } catch (erreur) {
        demandeCompte2 = {};
      }
      const code = ((demandeCompte2.fields || {}).code || {}).stringValue;
      if (code !== etat.codeMaison) {
        repondre(reponse, 403, {
          error: { code: 403, status: 'PERMISSION_DENIED', message: 'Missing or insufficient permissions.' },
        });
        return true;
      }
      etat.appels.ecritures += 1;
      etat.comptes.set(decodeURIComponent(reste), { fields: demandeCompte2.fields || {} });
      repondre(reponse, 200, { name: reste, fields: demandeCompte2.fields || {} });
      return true;
    }
    repondre(reponse, 403, { error: { code: 403, message: 'interdit' } });
    return true;
  }

  if (collection === etat.appareils) {
    if (requete.method === 'GET') {
      etat.appels.lectures += 1;
      // Verrou désarmé : la base se comporte comme avant le partage en lecture seule,
      // où tout appareil authentifié pouvait écrire. Tout appareil est donc « de la
      // maison », ce qui laisse les suites écrites avant ce chantier inchangées.
      if (!etat.exigerMaison) {
        repondre(reponse, 200, { name: reste, fields: {} });
        return true;
      }
      const inscrit = etat.appareils.get(decodeURIComponent(reste));
      if (!inscrit) {
        repondre(reponse, 404, { error: { code: 404, message: 'appareil inconnu' } });
        return true;
      }
      repondre(reponse, 200, { name: reste, fields: inscrit.fields });
      return true;
    }
    if (requete.method === 'PATCH') {
      const corpsAppareil = await lireCorps(requete);
      let demandeAppareil = {};
      try {
        demandeAppareil = JSON.parse(corpsAppareil || '{}');
      } catch (erreur) {
        demandeAppareil = {};
      }
      const code = ((demandeAppareil.fields || {}).code || {}).stringValue;
      if (code !== etat.codeMaison) {
        repondre(reponse, 403, {
          error: { code: 403, status: 'PERMISSION_DENIED', message: 'Missing or insufficient permissions.' },
        });
        return true;
      }
      etat.appels; // eslint-disable-line no-unused-expressions
      etat.appels.ecritures += 1;
      etat.appareils.set(decodeURIComponent(reste), { fields: demandeAppareil.fields || {} });
      repondre(reponse, 200, { name: reste, fields: demandeAppareil.fields || {} });
      return true;
    }
    repondre(reponse, 403, { error: { code: 403, message: 'interdit' } });
    return true;
  }

  // Le verrou des règles, côté contenu : écrire exige d'être membre du foyer, en
  // modification. Les collections de l'amorçage (le foyer, ses membres, la fiche du
  // compte) en sont exclues, sinon personne ne pourrait jamais créer le premier foyer.
  // L'amorçage et l'annuaire échappent au verrou : sans eux, un compte neuf ne
  // pourrait ni se doter d'un foyer ni se rendre trouvable.
  const amorcage =
    collection === etat.foyers ||
    collection === etat.membres ||
    collection === etat.fiches ||
    collection === etat.annuaire;
  if (etat.exigerMaison && requete.method !== 'GET' && !amorcage) {
    const membre = etat.membres.get(appareil);
    const role = membre && ((membre.fields || {}).role || {}).stringValue;
    if (role !== 'modification') {
      repondre(reponse, 403, {
        error: { code: 403, status: 'PERMISSION_DENIED', message: 'Missing or insufficient permissions.' },
      });
      return true;
    }
  }

  if (collection === etat.recettes && etat.refuserRecettes) {
    repondre(reponse, 403, {
      error: { code: 403, status: 'PERMISSION_DENIED', message: 'Missing or insufficient permissions.' },
    });
    return true;
  }

  // Masque de lecture : l'application le demande pour ne pas telecharger les
  // grandes images quand elle n'affiche que des vignettes. Sans cette prise en
  // charge, le stub renverrait tout et le test ne verifierait rien de reel.
  const masqueLecture = url.searchParams.getAll('mask.fieldPaths');

  function projeter(champs) {
    if (masqueLecture.length === 0) return champs;
    const reduit = {};
    masqueLecture.forEach((nom) => {
      if (champs && nom in champs) reduit[nom] = champs[nom];
    });
    return reduit;
  }

  if (requete.method === 'GET' && reste === '') {
    etat.appels.lectures += 1;
    const documents = [...collection.entries()].map(([id, doc]) => ({
      name: `${chemin.replace(/^\/__firestore\/v1\//, '')}/${id}`,
      fields: projeter(doc.fields),
    }));
    repondre(reponse, 200, documents.length ? { documents } : {});
    return true;
  }

  const id = decodeURIComponent(reste);

  if (requete.method === 'GET') {
    etat.appels.lectures += 1;
    const document_ = collection.get(id);
    if (!document_) {
      repondre(reponse, 404, { error: { code: 404, message: 'document absent' } });
      return true;
    }
    repondre(reponse, 200, { name: id, fields: projeter(document_.fields) });
    return true;
  }

  if (requete.method === 'PATCH') {
    const corps = await lireCorps(requete);
    let demande = {};
    try {
      demande = JSON.parse(corps || '{}');
    } catch (erreur) {
      repondre(reponse, 400, { error: { code: 400, message: 'corps illisible' } });
      return true;
    }
    const masque = url.searchParams.getAll('updateMask.fieldPaths');
    etat.appels.ecritures += 1;

    if (masque.length > 0) {
      // Mise a jour partielle : seuls les champs du masque changent. C'est ce qui
      // permet a deux personnes de modifier le meme article sans s'ecraser.
      const existant = collection.get(id);
      if (!existant) {
        repondre(reponse, 404, { error: { code: 404, message: 'document absent' } });
        return true;
      }
      masque.forEach((nom) => {
        if (demande.fields && nom in demande.fields) existant.fields[nom] = demande.fields[nom];
      });
      repondre(reponse, 200, { name: id, fields: existant.fields });
      return true;
    }

    collection.set(id, { fields: demande.fields || {} });
    repondre(reponse, 200, { name: id, fields: demande.fields || {} });
    return true;
  }

  if (requete.method === 'DELETE') {
    etat.appels.suppressions += 1;
    if (!collection.has(id)) {
      repondre(reponse, 404, { error: { code: 404, message: 'document absent' } });
      return true;
    }
    collection.delete(id);
    repondre(reponse, 200, {});
    return true;
  }

  repondre(reponse, 405, { error: { code: 405, message: `methode ${requete.method} non geree` } });
  return true;
}

module.exports = { traiter, etat, reinitialiser };
