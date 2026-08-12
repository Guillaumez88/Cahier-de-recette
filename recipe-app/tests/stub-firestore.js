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
  sessions: new Map(), // refreshToken -> compteur
  panne: false, // quand vrai, toute requete Firestore repond 503
  // Quand vrai, seule la collection `recettes` est refusee, comme le ferait un
  // projet dont les regles de securite n'ont pas encore ete republiees.
  refuserRecettes: false,
  appels: { lectures: 0, ecritures: 0, suppressions: 0, sessions: 0 },
};

function reinitialiser() {
  etat.articles.clear();
  etat.recettes.clear();
  etat.creneaux.clear();
  etat.photos.clear();
  etat.placard.clear();
  etat.livres.clear();
  etat.illustrations.clear();
  etat.sessions.clear();
  etat.panne = false;
  etat.refuserRecettes = false;
  etat.appels = { lectures: 0, ecritures: 0, suppressions: 0, sessions: 0 };
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
    if (url.searchParams.get('reinitialiser') === '1') reinitialiser();
    repondre(reponse, 200, {
      panne: etat.panne,
      refuserRecettes: etat.refuserRecettes,
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
    await lireCorps(requete);
    if (!url.searchParams.get('key')) {
      repondre(reponse, 400, { error: { code: 400, message: 'API key manquante' } });
      return true;
    }
    etat.appels.sessions += 1;
    const refreshToken = `refresh-${etat.appels.sessions}`;
    etat.sessions.set(refreshToken, 0);
    repondre(reponse, 200, {
      idToken: `jeton-${etat.appels.sessions}`,
      refreshToken,
      expiresIn: '3600',
      localId: `anonyme-${etat.appels.sessions}`,
    });
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
    repondre(reponse, 200, {
      id_token: `${refreshToken}-renouvele-${n}`,
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
  ['articles', 'illustrations', 'recettes', 'creneaux', 'photos', 'placard', 'livres'].forEach((nom) => {
    if (collection) return;
    // Deux formes possibles : le chemin de la collection, qui finit par son nom, et
    // celui d'un document, ou le nom est suivi de l'identifiant. On coupe sur la
    // derniere occurrence : un identifiant qui contiendrait le nom de sa collection
    // ferait sinon lire une requete de document comme une requete de collection.
    if (chemin.endsWith('/' + nom)) {
      collection = etat[nom];
      reste = '';
      return;
    }
    const marque = '/' + nom + '/';
    const position = chemin.lastIndexOf(marque);
    if (position !== -1) {
      collection = etat[nom];
      reste = chemin.slice(position + marque.length);
    }
  });

  if (!collection) {
    repondre(reponse, 404, { error: { code: 404, message: 'collection inconnue' } });
    return true;
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
