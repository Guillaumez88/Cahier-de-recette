/* Mode « En magasin » : la liste de courses, réduite à ce qu'on fait en magasin.

   Premier écran sorti de app.js, qui portait jusqu'ici les cinq vues dans un seul
   fichier de 3 700 lignes. Le contrat est volontairement étroit : ce module ne
   connaît ni le routage, ni l'en-tête, ni les boîtes modales. Il reçoit ses outils
   de rendu en paramètre et rend un fragment. C'est ce qui le laisse testable et
   ce qui permettra de sortir les autres écrans un par un.

   Ce que ce mode enlève, et pourquoi : le formulaire d'ajout, les groupes de lignes
   proches, la provenance des ingrédients, les actions de nettoyage. En magasin, une
   main tient le téléphone et l'autre le panier ; ce qui reste doit tenir sur un
   écran et se cocher sans viser.

   Ce qu'il garde : l'ordre des rayons, qui est l'ordre du parcours, et le total
   restant, qui dit s'il faut encore avancer.

   Expose window.CarnetVueMagasin dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  /**
   * Construit l'écran.
   *
   * `outils` porte tout ce que ce module ne sait pas fabriquer lui-même :
   *   el(balise, attributs, enfants)  fabrique un nœud
   *   icone(nom, options)             fabrique un pictogramme
   *   S                               le module de liste de courses
   *   rendre()                        re-rend cet écran après une modification
   *   annoncer(phrase)                annonce aux lecteurs d'écran
   *   etat                            { voirCoches: bool }, conservé par l'appelant
   */
  function construire(outils) {
    var el = outils.el;
    var icone = outils.icone;
    var S = outils.S;
    var rendre = outils.rendre;
    var annoncer = outils.annoncer || function () {};
    var etat = outils.etat || {};

    var articles = S.getShoppingList();
    var groupes = S.listeParRayon(articles);

    var toutesLignes = groupes.reduce(function (total, g) {
      return total.concat(g.lignes);
    }, []);
    var restants = toutesLignes.filter(function (l) {
      return !l.coche;
    }).length;
    var coches = toutesLignes.length - restants;

    var fragment = global.document.createDocumentFragment();

    // --- En-tête : sortir, et où on en est ---------------------------------
    fragment.appendChild(
      el('div', { class: 'magasin__entete' }, [
        el('a', {
          class: 'bouton bouton--sobre',
          href: '#/liste-de-courses',
          id: 'quitter-magasin',
        }, [icone('croix', { taille: 16 }), el('span', { texte: 'Quitter' })]),
        el('p', { class: 'magasin__compteur', id: 'magasin-compteur' }, [
          el('strong', { texte: String(restants) }),
          el('span', { texte: restants > 1 ? ' à prendre' : ' à prendre' }),
        ]),
      ])
    );

    if (toutesLignes.length === 0) {
      fragment.appendChild(
        el('div', { class: 'etat-vide' }, [
          el('p', { texte: 'La liste est vide.' }),
          el('p', { texte: 'Rien à prendre : vous pouvez ranger le téléphone.' }),
        ])
      );
      return fragment;
    }

    if (restants === 0) {
      fragment.appendChild(
        el('div', { class: 'magasin__fini', id: 'magasin-fini' }, [
          el('p', { class: 'magasin__fini-titre', texte: 'Tout est pris.' }),
          el('p', { texte: 'Les ' + coches + ' lignes sont cochées. Bon retour.' }),
        ])
      );
    }

    // --- Les rayons ---------------------------------------------------------
    //
    // Une ligne cochée disparaît : c'est ce qui fait avancer la liste sous les yeux.
    // Elle reste consultable d'un dépli, sinon décocher une erreur serait impossible
    // sans quitter le mode.
    groupes.forEach(function (groupe) {
      var aPrendre = groupe.lignes.filter(function (l) {
        return !l.coche;
      });
      if (aPrendre.length === 0) return;

      fragment.appendChild(
        el('section', { class: 'magasin__rayon', 'data-rayon-magasin': groupe.rayon }, [
          el('h2', { class: 'magasin__rayon-titre' }, [
            el('span', { texte: groupe.rayon }),
            el('span', { class: 'magasin__rayon-nb', texte: String(aPrendre.length) }),
          ]),
          el(
            'ul',
            { class: 'magasin__lignes' },
            aPrendre.map(function (ligne) {
              return ligneMagasin(ligne, { el: el, S: S, rendre: rendre, annoncer: annoncer });
            })
          ),
        ])
      );
    });

    // --- Ce qui est déjà pris ----------------------------------------------
    if (coches > 0) {
      fragment.appendChild(
        el('div', { class: 'magasin__coches' }, [
          el('button', {
            type: 'button',
            class: 'bouton bouton--sobre',
            id: 'voir-coches',
            'aria-expanded': etat.voirCoches ? 'true' : 'false',
            onclick: function () {
              etat.voirCoches = !etat.voirCoches;
              rendre();
            },
          }, [
            icone(etat.voirCoches ? 'croix' : 'coche', { taille: 16 }),
            el('span', {
              texte:
                (etat.voirCoches ? 'Masquer les ' : 'Voir les ') +
                coches +
                (coches > 1 ? ' lignes prises' : ' ligne prise'),
            }),
          ]),
          etat.voirCoches
            ? el(
                'ul',
                { class: 'magasin__lignes magasin__lignes--coches', id: 'lignes-coches' },
                toutesLignes
                  .filter(function (l) {
                    return l.coche;
                  })
                  .map(function (ligne) {
                    return ligneMagasin(ligne, { el: el, S: S, rendre: rendre, annoncer: annoncer });
                  })
              )
            : null,
        ])
      );
    }

    return fragment;
  }

  /**
   * Une ligne, taillée pour le doigt.
   *
   * Toute la ligne est la cible, pas seulement la case : viser une case de 20 px en
   * marchant est le geste que ce mode existe pour supprimer.
   */
  function ligneMagasin(ligne, outils) {
    var el = outils.el;

    var caseCoche = el('input', {
      type: 'checkbox',
      class: 'magasin__case',
      checked: ligne.coche ? true : null,
      'aria-label': (ligne.coche ? 'Décocher ' : 'Cocher ') + ligne.nom,
      onchange: function (evenement) {
        var coche = evenement.target.checked;
        // Une ligne peut recouvrir plusieurs articles : on les coche tous.
        outils.S.cocherArticles(ligne.articles, coche).then(function () {
          outils.annoncer(ligne.nom + (coche ? ' pris' : ' remis dans la liste'));
          outils.rendre();
        });
      },
    });

    return el('li', { class: 'magasin__ligne' + (ligne.coche ? ' magasin__ligne--coche' : ''), 'data-ligne-magasin': ligne.nom }, [
      el('label', { class: 'magasin__label' }, [
        caseCoche,
        el('span', { class: 'magasin__nom', texte: ligne.nom }),
        ligne.quantite ? el('span', { class: 'magasin__quantite', texte: ligne.quantite }) : null,
      ]),
    ]);
  }

  var api = { construire: construire };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.CarnetVueMagasin = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
