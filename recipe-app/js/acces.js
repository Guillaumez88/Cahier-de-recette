/* Qui voit le carnet, et qui peut le modifier.

   ## Le modèle

   Les données appartiennent à un **foyer**. Un compte qui crée son compte crée son
   foyer du même geste, et en devient membre **en modification** : le premier compte
   d'un foyer neuf peut donc tout faire, sans code, sans réglage, sans attendre.

   Les comptes suivants du même foyer ne s'inscrivent pas eux-mêmes : un membre qui peut
   modifier les crée depuis la page des membres, en choisissant leur rôle
   (« modification » ou « lecture »). C'est la seule façon d'entrer dans un foyer.

   Sans connexion, il n'y a pas de foyer, donc rien à afficher : le carnet demande
   d'abord de se connecter.

   ## Ce que ce module tient

   1. Le foyer courant, qu'il pose dans `Sync` : sans lui, aucune lecture de contenu
      n'a de sens, et `sync.js` lève plutôt que d'inventer un chemin.
   2. Le rôle, donc `peutModifier()`, consulté partout dans `app.js` pour décider si une
      commande de modification existe.
   3. Le verrou d'interface, via `Sync.definirLectureSeule()`, qui empêche un bouton
      oublié d'envoyer quoi que ce soit. Du confort, pas de la sécurité : le verrou qui
      compte est dans les règles Firestore.

   ## Ce qu'il ne fait pas

   Aucune lecture Firestore au chargement. Le foyer et le rôle sont mémorisés sur
   l'appareil et rechargés tels quels ; `verifier()` les rafraîchit à la demande, en
   deux lectures. Un rôle rétrogradé ailleurs continuerait donc d'afficher des boutons
   jusqu'au prochain `verifier()`, mais le serveur, lui, refuserait les écritures.

   Expose window.CarnetAcces dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  var estNode = typeof module !== 'undefined' && module.exports;
  var Sync = estNode ? require('./sync.js') : global.CarnetSync;

  // Ce que cet appareil a retenu du dernier contrôle, pour ne pas repartir en lecture
  // seule le temps d'un aller-retour réseau à chaque chargement.
  var CLE = 'carnet-de-recettes:foyer';

  // Sous Node, ce module ne sert qu'aux tests et aux outils, qui écrivent en
  // connaissance de cause : rien n'est verrouillé.
  var etat = { foyer: null, role: estNode ? 'modification' : null, nom: '' };
  var abonnes = [];

  function surChangement(rappel) {
    abonnes.push(rappel);
  }

  function notifier() {
    abonnes.forEach(function (rappel) {
      try {
        rappel();
      } catch (erreur) {
        /* un abonné fautif ne doit pas bloquer les autres */
      }
    });
  }

  function lireEtatMemorise() {
    try {
      if (!global.localStorage) return null;
      var brut = global.localStorage.getItem(CLE);
      return brut ? JSON.parse(brut) : null;
    } catch (erreur) {
      return null;
    }
  }

  function memoriser() {
    try {
      if (!global.localStorage) return;
      if (etat.foyer) global.localStorage.setItem(CLE, JSON.stringify(etat));
      else global.localStorage.removeItem(CLE);
    } catch (erreur) {
      /* navigation privée saturée : l'état ne vaudra que pour cette session */
    }
  }

  function appliquer() {
    if (Sync && Sync.definirFoyer) Sync.definirFoyer(etat.foyer);
    if (Sync && Sync.definirLectureSeule) Sync.definirLectureSeule(!peutModifier());
    if (global.document && global.document.body) {
      global.document.body.classList.toggle('lecture-seule', !peutModifier());
      global.document.body.classList.toggle('sans-foyer', !etat.foyer);
    }
  }

  /** Le compte connecté, ou null. */
  function compte() {
    return Sync.compteCourant ? Sync.compteCourant() : null;
  }

  /** L'identifiant du foyer courant, ou null si personne n'est connecté. */
  function foyer() {
    return etat.foyer;
  }

  /** Le rôle du compte dans son foyer : « modification », « lecture », ou null. */
  function role() {
    return etat.role;
  }

  /** Vrai dès qu'un foyer est connu : il y a quelque chose à afficher. */
  function aUnFoyer() {
    return Boolean(etat.foyer);
  }

  /** Vrai si le carnet est modifiable depuis cet écran. */
  function peutModifier() {
    return Boolean(etat.foyer) && etat.role === 'modification';
  }

  /**
   * Lit l'état mémorisé et l'applique, sans rien demander au serveur.
   *
   * Personne de connecté : pas de foyer, donc rien à lire. Quelqu'un de connecté : on
   * repart de ce que l'appareil avait retenu, et `verifier()` tranchera.
   */
  function initialiser() {
    if (!estNode) {
      var memorise = compte() ? lireEtatMemorise() : null;
      etat = {
        foyer: (memorise && memorise.foyer) || null,
        role: (memorise && memorise.role) || null,
        nom: (memorise && memorise.nom) || '',
      };
    }
    appliquer();
    return peutModifier();
  }

  /**
   * Redemande au serveur le foyer et le rôle du compte connecté : deux lectures, et
   * seulement pour un compte. Un visiteur n'en déclenche aucune.
   */
  async function verifier() {
    if (estNode) return true;
    var courant = compte();
    if (!courant) {
      if (etat.foyer) oublier();
      return false;
    }
    try {
      var fiche = await Sync.lireUtilisateur(courant.uid);
      if (!fiche || !fiche.foyer) {
        oublier();
        return false;
      }
      Sync.definirFoyer(fiche.foyer);
      var membre = await Sync.lireMembre(fiche.foyer, courant.uid);
      poser(fiche.foyer, membre && membre.role, fiche.nomFoyer || etat.nom);
    } catch (erreur) {
      // Hors ligne : on garde ce qui était mémorisé plutôt que de verrouiller une
      // cuisine au milieu d'une recette.
      appliquer();
      return peutModifier();
    }
    return peutModifier();
  }

  // Les caches locaux appartiennent à un foyer, pas à l'appareil. Changer de foyer sur
  // le même téléphone, sans les vider, ferait apparaître la liste de courses des uns
  // chez les autres, le temps que le serveur réponde. On les efface donc, et on
  // recharge : c'est brutal, mais c'est la seule façon sûre de repartir propre.
  var CACHES = [
    'carnet-de-recettes:liste-commune',
    'carnet-de-recettes:file-attente',
    'carnet-de-recettes:semainier',
    'carnet-de-recettes:file-semainier',
    'carnet-de-recettes:placard',
    'carnet-de-recettes:file-placard',
    'carnet-de-recettes:livres',
    'carnet-de-recettes:file-livres',
    'carnet-de-recettes:recettes-modifiees',
    'carnet-de-recettes:vignettes',
    'carnet-de-recettes:cuisson',
  ];

  /**
   * Vide les caches et recharge la page.
   *
   * Recharger n'est pas de la paresse : les modules de collection ne lisent leur
   * collection qu'une fois par chargement, volontairement, pour ne pas dépenser de
   * lectures Firestore. Leur demander de tout relire après un changement de foyer
   * exigerait un chemin de réinitialisation dans chacun d'eux, pour un cas qui arrive
   * une fois de temps en temps. Un rechargement fait la même chose, sûrement.
   */
  function repartirAZero() {
    viderLesCaches();
    try {
      if (global.location && typeof global.location.reload === 'function') {
        global.location.reload();
      }
    } catch (erreur) {
      /* pas de navigateur : les tests unitaires n'ont rien à recharger */
    }
  }

  function viderLesCaches() {
    try {
      if (global.localStorage) {
        CACHES.forEach(function (cle) {
          global.localStorage.removeItem(cle);
        });
      }
    } catch (erreur) {
      /* stockage indisponible : il n'y avait rien à vider */
    }
    try {
      if (global.indexedDB) global.indexedDB.deleteDatabase('carnet-de-recettes');
    } catch (erreur) {
      /* les grandes photos resteront, elles seront écrasées à la première lecture */
    }
  }

  function poser(foyerId, roleDuMembre, nom) {
    var avant = etat.foyer + '|' + etat.role;
    if (etat.foyer && foyerId && etat.foyer !== foyerId) {
      // Changement de foyer sur le même appareil : rien de ce qui est affiché ne vaut.
      etat = { foyer: foyerId, role: roleDuMembre === 'modification' ? 'modification' : 'lecture', nom: nom || '' };
      memoriser();
      repartirAZero();
      return;
    }
    etat = {
      foyer: foyerId || null,
      role: roleDuMembre === 'modification' ? 'modification' : foyerId ? 'lecture' : null,
      nom: nom || '',
    };
    memoriser();
    appliquer();
    if (avant !== etat.foyer + '|' + etat.role) notifier();
  }

  function oublier() {
    var avait = Boolean(etat.foyer);
    etat = { foyer: null, role: null, nom: '' };
    memoriser();
    appliquer();
    notifier();
    // Se déconnecter laisse les caches du foyer quitté : les effacer, pour que le
    // compte suivant sur cet appareil ne voie pas la liste de courses du précédent.
    if (avait) viderLesCaches();
  }

  // Les messages d'Identity Toolkit sont des codes en majuscules : ils ne se montrent
  // pas tels quels à quelqu'un qui cherche à faire ses courses.
  var MESSAGES = {
    EMAIL_EXISTS: 'Un compte existe déjà avec cette adresse. Se connecter plutôt.',
    INVALID_EMAIL: 'Cette adresse ne ressemble pas à une adresse e-mail.',
    MISSING_PASSWORD: 'Saisir un mot de passe.',
    WEAK_PASSWORD: 'Mot de passe trop court : six caractères au minimum.',
    EMAIL_NOT_FOUND: 'Aucun compte à cette adresse.',
    INVALID_PASSWORD: 'Mot de passe incorrect.',
    INVALID_LOGIN_CREDENTIALS: 'Adresse ou mot de passe incorrect.',
    USER_DISABLED: 'Ce compte a été désactivé.',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'Trop de tentatives : réessayer dans quelques minutes.',
    OPERATION_NOT_ALLOWED: 'La connexion par e-mail n’est pas activée sur le projet Firebase.',
  };

  function raison(erreur) {
    var code = String(erreur.message || '').split(' : ')[0].trim();
    return MESSAGES[code] || 'Échec : ' + erreur.message;
  }

  /**
   * Crée un compte, son foyer, et l'y inscrit en modification.
   *
   * C'est le seul endroit où un foyer naît. Le compte qui vient de le créer peut donc
   * tout faire immédiatement : c'est ce qu'on attend d'une inscription, et cela évite
   * l'écran d'attente d'un compte créé mais sans droits.
   */
  async function creerCompte(email, motDePasse, nomDuFoyer) {
    try {
      await Sync.creerCompte(String(email || '').trim(), String(motDePasse || ''));
    } catch (erreur) {
      return { ok: false, raison: raison(erreur) };
    }
    try {
      var foyerId = await Sync.creerFoyer(String(nomDuFoyer || '').trim() || 'Ma cuisine');
      poser(foyerId, 'modification', String(nomDuFoyer || '').trim());
    } catch (erreur) {
      // Le compte existe, son foyer non : se reconnecter ne réparerait rien tout seul,
      // et l'écran doit le dire au lieu d'afficher un carnet vide.
      return {
        ok: false,
        raison: 'Compte créé, mais son foyer n’a pas pu l’être : ' + (erreur.message || 'erreur inconnue'),
      };
    }
    return { ok: true, peutModifier: peutModifier() };
  }

  /**
   * Ouvre la session d'un compte existant et retrouve son foyer.
   *
   * Aucun foyer n'est créé ici, volontairement : un membre inscrit par quelqu'un d'autre
   * a déjà sa fiche. S'il n'en a pas, lui en fabriquer une l'enverrait dans un foyer
   * vide au lieu de celui qu'il attend, et ce serait très difficile à comprendre.
   */
  async function connecter(email, motDePasse) {
    try {
      await Sync.connecter(String(email || '').trim(), String(motDePasse || ''));
    } catch (erreur) {
      return { ok: false, raison: raison(erreur) };
    }
    await verifier();
    if (!etat.foyer) {
      return {
        ok: false,
        sansFoyer: true,
        raison:
          'Ce compte n’appartient à aucun foyer. Demander à un membre du foyer de ' +
          'l’inscrire depuis la page des membres.',
      };
    }
    return { ok: true, peutModifier: peutModifier() };
  }

  /** Ferme la session. Il n'y a plus de foyer, donc plus rien à afficher. */
  function deconnecter() {
    Sync.deconnecter();
    oublier();
  }

  /** Demande le courriel de réinitialisation du mot de passe. */
  async function motDePasseOublie(email) {
    if (!email || String(email).trim() === '') {
      return { ok: false, raison: 'Saisir l’adresse du compte.' };
    }
    try {
      await Sync.reinitialiserMotDePasse(String(email).trim());
    } catch (erreur) {
      return { ok: false, raison: raison(erreur) };
    }
    return { ok: true };
  }

  // --- Les membres du foyer ----------------------------------------------------

  /** Les membres du foyer courant, avec leur rôle. */
  async function membres() {
    if (!etat.foyer) return [];
    return Sync.lireMembres(etat.foyer);
  }

  /** Crée un compte pour quelqu'un du foyer et l'y inscrit avec son rôle. */
  async function ajouterMembre(email, motDePasse, roleDemande) {
    if (!peutModifier()) return { ok: false, raison: 'Seul un membre en modification peut en ajouter un.' };
    if (!email || String(email).trim() === '') return { ok: false, raison: 'Saisir une adresse e-mail.' };
    try {
      var cree = await Sync.inscrireMembre(
        String(email).trim(),
        String(motDePasse || ''),
        roleDemande === 'lecture' ? 'lecture' : 'modification'
      );
      return { ok: true, membre: cree };
    } catch (erreur) {
      return { ok: false, raison: raison(erreur) };
    }
  }

  /**
   * Change le rôle d'un membre déjà inscrit.
   *
   * Le document est réécrit en entier (PATCH sans masque) : on lui repasse donc sa date
   * d'inscription, sinon changer un rôle l'effacerait.
   */
  async function changerRole(uid, roleDemande, email, ajouteLe) {
    if (!peutModifier()) return { ok: false, raison: 'Seul un membre en modification peut changer un rôle.' };
    try {
      await Sync.ecrireMembre(etat.foyer, uid, {
        email: String(email || ''),
        role: roleDemande === 'lecture' ? 'lecture' : 'modification',
        ajouteLe: String(ajouteLe || new Date().toISOString()),
      });
    } catch (erreur) {
      return { ok: false, raison: raison(erreur) };
    }
    if (compte() && compte().uid === uid) poser(etat.foyer, roleDemande, etat.nom);
    return { ok: true };
  }

  /** Retire un membre du foyer. Le compte survit, il n'a simplement plus de foyer. */
  async function retirerMembre(uid) {
    if (!peutModifier()) return { ok: false, raison: 'Seul un membre en modification peut en retirer un.' };
    if (etat.foyer === uid) return { ok: false, raison: 'Le fondateur du foyer ne peut pas être retiré.' };
    try {
      await Sync.supprimerMembre(etat.foyer, uid);
    } catch (erreur) {
      return { ok: false, raison: raison(erreur) };
    }
    return { ok: true };
  }

  var api = {
    CLE: CLE,
    surChangement: surChangement,
    compte: compte,
    foyer: foyer,
    role: role,
    aUnFoyer: aUnFoyer,
    peutModifier: peutModifier,
    initialiser: initialiser,
    verifier: verifier,
    creerCompte: creerCompte,
    connecter: connecter,
    deconnecter: deconnecter,
    motDePasseOublie: motDePasseOublie,
    membres: membres,
    ajouterMembre: ajouterMembre,
    changerRole: changerRole,
    retirerMembre: retirerMembre,
  };

  if (estNode) module.exports = api;
  else global.CarnetAcces = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
