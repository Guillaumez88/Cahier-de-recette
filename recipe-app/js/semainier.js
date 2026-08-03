/* Semainier commun : quel plat a quel repas, partage par toute la maison.

   Ce module suit exactement les trois principes de storage.js, pour les memes
   raisons :

   1. Le cache local est la source du rendu. `tous()` est synchrone : l'accueil
      s'affiche sans attendre le reseau, et le menu reste consultable en cuisine
      meme sans connexion.

   2. Les modifications sont appliquees en local puis poussees, chacune inscrite
      dans une file persistee. Poser un plat fonctionne hors ligne et part au
      retour du reseau.

   3. Firestore est la reference : un rafraichissement vide la file puis remplace
      le cache par ce que dit le serveur.

   Un creneau vide n'existe pas cote serveur : vider un creneau supprime son
   document. Cela evite d'accumuler des documents vides pour les repas non prevus,
   qui sont la majorite.

   Expose window.CarnetSemainier dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  var estNode = typeof module !== 'undefined' && module.exports;
  var Sync = estNode ? require('./sync.js') : global.CarnetSync;
  var Semaine = estNode ? require('./semaine.js') : global.CarnetSemaine;

  var CLE_CACHE = 'carnet-de-recettes:semainier';
  var CLE_FILE = 'carnet-de-recettes:file-semainier';

  var TYPE_RECETTE = 'recette';
  var TYPE_LIBRE = 'libre';

  var abonnes = [];
  var dejaCharge = false;

  var etat = {
    enLigne: null,
    dernierSucces: null,
    erreur: null,
    statut: null, // statut HTTP de la derniere erreur, pour la distinguer a l'ecran
    enCours: false,
    versionLocale: 0,
  };

  // --- Abonnement -------------------------------------------------------------

  function surChangement(rappel) {
    abonnes.push(rappel);
  }

  function notifier() {
    abonnes.forEach(function (rappel) {
      try {
        rappel();
      } catch (erreur) {
        /* un abonne fautif ne doit pas bloquer les autres */
      }
    });
  }

  // --- Cache local ------------------------------------------------------------

  function lireJson(cle, defaut) {
    try {
      var brut = global.localStorage && global.localStorage.getItem(cle);
      if (!brut) return defaut;
      var valeur = JSON.parse(brut);
      return Array.isArray(valeur) ? valeur : defaut;
    } catch (erreur) {
      return defaut;
    }
  }

  function ecrireJson(cle, valeur) {
    try {
      if (global.localStorage) global.localStorage.setItem(cle, JSON.stringify(valeur));
    } catch (erreur) {
      /* quota atteint ou navigation privee : la valeur reste en memoire */
    }
  }

  /** Tous les creneaux planifies. Synchrone, lu dans le cache local. */
  function tous() {
    return lireJson(CLE_CACHE, []);
  }

  function ecrireCache(creneaux) {
    ecrireJson(CLE_CACHE, creneaux);
    notifier();
    return creneaux;
  }

  // --- File d'attente ---------------------------------------------------------

  function lireFile() {
    return lireJson(CLE_FILE, []);
  }

  function empiler(operation) {
    var file = lireFile();
    file.push(operation);
    ecrireJson(CLE_FILE, file);
  }

  function nbEnAttente() {
    return lireFile().length;
  }

  async function viderFile() {
    var file = lireFile();

    while (file.length > 0) {
      var operation = file[0];
      try {
        if (operation.type === 'ecrire') await Sync.ecrireCreneau(operation.creneau);
        else if (operation.type === 'supprimer') await Sync.supprimerCreneau(operation.cle);
        file.shift();
        ecrireJson(CLE_FILE, file);
      } catch (erreur) {
        ecrireJson(CLE_FILE, file);
        throw erreur;
      }
    }
  }

  async function pousser() {
    try {
      await viderFile();
      etat.enLigne = true;
      etat.erreur = null;
      etat.statut = null;
    } catch (erreur) {
      etat.enLigne = false;
      etat.erreur = erreur.message;
      etat.statut = erreur.statut || null;
    }
    notifier();
    return tous();
  }

  function appliquer(creneaux, operations) {
    etat.versionLocale += 1;
    ecrireCache(creneaux);
    (Array.isArray(operations) ? operations : [operations]).forEach(empiler);
    return pousser();
  }

  // --- Rafraichissement -------------------------------------------------------

  function trier(creneaux) {
    // Ordre stable : par date puis par moment de la journee. Sans tri, Firestore
    // rend les documents par identifiant et l'ordre saute d'une lecture a l'autre.
    var rang = {};
    Semaine.MOMENTS.forEach(function (moment, i) {
      rang[moment.cle] = i;
    });
    return creneaux.slice().sort(function (a, b) {
      if (a.jour !== b.jour) return String(a.jour).localeCompare(String(b.jour));
      return (rang[a.moment] === undefined ? 9 : rang[a.moment]) - (rang[b.moment] === undefined ? 9 : rang[b.moment]);
    });
  }

  async function rafraichir() {
    if (etat.enCours) return tous();
    etat.enCours = true;
    notifier();

    var versionAvant = etat.versionLocale;

    try {
      await viderFile();
      var distants = await Sync.lireCreneaux();

      // Meme garde que pour la liste de courses : une modification locale survenue
      // pendant la lecture rend la reponse perimee. L'ecrire ferait reapparaitre a
      // l'ecran un plat qui vient d'etre retire.
      if (etat.versionLocale !== versionAvant) {
        etat.enLigne = true;
        etat.erreur = null;
        etat.statut = null;
        return tous();
      }

      var creneaux = trier(
        distants
          .map(function (creneau) {
            return {
              cle: creneau.cle,
              jour: creneau.jour,
              moment: creneau.moment,
              type: creneau.type === TYPE_LIBRE ? TYPE_LIBRE : TYPE_RECETTE,
              recetteId: creneau.recetteId || '',
              titre: creneau.titre || '',
              modifieLe: creneau.modifieLe || null,
            };
          })
          // Un document dont la cle ne se decoupe pas est un residu : l'ignorer
          // plutot que de le rendre a l'ecran sous une forme incomprehensible.
          .filter(function (creneau) {
            return Boolean(Semaine.decouperCreneau(creneau.cle)) && creneau.titre !== '';
          })
      );

      etat.enLigne = true;
      etat.erreur = null;
      etat.statut = null;
      etat.dernierSucces = Date.now();
      ecrireCache(creneaux);
      return creneaux;
    } catch (erreur) {
      etat.enLigne = false;
      etat.erreur = erreur.message;
      etat.statut = erreur.statut || null;
      return tous();
    } finally {
      etat.enCours = false;
      notifier();
    }
  }

  /**
   * Lecture initiale des menus, au chargement de la page. Idempotente.
   * Comme pour la liste de courses, il n'y a plus de sondage periodique : la mise a
   * jour passe par un bouton explicite. Voir le commentaire de storage.js, qui donne
   * l'arithmetique des lectures Firestore ayant motive ce choix.
   */
  function initialiser() {
    if (dejaCharge) return Promise.resolve(tous());
    dejaCharge = true;
    return rafraichir();
  }

  /** Age des menus affiches, en millisecondes, ou null si rien n'a encore ete lu. */
  function ageDonnees() {
    return etat.dernierSucces === null ? null : Date.now() - etat.dernierSucces;
  }

  function etatSync() {
    return {
      enLigne: etat.enLigne,
      dernierSucces: etat.dernierSucces,
      erreur: etat.erreur,
      statut: etat.statut,
      enCours: etat.enCours,
      enAttente: nbEnAttente(),
    };
  }

  // --- Lecture ----------------------------------------------------------------

  /** Le creneau pose a ce jour et ce moment, ou null. */
  function creneau(jourCle, moment) {
    var cle = Semaine.cleCreneau(jourCle, moment);
    var trouve = null;
    tous().forEach(function (c) {
      if (c.cle === cle) trouve = c;
    });
    return trouve;
  }

  /** Index cle -> creneau, pour un rendu qui ne refait pas la recherche 21 fois. */
  function parCle() {
    var index = {};
    tous().forEach(function (c) {
      index[c.cle] = c;
    });
    return index;
  }

  /**
   * Les plats d'une semaine, dedoublonnes.
   *
   * Un meme plat peut revenir deux fois dans la semaine (le dimanche midi et le
   * lundi soir). Pour les courses, c'est une seule entree : les ingredients ne sont
   * pas doubles automatiquement, faute de savoir si on cuisine deux fois ou si on
   * mange un reste. Le nombre d'occurrences est rendu pour que l'ecran le dise.
   */
  function platsDeLaSemaine(sem) {
    var joursDeLaSemaine = {};
    (sem && sem.jours ? sem.jours : []).forEach(function (jour) {
      joursDeLaSemaine[jour.cle] = jour;
    });

    var vus = {};
    var plats = [];

    tous().forEach(function (c) {
      if (!joursDeLaSemaine[c.jour]) return;
      var cle = c.type === TYPE_RECETTE ? 'r::' + c.recetteId : 'l::' + c.titre;
      if (vus[cle]) {
        vus[cle].occurrences.push(c);
        return;
      }
      vus[cle] = {
        cle: cle,
        type: c.type,
        recetteId: c.recetteId,
        titre: c.titre,
        occurrences: [c],
      };
      plats.push(vus[cle]);
    });

    return plats;
  }

  // --- Modifications ----------------------------------------------------------

  function horodatage() {
    return new Date().toISOString();
  }

  /**
   * Pose un plat sur un creneau. `plat` est
   *   { type: 'recette', recetteId, titre }  ou  { type: 'libre', titre }.
   * Remplace ce qui s'y trouvait : un creneau ne porte qu'un plat.
   */
  function poser(jourCle, moment, plat) {
    if (!plat || !plat.titre) return Promise.resolve(tous());
    var cle = Semaine.cleCreneau(jourCle, moment);
    var nouveau = {
      cle: cle,
      jour: jourCle,
      moment: moment,
      type: plat.type === TYPE_LIBRE ? TYPE_LIBRE : TYPE_RECETTE,
      recetteId: plat.type === TYPE_LIBRE ? '' : plat.recetteId || '',
      titre: plat.titre,
      modifieLe: horodatage(),
    };

    var creneaux = tous().filter(function (c) {
      return c.cle !== cle;
    });
    creneaux.push(nouveau);

    return appliquer(trier(creneaux), { type: 'ecrire', creneau: nouveau });
  }

  /** Vide un creneau. */
  function vider(jourCle, moment) {
    var cle = Semaine.cleCreneau(jourCle, moment);
    var avant = tous();
    var creneaux = avant.filter(function (c) {
      return c.cle !== cle;
    });
    if (creneaux.length === avant.length) return Promise.resolve(avant);
    return appliquer(creneaux, { type: 'supprimer', cle: cle });
  }

  /**
   * Deplace un plat d'un creneau vers un autre. Si le creneau d'arrivee est occupe,
   * les deux plats sont echanges : c'est ce qu'on attend en glissant un diner sur un
   * autre diner, et cela evite d'effacer un plat sans le dire.
   */
  function deplacer(deJour, deMoment, versJour, versMoment) {
    var cleDepart = Semaine.cleCreneau(deJour, deMoment);
    var cleArrivee = Semaine.cleCreneau(versJour, versMoment);
    if (cleDepart === cleArrivee) return Promise.resolve(tous());

    var index = parCle();
    var depart = index[cleDepart];
    if (!depart) return Promise.resolve(tous());
    var arrivee = index[cleArrivee] || null;

    var operations = [];
    var creneaux = tous().filter(function (c) {
      return c.cle !== cleDepart && c.cle !== cleArrivee;
    });

    var pose = {
      cle: cleArrivee,
      jour: versJour,
      moment: versMoment,
      type: depart.type,
      recetteId: depart.recetteId || '',
      titre: depart.titre,
      modifieLe: horodatage(),
    };
    creneaux.push(pose);
    operations.push({ type: 'ecrire', creneau: pose });

    if (arrivee) {
      var echange = {
        cle: cleDepart,
        jour: deJour,
        moment: deMoment,
        type: arrivee.type,
        recetteId: arrivee.recetteId || '',
        titre: arrivee.titre,
        modifieLe: horodatage(),
      };
      creneaux.push(echange);
      operations.push({ type: 'ecrire', creneau: echange });
    } else {
      operations.push({ type: 'supprimer', cle: cleDepart });
    }

    return appliquer(trier(creneaux), operations);
  }

  /** Retire toutes les occurrences d'une recette du semainier. */
  function retirerRecette(recetteId) {
    var vises = tous().filter(function (c) {
      return c.type === TYPE_RECETTE && c.recetteId === recetteId;
    });
    if (vises.length === 0) return Promise.resolve(tous());

    var aRetirer = {};
    vises.forEach(function (c) {
      aRetirer[c.cle] = true;
    });

    return appliquer(
      tous().filter(function (c) {
        return !aRetirer[c.cle];
      }),
      vises.map(function (c) {
        return { type: 'supprimer', cle: c.cle };
      })
    );
  }

  var api = {
    CLE_CACHE: CLE_CACHE,
    CLE_FILE: CLE_FILE,
    TYPE_RECETTE: TYPE_RECETTE,
    TYPE_LIBRE: TYPE_LIBRE,

    surChangement: surChangement,
    initialiser: initialiser,
    rafraichir: rafraichir,
    ageDonnees: ageDonnees,
    etatSync: etatSync,

    tous: tous,
    creneau: creneau,
    parCle: parCle,
    platsDeLaSemaine: platsDeLaSemaine,

    poser: poser,
    vider: vider,
    deplacer: deplacer,
    retirerRecette: retirerRecette,
  };

  if (estNode) module.exports = api;
  else global.CarnetSemainier = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
