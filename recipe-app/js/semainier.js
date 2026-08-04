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
      var ecart =
        (rang[a.moment] === undefined ? 9 : rang[a.moment]) - (rang[b.moment] === undefined ? 9 : rang[b.moment]);
      if (ecart !== 0) return ecart;
      // Plusieurs plats dans un meme repas : les ordonner par date de pose, pour que
      // le plat precede le dessert qu'on a ajoute ensuite. La cle departage les
      // horodatages egaux, sinon l'ordre sauterait d'une lecture a l'autre.
      if (a.modifieLe !== b.modifieLe) return String(a.modifieLe || '').localeCompare(String(b.modifieLe || ''));
      return String(a.cle).localeCompare(String(b.cle));
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

  /** Tous les plats poses a ce jour et ce moment, dans l'ordre de pose. */
  function creneaux(jourCle, moment) {
    return parCreneau()[Semaine.cleCreneau(jourCle, moment)] || [];
  }

  /** Le premier plat pose a ce jour et ce moment, ou null. */
  function creneau(jourCle, moment) {
    var liste = creneaux(jourCle, moment);
    return liste.length > 0 ? liste[0] : null;
  }

  /** Index cle de plat -> plat. Une cle de plat est unique, elle designe un document. */
  function parCle() {
    var index = {};
    tous().forEach(function (c) {
      index[c.cle] = c;
    });
    return index;
  }

  /**
   * Index cle de repas -> liste de plats. C'est cet index que le rendu utilise :
   * une case de la grille affiche tous les plats de son repas, pas seulement le premier.
   */
  function parCreneau() {
    var index = {};
    tous().forEach(function (c) {
      var decoupe = Semaine.decouperCreneau(c.cle);
      var cle = decoupe ? decoupe.cleCreneau : Semaine.cleCreneau(c.jour, c.moment);
      if (!index[cle]) index[cle] = [];
      index[cle].push(c);
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

  // --- Compteur de realisations -----------------------------------------------
  //
  // « Combien de fois ce plat a-t-il ete fait ? », lu dans l'historique du semainier.
  // Aucune donnee nouvelle n'est stockee : les creneaux passes sont deja la, ils
  // n'etaient simplement pas affiches.
  //
  // Seuls les creneaux strictement anterieurs a aujourd'hui comptent. Un repas prevu
  // pour jeudi prochain n'a pas ete fait, et le repas du jour ne l'est pas non plus
  // tant que la journee n'est pas finie : compter aujourd'hui ferait apparaitre le
  // plat comme realise avant qu'on l'ait cuisine.
  //
  // Limite de cout, a connaitre : le comptage porte sur tout l'historique, donc sur
  // la totalite de la collection, qui grossit d'environ 1 100 documents par an
  // (21 creneaux par semaine). Firestore facture a la lecture de document, et cette
  // lecture a lieu une fois par chargement de page. C'est sans consequence
  // aujourd'hui, cela le restera un a deux ans, puis il faudra un document
  // d'agregation par recette plutot qu'un comptage a la lecture.

  function cleDuJour(aujourdhui) {
    return Semaine.cleJour(aujourdhui instanceof Date ? aujourdhui : new Date());
  }

  /** Creneaux passes portant une recette du carnet, les seuls qui comptent. */
  function realisations(aujourdhui) {
    var limite = cleDuJour(aujourdhui);
    return tous().filter(function (c) {
      return c.type === TYPE_RECETTE && c.recetteId && c.jour < limite;
    });
  }

  /** Table { recetteId: nombre de fois fait }. */
  function comptes(aujourdhui) {
    var table = {};
    realisations(aujourdhui).forEach(function (c) {
      table[c.recetteId] = (table[c.recetteId] || 0) + 1;
    });
    return table;
  }

  function nbFois(recetteId, aujourdhui) {
    return comptes(aujourdhui)[recetteId] || 0;
  }

  /** Jour de la derniere realisation d'une recette, ou null. */
  function derniereFois(recetteId, aujourdhui) {
    var dernier = null;
    realisations(aujourdhui).forEach(function (c) {
      if (c.recetteId !== recetteId) return;
      if (dernier === null || c.jour > dernier) dernier = c.jour;
    });
    return dernier;
  }

  /**
   * Classement des plats les plus faits, du plus au moins frequent.
   * A nombre egal, le plus recemment fait passe devant : c'est celui dont on se
   * souvient, et l'ordre doit rester stable d'un affichage a l'autre.
   */
  function classement(aujourdhui) {
    var index = {};
    var liste = [];
    realisations(aujourdhui).forEach(function (c) {
      if (!index[c.recetteId]) {
        index[c.recetteId] = { recetteId: c.recetteId, titre: c.titre, nb: 0, dernier: null };
        liste.push(index[c.recetteId]);
      }
      var entree = index[c.recetteId];
      entree.nb += 1;
      if (entree.dernier === null || c.jour > entree.dernier) entree.dernier = c.jour;
      // Le titre le plus recent gagne : une recette renommee doit apparaitre sous
      // son nom actuel, pas sous celui qu'elle portait il y a six mois.
      if (c.jour === entree.dernier) entree.titre = c.titre;
    });

    return liste.sort(function (a, b) {
      if (b.nb !== a.nb) return b.nb - a.nb;
      if (a.dernier !== b.dernier) return String(b.dernier).localeCompare(String(a.dernier));
      return String(a.titre).localeCompare(String(b.titre), 'fr');
    });
  }

  // --- Modifications ----------------------------------------------------------

  function horodatage() {
    return new Date().toISOString();
  }

  function fabriquer(cle, jourCle, moment, plat) {
    return {
      cle: cle,
      jour: jourCle,
      moment: moment,
      type: plat.type === TYPE_LIBRE ? TYPE_LIBRE : TYPE_RECETTE,
      recetteId: plat.type === TYPE_LIBRE ? '' : plat.recetteId || '',
      titre: plat.titre,
      modifieLe: horodatage(),
    };
  }

  /**
   * Ajoute un plat a un repas, sans toucher a ce qui s'y trouve deja. `plat` est
   *   { type: 'recette', recetteId, titre }  ou  { type: 'libre', titre }.
   *
   * C'est l'operation normale : un repas peut porter un plat et un dessert.
   */
  function ajouter(jourCle, moment, plat) {
    if (!plat || !plat.titre) return Promise.resolve(tous());
    var nouveau = fabriquer(Semaine.cleItem(jourCle, moment, Semaine.suffixeItem()), jourCle, moment, plat);
    return appliquer(trier(tous().concat([nouveau])), { type: 'ecrire', creneau: nouveau });
  }

  /**
   * Remplace tout le contenu d'un repas par ce seul plat.
   * Sert quand on veut explicitement repartir de zero sur un creneau.
   */
  function poser(jourCle, moment, plat) {
    if (!plat || !plat.titre) return Promise.resolve(tous());
    var anciens = creneaux(jourCle, moment);
    var nouveau = fabriquer(Semaine.cleItem(jourCle, moment, Semaine.suffixeItem()), jourCle, moment, plat);

    var aRetirer = {};
    anciens.forEach(function (c) {
      aRetirer[c.cle] = true;
    });

    var operations = anciens.map(function (c) {
      return { type: 'supprimer', cle: c.cle };
    });
    operations.push({ type: 'ecrire', creneau: nouveau });

    return appliquer(
      trier(
        tous()
          .filter(function (c) {
            return !aRetirer[c.cle];
          })
          .concat([nouveau])
      ),
      operations
    );
  }

  /** Retire un plat, designe par sa cle de document. */
  function retirer(cle) {
    var avant = tous();
    var apres = avant.filter(function (c) {
      return c.cle !== cle;
    });
    if (apres.length === avant.length) return Promise.resolve(avant);
    return appliquer(apres, { type: 'supprimer', cle: cle });
  }

  /** Vide un repas, avec tous les plats qu'il porte. */
  function vider(jourCle, moment) {
    var vises = creneaux(jourCle, moment);
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

  /**
   * Deplace un plat, designe par sa cle, vers un autre repas.
   *
   * Il n'y a plus d'echange entre les deux creneaux : le plat vient s'ajouter a
   * l'arrivee. L'echange n'existait que parce qu'un repas ne portait qu'un plat et
   * qu'il fallait bien eviter d'en effacer un ; ce n'est plus le cas.
   */
  function deplacer(cle, versJour, versMoment) {
    var depart = parCle()[cle];
    if (!depart) return Promise.resolve(tous());
    if (depart.jour === versJour && depart.moment === versMoment) return Promise.resolve(tous());

    // Le plat prend un nouvel horodatage : il arrive derriere ce qui est deja pose,
    // ce qui est ce qu'on voit en le lachant sur la case.
    var pose = fabriquer(Semaine.cleItem(versJour, versMoment, Semaine.suffixeItem()), versJour, versMoment, depart);

    return appliquer(
      trier(
        tous()
          .filter(function (c) {
            return c.cle !== cle;
          })
          .concat([pose])
      ),
      [
        { type: 'ecrire', creneau: pose },
        { type: 'supprimer', cle: cle },
      ]
    );
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
    creneaux: creneaux,
    parCle: parCle,
    parCreneau: parCreneau,
    platsDeLaSemaine: platsDeLaSemaine,

    realisations: realisations,
    comptes: comptes,
    nbFois: nbFois,
    derniereFois: derniereFois,
    classement: classement,

    ajouter: ajouter,
    poser: poser,
    retirer: retirer,
    vider: vider,
    deplacer: deplacer,
    retirerRecette: retirerRecette,
  };

  if (estNode) module.exports = api;
  else global.CarnetSemainier = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
