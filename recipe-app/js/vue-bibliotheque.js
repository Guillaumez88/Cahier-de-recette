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

  // Quatre palettes, tirées du nom du livre et non de son thème. Depuis que les livres
  // sont posés sur une étagère par thème, une couleur par thème donnait des rangées de
  // couvertures identiques : une vraie étagère est bariolée. Le neutre reste réservé
  // aux livres vides, un livre garni ne doit pas leur ressembler.
  var NB_PALETTES = 4;

  /**
   * Palette d'un livre : une empreinte de son nom, ramenée sur quatre valeurs.
   *
   * djb2, le même que celui de sync.js pour désambiguïser des slugs. On ne cherche pas
   * une répartition parfaite, seulement une couleur stable : « Le grand manuel du
   * pâtissier » doit garder la sienne d'un chargement à l'autre, et deux livres de même
   * couleur ne gênent personne, chacun portant son titre.
   */
  function palette(nom) {
    var h = 5381;
    var texte = String(nom || '');
    for (var i = 0; i < texte.length; i += 1) {
      h = ((h << 5) + h + texte.charCodeAt(i)) | 0;
    }
    return (h >>> 0) % NB_PALETTES;
  }

  /**
   * La couverture d'un livre, telle qu'elle s'affiche sur l'étagère et sur son écran.
   *
   * Un seul composant pour les deux : c'était le seul moyen qu'un livre ait la même
   * allure aux deux endroits, et la classe de taille (`couverture--grande`) est la seule
   * chose qui les distingue.
   *
   * Sans photo, la couverture est dessinée : un dos à gauche, un cartouche portant le
   * titre. C'est plus reconnaissable qu'un pictogramme répété d'un livre à l'autre, et
   * c'est ce qui donne à l'étagère l'aspect qu'on en attend.
   */
  function couvertureDe(outils, livre, options) {
    var el = outils.el;
    var reglages = options || {};
    var image = reglages.image || null;
    var vide = Boolean(reglages.vide);

    var classes = ['couverture'];
    if (reglages.grande) classes.push('couverture--grande');
    if (image) classes.push('couverture--illustre');
    else if (vide) classes.push('couverture--vide');
    else classes.push('couverture--p' + palette(livre.titre));

    return el(
      'span',
      { class: classes.join(' ') },
      image
        ? [el('img', { class: 'couverture__image', src: image, alt: 'Couverture de ' + livre.titre })]
        : [
            el('span', { class: 'couverture__dos', 'aria-hidden': 'true' }),
            el('span', { class: 'couverture__impression' }, [
              el('span', { class: 'couverture__titre', texte: livre.titre }),
              livre.auteur ? el('span', { class: 'couverture__auteur', texte: livre.auteur }) : null,
            ]),
          ]
    );
  }

  function libelleCompte(n) {
    if (n === 0) return 'aucune recette pour l’instant';
    return n + (n > 1 ? ' recettes' : ' recette');
  }

  /**
   * La même chose, en court, pour la légende sous une couverture.
   *
   * « aucune recette pour l'instant » prenait deux lignes sous un livre de 132 px de
   * large, et repoussait la planche de l'étagère. La phrase entière reste employée là
   * où la place ne manque pas, comme dans la boîte de déplacement d'une recette.
   */
  function libelleCompteCourt(n) {
    if (n === 0) return 'vide';
    return n + (n > 1 ? ' recettes' : ' recette');
  }

  /**
   * Construit l'écran.
   *
   * `outils` :
   *   el, icone                fabriques de nœuds
   *   Lv                       le module des livres
   *   Rc                       le module des recettes
   *   Ph                       le module des photos, pour les couvertures
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
    var Ph = outils.Ph;
    var carteRecette = outils.carteRecette;
    var chercher = outils.chercher;
    var rendre = outils.rendre;
    var annoncer = outils.annoncer || function () {};
    var surCreer = outils.surCreer;
    var etat = outils.etat || {};
    // Un appareil en lecture seule voit la bibliothèque et n'y crée rien : voir
    // js/acces.js. L'écran reste identique par ailleurs.
    var peutModifier = outils.peutModifier ? outils.peutModifier() : true;

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
        el('div', { class: 'livre__actions' }, peutModifier ? [
          el('button', {
            type: 'button',
            class: 'bouton',
            id: 'creer-livre',
            onclick: function () {
              surCreer(etat.themeBiblio || '');
            },
          }, [icone('plus', { taille: 18 }), el('span', { texte: 'Créer un livre' })]),
        ] : []),
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

    // Les thèmes sont repliés par défaut, comme les filtres du livre : ce qu'on vient
    // voir ici, ce sont les livres. Le bouton dit le thème posé quand il y en a un,
    // pour qu'un filtre oublié ne fasse pas croire à une bibliothèque dégarnie.
    var deplie = Boolean(etat.filtresBiblioDeplies);
    fragment.appendChild(
      el('div', { class: 'filtres filtres--themes' }, [
        el('button', {
          type: 'button',
          class: 'bouton-filtres' + (themeActif ? ' bouton-filtres--actif' : ''),
          id: 'basculer-themes',
          'aria-expanded': deplie ? 'true' : 'false',
          'aria-controls': 'panneau-themes',
          onclick: function () {
            etat.filtresBiblioDeplies = !deplie;
            rendre();
          },
        }, [
          icone('poignee', { taille: 16 }),
          el('span', { texte: themeActif ? 'Thème · ' + themeActif : 'Filtrer par thème' }),
        ]),
        deplie
          ? el(
              'div',
              { class: 'rangee-filtre rangee-filtre--themes', id: 'panneau-themes' },
              [pilule('Tous', null, livres.length)].concat(
                groupes.map(function (groupe) {
                  return pilule(groupe.theme, groupe.theme, groupe.livres.length);
                })
              )
            )
          : null,
      ])
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
        // La couverture photographiée remplace la couverture dessinée : c'est ce qui
        // permet de reconnaître un ouvrage d'un coup d'œil, ce qu'un titre en petit ne
        // fait pas dans une étagère de dix. La vignette suffit, elle est déjà en cache.
        var couverture = Ph ? Ph.vignette(Lv.clePhoto(livre.id)) : null;

        return el(
          'a',
          {
            class: 'livre-carte',
            href: '#/bibliotheque/' + encodeURIComponent(livre.id),
            'data-livre': livre.id,
            title: livre.titre + (livre.auteur ? ' — ' + livre.auteur : ''),
          },
          [
            couvertureDe(outils, livre, { image: couverture, vide: vide }),
            // La légende sous le livre reste courte : le thème est déjà l'intertitre du
            // groupe, et le titre est sur la couverture quand elle est dessinée.
            el('span', { class: 'livre-carte__corps' }, [
              couverture ? el('span', { class: 'livre-carte__titre', texte: livre.titre }) : null,
              couverture && livre.auteur
                ? el('span', { class: 'livre-carte__auteur', texte: livre.auteur })
                : null,
              el('span', {
                class: 'livre-carte__compte' + (vide ? ' livre-carte__compte--vide' : ''),
                texte: libelleCompteCourt(nb),
              }),
            ]),
          ]
        );
      });

      // La carte d'ajout ferme le dernier groupe affiché, et pas chacun d'eux :
      // répétée sept fois elle deviendrait du décor. Quand un thème est filtré, elle
      // crée dans ce thème, ce qui est ce qu'on attend en le regardant.
      if (rang === visibles.length - 1 && peutModifier) {
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

      // L'étagère : les livres sont posés dessus, et la planche se voit. C'est ce qui
      // fait qu'une grille de vignettes devient une bibliothèque.
      fragment.appendChild(
        el('div', { class: 'etagere' }, [el('div', { class: 'grille-livres' }, cartes)])
      );
    });

    annoncer('Bibliothèque, ' + livres.length + (livres.length > 1 ? ' livres' : ' livre'));
    return fragment;
  }

  var api = {
    palette: palette,
    couvertureDe: couvertureDe,
    libelleCompte: libelleCompte,
    libelleCompteCourt: libelleCompteCourt,
    construire: construire,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.CarnetVueBibliotheque = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
