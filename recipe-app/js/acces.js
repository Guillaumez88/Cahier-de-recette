/* Qui a le droit de modifier le carnet : un compte connecté, et lui seul.

   ## Le modèle

   Le carnet se lit sans rien demander. Le **modifier** exige d'être connecté avec un
   compte autorisé, c'est-à-dire un compte qui possède son document dans la collection
   `comptes`. Les règles Firestore refusent toute écriture aux autres, y compris depuis
   la console du navigateur : c'est le seul verrou qui compte.

   Un compte s'autorise une fois, en présentant le code de la maison. Une fois, pour la
   personne, pas pour l'appareil : se connecter ailleurs suffit à retrouver ses droits.

   ## Ce que ce module tient

   1. L'état d'écran : `peutModifier()`, consulté partout dans `app.js` pour décider si
      une commande de modification existe.
   2. Le verrou d'interface, via `Sync.definirLectureSeule()`, qui empêche un bouton
      oublié d'envoyer quoi que ce soit. Du confort, pas de la sécurité.

   ## Ce qu'il ne fait pas

   Aucune lecture Firestore pour un visiteur. Un carnet qui se partage ne doit pas
   coûter une lecture par ouverture à des gens qui ne s'y connecteront jamais. La
   vérification de l'autorisation n'a lieu que si une session de compte existe.

   Expose window.CarnetAcces dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  var estNode = typeof module !== 'undefined' && module.exports;
  var Sync = estNode ? require('./sync.js') : global.CarnetSync;

  // Ce que cet appareil a retenu du dernier contrôle, pour ne pas repartir en lecture
  // seule le temps d'un aller-retour réseau à chaque chargement.
  var CLE = 'carnet-de-recettes:compte-autorise';

  // Sous Node, ce module ne sert qu'aux tests et aux outils, qui écrivent en
  // connaissance de cause : rien n'est verrouillé.
  var autorise = estNode;
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

  function lireDrapeau() {
    try {
      return global.localStorage && global.localStorage.getItem(CLE) === 'oui';
    } catch (erreur) {
      return false;
    }
  }

  function ecrireDrapeau(valeur) {
    try {
      if (!global.localStorage) return;
      if (valeur) global.localStorage.setItem(CLE, 'oui');
      else global.localStorage.removeItem(CLE);
    } catch (erreur) {
      /* navigation privée saturée : l'état ne vaudra que pour cette session */
    }
  }

  function appliquer() {
    if (Sync && Sync.definirLectureSeule) Sync.definirLectureSeule(!autorise);
    if (global.document && global.document.body) {
      global.document.body.classList.toggle('lecture-seule', !autorise);
    }
  }

  /** Le compte connecté, ou null. */
  function compte() {
    return Sync.compteCourant ? Sync.compteCourant() : null;
  }

  /** Vrai si le carnet est modifiable depuis cet écran. */
  function peutModifier() {
    return autorise;
  }

  /**
   * Lit l'état mémorisé et l'applique, sans rien demander au serveur.
   *
   * Personne de connecté : lecture seule, sans discussion. Quelqu'un de connecté : on
   * repart de ce que l'appareil avait retenu, et `verifier()` tranchera.
   */
  function initialiser() {
    if (!estNode) autorise = Boolean(compte()) && lireDrapeau();
    appliquer();
    return autorise;
  }

  /**
   * Demande au serveur si le compte connecté est autorisé. Une lecture, et seulement
   * pour un compte : un visiteur n'en déclenche aucune.
   */
  async function verifier() {
    if (estNode) return true;
    if (!compte()) {
      if (autorise) {
        autorise = false;
        ecrireDrapeau(false);
        appliquer();
        notifier();
      }
      return false;
    }
    var resultat;
    try {
      resultat = await Sync.compteAutorise();
    } catch (erreur) {
      // Hors ligne : on garde ce qui était mémorisé plutôt que de verrouiller une
      // cuisine au milieu d'une recette.
      return autorise;
    }
    if (resultat !== autorise) {
      autorise = resultat;
      ecrireDrapeau(resultat);
      appliquer();
      notifier();
    }
    return autorise;
  }

  /** Crée un compte, puis ouvre sa session. Rend { ok, raison }. */
  async function creerCompte(email, motDePasse) {
    return tenter(function () {
      return Sync.creerCompte(String(email || '').trim(), String(motDePasse || ''));
    });
  }

  /** Ouvre la session d'un compte existant. Rend { ok, raison }. */
  async function connecter(email, motDePasse) {
    return tenter(function () {
      return Sync.connecter(String(email || '').trim(), String(motDePasse || ''));
    });
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

  async function tenter(action) {
    try {
      await action();
    } catch (erreur) {
      var code = String(erreur.message || '').split(' : ')[0].trim();
      return { ok: false, raison: MESSAGES[code] || 'Échec : ' + erreur.message };
    }
    // Se connecter ne donne pas les droits : il faut que le compte soit autorisé.
    await verifier();
    return { ok: true, autorise: autorise };
  }

  /**
   * Autorise le compte connecté avec le code de la maison.
   *
   * Le code n'est comparé qu'au serveur, contre un document que personne ne peut lire.
   * Une fois par compte : les autres appareils de la même personne en héritent.
   */
  async function autoriserAvecCode(code) {
    if (!compte()) return { ok: false, raison: 'Il faut d’abord se connecter.' };
    if (!code || String(code).trim() === '') {
      return { ok: false, raison: 'Saisir le code de la maison.' };
    }
    try {
      await Sync.inscrireCompte(String(code).trim());
    } catch (erreur) {
      if (erreur.statut === 403 || erreur.statut === 400) {
        return {
          ok: false,
          raison:
            'Code refusé. Si le code est le bon, vérifier que les règles Firestore sont ' +
            'publiées et que le code est bien posé dans menage/secret.',
        };
      }
      return { ok: false, raison: 'Le serveur n’a pas répondu : ' + erreur.message };
    }
    autorise = true;
    ecrireDrapeau(true);
    appliquer();
    notifier();
    return { ok: true };
  }

  /** Ferme la session. Le carnet redevient lisible et non modifiable. */
  function deconnecter() {
    Sync.deconnecter();
    autorise = false;
    ecrireDrapeau(false);
    appliquer();
    notifier();
  }

  /** Demande le courriel de réinitialisation du mot de passe. */
  async function motDePasseOublie(email) {
    if (!email || String(email).trim() === '') {
      return { ok: false, raison: 'Saisir l’adresse du compte.' };
    }
    try {
      await Sync.reinitialiserMotDePasse(String(email).trim());
    } catch (erreur) {
      var code = String(erreur.message || '').split(' : ')[0].trim();
      return { ok: false, raison: MESSAGES[code] || 'Échec : ' + erreur.message };
    }
    return { ok: true };
  }

  var api = {
    CLE: CLE,
    surChangement: surChangement,
    compte: compte,
    peutModifier: peutModifier,
    initialiser: initialiser,
    verifier: verifier,
    creerCompte: creerCompte,
    connecter: connecter,
    deconnecter: deconnecter,
    autoriserAvecCode: autoriserAvecCode,
    motDePasseOublie: motDePasseOublie,
  };

  if (estNode) module.exports = api;
  else global.CarnetAcces = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
