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
  articles: new Map(), // idDocument -> { fields }
  sessions: new Map(), // refreshToken -> compteur
  panne: false, // quand vrai, toute requete Firestore repond 503
  appels: { lectures: 0, ecritures: 0, suppressions: 0, sessions: 0 },
};

function reinitialiser() {
  etat.articles.clear();
  etat.sessions.clear();
  etat.panne = false;
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

  if (chemin === '/__stub/etat') {
    if (url.searchParams.get('reinitialiser') === '1') reinitialiser();
    repondre(reponse, 200, {
      panne: etat.panne,
      nbArticles: etat.articles.size,
      appels: etat.appels,
      articles: [...etat.articles.entries()].map(([id, doc]) => ({ id, fields: doc.fields })),
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

  // On ne verifie pas la structure complete du chemin de collection, seulement que
  // la requete vise bien une collection « articles ».
  const apresArticles = chemin.split('/articles');
  if (apresArticles.length < 2) {
    repondre(reponse, 404, { error: { code: 404, message: 'collection inconnue' } });
    return true;
  }
  const reste = apresArticles[1].replace(/^\//, '');

  if (requete.method === 'GET' && reste === '') {
    etat.appels.lectures += 1;
    const documents = [...etat.articles.entries()].map(([id, doc]) => ({
      name: `projects/test/databases/(default)/documents/listes/commune/articles/${id}`,
      fields: doc.fields,
    }));
    repondre(reponse, 200, documents.length ? { documents } : {});
    return true;
  }

  const id = decodeURIComponent(reste);

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
      const existant = etat.articles.get(id);
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

    etat.articles.set(id, { fields: demande.fields || {} });
    repondre(reponse, 200, { name: id, fields: demande.fields || {} });
    return true;
  }

  if (requete.method === 'DELETE') {
    etat.appels.suppressions += 1;
    if (!etat.articles.has(id)) {
      repondre(reponse, 404, { error: { code: 404, message: 'document absent' } });
      return true;
    }
    etat.articles.delete(id);
    repondre(reponse, 200, {});
    return true;
  }

  repondre(reponse, 405, { error: { code: 405, message: `methode ${requete.method} non geree` } });
  return true;
}

module.exports = { traiter, etat, reinitialiser };
