/* Acces a Firestore par son API REST, sans SDK ni dependance.
   Ce module ne connait rien de la liste de courses : il transporte des articles.

   Modele de donnees : un document Firestore par article, dans la collection
   listes/<listeId>/articles. Un document par article et non un seul document
   contenant toute la liste : deux personnes qui cochent en meme temps modifient
   alors deux documents differents, sans s'ecraser mutuellement. Avec un document
   unique, le dernier qui ecrit gagne et le travail de l'autre est perdu.

   Expose window.CarnetSync dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  var config =
    typeof module !== 'undefined' && module.exports ? require('./firebase-config.js') : global.CarnetConfig;

  var CLE_JETON = 'carnet-de-recettes:jeton-anonyme';

  // --- Conversion entre valeurs Firestore et valeurs JavaScript --------------
  //
  // Firestore represente chaque champ par un objet type : { stringValue: 'x' },
  // { booleanValue: true }, etc. On traduit dans les deux sens.

  function versFirestore(valeur) {
    if (valeur === null || valeur === undefined) return { nullValue: null };
    if (typeof valeur === 'boolean') return { booleanValue: valeur };
    if (typeof valeur === 'number') {
      return Number.isInteger(valeur) ? { integerValue: String(valeur) } : { doubleValue: valeur };
    }
    return { stringValue: String(valeur) };
  }

  function depuisFirestore(champ) {
    if (!champ || typeof champ !== 'object') return null;
    if ('nullValue' in champ) return null;
    if ('booleanValue' in champ) return Boolean(champ.booleanValue);
    if ('integerValue' in champ) return Number(champ.integerValue);
    if ('doubleValue' in champ) return Number(champ.doubleValue);
    if ('stringValue' in champ) return champ.stringValue;
    if ('timestampValue' in champ) return champ.timestampValue;
    return null;
  }

  function champsVersObjet(champs) {
    var objet = {};
    Object.keys(champs || {}).forEach(function (nom) {
      objet[nom] = depuisFirestore(champs[nom]);
    });
    return objet;
  }

  function objetVersChamps(objet) {
    var champs = {};
    Object.keys(objet || {}).forEach(function (nom) {
      champs[nom] = versFirestore(objet[nom]);
    });
    return champs;
  }

  // --- Identifiant de document ----------------------------------------------
  //
  // Un identifiant Firestore ne peut pas contenir de barre oblique. La cle d'un
  // article (« <recetteId>::<nom> ») contient des accents, des espaces et parfois
  // des barres. On la reduit donc a un slug, auquel on ajoute une empreinte courte
  // de la cle d'origine : deux noms differents qui donneraient le meme slug
  // (« creme fraiche » et « crème fraîche ») restent malgre tout distincts.

  function empreinte(texte) {
    // djb2, suffisant pour desambiguiser des slugs.
    var h = 5381;
    for (var i = 0; i < texte.length; i += 1) {
      h = ((h << 5) + h + texte.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36);
  }

  function idDocument(cle) {
    var slug = String(cle)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .toLowerCase();
    return (slug || 'article') + '-' + empreinte(String(cle));
  }

  // --- Authentification anonyme ---------------------------------------------
  //
  // Les regles Firestore exigent une session (request.auth != null) : sans cela,
  // n'importe quel robot ayant lu la cle publique dans la page pourrait ecrire.
  // La connexion anonyme ne demande rien a l'utilisateur, elle donne juste une
  // identite. Le jeton dure une heure ; on garde le jeton de rafraichissement pour
  // en obtenir un nouveau sans recreer de compte.

  var jeton = null; // { idToken, refreshToken, expireLe }

  function lireJetonEnregistre() {
    try {
      var brut = global.localStorage && global.localStorage.getItem(CLE_JETON);
      return brut ? JSON.parse(brut) : null;
    } catch (erreur) {
      return null;
    }
  }

  function enregistrerJeton(valeur) {
    jeton = valeur;
    try {
      if (global.localStorage) global.localStorage.setItem(CLE_JETON, JSON.stringify(valeur));
    } catch (erreur) {
      /* stockage indisponible : le jeton restera en memoire pour la session */
    }
  }

  function maintenant() {
    return Date.now();
  }

  async function appelJson(url, options) {
    var reponse = await fetch(url, options);
    var texte = await reponse.text();
    var corps = null;
    try {
      corps = texte ? JSON.parse(texte) : null;
    } catch (erreur) {
      corps = null;
    }
    if (!reponse.ok) {
      var message = (corps && corps.error && corps.error.message) || `HTTP ${reponse.status}`;
      var echec = new Error(message);
      echec.statut = reponse.status;
      echec.corps = corps;
      throw echec;
    }
    return corps;
  }

  async function creerSessionAnonyme() {
    var corps = await appelJson(`${config.baseAuth}/accounts:signUp?key=${config.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    });
    enregistrerJeton({
      idToken: corps.idToken,
      refreshToken: corps.refreshToken,
      // On retire 60 s a la duree annoncee pour ne jamais utiliser un jeton expirant.
      expireLe: maintenant() + (Number(corps.expiresIn || 3600) - 60) * 1000,
    });
    return jeton.idToken;
  }

  async function rafraichirSession(refreshToken) {
    var corps = await appelJson(`${config.baseSecureToken}/token?key=${config.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    });
    enregistrerJeton({
      idToken: corps.id_token,
      refreshToken: corps.refresh_token,
      expireLe: maintenant() + (Number(corps.expires_in || 3600) - 60) * 1000,
    });
    return jeton.idToken;
  }

  async function obtenirJeton() {
    if (!jeton) jeton = lireJetonEnregistre();

    if (jeton && jeton.idToken && jeton.expireLe > maintenant()) return jeton.idToken;

    if (jeton && jeton.refreshToken) {
      try {
        return await rafraichirSession(jeton.refreshToken);
      } catch (erreur) {
        // Jeton de rafraichissement invalide (compte anonyme supprime, projet
        // reconfigure) : on repart sur une nouvelle session.
        jeton = null;
      }
    }
    return creerSessionAnonyme();
  }

  /** Efface la session locale. Utile pour les tests et en cas de reconfiguration. */
  function oublierSession() {
    jeton = null;
    try {
      if (global.localStorage) global.localStorage.removeItem(CLE_JETON);
    } catch (erreur) {
      /* sans effet */
    }
  }

  // --- Requetes Firestore ----------------------------------------------------

  function cheminCollection() {
    return `projects/${config.projectId}/databases/(default)/documents/listes/${config.listeId}/articles`;
  }

  async function requete(chemin, options) {
    var idToken = await obtenirJeton();
    var entetes = Object.assign({ Authorization: `Bearer ${idToken}` }, (options && options.headers) || {});
    return appelJson(`${config.baseFirestore}/${chemin}`, Object.assign({}, options, { headers: entetes }));
  }

  /** Lit tous les articles de la liste partagee. */
  async function lireArticles() {
    var articles = [];
    var pageSuivante = null;

    do {
      var url = `${cheminCollection()}?pageSize=300${pageSuivante ? `&pageToken=${encodeURIComponent(pageSuivante)}` : ''}`;
      var corps = await requete(url, { method: 'GET' });
      (corps && corps.documents ? corps.documents : []).forEach(function (document_) {
        var objet = champsVersObjet(document_.fields);
        // Le nom du document contient le chemin complet : on n'en garde que l'id.
        objet.idDocument = String(document_.name).split('/').pop();
        articles.push(objet);
      });
      pageSuivante = corps && corps.nextPageToken;
    } while (pageSuivante);

    return articles;
  }

  /** Cree ou remplace un article. PATCH sans masque fait un ajout ou un remplacement. */
  async function ecrireArticle(article) {
    var id = idDocument(article.cle);
    var aEcrire = Object.assign({}, article);
    delete aEcrire.idDocument;
    return requete(`${cheminCollection()}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: objetVersChamps(aEcrire) }),
    });
  }

  /**
   * Modifie certains champs d'un article, sans toucher aux autres.
   * C'est ce qui permet a deux personnes de cocher deux articles differents, ou
   * meme de modifier deux champs du meme article, sans perte.
   */
  async function modifierArticle(cle, champs) {
    var id = idDocument(cle);
    var masque = Object.keys(champs)
      .map(function (nom) {
        return `updateMask.fieldPaths=${encodeURIComponent(nom)}`;
      })
      .join('&');
    return requete(`${cheminCollection()}/${encodeURIComponent(id)}?${masque}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: objetVersChamps(champs) }),
    });
  }

  /** Supprime un article. Une suppression deja effectuee n'est pas une erreur. */
  async function supprimerArticle(cle) {
    var id = idDocument(cle);
    try {
      return await requete(`${cheminCollection()}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (erreur) {
      if (erreur.statut === 404) return null;
      throw erreur;
    }
  }

  // --- Recettes modifiees -----------------------------------------------------
  //
  // Une recette modifiee est enregistree dans la collection `recettes`, un document
  // par recette, sous la forme d'une seule chaine JSON.
  //
  // Pourquoi une chaine et non des champs Firestore : une recette est un objet
  // profondement imbrique (groupes d'ingredients, etapes, astuces, tableau de flux).
  // La representer en champs Firestore demanderait des arrayValue et mapValue
  // imbriques, donc un encodeur bien plus lourd, pour un benefice nul ici : on ne
  // fait jamais de requete sur un champ interne d'une recette, on la lit en entier.
  // Le cout assume est qu'une recette n'est pas interrogeable cote serveur.

  function cheminRecettes() {
    return `projects/${config.projectId}/databases/(default)/documents/recettes`;
  }

  /** Lit toutes les recettes modifiees. Retourne { id: recette }. */
  async function lireRecettesModifiees() {
    var corps = await requete(`${cheminRecettes()}?pageSize=300`, { method: 'GET' });
    var resultat = {};
    (corps && corps.documents ? corps.documents : []).forEach(function (document_) {
      var champs = champsVersObjet(document_.fields);
      if (!champs.json) return;
      try {
        var recette = JSON.parse(champs.json);
        if (recette && recette.id) resultat[recette.id] = recette;
      } catch (erreur) {
        // Document illisible : on l'ignore plutot que de casser le chargement.
      }
    });
    return resultat;
  }

  /** Enregistre une recette modifiee, en remplacant la precedente version. */
  async function ecrireRecette(recette) {
    var id = idDocument(recette.id);
    return requete(`${cheminRecettes()}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: objetVersChamps({
          recetteId: recette.id,
          json: JSON.stringify(recette),
          modifieLe: new Date().toISOString(),
        }),
      }),
    });
  }

  /** Supprime la version modifiee d'une recette, ce qui restaure l'originale. */
  async function supprimerRecette(recetteId) {
    var id = idDocument(recetteId);
    try {
      return await requete(`${cheminRecettes()}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (erreur) {
      if (erreur.statut === 404) return null;
      throw erreur;
    }
  }

  // --- Semainier ---------------------------------------------------------------
  //
  // Un document par creneau de repas, dans semainiers/<semainierId>/creneaux.
  // Meme raison que pour les articles de la liste : deux personnes qui posent deux
  // plats differents au meme moment modifient deux documents distincts. Avec un
  // document unique par semaine, le dernier qui ecrit effacerait le plat de l'autre.
  //
  // La cle d'un creneau est « 2026-08-03::dejeuner » : elle porte la date et le
  // moment, donc un creneau vide n'est pas un document vide, c'est un document
  // absent. Vider un creneau est une suppression.

  function cheminCreneaux() {
    return `projects/${config.projectId}/databases/(default)/documents/semainiers/${config.semainierId}/creneaux`;
  }

  /** Lit tous les creneaux planifies. */
  async function lireCreneaux() {
    var creneaux = [];
    var pageSuivante = null;

    do {
      var url = `${cheminCreneaux()}?pageSize=300${pageSuivante ? `&pageToken=${encodeURIComponent(pageSuivante)}` : ''}`;
      var corps = await requete(url, { method: 'GET' });
      (corps && corps.documents ? corps.documents : []).forEach(function (document_) {
        var objet = champsVersObjet(document_.fields);
        objet.idDocument = String(document_.name).split('/').pop();
        creneaux.push(objet);
      });
      pageSuivante = corps && corps.nextPageToken;
    } while (pageSuivante);

    return creneaux;
  }

  /** Pose un plat sur un creneau, en remplacant ce qui s'y trouvait. */
  async function ecrireCreneau(creneau) {
    var id = idDocument(creneau.cle);
    var aEcrire = Object.assign({}, creneau);
    delete aEcrire.idDocument;
    return requete(`${cheminCreneaux()}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: objetVersChamps(aEcrire) }),
    });
  }

  /** Vide un creneau. Un creneau deja vide n'est pas une erreur. */
  async function supprimerCreneau(cle) {
    var id = idDocument(cle);
    try {
      return await requete(`${cheminCreneaux()}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (erreur) {
      if (erreur.statut === 404) return null;
      throw erreur;
    }
  }

  // --- Placard : les ingredients qu'on a toujours -------------------------------
  //
  // Un document par ingredient, dans `placard`, comme partout ailleurs : deux
  // personnes qui ajoutent chacune un ingredient au placard modifient deux documents
  // distincts, et aucune des deux n'ecrase l'autre.
  //
  // Pourquoi partage et non local : le placard decrit la maison, pas l'appareil. S'il
  // etait local, l'un curerait sa liste et l'autre recevrait quand meme le sel et la
  // farine dans ses courses. C'est exactement le defaut corrige sur le semainier.

  function cheminPlacard() {
    return `projects/${config.projectId}/databases/(default)/documents/placard`;
  }

  /** Lit tout le placard. Retourne une liste de { cle, nom }. */
  async function lirePlacard() {
    var entrees = [];
    var pageSuivante = null;

    do {
      var url = `${cheminPlacard()}?pageSize=300${pageSuivante ? `&pageToken=${encodeURIComponent(pageSuivante)}` : ''}`;
      var corps = await requete(url, { method: 'GET' });
      (corps && corps.documents ? corps.documents : []).forEach(function (document_) {
        var objet = champsVersObjet(document_.fields);
        objet.idDocument = String(document_.name).split('/').pop();
        entrees.push(objet);
      });
      pageSuivante = corps && corps.nextPageToken;
    } while (pageSuivante);

    return entrees;
  }

  async function ecrirePlacard(entree) {
    var id = idDocument(entree.cle);
    var aEcrire = Object.assign({}, entree);
    delete aEcrire.idDocument;
    return requete(`${cheminPlacard()}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: objetVersChamps(aEcrire) }),
    });
  }

  async function supprimerPlacard(cle) {
    var id = idDocument(cle);
    try {
      return await requete(`${cheminPlacard()}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (erreur) {
      if (erreur.statut === 404) return null;
      throw erreur;
    }
  }

  // --- Photos des recettes -----------------------------------------------------
  //
  // Un document par recette dans `photos`, avec deux tailles dans le meme document :
  // `vignette` (cote 320 px) et `grande` (cote 1200 px), toutes deux en data URL.
  //
  // Pourquoi deux tailles et pourquoi un masque de lecture : le livre affiche une
  // vingtaine de vignettes d'un coup. Lire les documents entiers ferait descendre
  // autant de grandes images, soit plusieurs megaoctets pour afficher des cases de
  // 320 px. L'API REST accepte `mask.fieldPaths` : la liste ne demande donc que les
  // vignettes, et la grande image n'est lue qu'a l'ouverture d'une fiche.
  //
  // Pourquoi pas Firebase Storage : il faudrait le SDK ou une seconde API a signer,
  // alors que Firestore est deja en place et qu'une photo de plat compressee tient
  // largement sous la limite de 1 Mio par document.

  function cheminPhotos() {
    return `projects/${config.projectId}/databases/(default)/documents/photos`;
  }

  /** Lit uniquement les vignettes. Retourne { recetteId: dataUrl }. */
  async function lireVignettes() {
    var resultat = {};
    var pageSuivante = null;

    do {
      var url =
        `${cheminPhotos()}?pageSize=300&mask.fieldPaths=recetteId&mask.fieldPaths=vignette` +
        (pageSuivante ? `&pageToken=${encodeURIComponent(pageSuivante)}` : '');
      var corps = await requete(url, { method: 'GET' });
      (corps && corps.documents ? corps.documents : []).forEach(function (document_) {
        var champs = champsVersObjet(document_.fields);
        if (champs.recetteId && champs.vignette) resultat[champs.recetteId] = champs.vignette;
      });
      pageSuivante = corps && corps.nextPageToken;
    } while (pageSuivante);

    return resultat;
  }

  /** Lit la grande image d'une recette. Rend null si la recette n'a pas de photo. */
  async function lireGrandePhoto(recetteId) {
    var id = idDocument('photo::' + recetteId);
    try {
      var corps = await requete(
        `${cheminPhotos()}/${encodeURIComponent(id)}?mask.fieldPaths=grande`,
        { method: 'GET' }
      );
      var champs = champsVersObjet(corps && corps.fields);
      return champs.grande || null;
    } catch (erreur) {
      if (erreur.statut === 404) return null;
      throw erreur;
    }
  }

  /** Enregistre les deux tailles d'une photo. */
  async function ecrirePhoto(recetteId, vignette, grande) {
    var id = idDocument('photo::' + recetteId);
    return requete(`${cheminPhotos()}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: objetVersChamps({
          recetteId: recetteId,
          vignette: vignette,
          grande: grande,
          modifieLe: new Date().toISOString(),
        }),
      }),
    });
  }

  /** Retire la photo d'une recette. */
  async function supprimerPhoto(recetteId) {
    var id = idDocument('photo::' + recetteId);
    try {
      return await requete(`${cheminPhotos()}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (erreur) {
      if (erreur.statut === 404) return null;
      throw erreur;
    }
  }

  var api = {
    idDocument: idDocument,
    cheminRecettes: cheminRecettes,
    lireRecettesModifiees: lireRecettesModifiees,
    ecrireRecette: ecrireRecette,
    supprimerRecette: supprimerRecette,
    versFirestore: versFirestore,
    depuisFirestore: depuisFirestore,
    champsVersObjet: champsVersObjet,
    objetVersChamps: objetVersChamps,
    obtenirJeton: obtenirJeton,
    oublierSession: oublierSession,
    lireArticles: lireArticles,
    ecrireArticle: ecrireArticle,
    modifierArticle: modifierArticle,
    supprimerArticle: supprimerArticle,
    cheminCollection: cheminCollection,
    cheminCreneaux: cheminCreneaux,
    lireCreneaux: lireCreneaux,
    ecrireCreneau: ecrireCreneau,
    supprimerCreneau: supprimerCreneau,
    cheminPhotos: cheminPhotos,
    lirePlacard: lirePlacard,
    ecrirePlacard: ecrirePlacard,
    supprimerPlacard: supprimerPlacard,
    lireVignettes: lireVignettes,
    lireGrandePhoto: lireGrandePhoto,
    ecrirePhoto: ecrirePhoto,
    supprimerPhoto: supprimerPhoto,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.CarnetSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
