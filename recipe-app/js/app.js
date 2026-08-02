/* Mon carnet de recettes, version web statique.
   Sans framework ni build : un seul fichier, routage par ancre.

   La logique métier (normalisation, filtres, résolution du tableau de flux) est le
   miroir de recipe-app-native/src/utils/. Les deux versions doivent rester
   d'accord : une évolution ici se reporte là-bas, et réciproquement. Les tests de
   la v2 (recipe-app-native/tests/run-tests.js) valident cette logique sur les
   17 recettes ; les fonctions portent volontairement les mêmes noms. */

(function () {
  'use strict';

  var CLE_STOCKAGE = 'carnet-de-recettes:liste-de-courses';

  var etat = { recettes: [], criteres: criteresVides() };

  function criteresVides() {
    return { recherche: '', categorie: null, origine: null, difficulte: null, temps: null };
  }

  /* --- format : miroir de src/utils/format.js ------------------------------ */

  function parseMinutes(valeur) {
    if (typeof valeur !== 'string') return null;
    var avecHeures = valeur.match(/(\d+)\s*h(?:\s*(\d+))?/i);
    if (avecHeures) {
      return Number(avecHeures[1]) * 60 + (avecHeures[2] ? Number(avecHeures[2]) : 0);
    }
    var minutesSeules = valeur.match(/(\d+)\s*min/i);
    if (minutesSeules) return Number(minutesSeules[1]);
    return null;
  }

  function stripTipPrefix(texte) {
    if (typeof texte !== 'string') return '';
    return texte.replace(/^\s*(astuce|note|conseil)(\s+de\s+la\s+recette)?\s*:\s*/i, '').trim();
  }

  var REGLES_ORIGINE = [
    [/itali/i, 'Italienne'],
    [/améric|americ|anglais/i, 'Américaine'],
    [/provenç|provenc/i, 'Provençale'],
    [/savoyard/i, 'Savoyarde'],
    [/méditerran|mediterran/i, 'Méditerranéenne'],
    [/franç|franc/i, 'Française'],
  ];

  function origineCourte(origine) {
    if (typeof origine !== 'string') return 'Autre';
    for (var i = 0; i < REGLES_ORIGINE.length; i += 1) {
      if (REGLES_ORIGINE[i][0].test(origine)) return REGLES_ORIGINE[i][1];
    }
    return 'Autre';
  }

  function difficulteCourte(difficulte) {
    if (typeof difficulte !== 'string') return 'Non indiquée';
    if (/technique|difficile/i.test(difficulte)) return 'Technique';
    if (/moyen/i.test(difficulte)) return 'Moyenne';
    if (/facile/i.test(difficulte)) return 'Facile';
    return 'Non indiquée';
  }

  var TRANCHES_TEMPS = [
    { cle: 'rapide', libelle: '30 min ou moins', min: 0, max: 30 },
    { cle: 'moyen', libelle: '30 min à 1 h', min: 31, max: 60 },
    { cle: 'long', libelle: '1 h à 2 h', min: 61, max: 120 },
    { cle: 'tres-long', libelle: 'Plus de 2 h', min: 121, max: Infinity },
  ];

  function trancheTemps(minutes) {
    if (typeof minutes !== 'number') return null;
    for (var i = 0; i < TRANCHES_TEMPS.length; i += 1) {
      if (minutes >= TRANCHES_TEMPS[i].min && minutes <= TRANCHES_TEMPS[i].max) {
        return TRANCHES_TEMPS[i].cle;
      }
    }
    return null;
  }

  /* --- filtres : miroir de src/utils/filters.js ---------------------------- */

  function normaliser(texte) {
    if (typeof texte !== 'string') return '';
    return texte
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u2019']/g, "'")
      .toLowerCase()
      .trim();
  }

  function texteIndexable(recette) {
    var morceaux = [recette.titre, recette.categorie, recette.origine, recette.source && recette.source.label];
    (recette.ingredients || []).forEach(function (groupe) {
      if (groupe.groupe) morceaux.push(groupe.groupe);
      (groupe.items || []).forEach(function (item) {
        morceaux.push(item.nom, item.quantite);
      });
    });
    (recette.instructions || []).forEach(function (etape) {
      morceaux.push(etape.texte);
    });
    return normaliser(
      morceaux
        .filter(function (m) {
          return Boolean(m);
        })
        .join(' ')
    );
  }

  function optionsDisponibles(recettes) {
    function uniques(valeurs) {
      var vues = [];
      valeurs.forEach(function (v) {
        if (v && vues.indexOf(v) === -1) vues.push(v);
      });
      return vues.sort(function (a, b) {
        return a.localeCompare(b, 'fr');
      });
    }
    return {
      categories: uniques(
        recettes.map(function (r) {
          return r.categorie;
        })
      ),
      origines: uniques(
        recettes.map(function (r) {
          return origineCourte(r.origine);
        })
      ),
      difficultes: uniques(
        recettes.map(function (r) {
          return difficulteCourte(r.difficulte);
        })
      ),
    };
  }

  function filterRecipes(recettes, criteres) {
    criteres = criteres || {};
    var requete = normaliser(criteres.recherche || '');
    var mots = requete
      ? requete.split(/\s+/).filter(function (m) {
          return Boolean(m);
        })
      : [];

    return (recettes || []).filter(function (recette) {
      if (criteres.categorie && recette.categorie !== criteres.categorie) return false;
      if (criteres.origine && origineCourte(recette.origine) !== criteres.origine) return false;
      if (criteres.difficulte && difficulteCourte(recette.difficulte) !== criteres.difficulte) return false;

      if (criteres.temps) {
        // Une recette sans durée exploitable est exclue dès qu'on filtre sur le temps.
        var minutes = parseMinutes(recette.temps && recette.temps.total);
        if (trancheTemps(minutes) !== criteres.temps) return false;
      }

      if (mots.length > 0) {
        var index = texteIndexable(recette);
        for (var i = 0; i < mots.length; i += 1) {
          if (index.indexOf(mots[i]) === -1) return false;
        }
      }
      return true;
    });
  }

  /* --- tableau de flux : miroir de src/utils/flow.js ----------------------
     La v1 rend un vrai <table> avec les rowspan/colspan d'origine ; on n'a donc
     besoin que du test « ce tableau porte-t-il une information ? ». */

  var CELLULE_VIDE_DE_SENS = /^(|✓|x|Selon étapes|Si concerné|Non concerné|-|—|Cuisson\s*:.*)$/i;

  function isFlowTableInformative(flowTable) {
    var lignes = (flowTable && flowTable.rows) || [];
    if (lignes.length === 0) return false;

    var fusion = lignes.some(function (ligne) {
      return (ligne || []).some(function (c) {
        return (Number(c.rowspan) || 1) > 1 || (Number(c.colspan) || 1) > 1;
      });
    });
    if (fusion) return true;

    return lignes.some(function (ligne) {
      return (ligne || []).slice(1).some(function (c) {
        return !CELLULE_VIDE_DE_SENS.test(String(c.text || '').trim());
      });
    });
  }

  /** Nombre de colonnes de la grille, une fois les colspan pris en compte. */
  function largeurGrille(flowTable) {
    var lignes = (flowTable && flowTable.rows) || [];
    var largeurs = lignes.map(function (ligne) {
      return (ligne || []).reduce(function (total, c) {
        return total + (Number(c.colspan) || 1);
      }, 0);
    });
    return largeurs.length ? Math.max.apply(null, largeurs) : 0;
  }

  /* --- liste de courses : miroir de src/utils/storage.js, en localStorage --- */

  function cleArticle(recetteId, nom) {
    return recetteId + '::' + nom;
  }

  function getShoppingList() {
    try {
      var brut = window.localStorage.getItem(CLE_STOCKAGE);
      if (!brut) return [];
      var articles = JSON.parse(brut);
      return Array.isArray(articles) ? articles : [];
    } catch (erreur) {
      return [];
    }
  }

  function ecrire(articles) {
    try {
      window.localStorage.setItem(CLE_STOCKAGE, JSON.stringify(articles));
    } catch (erreur) {
      // Stockage indisponible (navigation privée, quota) : la liste reste en mémoire
      // pour la session courante plutôt que de faire échouer l'action.
    }
    majBadge();
    return articles;
  }

  function addRecipeToList(recette) {
    var articles = getShoppingList();
    var presents = {};
    articles.forEach(function (a) {
      presents[a.cle] = true;
    });

    (recette.ingredients || []).forEach(function (groupe) {
      (groupe.items || []).forEach(function (item) {
        var cle = cleArticle(recette.id, item.nom);
        if (presents[cle]) return;
        presents[cle] = true;
        articles.push({
          cle: cle,
          nom: item.nom,
          quantite: item.quantite || '',
          groupe: groupe.groupe || null,
          recetteId: recette.id,
          recetteTitre: recette.titre,
          coche: false,
        });
      });
    });
    return ecrire(articles);
  }

  function removeRecipeFromList(recetteId) {
    return ecrire(
      getShoppingList().filter(function (a) {
        return a.recetteId !== recetteId;
      })
    );
  }

  function toggleArticle(cle) {
    return ecrire(
      getShoppingList().map(function (a) {
        if (a.cle !== cle) return a;
        return Object.assign({}, a, { coche: !a.coche });
      })
    );
  }

  function removeArticle(cle) {
    return ecrire(
      getShoppingList().filter(function (a) {
        return a.cle !== cle;
      })
    );
  }

  function clearShoppingList() {
    return ecrire([]);
  }

  function recetteDansListe(articles, recetteId) {
    return (articles || []).some(function (a) {
      return a.recetteId === recetteId;
    });
  }

  function grouperParRecette(articles) {
    var groupes = [];
    var index = {};
    (articles || []).forEach(function (article) {
      if (!index[article.recetteId]) {
        index[article.recetteId] = { recetteId: article.recetteId, titre: article.recetteTitre, articles: [] };
        groupes.push(index[article.recetteId]);
      }
      index[article.recetteId].articles.push(article);
    });
    return groupes;
  }

  /* --- rendu : petites aides ---------------------------------------------- */

  function el(balise, attributs, enfants) {
    var noeud = document.createElement(balise);
    Object.keys(attributs || {}).forEach(function (nom) {
      var valeur = attributs[nom];
      if (valeur === null || valeur === undefined || valeur === false) return;
      if (nom === 'onclick') noeud.addEventListener('click', valeur);
      else if (nom === 'oninput') noeud.addEventListener('input', valeur);
      else if (nom === 'onchange') noeud.addEventListener('change', valeur);
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
          class: dansListe ? 'bouton bouton--secondaire' : 'bouton',
          texte: dansListe ? 'Retirer de la liste de courses' : 'Ajouter à la liste de courses',
          onclick: function () {
            if (dansListe) removeRecipeFromList(recette.id);
            else addRecipeToList(recette);
            monter(vueRecette(id));
          },
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

    fragment.appendChild(
      section(
        'Ingrédients',
        null,
        recette.ingredients.map(function (groupe) {
          return el('div', {}, [
            groupe.groupe ? el('h3', { class: 'groupe-ingredients__titre', texte: groupe.groupe }) : null,
            el(
              'ul',
              { class: 'liste-ingredients' },
              groupe.items.map(function (item) {
                return el('li', {}, [
                  el('span', { class: 'nom', texte: item.nom }),
                  el('span', { class: 'quantite', texte: item.quantite }),
                ]);
              })
            ),
          ]);
        })
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

  function vueListeDeCourses() {
    document.title = 'Liste de courses — Mon carnet de recettes';

    var articles = getShoppingList();
    var fragment = document.createDocumentFragment();

    fragment.appendChild(el('a', { class: 'retour', href: '#/', texte: '‹ Retour au carnet' }));
    fragment.appendChild(el('h1', { class: 'fiche__titre', texte: 'Liste de courses' }));

    if (articles.length === 0) {
      fragment.appendChild(
        el('div', { class: 'etat-vide' }, [
          el('p', { texte: 'Liste de courses vide.' }),
          el('p', {
            texte:
              'Ouvrez une recette et utilisez « Ajouter à la liste de courses » pour y verser ses ingrédients.',
          }),
        ])
      );
      return fragment;
    }

    var restants = articles.filter(function (a) {
      return !a.coche;
    }).length;

    fragment.appendChild(
      el('div', { class: 'barre-resultats' }, [
        el('span', {
          texte:
            restants + ' article' + (restants > 1 ? 's' : '') + ' à acheter sur ' + articles.length,
        }),
        el('div', {}, [
          el('button', {
            type: 'button',
            class: 'lien-action',
            texte: 'Imprimer la liste',
            onclick: function () {
              window.print();
            },
          }),
          el('span', { texte: '  ' }),
          el('button', {
            type: 'button',
            class: 'lien-action',
            texte: 'Vider la liste',
            onclick: function () {
              clearShoppingList();
              monter(vueListeDeCourses());
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
                removeRecipeFromList(groupe.recetteId);
                monter(vueListeDeCourses());
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
                  toggleArticle(article.cle);
                  monter(vueListeDeCourses());
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
                    removeArticle(article.cle);
                    monter(vueListeDeCourses());
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
      })
      .catch(function (erreur) {
        afficherErreurChargement(erreur.message);
      });
  }

  demarrer();
})();
