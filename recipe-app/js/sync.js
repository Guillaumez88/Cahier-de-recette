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
  // La session d'un compte, quand quelqu'un est connecté. Rangée à part de la session
  // anonyme : se déconnecter doit rendre le carnet lisible, pas inaccessible.
  var CLE_COMPTE = 'carnet-de-recettes:session-compte';

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
    // Les tableaux servent aux manifestes de partage, et à eux seuls pour l'instant.
    // Les règles Firestore savent y chercher un identifiant (`hasAny`), ce qu'elles ne
    // sauraient pas faire dans une chaîne JSON sans se prêter à des faux positifs.
    if (Array.isArray(valeur)) {
      return { arrayValue: { values: valeur.map(versFirestore) } };
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
    if ('arrayValue' in champ) return ((champ.arrayValue && champ.arrayValue.values) || []).map(depuisFirestore);
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

  var jeton = null; // { idToken, refreshToken, expireLe } : la session anonyme
  // { idToken, refreshToken, expireLe, uid, email } : la session d'un compte. Quand
  // elle existe, c'est elle qui signe toutes les requêtes : les règles ne voient plus
  // un visiteur anonyme mais une personne.
  var session = undefined;

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

  // --- Session d'un compte ----------------------------------------------------
  //
  // Même API REST que la session anonyme (Identity Toolkit), donc aucune dépendance
  // nouvelle : accounts:signUp pour créer, accounts:signInWithPassword pour ouvrir,
  // le jeton de renouvellement pour tenir dans le temps.

  function lireSessionEnregistree() {
    if (session !== undefined) return session;
    try {
      var brut = global.localStorage && global.localStorage.getItem(CLE_COMPTE);
      session = brut ? JSON.parse(brut) : null;
    } catch (erreur) {
      session = null;
    }
    return session;
  }

  function enregistrerSession(valeur) {
    session = valeur;
    try {
      if (!global.localStorage) return;
      if (valeur) global.localStorage.setItem(CLE_COMPTE, JSON.stringify(valeur));
      else global.localStorage.removeItem(CLE_COMPTE);
    } catch (erreur) {
      /* stockage indisponible : la session ne vaudra que pour cet onglet */
    }
  }

  /** Le compte connecté, ou null. Synchrone : c'est l'état d'écran. */
  function compteCourant() {
    var s = lireSessionEnregistree();
    return s ? { uid: s.uid, email: s.email } : null;
  }

  function depuisIdentity(corps) {
    return {
      idToken: corps.idToken,
      refreshToken: corps.refreshToken,
      expireLe: maintenant() + (Number(corps.expiresIn || 3600) - 60) * 1000,
      uid: corps.localId,
      email: corps.email,
    };
  }

  /** Crée un compte et l'ouvre. L'appelant traite EMAIL_EXISTS et WEAK_PASSWORD. */
  async function creerCompte(email, motDePasse) {
    var corps = await appelJson(`${config.baseAuth}/accounts:signUp?key=${config.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: motDePasse, returnSecureToken: true }),
    });
    enregistrerSession(depuisIdentity(corps));
    return compteCourant();
  }

  /** Ouvre une session. L'appelant traite INVALID_LOGIN_CREDENTIALS. */
  async function connecter(email, motDePasse) {
    var corps = await appelJson(`${config.baseAuth}/accounts:signInWithPassword?key=${config.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: motDePasse, returnSecureToken: true }),
    });
    enregistrerSession(depuisIdentity(corps));
    return compteCourant();
  }

  /**
   * Ferme la session du compte. La session anonyme reprend la main : le carnet reste
   * lisible, il n'est plus modifiable. Rien n'est supprimé côté serveur.
   */
  function deconnecter() {
    enregistrerSession(null);
  }

  /** Envoie un courriel de réinitialisation du mot de passe. */
  async function reinitialiserMotDePasse(email) {
    return appelJson(`${config.baseAuth}/accounts:sendOobCode?key=${config.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: email }),
    });
  }

  /**
   * Le jeton du compte connecté, renouvelé si besoin.
   *
   * Un renouvellement refusé (mot de passe changé ailleurs, compte supprimé) ferme la
   * session plutôt que de boucler : l'écran demandera de se reconnecter.
   */
  async function jetonDuCompte() {
    var s = lireSessionEnregistree();
    if (!s) return null;
    if (s.idToken && s.expireLe > maintenant()) return s.idToken;
    try {
      var corps = await appelJson(`${config.baseSecureToken}/token?key=${config.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(s.refreshToken)}`,
      });
      enregistrerSession({
        idToken: corps.id_token,
        refreshToken: corps.refresh_token,
        expireLe: maintenant() + (Number(corps.expires_in || 3600) - 60) * 1000,
        uid: corps.user_id || s.uid,
        email: s.email,
      });
      return session.idToken;
    } catch (erreur) {
      enregistrerSession(null);
      return null;
    }
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
  //
  // Toutes les collections de contenu vivent sous le foyer : `foyers/<id>/recettes`,
  // `foyers/<id>/articles`, et ainsi de suite. Un seul préfixe, posé une fois après la
  // connexion, cloisonne donc tout le carnet. Tant qu'il n'est pas posé, aucune
  // lecture de contenu n'a de sens : l'application ne sait pas encore de quel foyer
  // elle parle.

  var foyerCourant = null;

  /** Désigne le foyer dont on lit et écrit les données. */
  function definirFoyer(id) {
    foyerCourant = id || null;
  }

  function foyer() {
    return foyerCourant;
  }

  function racine() {
    return `projects/${config.projectId}/databases/(default)/documents`;
  }

  /** Le chemin d'une collection du foyer courant. Lève si aucun foyer n'est désigné. */
  function dansLeFoyer(nom) {
    if (!foyerCourant) {
      var erreur = new Error('Aucun foyer désigné : impossible de lire ou d’écrire « ' + nom + ' ».');
      erreur.sansFoyer = true;
      throw erreur;
    }
    return `${racine()}/foyers/${encodeURIComponent(foyerCourant)}/${nom}`;
  }

  function cheminCollection() {
    return dansLeFoyer('articles');
  }

  // --- Mode lecture seule ----------------------------------------------------
  //
  // Un verrou local, posé par acces.js quand l'appareil n'est pas un appareil de la
  // maison. Il ne remplace pas les règles Firestore, qui refusent de toute façon
  // l'écriture à un appareil non inscrit : il évite qu'un bouton oublié parte quand
  // même, et rend l'échec lisible plutôt qu'un 403 dans la console.
  var lectureSeule = false;

  function definirLectureSeule(valeur) {
    lectureSeule = Boolean(valeur);
  }

  function estLectureSeule() {
    return lectureSeule;
  }

  async function requete(chemin, options) {
    var methode = (options && options.method) || 'GET';
    if (lectureSeule && methode !== 'GET') {
      var refus = new Error('Cet appareil est en lecture seule : rien n’a été envoyé.');
      refus.statut = 403;
      refus.lectureSeule = true;
      throw refus;
    }
    // Signée par le compte si quelqu'un est connecté, par la session anonyme sinon.
    var idToken = (await jetonDuCompte()) || (await obtenirJeton());
    var entetes = Object.assign({ Authorization: `Bearer ${idToken}` }, (options && options.headers) || {});
    return appelJson(`${config.baseFirestore}/${chemin}`, Object.assign({}, options, { headers: entetes }));
  }

  // --- Foyers, membres, comptes ------------------------------------------------
  //
  // Un foyer possède les données. Son identifiant est celui du compte qui l'a créé :
  // pas de tirage aléatoire, pas de collision, et une règle triviale à écrire
  // (« tu peux créer le foyer qui porte ton identifiant »).
  //
  // Un membre est un document du foyer, nommé par l'identifiant du compte, portant son
  // rôle : « modification » ou « lecture ». Le fondateur s'inscrit lui-même en
  // modification à la création ; les suivants sont inscrits par un membre qui peut
  // modifier. Il n'y a donc aucun code partagé à retenir nulle part.
  //
  // `utilisateurs/{uid}` dit à quel foyer un compte appartient : c'est la première
  // chose lue à l'ouverture, avant de savoir quoi afficher.

  function cheminUtilisateurs() {
    return `${racine()}/utilisateurs`;
  }

  function cheminFoyers() {
    return `${racine()}/foyers`;
  }

  function cheminMembres(foyerId) {
    return `${cheminFoyers()}/${encodeURIComponent(foyerId)}/membres`;
  }

  /** La fiche du compte connecté : son foyer, son adresse. Null si elle n'existe pas. */
  async function lireUtilisateur(uid) {
    try {
      var corps = await requete(`${cheminUtilisateurs()}/${encodeURIComponent(uid)}`, { method: 'GET' });
      return champsVersObjet((corps && corps.fields) || {});
    } catch (erreur) {
      if (erreur.statut === 404) return null;
      throw erreur;
    }
  }

  async function ecrireUtilisateur(uid, donnees) {
    return requete(`${cheminUtilisateurs()}/${encodeURIComponent(uid)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: objetVersChamps(donnees) }),
    });
  }

  /** Le membre d'un foyer, avec son rôle. Null s'il n'en est pas. */
  async function lireMembre(foyerId, uid) {
    try {
      var corps = await requete(`${cheminMembres(foyerId)}/${encodeURIComponent(uid)}`, { method: 'GET' });
      return champsVersObjet((corps && corps.fields) || {});
    } catch (erreur) {
      if (erreur.statut === 404 || erreur.statut === 403) return null;
      throw erreur;
    }
  }

  /** Tous les membres d'un foyer, pour l'écran qui les gère. */
  async function lireMembres(foyerId) {
    var corps = await requete(`${cheminMembres(foyerId)}?pageSize=100`, { method: 'GET' });
    return ((corps && corps.documents) || []).map(function (document_) {
      var champs = champsVersObjet(document_.fields);
      champs.uid = String(document_.name).split('/').pop();
      return champs;
    });
  }

  async function ecrireMembre(foyerId, uid, donnees) {
    return requete(`${cheminMembres(foyerId)}/${encodeURIComponent(uid)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: objetVersChamps(donnees) }),
    });
  }

  async function supprimerMembre(foyerId, uid) {
    return requete(`${cheminMembres(foyerId)}/${encodeURIComponent(uid)}`, { method: 'DELETE' });
  }

  /**
   * Crée le foyer du compte connecté et l'y inscrit en modification.
   *
   * Trois écritures, dans cet ordre : le foyer, le membre fondateur, puis la fiche
   * d'utilisateur. Si la deuxième échoue, le foyer existe sans membre et personne n'y
   * touche : c'est réparable. L'inverse laisserait un compte pointant vers un foyer
   * absent, ce qui l'enfermerait dehors.
   */
  async function creerFoyer(nom) {
    var courant = compteCourant();
    if (!courant) throw new Error('Aucun compte connecté.');
    var foyerId = courant.uid;
    var maintenantIso = new Date().toISOString();

    // Le verrou d'interface est levé le temps de l'amorçage : ce sont les seules
    // écritures qu'un compte encore sans foyer doit pouvoir tenter, sans quoi il ne
    // pourrait jamais en avoir un. Le serveur, lui, ne laisse créer que le foyer qui
    // porte l'identifiant du compte.
    var avant = lectureSeule;
    lectureSeule = false;
    try {
      return await amorcerFoyer(foyerId, courant, nom, maintenantIso);
    } finally {
      lectureSeule = avant;
    }
  }

  async function amorcerFoyer(foyerId, courant, nom, maintenantIso) {
    await requete(`${cheminFoyers()}/${encodeURIComponent(foyerId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: objetVersChamps({
          nom: String(nom || 'Ma cuisine'),
          proprietaire: courant.uid,
          creeLe: maintenantIso,
        }),
      }),
    });
    await ecrireMembre(foyerId, courant.uid, {
      email: courant.email || '',
      role: 'modification',
      ajouteLe: maintenantIso,
    });
    await ecrireUtilisateur(courant.uid, { email: courant.email || '', foyer: foyerId });
    definirFoyer(foyerId);
    return foyerId;
  }

  /**
   * Crée un compte pour quelqu'un d'autre et l'inscrit dans le foyer courant.
   *
   * Le détour par une session temporaire est nécessaire : l'API d'authentification ne
   * sait créer un compte qu'en ouvrant sa session. On garde donc la session courante,
   * on crée le compte, on remet la session d'origine, et c'est elle qui écrit le
   * document de membre. Sans cela, le fondateur se retrouverait connecté à la place du
   * membre qu'il vient d'inscrire.
   */
  async function inscrireMembre(email, motDePasse, role) {
    var courant = compteCourant();
    var foyerId = foyer();
    if (!courant || !foyerId) throw new Error('Aucun foyer courant.');

    var sessionDuFondateur = lireSessionEnregistree();
    var corps;
    try {
      corps = await appelJson(`${config.baseAuth}/accounts:signUp?key=${config.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: motDePasse, returnSecureToken: true }),
      });
    } finally {
      enregistrerSession(sessionDuFondateur);
    }

    await ecrireMembre(foyerId, corps.localId, {
      email: String(email || ''),
      role: role === 'lecture' ? 'lecture' : 'modification',
      ajouteLe: new Date().toISOString(),
    });
    // La fiche d'utilisateur du nouveau membre, pour qu'il trouve son foyer en se
    // connectant. Écrite par le fondateur : les règles l'autorisent à condition que le
    // foyer désigné soit le sien.
    await ecrireUtilisateur(corps.localId, { email: String(email || ''), foyer: foyerId });
    return { uid: corps.localId, email: email };
  }

  /** L'identifiant qui signe les requêtes : celui du compte, sinon celui de la session anonyme. */
  function uidCourant() {
    var s = lireSessionEnregistree();
    if (s && s.uid) return s.uid;
    if (!jeton) jeton = lireJetonEnregistre();
    if (!jeton || !jeton.idToken) return null;
    try {
      var charge = String(jeton.idToken).split('.')[1];
      // base64url vers base64, puis décodage : pas de dépendance pour lire une charge
      // utile JWT dont on ne vérifie rien, la vérification est faite par le serveur.
      var base64 = charge.replace(/-/g, '+').replace(/_/g, '/');
      var texte = typeof atob === 'function'
        ? atob(base64)
        : Buffer.from(base64, 'base64').toString('binary');
      var objet = JSON.parse(decodeURIComponent(escape(texte)));
      return objet.user_id || objet.sub || null;
    } catch (erreur) {
      return null;
    }
  }

  // --- Liste de courses --------------------------------------------------------

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

  // --- Annuaire, partages, boîte de réception -----------------------------------
  //
  // Partager, c'est ouvrir en lecture une partie de son foyer à un compte d'ailleurs.
  // Trois objets, et aucune copie de recette :
  //
  //   annuaire/{email}                   l'identifiant du compte à cette adresse
  //   foyers/{foyer}/partages/{uid}      ce que ce foyer ouvre à ce compte
  //   utilisateurs/{uid}/recus/{foyer}   ce que ce compte a reçu, et de qui
  //
  // **Pourquoi un manifeste et pas une requête.** Les règles Firestore ne filtrent pas
  // une requête de collection : un bénéficiaire ne peut pas demander « les recettes du
  // livre X du foyer Y ». Il lit donc chaque recette par son identifiant, et la règle
  // vérifie que cet identifiant figure dans le manifeste du partage. Conséquence
  // assumée : un livre partagé ne s'élargit pas tout seul quand une recette y entre,
  // il faut repartager, ce qui réécrit le manifeste.
  //
  // **Pourquoi le manifeste est rangé sous le foyer, et nommé par le bénéficiaire.**
  // La règle qui autorise la lecture doit retrouver ce document sans que personne lui
  // passe son identifiant : elle le reconstruit à partir du foyer visé et de l'identité
  // de celui qui lit. Et le foyer, lui, peut énumérer ses propres partages, ce qu'une
  // collection à la racine ne lui aurait pas permis sans un index supplémentaire.
  // Corollaire : un foyer n'a qu'un partage par bénéficiaire, qui liste tout.
  //
  // **Pourquoi une boîte de réception** : le bénéficiaire ne peut pas parcourir les
  // foyers du monde pour trouver ce qu'on lui a donné. Le partageur dépose donc un
  // petit document chez lui, dans une sous-collection qui lui appartient.

  function cheminAnnuaire() {
    return `${racine()}/annuaire`;
  }

  function cheminPartages(foyerId) {
    return `${racine()}/foyers/${encodeURIComponent(foyerId)}/partages`;
  }

  function cheminRecus(uid) {
    return `${cheminUtilisateurs()}/${encodeURIComponent(uid)}/recus`;
  }

  /**
   * Normalise une adresse pour en faire un identifiant de document.
   *
   * Minuscules et espaces retirés : « Marie@Exemple.fr » et « marie@exemple.fr » sont
   * le même compte. Les barres obliques sont refusées, elles couperaient le chemin.
   */
  function cleAnnuaire(email) {
    var propre = String(email || '').trim().toLowerCase();
    if (!propre || propre.indexOf('/') !== -1) return null;
    return propre;
  }

  /**
   * Inscrit le compte connecté dans l'annuaire, pour qu'on puisse le trouver.
   *
   * Le verrou de lecture seule est levé le temps de cette écriture : il protège le
   * contenu d'un foyer, or cette fiche n'appartient à aucun foyer, elle appartient au
   * compte. Sans cela, un membre inscrit en lecture ne serait jamais trouvable, et
   * personne ne pourrait rien lui partager.
   */
  async function inscrireAnnuaire() {
    var courant = compteCourant();
    if (!courant || !courant.email) return null;
    var cle = cleAnnuaire(courant.email);
    if (!cle) return null;
    var avant = lectureSeule;
    lectureSeule = false;
    try {
      return await requete(`${cheminAnnuaire()}/${encodeURIComponent(cle)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: objetVersChamps({ uid: courant.uid, email: courant.email }) }),
      });
    } finally {
      lectureSeule = avant;
    }
  }

  /** L'identifiant du compte qui porte cette adresse, ou null s'il n'y en a pas. */
  async function chercherDansAnnuaire(email) {
    var cle = cleAnnuaire(email);
    if (!cle) return null;
    try {
      var corps = await requete(`${cheminAnnuaire()}/${encodeURIComponent(cle)}`, { method: 'GET' });
      return champsVersObjet((corps && corps.fields) || {});
    } catch (erreur) {
      if (erreur.statut === 404) return null;
      throw erreur;
    }
  }

  /** Le partage qu'un foyer ouvre à un compte, ou null. */
  async function lirePartage(foyerId, uid) {
    try {
      var corps = await requete(`${cheminPartages(foyerId)}/${encodeURIComponent(uid)}`, {
        method: 'GET',
      });
      var champs = champsVersObjet((corps && corps.fields) || {});
      champs.recettes = champs.recettes || [];
      champs.livres = champs.livres || [];
      return champs;
    } catch (erreur) {
      if (erreur.statut === 404 || erreur.statut === 403) return null;
      throw erreur;
    }
  }

  /**
   * Écrit le manifeste d'un partage.
   *
   * Les deux listes sont de vrais tableaux Firestore : c'est ce que les règles savent
   * interroger (`recettes.hasAny([id])`) pour décider si un bénéficiaire a le droit de
   * lire un document précis.
   */
  async function ecrirePartage(foyerId, uid, donnees) {
    return requete(`${cheminPartages(foyerId)}/${encodeURIComponent(uid)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: objetVersChamps({
          foyer: foyerId,
          beneficiaire: uid,
          emailBeneficiaire: String(donnees.emailBeneficiaire || ''),
          recettes: (donnees.recettes || []).map(String),
          livres: (donnees.livres || []).map(String),
          // Ce que les règles comparent : les noms de documents, dérivés des
          // identifiants, pour les recettes, leurs photos, leurs illustrations et les
          // livres. Les deux listes ci-dessus, elles, servent aux écrans.
          documents: documentsOuverts(donnees.recettes || [], donnees.livres || []),
          modifieLe: new Date().toISOString(),
        }),
      }),
    });
  }

  async function supprimerPartage(foyerId, uid) {
    try {
      return await requete(`${cheminPartages(foyerId)}/${encodeURIComponent(uid)}`, {
        method: 'DELETE',
      });
    } catch (erreur) {
      if (erreur.statut === 404) return null;
      throw erreur;
    }
  }

  /**
   * Les noms de documents qu'un manifeste ouvre.
   *
   * Une recette partagée ouvre trois documents : la recette, sa photo et ses
   * illustrations d'étapes. Les trois portent des noms différents, dérivés du même
   * identifiant de recette, et les règles ne savent pas les recalculer : c'est donc ici
   * qu'on les énumère, une fois, au moment du partage.
   */
  function documentsOuverts(recettes, livres) {
    var noms = [];
    (recettes || []).forEach(function (recetteId) {
      noms.push(idDocument(recetteId));
      noms.push(idDocument('photo::' + recetteId));
      noms.push(idDocument('etapes::' + recetteId));
    });
    (livres || []).forEach(function (livreId) {
      noms.push(idDocument(livreId));
    });
    return noms;
  }

  /** Tous les partages ouverts par un foyer, pour l'écran qui les gère. */
  async function lirePartages(foyerId) {
    var corps = await requete(`${cheminPartages(foyerId)}?pageSize=100`, { method: 'GET' });
    return ((corps && corps.documents) || []).map(function (document_) {
      var champs = champsVersObjet(document_.fields);
      champs.beneficiaire = champs.beneficiaire || String(document_.name).split('/').pop();
      champs.recettes = champs.recettes || [];
      champs.livres = champs.livres || [];
      return champs;
    });
  }

  /** Dépose (ou met à jour) l'avis de partage dans la boîte du bénéficiaire. */
  async function ecrireRecu(uid, foyerId, donnees) {
    return requete(`${cheminRecus(uid)}/${encodeURIComponent(foyerId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: objetVersChamps({
          foyer: foyerId,
          nomFoyer: String(donnees.nomFoyer || ''),
          emailPartageur: String(donnees.emailPartageur || ''),
          modifieLe: new Date().toISOString(),
        }),
      }),
    });
  }

  async function supprimerRecu(uid, foyerId) {
    try {
      return await requete(`${cheminRecus(uid)}/${encodeURIComponent(foyerId)}`, { method: 'DELETE' });
    } catch (erreur) {
      if (erreur.statut === 404) return null;
      throw erreur;
    }
  }

  /** Ce que le compte connecté a reçu : un avis par foyer partageur. */
  async function lireRecus() {
    var courant = compteCourant();
    if (!courant) return [];
    var corps = await requete(`${cheminRecus(courant.uid)}?pageSize=100`, { method: 'GET' });
    return ((corps && corps.documents) || []).map(function (document_) {
      var champs = champsVersObjet(document_.fields);
      champs.foyer = champs.foyer || String(document_.name).split('/').pop();
      return champs;
    });
  }

  // --- Lire chez les autres -----------------------------------------------------
  //
  // Un bénéficiaire lit document par document, hors de son propre foyer. Ces fonctions
  // ne passent donc pas par `dansLeFoyer` : le foyer est celui qu'on nomme.

  function cheminDuFoyer(foyerId, nom) {
    return `${racine()}/foyers/${encodeURIComponent(foyerId)}/${nom}`;
  }

  /**
   * Une recette d'un autre foyer, lue par son identifiant. Null si elle est fermée.
   *
   * Le nom du document n'est pas l'identifiant de la recette mais son dérivé
   * (`idDocument`), comme partout ailleurs : c'est ce nom-là que le manifeste liste et
   * que les règles comparent.
   */
  async function lireRecetteDeFoyer(foyerId, recetteId) {
    try {
      var corps = await requete(
        `${cheminDuFoyer(foyerId, 'recettes')}/${encodeURIComponent(idDocument(recetteId))}`,
        { method: 'GET' }
      );
      var champs = champsVersObjet((corps && corps.fields) || {});
      return champs.json ? JSON.parse(champs.json) : null;
    } catch (erreur) {
      if (erreur.statut === 404 || erreur.statut === 403) return null;
      throw erreur;
    }
  }

  /** Un livre d'un autre foyer. Null s'il est fermé. */
  async function lireLivreDeFoyer(foyerId, livreId) {
    try {
      var corps = await requete(
        `${cheminDuFoyer(foyerId, 'livres')}/${encodeURIComponent(idDocument(livreId))}`,
        { method: 'GET' }
      );
      return champsVersObjet((corps && corps.fields) || {});
    } catch (erreur) {
      if (erreur.statut === 404 || erreur.statut === 403) return null;
      throw erreur;
    }
  }

  /** La grande photo d'une recette d'un autre foyer. Null si absente ou fermée. */
  async function lirePhotoDeFoyer(foyerId, recetteId) {
    try {
      var corps = await requete(
        `${cheminDuFoyer(foyerId, 'photos')}/${encodeURIComponent(idDocument('photo::' + recetteId))}` +
          '?mask.fieldPaths=grande',
        { method: 'GET' }
      );
      var champs = champsVersObjet((corps && corps.fields) || {});
      return champs.grande || null;
    } catch (erreur) {
      if (erreur.statut === 404 || erreur.statut === 403) return null;
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
    return dansLeFoyer('recettes');
  }

  /** Lit toutes les recettes modifiees. Retourne { id: recette }. */
  async function lireRecettesModifiees() {
    var resultat = {};
    var pageSuivante = null;

    // La pagination n'est pas theorique depuis la bibliotheque : une seule page de
    // 300 documents suffisait aux recettes modifiees a la main, mais les recettes
    // rattachees a un livre vivent dans la meme collection. Sans cette boucle, la
    // 301e recette disparaitrait de l'application sans le moindre message.
    do {
      var url = `${cheminRecettes()}?pageSize=300${pageSuivante ? `&pageToken=${encodeURIComponent(pageSuivante)}` : ''}`;
      var corps = await requete(url, { method: 'GET' });
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
      pageSuivante = corps && corps.nextPageToken;
    } while (pageSuivante);

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
    return dansLeFoyer('creneaux');
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
    return dansLeFoyer('placard');
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

  // --- Bibliotheque : les livres de cuisine ------------------------------------
  //
  // Un livre est une etagere : un titre, un theme, et rien d'autre. Il ne porte pas
  // la liste de ses recettes, c'est chaque recette qui nomme son livre dans son
  // propre document. Deux raisons : une recette rattachee a un livre est ecrite au
  // meme endroit qu'une recette ajoutee a la main, donc rien du mecanisme existant
  // ne change ; et deux appareils qui rattachent chacun une recette au meme livre
  // modifient deux documents distincts, sans s'ecraser.

  function cheminLivres() {
    return dansLeFoyer('livres');
  }

  /** Lit toute la bibliotheque. Retourne une liste de { id, titre, theme, auteur }. */
  async function lireLivres() {
    var livres = [];
    var pageSuivante = null;

    do {
      var url = `${cheminLivres()}?pageSize=300${pageSuivante ? `&pageToken=${encodeURIComponent(pageSuivante)}` : ''}`;
      var corps = await requete(url, { method: 'GET' });
      (corps && corps.documents ? corps.documents : []).forEach(function (document_) {
        var objet = champsVersObjet(document_.fields);
        objet.idDocument = String(document_.name).split('/').pop();
        livres.push(objet);
      });
      pageSuivante = corps && corps.nextPageToken;
    } while (pageSuivante);

    return livres;
  }

  async function ecrireLivre(livre) {
    var id = idDocument(livre.id);
    var aEcrire = Object.assign({}, livre);
    delete aEcrire.idDocument;
    aEcrire.modifieLe = new Date().toISOString();
    return requete(`${cheminLivres()}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: objetVersChamps(aEcrire) }),
    });
  }

  async function supprimerLivre(id) {
    try {
      return await requete(`${cheminLivres()}/${encodeURIComponent(idDocument(id))}`, { method: 'DELETE' });
    } catch (erreur) {
      if (erreur.statut === 404) return null;
      throw erreur;
    }
  }

  // --- Illustrations des etapes ------------------------------------------------
  //
  // Un document par recette, contenant toutes ses illustrations dans une seule chaine
  // JSON indexee par rang d'etape (« {"1": "data:image/...", "4": "..."} »).
  //
  // Pourquoi ainsi, et pas un document par etape : ces images ne servent que sur la
  // fiche ouverte. Un document par etape les ferait toutes lire au chargement de la
  // page, avec les vignettes de la collection `photos`, pour rien. Ici, une seule
  // lecture, et seulement quand on ouvre la fiche.

  // Le prefixe de l'identifiant est « etapes:: » et non « illustrations:: » : un
  // identifiant de document qui contient le nom de sa propre collection donne un chemin
  // ou le nom apparait deux fois (« /illustrations/illustrations-tarte-x »), que tout
  // decoupage naif lit de travers. C'est l'emulation de test qui l'a montre.
  function cheminIllustrations() {
    return dansLeFoyer('illustrations');
  }

  /** Lit les illustrations d'une recette. Rend une table { rang: dataUrl }, ou {}. */
  async function lireIllustrations(recetteId) {
    var id = idDocument('etapes::' + recetteId);
    try {
      var corps = await requete(`${cheminIllustrations()}/${encodeURIComponent(id)}`, { method: 'GET' });
      var champs = champsVersObjet((corps && corps.fields) || {});
      if (!champs.json) return {};
      var table = JSON.parse(champs.json);
      return table && typeof table === 'object' ? table : {};
    } catch (erreur) {
      // 404 : cette recette n'a aucune illustration, ce qui est le cas courant.
      if (erreur.statut === 404) return {};
      throw erreur;
    }
  }

  async function ecrireIllustrations(recetteId, table) {
    var id = idDocument('etapes::' + recetteId);
    return requete(`${cheminIllustrations()}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: objetVersChamps({
          recetteId: recetteId,
          json: JSON.stringify(table),
          modifieLe: new Date().toISOString(),
        }),
      }),
    });
  }

  async function supprimerIllustrations(recetteId) {
    var id = idDocument('etapes::' + recetteId);
    try {
      return await requete(`${cheminIllustrations()}/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
    return dansLeFoyer('photos');
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
    // Exposée pour les outils de migration, qui parlent aux anciens chemins globaux
    // dont plus aucun assistant de ce module ne connaît la forme.
    requete: requete,
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
    cheminIllustrations: cheminIllustrations,
    lireIllustrations: lireIllustrations,
    ecrireIllustrations: ecrireIllustrations,
    supprimerIllustrations: supprimerIllustrations,
    cheminPhotos: cheminPhotos,
    cheminLivres: cheminLivres,
    lireLivres: lireLivres,
    ecrireLivre: ecrireLivre,
    supprimerLivre: supprimerLivre,
    lirePlacard: lirePlacard,
    ecrirePlacard: ecrirePlacard,
    supprimerPlacard: supprimerPlacard,
    lireVignettes: lireVignettes,
    lireGrandePhoto: lireGrandePhoto,
    ecrirePhoto: ecrirePhoto,
    supprimerPhoto: supprimerPhoto,
    definirLectureSeule: definirLectureSeule,
    compteCourant: compteCourant,
    creerCompte: creerCompte,
    connecter: connecter,
    deconnecter: deconnecter,
    reinitialiserMotDePasse: reinitialiserMotDePasse,
    jetonDuCompte: jetonDuCompte,
    estLectureSeule: estLectureSeule,
    definirFoyer: definirFoyer,
    foyer: foyer,
    racine: racine,
    cheminUtilisateurs: cheminUtilisateurs,
    cheminFoyers: cheminFoyers,
    cheminMembres: cheminMembres,
    lireUtilisateur: lireUtilisateur,
    ecrireUtilisateur: ecrireUtilisateur,
    lireMembre: lireMembre,
    lireMembres: lireMembres,
    ecrireMembre: ecrireMembre,
    supprimerMembre: supprimerMembre,
    creerFoyer: creerFoyer,
    inscrireMembre: inscrireMembre,
    cleAnnuaire: cleAnnuaire,
    inscrireAnnuaire: inscrireAnnuaire,
    chercherDansAnnuaire: chercherDansAnnuaire,
    lirePartage: lirePartage,
    lirePartages: lirePartages,
    ecrirePartage: ecrirePartage,
    supprimerPartage: supprimerPartage,
    ecrireRecu: ecrireRecu,
    supprimerRecu: supprimerRecu,
    lireRecus: lireRecus,
    lireRecetteDeFoyer: lireRecetteDeFoyer,
    lireLivreDeFoyer: lireLivreDeFoyer,
    lirePhotoDeFoyer: lirePhotoDeFoyer,
    uidCourant: uidCourant,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.CarnetSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
