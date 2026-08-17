/* Partager un livre ou une recette avec le compte de quelqu'un d'autre.

   ## Ce que c'est, et ce que ce n'est pas

   Partager n'est **pas** copier : rien n'est dupliqué. Le foyer ouvre en lecture une
   partie de son carnet à un compte extérieur, qui lit les documents d'origine. Une
   recette corrigée l'est donc aussi chez la personne avec qui on l'a partagée.

   Deux documents par partage, et pas un de plus :

     foyers/{foyer}/partages/{uid}      le manifeste : ce qui est ouvert, à qui
     utilisateurs/{uid}/recus/{foyer}   l'avis déposé chez le bénéficiaire

   Le manifeste sert aux règles Firestore, qui ne savent pas filtrer une requête de
   collection : le bénéficiaire lit chaque recette par son identifiant, et la règle
   vérifie que cet identifiant y figure. L'avis sert au bénéficiaire, qui ne peut pas
   parcourir les foyers du monde pour trouver ce qu'on lui a donné.

   ## Ce qu'il faut savoir avant de s'en servir

   **Un livre partagé ne s'élargit pas tout seul.** Le manifeste fige la liste de ses
   recettes au moment du partage. Une recette ajoutée ensuite reste invisible tant qu'on
   n'a pas repartagé. C'est explicite : un partage ne s'étend pas sans qu'on le décide.

   **On ne partage qu'avec un compte qui existe.** L'adresse est cherchée dans
   l'annuaire ; inconnue, le partage échoue franchement au lieu de laisser croire qu'un
   message est parti quelque part.

   **Le bénéficiaire ne peut rien modifier**, ni voir le reste du foyer : ni la liste de
   courses, ni le semainier, ni les recettes hors manifeste.

   Expose window.CarnetPartageCompte dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  var estNode = typeof module !== 'undefined' && module.exports;
  var Sync = estNode ? require('./sync.js') : global.CarnetSync;

  function foyer() {
    return Sync.foyer();
  }

  function uniques(liste) {
    var vus = {};
    return (liste || []).filter(function (valeur) {
      if (!valeur || vus[valeur]) return false;
      vus[valeur] = true;
      return true;
    });
  }

  /**
   * Trouve le compte d'une adresse, en refusant les cas qui n'ont pas de sens.
   *
   * Rend { ok, uid, email } ou { ok: false, raison }.
   */
  async function trouverLeCompte(email) {
    var propre = String(email || '').trim();
    if (!propre) return { ok: false, raison: 'Saisir l’adresse du compte avec qui partager.' };

    var courant = Sync.compteCourant();
    if (courant && Sync.cleAnnuaire(courant.email) === Sync.cleAnnuaire(propre)) {
      return { ok: false, raison: 'C’est votre propre adresse : il n’y a rien à partager avec vous-même.' };
    }

    var fiche;
    try {
      fiche = await Sync.chercherDansAnnuaire(propre);
    } catch (erreur) {
      return { ok: false, raison: 'L’annuaire n’a pas répondu : ' + erreur.message };
    }
    if (!fiche || !fiche.uid) {
      return {
        ok: false,
        raison:
          'Aucun compte à cette adresse. La personne doit d’abord créer son compte sur ' +
          'le carnet, puis s’y connecter une fois.',
      };
    }
    return { ok: true, uid: fiche.uid, email: fiche.email || propre };
  }

  /**
   * Ajoute des recettes et des livres à ce qu'un foyer ouvre à un compte.
   *
   * Le manifeste existant est relu et complété, jamais remplacé : partager une seconde
   * recette avec la même personne ne doit pas lui retirer la première.
   */
  async function ouvrir(email, ajout) {
    var foyerId = foyer();
    if (!foyerId) return { ok: false, raison: 'Aucun foyer courant.' };

    var trouve = await trouverLeCompte(email);
    if (!trouve.ok) return trouve;

    var existant = null;
    try {
      existant = await Sync.lirePartage(foyerId, trouve.uid);
    } catch (erreur) {
      return { ok: false, raison: 'Le partage n’a pas pu être lu : ' + erreur.message };
    }

    var manifeste = {
      emailBeneficiaire: trouve.email,
      recettes: uniques(((existant && existant.recettes) || []).concat(ajout.recettes || [])),
      livres: uniques(((existant && existant.livres) || []).concat(ajout.livres || [])),
    };

    try {
      await Sync.ecrirePartage(foyerId, trouve.uid, manifeste);
    } catch (erreur) {
      if (erreur.statut === 403) {
        return { ok: false, raison: 'Le serveur a refusé : seul un membre en modification peut partager.' };
      }
      return { ok: false, raison: 'Le partage n’a pas pu être enregistré : ' + erreur.message };
    }

    // L'avis chez le bénéficiaire vient après le manifeste : un avis sans manifeste
    // mènerait à un écran vide, un manifeste sans avis se rattrape en repartageant.
    var courant = Sync.compteCourant();
    try {
      await Sync.ecrireRecu(trouve.uid, foyerId, {
        nomFoyer: ajout.nomFoyer || '',
        emailPartageur: (courant && courant.email) || '',
      });
    } catch (erreur) {
      return {
        ok: false,
        avertissement: true,
        raison:
          'Le partage est enregistré, mais l’avis n’a pas pu être déposé chez ' +
          trouve.email +
          ' : ' +
          erreur.message,
      };
    }

    return { ok: true, uid: trouve.uid, email: trouve.email, manifeste: manifeste };
  }

  /** Partage une recette. */
  function partagerRecette(email, recetteId, nomFoyer) {
    return ouvrir(email, { recettes: [recetteId], nomFoyer: nomFoyer });
  }

  /**
   * Partage un livre, et les recettes qu'il contient au moment du partage.
   *
   * Les deux vont ensemble : un livre sans ses recettes n'ouvrirait qu'un titre.
   */
  function partagerLivre(email, livreId, recetteIds, nomFoyer) {
    return ouvrir(email, { livres: [livreId], recettes: recetteIds || [], nomFoyer: nomFoyer });
  }

  /** Ce que ce foyer partage, un manifeste par bénéficiaire. */
  async function mesPartages() {
    var foyerId = foyer();
    if (!foyerId) return [];
    return Sync.lirePartages(foyerId);
  }

  /** Ferme un partage : le manifeste et l'avis partent ensemble. */
  async function fermer(uid) {
    var foyerId = foyer();
    if (!foyerId) return { ok: false, raison: 'Aucun foyer courant.' };
    try {
      await Sync.supprimerPartage(foyerId, uid);
      // L'avis en second : s'il subsiste seul, il mène à un écran qui dit « plus rien
      // n'est partagé », ce qui est la vérité.
      await Sync.supprimerRecu(uid, foyerId);
    } catch (erreur) {
      return { ok: false, raison: 'Le partage n’a pas pu être fermé : ' + erreur.message };
    }
    return { ok: true };
  }

  /** Ce que d'autres foyers m'ont ouvert : un avis par foyer. */
  function recus() {
    return Sync.lireRecus();
  }

  /**
   * Le contenu d'un partage reçu : les livres et les recettes lisibles.
   *
   * Une lecture par recette, sans pagination possible : un manifeste énorme coûterait
   * cher. Il est borné à 500 recettes par les règles, ce qui est déjà beaucoup pour un
   * carnet de maison, et l'écran prévient au-delà de 100.
   */
  async function contenuRecu(foyerId) {
    var courant = Sync.compteCourant();
    if (!courant) return { livres: [], recettes: [] };

    var manifeste = await Sync.lirePartage(foyerId, courant.uid);
    if (!manifeste) return { livres: [], recettes: [], absent: true };

    var livres = [];
    for (var i = 0; i < manifeste.livres.length; i += 1) {
      var livre = await Sync.lireLivreDeFoyer(foyerId, manifeste.livres[i]);
      if (livre) livres.push(livre);
    }

    // Une recette du carnet d'origine, jamais modifiée, n'a pas de document Firestore :
    // elle vit dans le fichier servi avec le site, que tout le monde a déjà. Son
    // identifiant est alors rendu tel quel, et l'écran la lira dans sa propre base.
    // Une recette vraiment disparue (supprimée depuis le partage) l'est aussi : les
    // deux cas se distinguent chez l'appelant, qui sait ce que contient le carnet.
    var recettes = [];
    var sansDocument = [];
    for (var j = 0; j < manifeste.recettes.length; j += 1) {
      var recette = await Sync.lireRecetteDeFoyer(foyerId, manifeste.recettes[j]);
      if (recette) recettes.push(recette);
      else sansDocument.push(manifeste.recettes[j]);
    }

    return { livres: livres, recettes: recettes, sansDocument: sansDocument, manifeste: manifeste };
  }

  var api = {
    trouverLeCompte: trouverLeCompte,
    partagerRecette: partagerRecette,
    partagerLivre: partagerLivre,
    mesPartages: mesPartages,
    fermer: fermer,
    recus: recus,
    contenuRecu: contenuRecu,
  };

  if (estNode) module.exports = api;
  else global.CarnetPartageCompte = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
