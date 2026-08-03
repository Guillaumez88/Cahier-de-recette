/* Logique metier du carnet de recettes : fonctions pures, sans DOM.
   Separee du rendu pour deux raisons : elle est testable sous Node sans navigateur
   (voir tests/run-tests.js), et le rendu reste lisible.

   Expose window.CarnetLogic dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  function criteresVides() {
    return {
      recherche: '',
      categorie: null,
      origine: null,
      difficulte: null,
      temps: null,
      // « jamais » ou « deja » : filtre sur le nombre de fois que le plat a ete fait,
      // compte a partir du semainier. Voir le troisieme argument de filterRecipes.
      realisations: null,
    };
  }

  /* --- format ------------------------------------------------------ */

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

  /* --- filtres ---------------------------------------------------- */

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

  /**
   * Filtre le carnet.
   *
   * `comptes` est une table facultative { recetteId: nombre de realisations }, que
   * l'appelant obtient du semainier. Elle est passee en argument plutot que lue ici :
   * ce module reste sans acces au stockage, ce qui est ce qui le rend testable sous
   * Node sans emulation.
   */
  function filterRecipes(recettes, criteres, comptes) {
    criteres = criteres || {};
    var tableComptes = comptes || {};
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

      if (criteres.realisations) {
        var faits = tableComptes[recette.id] || 0;
        if (criteres.realisations === 'jamais' && faits > 0) return false;
        if (criteres.realisations === 'deja' && faits === 0) return false;
      }

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

  /* --- tableau de flux ----------------------------------------------------
     Le rendu produit un vrai <table> avec les rowspan/colspan d'origine : on n'a
     donc pas besoin de resoudre la grille, seulement de savoir si le tableau
     porte une information. */

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

  var api = {
    criteresVides: criteresVides,
    parseMinutes: parseMinutes,
    stripTipPrefix: stripTipPrefix,
    origineCourte: origineCourte,
    difficulteCourte: difficulteCourte,
    TRANCHES_TEMPS: TRANCHES_TEMPS,
    trancheTemps: trancheTemps,
    normaliser: normaliser,
    texteIndexable: texteIndexable,
    optionsDisponibles: optionsDisponibles,
    filterRecipes: filterRecipes,
    isFlowTableInformative: isFlowTableInformative,
    largeurGrille: largeurGrille,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.CarnetLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
