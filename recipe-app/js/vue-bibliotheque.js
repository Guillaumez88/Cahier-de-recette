/* L'écran « Bibliothèque » : les livres de cuisine de la maison.

   Deuxième écran sorti de app.js, sur le même contrat étroit que vue-magasin.js : ce
   module ne connaît ni le routage, ni l'en-tête, ni les boîtes modales. Il reçoit ses
   outils de rendu et rend un fragment.

   ## Ce que l'écran montre

   Des étagères, pas des recettes. Un livre est un ouvrage papier de la maison, auquel
   on rattache des recettes au fil de leur saisie ; un livre sans aucune recette reste
   listé, parce qu'il existe quand même sur l'étagère et qu'on y rangera quelque chose.
   Les recettes d'un livre ne sont pas dans le livre de cuisine, donc pas dans le
   planning de la semaine : c'est tout l'objet de cette séparation.

   ## Le champ de recherche traverse toute la bibliothèque

   C'est la seule chose que cet écran fait qui ne soit pas une liste de livres, et elle
   est demandée : chercher une tarte sans avoir à se rappeler dans quel ouvrage elle
   se trouve. La recherche remplace alors la grille de livres par des résultats, chaque
   carte portant le nom de son livre. La recherche propre à un livre, elle, est sur
   l'écran du livre et ne regarde que ses recettes.

   ## Les couleurs viennent du thème, mais pas d'une liste figée

   Un thème n'est pas un choix fermé : « Conserves » doit pouvoir apparaître sans qu'on
   touche au code. Sa couleur est donc tirée d'une empreinte de son nom sur trois
   palettes, ce qui la rend stable d'un chargement à l'autre sans table à maintenir. Un
   livre vide reste neutre, quel que soit son thème : sa couverture dit qu'il attend
   encore quelque chose.

   Expose window.CarnetVueBibliotheque dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  // Deux palettes, et non trois : la troisieme aurait ete un neutre, or le neutre est
  // deja pris par les livres vides. Un livre garni qui ressemble a un livre vide est
  // pire qu'une couleur repetee.
  var NB_PALETTES = 2;

  /**
   * Palette d'un thème : une empreinte de son nom, ramenée sur trois valeurs.
   *
   * djb2, le même que celui de sync.js pour désambiguïser des slugs. On ne cherche
   * pas une répartition parfaite, seulement une couleur stable : « Pâtisserie » doit
   * garder la sienne d'un chargement à l'autre, et deux thèmes de même couleur ne
   * gênent personne, chaque groupe portant son intertitre.
   */
  function palette(theme) {
    var h = 5381;
    var texte = String(theme || '');
    for (var i = 0; i < texte.length; i += 1) {
      h = ((h << 5) + h + texte.charCodeAt(i)) | 0;
    }
    return (h >>> 0) % NB_PALETTES;
  }

  function libelleCompte(n) {
    if (n === 0) return 'aucune recette pour l’instant';
    return n + (n > 1 ? ' recettes' : ' recette');
  }

  /**
   * Construit l'écran.
   *
   * `outils` :
   *   el, icone                fabriques de nœuds
   *   Lv                       le module des livres
   *   Rc                       le module des recettes
   *   carteRecette(recette)    la carte d'une recette, celle du livre de cuisine
   *   chercher(recettes, mot)  la recherche, telle que le livre de cuisine la fait
   *   rendre()                 re-rend cet écran
   *   annoncer(phrase)         annonce aux lecteurs d'écran
   *   surCreer(theme)          ouvre la boîte de création, thème pré-rempli
   *   etat                     { themeBiblio, rechercheBiblio }, tenu par l'appelant
   */
  function construire(outils) {
    var el = outils.el;
    var icone = outils.icone;
    var Lv = outils.Lv;
    var Rc = outils.Rc;
    var carteRecette = outils.carteRecette;
    var chercher = outils.chercher;
    var rendre = outils.rendre;
    var annoncer = outils.annoncer || function () {};
    var surCreer = outils.surCreer;
    var etat = outils.etat || {};

    var livres = Lv.tous();
    var comptes = Rc.comptesParLivre();
    var groupes = Lv.parTheme();
    var recherche = String(etat.rechercheBiblio || '');

    var fragment = global.document.createDocumentFragment();

    fragment.appendChild(el('a', { class: 'retour', href: '#/', texte: '‹ Retour à l’accueil' }));

    fragment.appendChild(
      el('div', { class: 'livre__entete' }, [
        el('div', {}, [
          el('h1', { class: 'fiche__titre', texte: 'Bibliothèque' }),
          el('p', {
            class: 'accroche',
            texte:
              'Les livres de cuisine de la maison, pour y rattacher des recettes au fil de leur saisie. ' +
              'Leurs recettes restent hors du planning de la semaine, sauf celles qu’on remonte dans le livre de cuisine.',
          }),
        ]),
        el('div', { class: 'livre__actions' }, [
          el('button', {
            type: 'button',
            class: 'bouton',
            id: 'creer-livre',
            onclick: function () {
              surCreer(etat.themeBiblio || '');
            },
          }, [icone('plus', { taille: 18 }), el('span', { texte: 'Créer un livre' })]),
        ]),
      ])
    );

    // --- Recherche, sur toute la bibliothèque --------------------------------

    var champ = el('input', {
      type: 'search',
      class: 'champ-recherche',
      id: 'recherche-bibliotheque',
      placeholder: 'Rechercher dans tous les livres…',
      'aria-label': 'Rechercher une recette dans toute la bibliothèque',
      value: recherche,
      oninput: function (evenement) {
        etat.rechercheBiblio = evenement.target.value;
        rendre();
      },
    });
    fragment.appendChild(el('div', { class: 'filtres filtres--seul' }, [champ]));

    if (recherche.trim() !== '') {
      var trouvees = chercher(Rc.deLaBibliotheque(), recherche);
      fragment.appendChild(
        el('div', { class: 'barre-resultats' }, [
          el('span', {
            texte:
              trouvees.length === 0
                ? 'Aucune recette de la bibliothèque ne correspond'
                : trouvees.length + ' recette' + (trouvees.length > 1 ? 's' : '') + ' dans la bibliothèque',
          }),
          el('button', {
            type: 'button',
            class: 'lien-action',
            id: 'effacer-recherche-bibliotheque',
            texte: 'Tout effacer',
            onclick: function () {
              etat.rechercheBiblio = '';
              rendre();
            },
          }),
        ])
      );

      if (trouvees.length === 0) {
        fragment.appendChild(
          el('div', { class: 'etat-vide' }, [
            el('p', { texte: 'Rien de ce nom dans les livres.' }),
            el('p', { texte: 'La recherche du livre de cuisine, elle, est sur l’écran « Le livre ».' }),
          ])
        );
      } else {
        fragment.appendChild(
          el(
            'div',
            { class: 'grille', id: 'resultats-bibliotheque' },
            trouvees.map(function (recette) {
              return carteRecette(recette);
            })
          )
        );
      }
      return fragment;
    }

    // --- Aucun livre ---------------------------------------------------------

    if (livres.length === 0) {
      fragment.appendChild(
        el('div', { class: 'etat-vide', id: 'bibliotheque-vide' }, [
          el('p', { texte: 'La bibliothèque est vide.' }),
          el('p', {
            texte:
              'Créez un livre pour chaque ouvrage de la maison, puis rattachez-lui ses recettes ' +
              'au fur et à mesure. Rien n’oblige à tout saisir d’un coup.',
          }),
        ])
      );
      return fragment;
    }

    // --- Filtre par thème ----------------------------------------------------

    var themeActif = etat.themeBiblio || null;

    function pilule(libelle, valeur, nb) {
      var actif = themeActif === valeur;
      return el('button', {
        type: 'button',
        class: 'pilule',
        'data-theme-livre': valeur === null ? 'tous' : valeur,
        'aria-pressed': actif ? 'true' : 'false',
        texte: libelle + ' · ' + nb,
        onclick: function () {
          etat.themeBiblio = actif ? null : valeur;
          rendre();
        },
      });
    }

    fragment.appendChild(
      el(
        'div',
        { class: 'rangee-filtre rangee-filtre--themes' },
        [pilule('Tous', null, livres.length)].concat(
          groupes.map(function (groupe) {
            return pilule(groupe.theme, groupe.theme, groupe.livres.length);
          })
        )
      )
    );

    var visibles = themeActif
      ? groupes.filter(function (g) {
          return g.theme === themeActif;
        })
      : groupes;

    visibles.forEach(function (groupe, rang) {
      fragment.appendChild(
        el('h2', { class: 'biblio__theme', texte: groupe.theme + ' · ' + groupe.livres.length })
      );

      var cartes = groupe.livres.map(function (livre) {
        var nb = comptes[livre.id] || 0;
        var vide = nb === 0;
        return el(
          'a',
          {
            class: 'livre-carte' + (vide ? ' livre-carte--vide' : ' livre-carte--p' + palette(livre.theme)),
            href: '#/bibliotheque/' + encodeURIComponent(livre.id),
            'data-livre': livre.id,
          },
          [
            el('span', { class: 'livre-carte__couverture' }, [icone('livre-ferme', { taille: 30 })]),
            el('span', { class: 'livre-carte__corps' }, [
              el('span', { class: 'etiquette etiquette--sobre', texte: livre.theme }),
              el('span', { class: 'livre-carte__titre', texte: livre.titre }),
              livre.auteur ? el('span', { class: 'livre-carte__auteur', texte: livre.auteur }) : null,
              el('span', {
                class: 'livre-carte__compte' + (vide ? ' livre-carte__compte--vide' : ''),
                texte: libelleCompte(nb),
              }),
            ]),
          ]
        );
      });

      // La carte d'ajout ferme le dernier groupe affiché, et pas chacun d'eux :
      // répétée sept fois elle deviendrait du décor. Quand un thème est filtré, elle
      // crée dans ce thème, ce qui est ce qu'on attend en le regardant.
      if (rang === visibles.length - 1) {
        cartes.push(
          el('button', {
            type: 'button',
            class: 'livre-carte livre-carte--ajout',
            id: 'ajouter-livre',
            onclick: function () {
              surCreer(themeActif || groupe.theme);
            },
          }, [icone('plus', { taille: 20 }), el('span', { texte: 'Ajouter un livre' })])
        );
      }

      fragment.appendChild(el('div', { class: 'grille-livres' }, cartes));
    });

    annoncer('Bibliothèque, ' + livres.length + (livres.length > 1 ? ' livres' : ' livre'));
    return fragment;
  }

  var api = { palette: palette, libelleCompte: libelleCompte, construire: construire };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.CarnetVueBibliotheque = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
