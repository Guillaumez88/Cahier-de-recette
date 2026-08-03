/* Rendu et routage du carnet de recettes.
   Sans framework ni etape de construction : routage par ancre, rendu par creation
   de noeuds DOM.

   La logique metier est dans js/logic.js et l'acces a la liste de courses dans
   js/storage.js. Ce fichier ne fait que du rendu : il ne lit ni le localStorage ni
   ne filtre lui-meme. */

(function () {
  'use strict';

  var L = window.CarnetLogic;
  var S = window.CarnetStorage;
  var R = window.CarnetRayons;
  var Rc = window.CarnetRecettes;
  var Q = window.CarnetQuantites;
  var Fx = window.CarnetFlux;

  var criteresVides = L.criteresVides;
  var origineCourte = L.origineCourte;
  var difficulteCourte = L.difficulteCourte;
  var stripTipPrefix = L.stripTipPrefix;
  var TRANCHES_TEMPS = L.TRANCHES_TEMPS;
  var optionsDisponibles = L.optionsDisponibles;
  var filterRecipes = L.filterRecipes;
  var isFlowTableInformative = L.isFlowTableInformative;
  var largeurGrille = L.largeurGrille;

  var getShoppingList = S.getShoppingList;
  var addRecipeToList = S.addRecipeToList;
  var removeRecipeFromList = S.removeRecipeFromList;
  var toggleArticle = S.toggleArticle;
  var removeArticle = S.removeArticle;
  var clearShoppingList = S.clearShoppingList;
  var recetteDansListe = S.recetteDansListe;
  var grouperParRecette = S.grouperParRecette;

  var etat = { recettes: [], criteres: criteresVides() };

  /* --- rendu : petites aides ---------------------------------------------- */

  function el(balise, attributs, enfants) {
    var noeud = document.createElement(balise);
    Object.keys(attributs || {}).forEach(function (nom) {
      var valeur = attributs[nom];
      if (valeur === null || valeur === undefined || valeur === false) return;
      if (nom === 'onclick') noeud.addEventListener('click', valeur);
      else if (nom === 'oninput') noeud.addEventListener('input', valeur);
      else if (nom === 'onchange') noeud.addEventListener('change', valeur);
      else if (nom === 'onsubmit') noeud.addEventListener('submit', valeur);
      else if (nom === 'texte') noeud.textContent = valeur;
      else noeud.setAttribute(nom, valeur === true ? '' : String(valeur));
    });
    (Array.isArray(enfants) ? enfants : enfants ? [enfants] : []).forEach(function (enfant) {
      if (enfant === null || enfant === undefined || enfant === false) return;
      noeud.appendChild(typeof enfant === 'string' ? document.createTextNode(enfant) : enfant);
    });
    return noeud;
  }

  var SUFFIXE_CATEGORIE = { Entrée: 'olive', Plat: '', Dessert: 'ocre' };

  function classeCategorie(base, categorie) {
    var suffixe = SUFFIXE_CATEGORIE[categorie];
    return suffixe ? base + ' ' + base + '--' + suffixe : base;
  }

  function nbIngredients(recette) {
    return (recette.ingredients || []).reduce(function (total, groupe) {
      return total + (groupe.items || []).length;
    }, 0);
  }

  function majBadge() {
    var badge = document.getElementById('badge-courses');
    if (!badge) return;
    var restants = getShoppingList().filter(function (a) {
      return !a.coche;
    }).length;
    badge.textContent = String(restants);
    badge.hidden = restants === 0;
  }

  function monter(noeud) {
    var vue = document.getElementById('vue');
    vue.textContent = '';
    vue.appendChild(noeud);
    majBadge();
  }

  // Le badge et l'ecran de liste sont rafraichis par surChangementListe(),
  // abonne au demarrage (voir plus bas).

  /* --- vue : accueil ------------------------------------------------------- */

  function vueAccueil() {
    var recettes = Rc.toutes();
    var resultats = filterRecipes(recettes, etat.criteres);
    var options = optionsDisponibles(recettes);
    var fragment = document.createDocumentFragment();

    fragment.appendChild(
      el('p', {
        class: 'accroche',
        texte:
          recettes.length +
          ' recettes rassemblées, avec leurs astuces, leurs variantes et ce que leur source ne dit pas.',
      })
    );

    var rangees = [
      {
        cle: 'categorie',
        titre: 'Catégorie',
        valeurs: options.categories.map(function (v) {
          return { valeur: v, libelle: v, classe: classeCategorie('pilule', v) };
        }),
      },
      {
        cle: 'origine',
        titre: 'Origine',
        valeurs: options.origines.map(function (v) {
          return { valeur: v, libelle: v, classe: 'pilule' };
        }),
      },
      {
        cle: 'difficulte',
        titre: 'Difficulté',
        valeurs: options.difficultes.map(function (v) {
          return { valeur: v, libelle: v, classe: 'pilule' };
        }),
      },
      {
        cle: 'temps',
        titre: 'Temps total',
        valeurs: TRANCHES_TEMPS.map(function (t) {
          return { valeur: t.cle, libelle: t.libelle, classe: 'pilule' };
        }),
      },
    ];

    var champ = el('input', {
      type: 'search',
      class: 'champ-recherche',
      placeholder: 'Rechercher un plat, un ingrédient…',
      'aria-label': 'Rechercher une recette',
      value: etat.criteres.recherche || '',
      oninput: function (evenement) {
        etat.criteres.recherche = evenement.target.value;
        rendreAccueilPartiel();
      },
    });

    var blocFiltres = el('div', { class: 'filtres' }, [champ].concat(
      rangees.map(function (rangee) {
        return el('div', { class: 'rangee-filtre' }, [el('span', { class: 'rangee-filtre__titre', texte: rangee.titre })].concat(
          rangee.valeurs.map(function (option) {
            var actif = etat.criteres[rangee.cle] === option.valeur;
            return el('button', {
              type: 'button',
              class: option.classe,
              'aria-pressed': actif ? 'true' : 'false',
              texte: option.libelle,
              onclick: function () {
                etat.criteres[rangee.cle] = actif ? null : option.valeur;
                rendreAccueilPartiel();
              },
            });
          })
        ));
      })
    ));
    fragment.appendChild(blocFiltres);

    var auMoinsUnFiltre = Boolean(
      etat.criteres.recherche ||
        etat.criteres.categorie ||
        etat.criteres.origine ||
        etat.criteres.difficulte ||
        etat.criteres.temps
    );

    fragment.appendChild(
      el('div', { class: 'barre-resultats' }, [
        el('span', { texte: resultats.length + ' recette' + (resultats.length > 1 ? 's' : '') }),
        auMoinsUnFiltre
          ? el('button', {
              type: 'button',
              class: 'lien-action',
              texte: 'Tout effacer',
              onclick: function () {
                etat.criteres = criteresVides();
                rendreAccueilPartiel();
              },
            })
          : null,
      ])
    );

    if (resultats.length === 0) {
      fragment.appendChild(
        el('div', { class: 'etat-vide' }, [
          el('p', { texte: 'Aucune recette ne correspond.' }),
          el('p', { texte: 'Essayez avec moins de filtres, ou un autre mot dans la recherche.' }),
        ])
      );
    } else {
      fragment.appendChild(
        el(
          'div',
          { class: 'grille' },
          resultats.map(function (recette) {
            return el('a', { class: 'carte', href: '#/recette/' + recette.id }, [
              el('span', { class: classeCategorie('carte__liseret', recette.categorie), 'aria-hidden': 'true' }),
              el('span', { class: 'carte__corps' }, [
                el('span', { class: 'carte__haut' }, [
                  el('span', { class: classeCategorie('etiquette', recette.categorie), texte: recette.categorie }),
                  el('span', { class: 'carte__temps', texte: recette.temps.total }),
                ]),
                el('span', { class: 'carte__titre', texte: recette.titre }),
                el('span', {
                  class: 'carte__meta',
                  texte:
                    origineCourte(recette.origine) +
                    ' · ' +
                    difficulteCourte(recette.difficulte) +
                    ' · ' +
                    recette.portions,
                }),
                el('span', {
                  class: 'carte__meta-faible',
                  texte: nbIngredients(recette) + ' ingrédients · ' + recette.instructions.length + ' étapes',
                }),
              ]),
            ]);
          })
        )
      );
    }

    return fragment;
  }

  /* Re-rendu de l'accueil en conservant le focus et la position du curseur du
     champ de recherche, sinon la saisie devient inutilisable. */
  function rendreAccueilPartiel() {
    var actif = document.activeElement;
    var etaitDansRecherche = actif && actif.classList && actif.classList.contains('champ-recherche');
    var position = etaitDansRecherche ? actif.selectionStart : null;

    monter(vueAccueil());

    if (etaitDansRecherche) {
      var nouveau = document.querySelector('.champ-recherche');
      if (nouveau) {
        nouveau.focus();
        if (position !== null) {
          try {
            nouveau.setSelectionRange(position, position);
          } catch (erreur) {
            // Certains types de champ n'acceptent pas setSelectionRange : sans effet.
          }
        }
      }
    }
  }

  /* --- vue : fiche recette ------------------------------------------------- */

  function section(titre, sousTitre, contenu) {
    return el('section', { class: 'section' }, [
      el('h2', { class: 'section__titre', texte: titre }),
      sousTitre ? el('p', { class: 'section__soustitre', texte: sousTitre }) : null,
    ].concat(Array.isArray(contenu) ? contenu : [contenu]));
  }

  function listePuces(elements) {
    return el(
      'ul',
      { class: 'liste-puces' },
      elements.map(function (texte) {
        return el('li', { texte: texte });
      })
    );
  }

  function tableauFlux(flowTable) {
    var largeur = largeurGrille(flowTable);
    var entetes = (flowTable.headers || []).slice();

    var corps = el(
      'tbody',
      {},
      (flowTable.rows || []).map(function (ligne) {
        return el(
          'tr',
          {},
          (ligne || []).map(function (cellule) {
            var colspan = Number(cellule.colspan) || 1;
            var rowspan = Number(cellule.rowspan) || 1;
            return el('td', {
              class: colspan >= largeur && largeur > 0 ? 'pleine-largeur' : null,
              colspan: colspan > 1 ? colspan : null,
              rowspan: rowspan > 1 ? rowspan : null,
              texte: cellule.text || '',
            });
          })
        );
      })
    );

    var tableau = el('table', { class: 'tableau-flux' }, [
      entetes.length
        ? el('thead', {}, [
            el(
              'tr',
              {},
              entetes.map(function (entete) {
                return el('th', { scope: 'col', texte: entete });
              })
            ),
          ])
        : null,
      corps,
    ]);

    return el('div', { class: 'flux-enveloppe' }, tableau);
  }

  /**
   * Rend le deroule reconstitue a partir des ingredients et des etapes.
   * Utilise quand la recette n'apporte pas de tableau exploitable, c'est-a-dire
   * pour 19 des 20 recettes du carnet.
   */
  function tableauDerouleGenere(recette) {
    var deroule = Fx.genererDeroule(recette);
    if (deroule.phases.length === 0) return null;

    var corps = el(
      'tbody',
      {},
      deroule.phases.map(function (phase) {
        return el('tr', {}, [
          el('td', { class: 'deroule__etape', texte: phase.numero }),
          el(
            'td',
            { class: 'deroule__ingredients' },
            phase.ingredients.map(function (item) {
              return el('div', { class: 'deroule__ligne' }, [
                el('span', { class: 'nom', texte: item.nom }),
                item.quantite ? el('span', { class: 'quantite', texte: item.quantite }) : null,
              ]);
            })
          ),
          el('td', { class: 'deroule__action', texte: phase.action }),
        ]);
      })
    );

    var tableau = el('table', { class: 'tableau-flux tableau-flux--genere' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', texte: 'Étape' }),
          el('th', { scope: 'col', texte: 'Ingrédients qui entrent' }),
          el('th', { scope: 'col', texte: 'Ce qu’on en fait' }),
        ]),
      ]),
      corps,
    ]);

    return el('div', {}, [
      el('div', { class: 'flux-enveloppe' }, tableau),
      // On dit ce qui n'a pas pu etre rattache, au lieu de le placer au hasard.
      deroule.nonRattaches.length
        ? el('p', { class: 'deroule__reste' }, [
            el('span', { texte: 'Non rattaché à une étape, faute d’être nommé dans le texte : ' }),
            el('span', {
              texte: deroule.nonRattaches
                .map(function (i) {
                  return i.quantite ? i.nom + ' (' + i.quantite + ')' : i.nom;
                })
                .join(', '),
            }),
          ])
        : null,
    ]);
  }

  function vueRecette(id) {
    var recette = Rc.parId(id);

    if (!recette) {
      return el('div', {}, [
        el('a', { class: 'retour', href: '#/', texte: '‹ Retour au carnet' }),
        el('div', { class: 'etat-erreur' }, [
          el('h1', { texte: 'Recette introuvable' }),
          el('p', { texte: 'L’identifiant « ' + id + ' » ne correspond à aucune fiche.' }),
        ]),
      ]);
    }

    document.title = recette.titre + ' — Mon carnet de recettes';

    var dansListe = recetteDansListe(getShoppingList(), recette.id);
    var fragment = document.createDocumentFragment();

    fragment.appendChild(el('a', { class: 'retour', href: '#/', texte: '‹ Retour au carnet' }));

    var bandeauFiche = bandeauErreurRecettes();
    if (bandeauFiche) fragment.appendChild(bandeauFiche);

    fragment.appendChild(
      el('div', { class: 'fiche__etiquettes' }, [
        el('span', { class: classeCategorie('etiquette', recette.categorie), texte: recette.categorie }),
        el('span', { class: 'etiquette etiquette--sobre', texte: origineCourte(recette.origine) }),
        el('span', { class: 'etiquette etiquette--sobre', texte: difficulteCourte(recette.difficulte) }),
      ])
    );

    fragment.appendChild(el('h1', { class: 'fiche__titre', texte: recette.titre }));
    fragment.appendChild(
      el('p', { class: 'fiche__portions' }, [
        el('span', { texte: recette.portions }),
        // Signale une fiche qui ne correspond plus a la source citee plus bas.
        Rc.estModifiee(id)
          ? el('span', { class: 'marque-modifiee', texte: 'fiche modifiée' })
          : null,
      ])
    );

    fragment.appendChild(
      el('div', { class: 'actions-fiche' }, [
        el('button', {
          type: 'button',
          class: 'bouton',
          texte: 'Tout ajouter à la liste',
          onclick: function () {
            addRecipeToList(recette).then(function () {
              monter(vueRecette(id));
            });
          },
        }),
        dansListe
          ? el('button', {
              type: 'button',
              class: 'bouton bouton--secondaire',
              texte: 'Retirer cette recette de la liste',
              onclick: function () {
                removeRecipeFromList(recette.id).then(function () {
                  monter(vueRecette(id));
                });
              },
            })
          : null,
        el('a', {
          class: 'bouton bouton--secondaire',
          id: 'modifier-recette',
          href: '#/recette/' + id + '/modifier',
          texte: 'Modifier la recette',
        }),
        el('button', {
          type: 'button',
          class: 'bouton bouton--secondaire',
          texte: 'Imprimer la fiche',
          onclick: function () {
            window.print();
          },
        }),
      ])
    );

    var lignesTemps = [
      ['Préparation', recette.temps.preparation],
      ['Cuisson', recette.temps.cuisson],
      ['Repos', recette.temps.repos],
      ['Total', recette.temps.total],
    ].filter(function (paire) {
      return Boolean(paire[1]);
    });

    fragment.appendChild(
      section(
        'Temps',
        null,
        el('table', { class: 'tableau-simple' }, [
          el(
            'tbody',
            {},
            lignesTemps.map(function (paire) {
              return el('tr', {}, [
                el('th', { scope: 'row', texte: paire[0] }),
                el('td', { texte: paire[1] }),
              ]);
            })
          ),
        ])
      )
    );

    fragment.appendChild(
      section('Origine', null, [
        el('p', { texte: recette.origine }),
        recette.difficulte
          ? el('p', { class: 'section__soustitre', texte: 'Difficulté indiquée : ' + recette.difficulte })
          : null,
        recette.calories
          ? el('p', { class: 'section__soustitre', texte: 'Calories : ' + recette.calories })
          : null,
      ])
    );

    // Chaque ingredient est cochable pour n'ajouter qu'une partie de la recette.
    // Ceux deja dans la liste commune sont marques et non selectionnables : les
    // recocher n'ajouterait rien, la cle d'un article etant deja prise.
    var dejaDansListe = S.nomsPresents(getShoppingList(), recette.id);
    var selection = {};

    function majBoutonSelection() {
      var bouton = document.getElementById('ajouter-selection');
      if (!bouton) return;
      var nb = Object.keys(selection).length;
      bouton.textContent = nb === 0 ? 'Ajouter la sélection' : `Ajouter la sélection (${nb})`;
      bouton.disabled = nb === 0;
    }

    fragment.appendChild(
      section(
        'Ingrédients',
        'Cochez ceux à mettre dans la liste commune, ou utilisez « Tout ajouter » plus haut.',
        recette.ingredients
          .map(function (groupe) {
            return el('div', {}, [
              groupe.groupe ? el('h3', { class: 'groupe-ingredients__titre', texte: groupe.groupe }) : null,
              el(
                'ul',
                { class: 'liste-ingredients liste-ingredients--selectionnable' },
                groupe.items.map(function (item) {
                  var present = Boolean(dejaDansListe[item.nom]);
                  var caseCoche = el('input', {
                    type: 'checkbox',
                    class: 'case-ingredient',
                    disabled: present ? true : null,
                    'data-nom': item.nom,
                    onchange: function (evenement) {
                      if (evenement.target.checked) {
                        selection[item.nom] = { nom: item.nom, quantite: item.quantite, groupe: groupe.groupe || null };
                      } else {
                        delete selection[item.nom];
                      }
                      majBoutonSelection();
                    },
                  });

                  return el('li', { class: present ? 'deja-dans-liste' : null }, [
                    el('label', {}, [
                      caseCoche,
                      el('span', { class: 'nom', texte: item.nom }),
                      el('span', { class: 'quantite', texte: item.quantite }),
                    ]),
                    present ? el('span', { class: 'marque-presence', texte: 'déjà dans la liste' }) : null,
                  ]);
                })
              ),
            ]);
          })
          .concat([
            el('div', { class: 'actions-selection' }, [
              el('button', {
                type: 'button',
                id: 'ajouter-selection',
                class: 'bouton',
                disabled: true,
                texte: 'Ajouter la sélection',
                onclick: function () {
                  var items = Object.keys(selection).map(function (nom) {
                    return selection[nom];
                  });
                  if (items.length === 0) return;
                  S.addItemsToList(recette, items).then(function () {
                    monter(vueRecette(id));
                  });
                },
              }),
            ]),
          ])
      )
    );

    fragment.appendChild(
      section(
        'Préparation',
        null,
        el(
          'ol',
          { class: 'etapes' },
          recette.instructions.map(function (etape) {
            // `numero` vaut parfois un libellé plutôt qu'un entier
            // (« Pour finir » dans la source des lasagnes bolognaise).
            var estEntier = typeof etape.numero === 'number';
            return el('li', { class: 'etape' }, [
              el('span', { class: 'etape__numero', texte: estEntier ? String(etape.numero) : '•' }),
              el('div', {}, [
                estEntier ? null : el('p', { class: 'etape__libelle', texte: String(etape.numero) }),
                el('p', { class: 'etape__texte', texte: etape.texte }),
                etape.astuce
                  ? el('div', { class: 'astuce' }, [
                      el('span', { class: 'astuce__marque', texte: 'Astuce' }),
                      el('p', { texte: stripTipPrefix(etape.astuce) }),
                    ])
                  : null,
              ]),
            ]);
          })
        )
      )
    );

    /* Les 16 recettes du lot 2 ont un tableau de flux généré automatiquement, ne
       contenant que des marqueurs (« ✓ », « Selon étapes »). On ne l'affiche que
       lorsqu'il porte une information, comme la v2. */
    // Un tableau fourni avec la recette est toujours prefere : il porte une
    // interpretation (les sous-preparations qui convergent) que la generation ne
    // sait pas deviner. Sinon on reconstitue le deroule depuis les etapes.
    if (isFlowTableInformative(recette.flowTable)) {
      fragment.appendChild(
        section(
          'Déroulé des préparations',
          'Comment chaque ingrédient est préparé, puis assemblé jusqu’à la cuisson.',
          tableauFlux(recette.flowTable)
        )
      );
    } else {
      var genere = tableauDerouleGenere(recette);
      if (genere) {
        fragment.appendChild(
          section(
            'Déroulé des préparations',
            'Reconstitué automatiquement : à quelle étape chaque ingrédient entre.',
            genere
          )
        );
      }
    }

    if (recette.astuces.recette.length) {
      fragment.appendChild(section('Astuces de la recette', null, listePuces(recette.astuces.recette)));
    }
    if (recette.astuces.commentaires.length) {
      fragment.appendChild(
        section('Astuces tirées des commentaires', null, listePuces(recette.astuces.commentaires))
      );
    }
    if (recette.variantes.recette.length) {
      fragment.appendChild(section('Variantes', null, listePuces(recette.variantes.recette)));
    }
    if (recette.variantes.associees.length) {
      fragment.appendChild(
        section('Recettes associées', 'Suggestions présentes sur la page source.', listePuces(recette.variantes.associees))
      );
    }
    if (recette.manquants.length) {
      fragment.appendChild(
        section(
          'Ce que la source ne donne pas',
          'Signalé plutôt que comblé par une hypothèse.',
          listePuces(recette.manquants)
        )
      );
    }

    fragment.appendChild(
      section('Source', null, [
        el('p', {}, [
          el('a', {
            class: 'lien-source',
            href: recette.source.url,
            target: '_blank',
            rel: 'noopener noreferrer',
            texte: recette.source.label,
          }),
        ]),
        el('p', { class: 'url-source', texte: recette.source.url }),
      ])
    );

    return fragment;
  }

  /* --- vue : liste de courses ---------------------------------------------- */

  /** Bandeau d'etat de la synchronisation, avec le bouton de rafraichissement. */
  function barreSync() {
    var e = S.etatSync();

    var libelle;
    var classe = 'sync';
    if (e.enCours) {
      libelle = 'Synchronisation…';
    } else if (e.enLigne === true) {
      var heure = e.dernierSucces ? new Date(e.dernierSucces).toLocaleTimeString('fr-FR') : null;
      libelle = heure ? 'Liste commune, à jour à ' + heure : 'Liste commune, à jour';
      classe += ' sync--ok';
    } else if (e.enLigne === false) {
      libelle =
        e.enAttente > 0
          ? 'Hors ligne, ' + e.enAttente + ' modification' + (e.enAttente > 1 ? 's' : '') + ' en attente d’envoi'
          : 'Hors ligne, liste affichée depuis la copie locale';
      classe += ' sync--hors-ligne';
    } else {
      libelle = 'Connexion…';
    }

    return el('div', { class: classe }, [
      el('span', { class: 'sync__etat', texte: libelle }),
      el('button', {
        type: 'button',
        class: 'lien-action',
        id: 'rafraichir',
        texte: 'Rafraîchir',
        onclick: function () {
          S.rafraichir().then(function () {
            monter(vueListeDeCourses());
          });
        },
      }),
      e.erreur ? el('p', { class: 'sync__erreur', texte: e.erreur }) : null,
    ]);
  }

  /** Formulaire d'ajout d'un article hors recette. */
  function formulaireAjoutLibre() {
    var champNom = el('input', {
      type: 'text',
      class: 'champ-ajout',
      id: 'ajout-nom',
      placeholder: 'Ajouter un article (ex. pain)',
      'aria-label': 'Nom de l’article à ajouter',
    });
    var champQuantite = el('input', {
      type: 'text',
      class: 'champ-ajout champ-ajout--quantite',
      id: 'ajout-quantite',
      placeholder: 'Quantité',
      'aria-label': 'Quantité',
    });

    function valider() {
      var nom = champNom.value;
      if (!nom.trim()) return;
      S.addFreeItem(nom, champQuantite.value).then(function () {
        monter(vueListeDeCourses());
        // Rendre la saisie enchainable : on remet le focus dans le champ.
        var suivant = document.getElementById('ajout-nom');
        if (suivant) suivant.focus();
      });
    }

    [champNom, champQuantite].forEach(function (champ) {
      champ.addEventListener('keydown', function (evenement) {
        if (evenement.key === 'Enter') {
          evenement.preventDefault();
          valider();
        }
      });
    });

    return el('form', { class: 'ajout-libre', onsubmit: function (e) { e.preventDefault(); valider(); } }, [
      champNom,
      champQuantite,
      el('button', { type: 'submit', class: 'bouton', id: 'ajout-valider', texte: 'Ajouter' }),
    ]);
  }

  /** Bloc compact listant les recettes presentes, avec un retrait par recette. */
  function blocRecettes(articles) {
    var recettes = S.recettesDansListe(articles);
    if (recettes.length === 0) return null;

    return el('details', { class: 'bloc-recettes' }, [
      el('summary', {
        texte: recettes.length + ' recette' + (recettes.length > 1 ? 's' : '') + ' dans la liste',
      }),
      el(
        'ul',
        { class: 'liste-recettes' },
        recettes.map(function (recette) {
          return el('li', {}, [
            el('a', { href: '#/recette/' + recette.recetteId, texte: recette.titre }),
            el('span', { class: 'compte-articles', texte: recette.nb + ' article' + (recette.nb > 1 ? 's' : '') }),
            el('button', {
              type: 'button',
              class: 'lien-action',
              texte: 'Retirer',
              'aria-label': 'Retirer les ingrédients de ' + recette.titre,
              onclick: function () {
                removeRecipeFromList(recette.recetteId).then(function () {
                  monter(vueListeDeCourses());
                });
              },
            }),
          ]);
        })
      ),
    ]);
  }

  /** Une ligne de la liste : un ingredient, quantites additionnees. */
  function ligneCourses(ligne) {
    var caseCoche = el('input', {
      type: 'checkbox',
      checked: ligne.coche ? true : null,
      onchange: function (evenement) {
        // Une ligne peut recouvrir plusieurs articles : on les coche tous.
        S.cocherArticles(ligne.articles, evenement.target.checked).then(function () {
          monter(vueListeDeCourses());
        });
      },
    });

    return el('li', { class: ligne.coche ? 'coche' : null }, [
      el('label', {}, [
        caseCoche,
        el('span', { class: 'nom', texte: ligne.nom }),
        ligne.quantite ? el('span', { class: 'quantite', texte: ligne.quantite }) : null,
      ]),
      // Provenance affichee seulement quand l'ingredient vient de plusieurs recettes :
      // c'est la que le total additionne demande une explication.
      ligne.nbSources > 1
        ? el('span', { class: 'provenance', texte: ligne.recettes.join(' + ') })
        : null,
      el('button', {
        type: 'button',
        class: 'supprimer',
        texte: '×',
        'aria-label': 'Supprimer ' + ligne.nom,
        onclick: function () {
          S.removeArticles(ligne.articles).then(function () {
            monter(vueListeDeCourses());
          });
        },
      }),
    ]);
  }

  function vueListeDeCourses() {
    document.title = 'Liste de courses — Mon carnet de recettes';

    var articles = getShoppingList();
    var fragment = document.createDocumentFragment();

    fragment.appendChild(el('a', { class: 'retour', href: '#/', texte: '‹ Retour au carnet' }));
    fragment.appendChild(el('h1', { class: 'fiche__titre', texte: 'Liste de courses commune' }));
    fragment.appendChild(
      el('p', {
        class: 'accroche',
        texte: 'Rangée par rayon, dans l’ordre du magasin. Un même ingrédient venu de plusieurs recettes est additionné.',
      })
    );

    fragment.appendChild(barreSync());
    fragment.appendChild(formulaireAjoutLibre());

    if (articles.length === 0) {
      fragment.appendChild(
        el('div', { class: 'etat-vide' }, [
          el('p', { texte: 'La liste est vide.' }),
          el('p', {
            texte:
              'Ouvrez une recette pour y verser ses ingrédients, ou ajoutez un article directement ci-dessus.',
          }),
        ])
      );
      return fragment;
    }

    var groupes = S.listeParRayon(articles);
    var lignes = groupes.reduce(function (total, g) {
      return total.concat(g.lignes);
    }, []);
    var restants = lignes.filter(function (l) {
      return !l.coche;
    }).length;
    var coches = lignes.length - restants;

    fragment.appendChild(
      el('div', { class: 'barre-resultats' }, [
        el('span', {
          texte: restants + ' ligne' + (restants > 1 ? 's' : '') + ' à acheter sur ' + lignes.length,
        }),
        el('div', { class: 'actions-liste' }, [
          el('button', {
            type: 'button',
            class: 'lien-action',
            texte: 'Imprimer la liste',
            onclick: function () {
              window.print();
            },
          }),
          coches > 0
            ? el('button', {
                type: 'button',
                class: 'lien-action',
                id: 'retirer-coches',
                texte: 'Retirer les ' + coches + ' cochés',
                onclick: function () {
                  S.removeCheckedArticles().then(function () {
                    monter(vueListeDeCourses());
                  });
                },
              })
            : null,
          el('button', {
            type: 'button',
            class: 'lien-action',
            texte: 'Vider la liste',
            onclick: function () {
              clearShoppingList().then(function () {
                monter(vueListeDeCourses());
              });
            },
          }),
        ]),
      ])
    );

    var recettes = blocRecettes(articles);
    if (recettes) fragment.appendChild(recettes);

    groupes.forEach(function (groupe) {
      fragment.appendChild(
        el('section', { class: 'rayon' }, [
          el('h2', { class: 'rayon__titre' }, [
            el('span', { texte: groupe.rayon }),
            el('span', { class: 'rayon__compte', texte: String(groupe.lignes.length) }),
          ]),
          el('ul', { class: 'liste-courses' }, groupe.lignes.map(ligneCourses)),
        ])
      );
    });

    return fragment;
  }

  /* --- vue : modification d'une recette ------------------------------------- */

  // Brouillon en cours d'edition, garde hors du rendu pour survivre aux re-rendus
  // declenches par l'ajout ou le retrait d'une ligne.
  var brouillon = null;

  /** Champ de saisie lie a une propriete du brouillon, sans re-rendu a la frappe. */
  function champ(valeurInitiale, surSaisie, options) {
    options = options || {};
    return el(options.multiligne ? 'textarea' : 'input', {
      class: options.classe || 'champ-edition',
      type: options.multiligne ? null : 'text',
      rows: options.multiligne ? String(options.lignes || 3) : null,
      value: options.multiligne ? null : valeurInitiale || '',
      texte: options.multiligne ? valeurInitiale || '' : null,
      placeholder: options.placeholder || null,
      'aria-label': options.libelle || null,
      oninput: function (evenement) {
        surSaisie(evenement.target.value);
      },
    });
  }

  /** Ligne « libellé : champ » du formulaire. */
  function ligneChamp(libelle, noeud) {
    return el('label', { class: 'ligne-edition' }, [
      el('span', { class: 'ligne-edition__libelle', texte: libelle }),
      noeud,
    ]);
  }

  /** Bloc de reglage du nombre de parts, avec recalcul des quantites. */
  function blocPortions(id) {
    var portions = Q.analyserPortions(brouillon.portions);

    if (portions.nombre === null) {
      return el('div', { class: 'bloc-portions bloc-portions--impossible' }, [
        el('p', {
          texte:
            'Le nombre de parts « ' +
            brouillon.portions +
            ' » ne commence pas par un nombre : le recalcul automatique des quantités n’est pas possible. Modifiez-le à la main ci-dessous.',
        }),
      ]);
    }

    function appliquer(nouveau) {
      if (!(nouveau > 0)) return;
      var resultat = Rc.echelonner(brouillon, nouveau);
      if (!resultat.possible) return;
      brouillon = resultat.recette;
      brouillon.__dernierEchelonnage = {
        facteur: resultat.facteur,
        remplacements: resultat.remplacements,
        ignorees: resultat.ignorees,
      };
      monter(vueModifier(id));
    }

    var champNombre = el('input', {
      type: 'number',
      class: 'champ-portions',
      id: 'nombre-parts',
      min: '0.5',
      step: '0.5',
      value: String(portions.nombre),
      'aria-label': 'Nombre de parts',
      onchange: function (evenement) {
        appliquer(Number(evenement.target.value));
      },
    });

    var dernier = brouillon.__dernierEchelonnage;

    return el('div', { class: 'bloc-portions' }, [
      el('div', { class: 'bloc-portions__reglage' }, [
        el('span', { class: 'ligne-edition__libelle', texte: 'Nombre de parts' }),
        el('button', {
          type: 'button',
          class: 'bouton-pas',
          id: 'parts-moins',
          texte: '−',
          'aria-label': 'Diminuer le nombre de parts',
          onclick: function () {
            appliquer(portions.nombre - 1);
          },
        }),
        champNombre,
        el('button', {
          type: 'button',
          class: 'bouton-pas',
          id: 'parts-plus',
          texte: '+',
          'aria-label': 'Augmenter le nombre de parts',
          onclick: function () {
            appliquer(portions.nombre + 1);
          },
        }),
        el('span', { class: 'bloc-portions__libelle', texte: portions.libelle }),
      ]),
      el('p', {
        class: 'bloc-portions__aide',
        texte:
          'Changer ce nombre recalcule proportionnellement les quantités des ingrédients, et celles qui figurent dans les instructions. Les durées et les températures ne sont jamais modifiées.',
      }),
      dernier
        ? el('div', { class: 'bloc-portions__rapport', id: 'rapport-echelonnage' }, [
            el('p', {
              texte:
                'Dernier recalcul : facteur ' +
                Q.formatNombre(dernier.facteur) +
                '. ' +
                dernier.remplacements.length +
                ' quantité' +
                (dernier.remplacements.length > 1 ? 's' : '') +
                ' ajustée' +
                (dernier.remplacements.length > 1 ? 's' : '') +
                ' dans les instructions.',
            }),
            dernier.remplacements.length
              ? el('p', {
                  class: 'bloc-portions__detail',
                  texte: dernier.remplacements
                    .map(function (r) {
                      return r.avant + ' → ' + r.apres;
                    })
                    .join(' · '),
                })
              : null,
            dernier.ignorees.length
              ? el('p', {
                  class: 'bloc-portions__detail',
                  texte:
                    'Laissé inchangé, faute de quantité chiffrée : ' + dernier.ignorees.join(', ') + '.',
                })
              : null,
          ])
        : null,
    ]);
  }

  /** Section des ingredients, editable, groupe par groupe. */
  function blocIngredients(id) {
    return el(
      'div',
      { class: 'bloc-edition' },
      brouillon.ingredients
        .map(function (groupe, indexGroupe) {
          return el('div', { class: 'groupe-edition' }, [
            ligneChamp(
              'Section',
              champ(groupe.groupe || '', function (valeur) {
                groupe.groupe = valeur.trim() === '' ? null : valeur;
              }, { placeholder: 'Sans section', libelle: 'Nom de la section d’ingrédients' })
            ),
            el(
              'ul',
              { class: 'liste-edition' },
              groupe.items.map(function (item, indexItem) {
                return el('li', {}, [
                  champ(item.nom, function (valeur) {
                    item.nom = valeur;
                  }, { classe: 'champ-edition champ-edition--nom', libelle: 'Nom de l’ingrédient' }),
                  champ(item.quantite, function (valeur) {
                    item.quantite = valeur;
                  }, { classe: 'champ-edition champ-edition--quantite', libelle: 'Quantité', placeholder: 'Quantité' }),
                  el('span', { class: 'rayon-indique', texte: R.rayonDe(item.nom) }),
                  el('button', {
                    type: 'button',
                    class: 'supprimer',
                    texte: '×',
                    'aria-label': 'Supprimer ' + item.nom,
                    onclick: function () {
                      groupe.items.splice(indexItem, 1);
                      if (groupe.items.length === 0 && brouillon.ingredients.length > 1) {
                        brouillon.ingredients.splice(indexGroupe, 1);
                      }
                      monter(vueModifier(id));
                    },
                  }),
                ]);
              })
            ),
            el('button', {
              type: 'button',
              class: 'lien-action',
              texte: 'Ajouter un ingrédient',
              onclick: function () {
                groupe.items.push({ nom: '', quantite: '' });
                monter(vueModifier(id));
              },
            }),
          ]);
        })
        .concat([
          el('button', {
            type: 'button',
            class: 'lien-action',
            texte: 'Ajouter une section',
            onclick: function () {
              brouillon.ingredients.push({ groupe: '', items: [{ nom: '', quantite: '' }] });
              monter(vueModifier(id));
            },
          }),
        ])
    );
  }

  /** Section des etapes, editable. */
  function blocInstructions(id) {
    return el(
      'div',
      { class: 'bloc-edition' },
      brouillon.instructions
        .map(function (etape, index) {
          return el('div', { class: 'etape-edition' }, [
            el('div', { class: 'etape-edition__haut' }, [
              el('span', { class: 'etape__numero', texte: String(index + 1) }),
              el('button', {
                type: 'button',
                class: 'supprimer',
                texte: '×',
                'aria-label': 'Supprimer l’étape ' + (index + 1),
                onclick: function () {
                  brouillon.instructions.splice(index, 1);
                  renumeroter();
                  monter(vueModifier(id));
                },
              }),
            ]),
            champ(etape.texte, function (valeur) {
              etape.texte = valeur;
            }, { multiligne: true, lignes: 3, libelle: 'Texte de l’étape ' + (index + 1) }),
            champ(etape.astuce || '', function (valeur) {
              etape.astuce = valeur.trim() === '' ? null : valeur;
            }, { multiligne: true, lignes: 2, placeholder: 'Astuce (facultatif)', libelle: 'Astuce de l’étape ' + (index + 1) }),
          ]);
        })
        .concat([
          el('button', {
            type: 'button',
            class: 'lien-action',
            texte: 'Ajouter une étape',
            onclick: function () {
              brouillon.instructions.push({ numero: brouillon.instructions.length + 1, texte: '', astuce: null });
              monter(vueModifier(id));
            },
          }),
        ])
    );
  }

  /**
   * Renumerote les etapes apres un ajout ou un retrait.
   * Les libelles non numeriques sont conserves : la source des lasagnes appelle sa
   * derniere etape « Pour finir », et ce n'est pas a l'editeur de la renommer.
   */
  function renumeroter() {
    var compteur = 0;
    brouillon.instructions.forEach(function (etape) {
      if (typeof etape.numero === 'number') {
        compteur += 1;
        etape.numero = compteur;
      } else {
        compteur += 1;
      }
    });
  }

  /**
   * Bandeau d'erreur des recettes modifiees.
   *
   * Sans lui, une modification qui n'a pas pu partir resterait visible en local et
   * disparaitrait au rechargement suivant, sans explication. Le cas le plus probable
   * est un refus de Firestore parce que les regles de firestore.rules n'ont pas ete
   * republiees apres l'ajout de la collection des recettes.
   */
  function bandeauErreurRecettes() {
    var e = Rc.etatChargement();
    if (!e.erreur) return null;

    var explication = 'Les modifications de recettes ne sont pas enregistrées sur le serveur.';
    if (/PERMISSION_DENIED|Missing or insufficient permissions/i.test(e.erreur)) {
      explication +=
        ' Firestore refuse l’accès à la collection « recettes » : les règles de sécurité du projet doivent être republiées à partir du fichier firestore.rules du dépôt.';
    } else {
      explication += ' Ce qui est modifié ici reste sur cet appareil jusqu’au rétablissement.';
    }

    return el('div', { class: 'etat-erreur etat-erreur--compact', id: 'erreur-recettes' }, [
      el('p', { texte: explication }),
      el('p', { class: 'url-source', texte: e.erreur }),
    ]);
  }

  function vueModifier(id) {
    var recette = Rc.parId(id);

    if (!recette) {
      return el('div', {}, [
        el('a', { class: 'retour', href: '#/', texte: '‹ Retour au carnet' }),
        el('div', { class: 'etat-erreur' }, [
          el('h1', { texte: 'Recette introuvable' }),
          el('p', { texte: 'L’identifiant « ' + id + ' » ne correspond à aucune fiche.' }),
        ]),
      ]);
    }

    // Nouveau brouillon seulement si l'on change de recette : sinon on repartirait
    // de zero a chaque re-rendu et la saisie serait perdue.
    if (!brouillon || brouillon.id !== id) {
      brouillon = JSON.parse(JSON.stringify(recette));
    }

    document.title = 'Modifier ' + recette.titre + ' — Mon carnet de recettes';

    var fragment = document.createDocumentFragment();

    fragment.appendChild(
      el('a', { class: 'retour', href: '#/recette/' + id, texte: '‹ Revenir à la fiche' })
    );
    fragment.appendChild(el('h1', { class: 'fiche__titre', texte: 'Modifier la recette' }));

    var bandeau = bandeauErreurRecettes();
    if (bandeau) fragment.appendChild(bandeau);

    fragment.appendChild(
      el('div', { class: 'actions-fiche' }, [
        el('button', {
          type: 'button',
          class: 'bouton',
          id: 'enregistrer',
          texte: 'Enregistrer',
          onclick: function () {
            var aEnregistrer = JSON.parse(JSON.stringify(brouillon));
            delete aEnregistrer.__dernierEchelonnage;
            // Les ingredients vides sont retires plutot qu'enregistres a blanc.
            aEnregistrer.ingredients = aEnregistrer.ingredients
              .map(function (groupe) {
                return {
                  groupe: groupe.groupe && groupe.groupe.trim() !== '' ? groupe.groupe : null,
                  items: groupe.items.filter(function (item) {
                    return String(item.nom || '').trim() !== '';
                  }),
                };
              })
              .filter(function (groupe) {
                return groupe.items.length > 0;
              });
            aEnregistrer.instructions = aEnregistrer.instructions.filter(function (etape) {
              return String(etape.texte || '').trim() !== '';
            });

            Rc.enregistrer(aEnregistrer).then(function () {
              // On ne quitte l'editeur que si l'enregistrement a reellement abouti :
              // sinon l'utilisateur croirait son travail sauvegarde alors qu'il ne
              // survivrait pas au prochain rafraichissement.
              if (Rc.etatChargement().erreur) {
                brouillon = aEnregistrer;
                monter(vueModifier(id));
                var noeud = document.getElementById('erreur-recettes');
                if (noeud) noeud.scrollIntoView({ block: 'center' });
                return;
              }
              brouillon = null;
              window.location.hash = '#/recette/' + id;
            });
          },
        }),
        el('button', {
          type: 'button',
          class: 'bouton bouton--secondaire',
          id: 'annuler',
          texte: 'Annuler',
          onclick: function () {
            brouillon = null;
            window.location.hash = '#/recette/' + id;
          },
        }),
        Rc.estModifiee(id)
          ? el('button', {
              type: 'button',
              class: 'bouton bouton--secondaire',
              id: 'reinitialiser',
              texte: 'Rétablir l’originale',
              onclick: function () {
                Rc.reinitialiser(id).then(function () {
                  brouillon = null;
                  window.location.hash = '#/recette/' + id;
                });
              },
            })
          : null,
      ])
    );

    fragment.appendChild(section('Nombre de parts', null, blocPortions(id)));

    fragment.appendChild(
      section('Fiche', null, [
        ligneChamp(
          'Titre',
          champ(brouillon.titre, function (valeur) {
            brouillon.titre = valeur;
          }, { libelle: 'Titre de la recette' })
        ),
        ligneChamp(
          'Catégorie',
          el(
            'select',
            {
              class: 'champ-edition',
              'aria-label': 'Catégorie',
              onchange: function (evenement) {
                brouillon.categorie = evenement.target.value;
              },
            },
            ['Entrée', 'Plat', 'Dessert'].map(function (c) {
              return el('option', { value: c, selected: brouillon.categorie === c ? true : null, texte: c });
            })
          )
        ),
        ligneChamp(
          'Origine',
          champ(brouillon.origine, function (valeur) {
            brouillon.origine = valeur;
          }, { libelle: 'Origine' })
        ),
        ligneChamp(
          'Difficulté',
          champ(brouillon.difficulte, function (valeur) {
            brouillon.difficulte = valeur;
          }, { libelle: 'Difficulté' })
        ),
      ])
    );

    fragment.appendChild(
      section(
        'Temps',
        null,
        [
          ['preparation', 'Préparation'],
          ['cuisson', 'Cuisson'],
          ['repos', 'Repos'],
          ['total', 'Total'],
        ].map(function (paire) {
          return ligneChamp(
            paire[1],
            champ(brouillon.temps[paire[0]], function (valeur) {
              brouillon.temps[paire[0]] = valeur;
            }, { libelle: paire[1] })
          );
        })
      )
    );

    fragment.appendChild(
      section('Ingrédients', 'Le rayon indiqué à droite est déduit du nom.', blocIngredients(id))
    );
    fragment.appendChild(section('Préparation', null, blocInstructions(id)));

    return fragment;
  }

  /* --- routage par ancre --------------------------------------------------- */

  function router() {
    var ancre = window.location.hash.replace(/^#/, '');

    if (ancre.indexOf('/recette/') === 0) {
      var reste = ancre.slice('/recette/'.length);
      var modification = reste.match(/^(.*)\/modifier$/);
      if (modification) {
        monter(vueModifier(decodeURIComponent(modification[1])));
        window.scrollTo(0, 0);
        return;
      }
      // On quitte l'editeur : le brouillon non enregistre n'a plus lieu d'etre.
      brouillon = null;
      monter(vueRecette(decodeURIComponent(reste)));
      window.scrollTo(0, 0);
      return;
    }
    if (ancre === '/liste-de-courses') {
      monter(vueListeDeCourses());
      window.scrollTo(0, 0);
      return;
    }

    document.title = 'Mon carnet de recettes';
    monter(vueAccueil());
  }

  /* --- démarrage ----------------------------------------------------------- */

  function afficherErreurChargement(message) {
    var vue = document.getElementById('vue');
    vue.textContent = '';
    vue.appendChild(
      el('div', { class: 'etat-erreur' }, [
        el('h1', { texte: 'Les recettes n’ont pas pu être chargées' }),
        el('p', { texte: message }),
        el('p', {}, [
          document.createTextNode('Cette version lit '),
          el('code', { texte: 'data/recipes.json' }),
          document.createTextNode(
            ' avec fetch(), que les navigateurs bloquent sur une URL file://. Ouvrir la page par un double-clic ne peut donc pas fonctionner. Depuis ce dossier, lancer : '
          ),
          el('code', { texte: 'python3 -m http.server 8000' }),
          document.createTextNode(' puis ouvrir '),
          el('code', { texte: 'http://localhost:8000/' }),
          document.createTextNode('.'),
        ]),
      ])
    );
  }

  /* --- rafraichissement automatique de la liste commune --------------------- */

  function surEcranListe() {
    return window.location.hash.replace(/^#/, '') === '/liste-de-courses';
  }

  /**
   * Un rafraichissement peut survenir pendant que l'utilisateur tape dans le champ
   * d'ajout : re-rendre effacerait sa saisie. On saute donc le re-rendu tant qu'un
   * champ a le focus. Le sondage suivant s'en chargera.
   */
  function saisieEnCours() {
    var actif = document.activeElement;
    if (!actif) return false;
    return actif.tagName === 'INPUT' || actif.tagName === 'TEXTAREA';
  }

  function surChangementListe() {
    majBadge();
    if (surEcranListe() && !saisieEnCours()) monter(vueListeDeCourses());
  }

  function demarrer() {
    fetch('data/recipes.json')
      .then(function (reponse) {
        if (!reponse.ok) throw new Error('réponse ' + reponse.status + ' du serveur');
        return reponse.json();
      })
      .then(function (recettes) {
        etat.recettes = recettes;
        Rc.definirBase(recettes);

        window.addEventListener('hashchange', router);
        router();

        // Le sondage n'est lance qu'une fois les recettes chargees : avant, l'ecran
        // ne peut rien afficher d'utile de toute facon.
        S.surChangement(surChangementListe);
        S.demarrer();

        // Les recettes modifiees sont relues une fois, au chargement. Elles changent
        // trop rarement pour justifier un sondage permanent.
        Rc.rafraichir().then(function () {
          router();
        });
      })
      .catch(function (erreur) {
        afficherErreurChargement(erreur.message);
      });
  }

  demarrer();
})();
