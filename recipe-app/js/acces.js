/* Qui a le droit de modifier le carnet, et comment un appareil le devient.

   ## Le problème

   Le carnet est un site public : son adresse suffit à l'ouvrir. Tant que les règles
   Firestore acceptaient l'écriture de n'importe quel visiteur authentifié
   anonymement, partager l'adresse revenait à partager les droits de modification, et
   masquer les boutons n'y aurait rien changé : la console du navigateur reste ouverte
   à tous.

   ## Ce qui a été retenu

   **Deux verrous, dont un seul compte.**

   1. Les **règles Firestore** n'autorisent l'écriture qu'aux appareils inscrits dans la
      collection `appareils`, un document par appareil, nommé par son identifiant
      anonyme. C'est le verrou réel : la console n'y peut rien.
   2. Ce module tient le verrou **d'interface** : un appareil qui ne s'est pas
      déverrouillé ne voit aucun bouton de modification, et `sync.js` refuse d'envoyer
      quoi que ce soit. C'est du confort et de la clarté, pas de la sécurité.

   **Un code, saisi une fois.** L'appareil se déverrouille à l'adresse `#/acces`, en
   saisissant le code de la maison. Le code n'est comparé qu'au serveur, contre un
   document que personne ne peut lire : il ne se trouve nulle part dans le site.

   **La mémoire est locale, la vérité est distante.** Le drapeau rangé ici évite de
   redemander le code à chaque ouverture. Il est reverifié auprès du serveur au
   démarrage, en tâche de fond : un appareil retiré de la maison redevient lecteur, et
   un appareil déjà inscrit se reconnaît tout seul.

   Expose window.CarnetAcces dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  var estNode = typeof module !== 'undefined' && module.exports;
  var Sync = estNode ? require('./sync.js') : global.CarnetSync;

  var CLE = 'carnet-de-recettes:maison';

  // Sous Node, ce module ne sert qu'aux tests et aux outils, qui écrivent en connaissance
  // de cause : rien n'est verrouillé.
  var deverrouille = estNode;
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
      /* navigation privée saturée : le mode reste celui de la session */
    }
  }

  function appliquer() {
    if (Sync && Sync.definirLectureSeule) Sync.definirLectureSeule(!deverrouille);
    if (global.document && global.document.body) {
      global.document.body.classList.toggle('lecture-seule', !deverrouille);
    }
  }

  /** Vrai si cet appareil peut modifier le carnet. Synchrone : c'est l'état d'écran. */
  function peutModifier() {
    return deverrouille;
  }

  /** Lit l'état mémorisé et l'applique. À appeler avant le premier rendu. */
  function initialiser() {
    if (!estNode) deverrouille = lireDrapeau();
    appliquer();
    return deverrouille;
  }

  /**
   * Recontrôle auprès du serveur, sans bloquer l'affichage.
   *
   * Deux cas utiles : un appareil de la maison qui a effacé son stockage local se
   * reconnaît sans ressaisir le code, et un appareil retiré de la collection
   * `appareils` repasse en lecture seule tout seul.
   */
  async function verifier() {
    if (estNode) return true;
    var autorise;
    try {
      autorise = await Sync.appareilAutorise();
    } catch (erreur) {
      // Hors ligne ou serveur muet : on garde l'état mémorisé plutôt que de verrouiller
      // une cuisine au milieu d'une recette.
      return deverrouille;
    }
    if (autorise !== deverrouille) {
      deverrouille = autorise;
      ecrireDrapeau(autorise);
      appliquer();
      notifier();
    }
    return deverrouille;
  }

  /**
   * Déverrouille cet appareil avec le code de la maison.
   *
   * Rend { ok: true } ou { ok: false, raison }. Le code n'est jamais conservé : seul le
   * fait d'être inscrit l'est, et il l'est côté serveur.
   */
  async function deverrouiller(code) {
    if (!code || String(code).trim() === '') {
      return { ok: false, raison: 'Saisir le code de la maison.' };
    }
    try {
      await Sync.inscrireAppareil(String(code).trim());
    } catch (erreur) {
      if (erreur.statut === 403 || erreur.statut === 400) {
        // Deux causes possibles, et l'une n'est pas une faute de frappe : tant que les
        // règles ne sont pas publiées, ou que le code de la maison n'est pas posé dans
        // `menage/secret`, le serveur refuse toute inscription. Le dire évite de
        // chercher une heure une erreur de saisie qui n'existe pas.
        return {
          ok: false,
          raison:
            'Code refusé. Cet appareil reste en lecture seule. Si le code est le bon, ' +
            'vérifier que les règles Firestore sont publiées et que le code est bien ' +
            'posé dans menage/secret.',
        };
      }
      return { ok: false, raison: 'Le serveur n’a pas répondu : ' + erreur.message };
    }
    deverrouille = true;
    ecrireDrapeau(true);
    appliquer();
    notifier();
    return { ok: true };
  }

  /**
   * Repasse cet appareil en lecture seule.
   *
   * Local seulement : le document de l'appareil reste côté serveur, et une nouvelle
   * saisie du code le rouvrira. Retirer durablement un appareil se fait en supprimant
   * son document dans la console Firebase, ce que l'application ne propose pas : elle
   * ne doit pas permettre à un appareil d'en exclure un autre.
   */
  function verrouiller() {
    deverrouille = false;
    ecrireDrapeau(false);
    appliquer();
    notifier();
  }

  var api = {
    CLE: CLE,
    surChangement: surChangement,
    peutModifier: peutModifier,
    initialiser: initialiser,
    verifier: verifier,
    deverrouiller: deverrouiller,
    verrouiller: verrouiller,
  };

  if (estNode) module.exports = api;
  else global.CarnetAcces = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
