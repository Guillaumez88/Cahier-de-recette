/* Partager une recette : en texte, et par un lien.

   Deux besoins distincts, souvent confondus, et le module rend les deux :

   1. **Le texte.** Quand on envoie une recette a quelqu'un par message, il veut la
      recette, pas un lien a ouvrir : les ingredients avec leurs quantites et les
      etapes, lisibles tels quels dans la conversation. C'est `enTexte()`.

   2. **Le lien.** Pour quelqu'un de la maison, qui a le carnet, un lien vers la
      fiche est plus utile que du texte recopie. C'est `lien()`.

   ## Ce qu'un lien partage donne vraiment, et a qui

   Le site est public et l'authentification est anonyme : n'importe qui ouvrant le
   lien obtient une session et peut lire les recettes ajoutees ou modifiees, qui
   vivent dans Firestore. Un lien fonctionne donc pour tout le monde, et il ouvre la
   fiche a jour, pas une copie figee.

   Deux reserves, et elles sont reelles. `recettes.js` applique une modification en
   local **puis** tente l'envoi, et n'a pas de file d'attente : un envoi qui echoue
   n'est pas rejoue. Donc :

   - une recette **ajoutee ici** dont l'envoi a echoue n'existe que sur cet appareil :
     le lien menerait a « Recette introuvable » ;
   - une recette **modifiee ici** dont l'envoi a echoue existe bien sur le serveur,
     mais dans sa version anterieure : le lien marche, et montre autre chose que ce
     qu'on a sous les yeux.

   `partageable()` distingue les deux : la premiere interdit le lien, la seconde ne
   fait que le nuancer. Le texte, lui, est toujours partageable : il ne depend que de
   ce qui est affiche.

   ## Pas de mise en forme

   Le texte produit est du texte brut, sans asterisques ni tirets decoratifs. Chaque
   application de messagerie a sa propre syntaxe de gras, et un `*mot*` qui ne
   s'interprete pas est plus laid qu'une absence de gras.

   Expose window.CarnetPartage dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  var estNode = typeof module !== 'undefined' && module.exports;
  var Logic = estNode ? require('./logic.js') : global.CarnetLogic;

  /**
   * Adresse publique de la fiche.
   *
   * `base` est l'adresse ou tourne le carnet. Tout ce qui suit le chemin est retire :
   * l'ancre, parce qu'elle designe l'ecran courant et non la fiche, la chaine de
   * requete, et un `index.html` final, sinon le lien porterait
   * `.../index.html/#/recette/x`, qui n'est pas une adresse valide.
   *
   * Le lien porte une ancre : le routage du carnet est par ancre, il n'y a pas
   * d'autre forme d'URL.
   */
  function lien(recette, base) {
    if (!recette || !recette.id) return '';
    var racine = String(base || '')
      .replace(/#.*$/, '')
      .replace(/\?.*$/, '')
      .replace(/\/index\.html$/i, '')
      .replace(/\/+$/, '');
    return racine + '/#/recette/' + encodeURIComponent(recette.id);
  }

  /**
   * Un lien vers cette fiche mene-t-il a quelque chose, et a quoi ?
   *
   * `contexte` porte les deux seules informations dont la reponse depend :
   *
   *   ajoutee          la recette a ete creee ici, elle n'est pas dans data/recipes.json
   *   erreurEcriture   message de la derniere ecriture de recette en echec, ou null
   *
   * Rend { possible, raison, reserve }. `raison` et `reserve` sont des phrases
   * affichables, pas des codes : elles nomment ce qui manque.
   */
  function partageable(recette, contexte) {
    var c = contexte || {};

    if (!recette || !recette.id) {
      return { possible: false, raison: 'cette recette n’a pas encore d’identifiant', reserve: null };
    }

    if (c.ajoutee && c.erreurEcriture) {
      return {
        possible: false,
        raison:
          'cette recette n’est pas arrivée sur le serveur (' +
          c.erreurEcriture +
          '). Elle n’existe que sur cet appareil, et le lien mènerait à une fiche ' +
          'introuvable. Rouvrez-la et enregistrez-la une fois le réseau revenu.',
        reserve: null,
      };
    }

    if (c.erreurEcriture) {
      return {
        possible: true,
        raison: null,
        reserve:
          'la dernière modification n’a pas pu être envoyée (' +
          c.erreurEcriture +
          '). Le lien ouvrira la version précédente de la fiche.',
      };
    }

    return { possible: true, raison: null, reserve: null };
  }

  /** Une ligne d'ingredient : « Olives noires : 200 g », ou le nom seul. */
  function ligneIngredient(item) {
    var nom = String((item && item.nom) || '').trim();
    var quantite = String((item && item.quantite) || '').trim();
    if (nom === '') return '';
    return quantite === '' ? nom : nom + ' : ' + quantite;
  }

  /**
   * La recette en texte brut, prete a coller dans un message.
   *
   * `options.lien` ajoute l'adresse de la fiche en fin de texte. `options.parts`
   * remplace le nombre de parts affiche, pour une recette mise a l'echelle : sans
   * cela le texte annoncerait 4 personnes avec les quantites pour 8.
   */
  function enTexte(recette, options) {
    if (!recette || !recette.titre) return '';
    var reglages = options || {};
    var morceaux = [];

    morceaux.push(recette.titre);

    // Une ligne de contexte, seulement avec ce que la recette donne vraiment : un
    // « Non indiqué » recopie dans un message n'apporte rien.
    var contexte = [];
    var portions = reglages.parts || recette.portions;
    if (portions && !/^non indiqu/i.test(portions)) contexte.push(portions);
    if (recette.temps && recette.temps.total && !/^non indiqu/i.test(recette.temps.total)) {
      contexte.push(recette.temps.total);
    }
    if (contexte.length > 0) morceaux.push(contexte.join(' · '));

    morceaux.push('');
    morceaux.push('Ingrédients');
    (recette.ingredients || []).forEach(function (groupe) {
      if (groupe.groupe) morceaux.push(groupe.groupe + ' :');
      (groupe.items || []).forEach(function (item) {
        var ligne = ligneIngredient(item);
        if (ligne) morceaux.push('- ' + ligne);
      });
    });

    if ((recette.instructions || []).length > 0) {
      morceaux.push('');
      morceaux.push('Préparation');
      recette.instructions.forEach(function (etape, i) {
        // Le numero de la source est repris quand c'est un entier ; sinon on compte,
        // parce qu'une etape « Pour finir » ne peut pas servir de numero de liste.
        var numero = typeof etape.numero === 'number' ? etape.numero : i + 1;
        morceaux.push(numero + '. ' + String(etape.texte || '').trim());
        var astuce = Logic.stripTipPrefix(etape.astuce || '');
        if (astuce) morceaux.push('   Astuce : ' + astuce);
      });
    }

    // Ce que la source ne donne pas suit la recette : quelqu'un qui la cuisine doit
    // le savoir avant de commencer, pas le decouvrir devant ses casseroles.
    if ((recette.manquants || []).length > 0) {
      morceaux.push('');
      morceaux.push('À savoir');
      recette.manquants.forEach(function (m) {
        morceaux.push('- ' + m);
      });
    }

    if (recette.source && recette.source.label) {
      morceaux.push('');
      morceaux.push(
        'Source : ' + recette.source.label + (recette.source.url ? ' (' + recette.source.url + ')' : '')
      );
    }

    if (reglages.lien) {
      morceaux.push('');
      morceaux.push('La fiche : ' + reglages.lien);
    }

    return morceaux
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Ce que `navigator.share` attend.
   *
   * `text` porte la recette entiere et **pas** le lien : l'API le place elle-meme a
   * partir de `url`, et les applications qui ignorent `url` recoivent quand meme la
   * recette. Le repeter dans `text` le ferait apparaitre deux fois.
   */
  function chargeDePartage(recette, base, options) {
    var adresse = lien(recette, base);
    var reglages = {};
    Object.keys(options || {}).forEach(function (cle) {
      reglages[cle] = options[cle];
    });
    reglages.lien = null;

    var charge = { title: recette.titre, text: enTexte(recette, reglages) };
    if (adresse) charge.url = adresse;
    return charge;
  }

  var api = {
    lien: lien,
    partageable: partageable,
    ligneIngredient: ligneIngredient,
    enTexte: enTexte,
    chargeDePartage: chargeDePartage,
  };

  if (estNode) module.exports = api;
  else global.CarnetPartage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
