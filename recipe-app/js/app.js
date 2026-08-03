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
    var resultats = filterRecipes(etat.recettes, etat.criteres);
    var options = optionsDisponibles(etat.recettes);
    var fragment = document.createDocumentFragment();

    fragment.appendChild(
      el('p', {
        class: 'accroche',
        texte:
          etat.recettes.length +
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

  function vueRecette(id) {
    var recette = null;
    for (var i = 0; i < etat.recettes.length; i += 1) {
      if (etat.recettes[i].id === id) recette = etat.recettes[i];
    }

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

    fragment.appendChild(
      el('div', { class: 'fiche__etiquettes' }, [
        el('span', { class: classeCategorie('etiquette', recette.categorie), texte: recette.categorie }),
        el('span', { class: 'etiquette etiquette--sobre', texte: origineCourte(recette.origine) }),
        el('span', { class: 'etiquette etiquette--sobre', texte: difficulteCourte(recette.difficulte) }),
      ])
    );

    fragment.appendChild(el('h1', { class: 'fiche__titre', texte: recette.titre }));
    fragment.appendChild(el('p', { class: 'fiche__portions', texte: recette.portions }));

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
    if (isFlowTableInformative(recette.flowTable)) {
      fragment.appendChild(
        section(
          'Déroulé des préparations',
          'Comment chaque ingrédient est préparé, puis assemblé jusqu’à la cuisson.',
          tableauFlux(recette.flowTable)
        )
      );
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

  function vueListeDeCourses() {
    document.title = 'Liste de courses — Mon carnet de recettes';

    var articles = getShoppingList();
    var fragment = document.createDocumentFragment();

    fragment.appendChild(el('a', { class: 'retour', href: '#/', texte: '‹ Retour au carnet' }));
    fragment.appendChild(el('h1', { class: 'fiche__titre', texte: 'Liste de courses commune' }));
    fragment.appendChild(
      el('p', { class: 'accroche', texte: 'Partagée : ce que vous cochez ou ajoutez apparaît chez les autres.' })
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

    var restants = articles.filter(function (a) {
      return !a.coche;
    }).length;
    var coches = articles.length - restants;

    fragment.appendChild(
      el('div', { class: 'barre-resultats' }, [
        el('span', {
          texte: restants + ' article' + (restants > 1 ? 's' : '') + ' à acheter sur ' + articles.length,
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

    grouperParRecette(articles).forEach(function (groupe) {
      fragment.appendChild(
        el('div', { class: 'groupe-courses' }, [
          el('div', { class: 'groupe-courses__haut' }, [
            el('h2', { class: 'groupe-courses__titre', texte: groupe.titre }),
            el('button', {
              type: 'button',
              class: 'lien-action',
              texte: 'Retirer',
              'aria-label': 'Retirer les ingrédients de ' + groupe.titre,
              onclick: function () {
                removeRecipeFromList(groupe.recetteId).then(function () {
                  monter(vueListeDeCourses());
                });
              },
            }),
          ]),
          el(
            'ul',
            { class: 'liste-courses' },
            groupe.articles.map(function (article) {
              var caseCoche = el('input', {
                type: 'checkbox',
                checked: article.coche ? true : null,
                onchange: function () {
                  toggleArticle(article.cle).then(function () {
                    monter(vueListeDeCourses());
                  });
                },
              });
              return el('li', { class: article.coche ? 'coche' : null }, [
                el('label', {}, [
                  caseCoche,
                  el('span', { class: 'nom', texte: article.nom }),
                  article.quantite ? el('span', { class: 'quantite', texte: article.quantite }) : null,
                ]),
                el('button', {
                  type: 'button',
                  class: 'supprimer',
                  texte: '×',
                  'aria-label': 'Supprimer ' + article.nom,
                  onclick: function () {
                    removeArticle(article.cle).then(function () {
                      monter(vueListeDeCourses());
                    });
                  },
                }),
              ]);
            })
          ),
        ])
      );
    });

    return fragment;
  }

  /* --- routage par ancre --------------------------------------------------- */

  function router() {
    var ancre = window.location.hash.replace(/^#/, '');

    if (ancre.indexOf('/recette/') === 0) {
      monter(vueRecette(decodeURIComponent(ancre.slice('/recette/'.length))));
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
        window.addEventListener('hashchange', router);
        router();

        // Le sondage n'est lance qu'une fois les recettes chargees : avant, l'ecran
        // ne peut rien afficher d'utile de toute facon.
        S.surChangement(surChangementListe);
        S.demarrer();
      })
      .catch(function (erreur) {
        afficherErreurChargement(erreur.message);
      });
  }

  demarrer();
})();
