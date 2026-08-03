/* Deroule des preparations : generation du tableau a partir de la recette.
   Fonctions pures, sans DOM : testables sous Node.

   Le carnet contient un tableau de flux construit a la main pour une seule recette
   (les lasagnes bolognaise) et des tableaux generes automatiquement, vides de sens,
   pour les seize autres. Plutot que de demander de tout reimporter, ce module
   reconstruit le deroule a partir de ce que la recette contient deja : la liste des
   ingredients et le texte des etapes.

   Principe : pour chaque ingredient, on cherche la premiere etape qui le mentionne.
   Le tableau se lit alors « a l'etape 2, ces ingredients entrent, et voila ce qu'on
   en fait ».

   Ce que cette methode sait faire, mesure sur les 17 recettes : 158 ingredients sur
   169 sont rattaches a une etape, soit 93 %, et 8 recettes le sont entierement.

   Ce qu'elle ne sait pas faire, et pourquoi c'est assume :
   - Quand une instruction designe une categorie plutot qu'un produit, le lien est
     introuvable : « faire fondre les fromages » ne dit pas qu'il s'agit du Beaufort,
     du Comte et de la Tomme de Savoie ; « saler » ne contient pas le mot « sel » ;
     « ajouter les epices » ne nomme ni la cannelle ni le gingembre. Ces ingredients
     sont donc listes a part, sous le tableau, au lieu d'etre placés au hasard.
   - Le tableau fait main des lasagnes va plus loin : il regroupe les ingredients en
     sous-preparations qui convergent (la sauce tomate, la bechamel), ce qui est une
     interpretation humaine du texte. On ne la devine pas. C'est pourquoi un tableau
     fourni avec la recette est toujours prefere au tableau genere.

   Expose window.CarnetFlux dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  var estNode = typeof module !== 'undefined' && module.exports;
  var Q = estNode ? require('./quantites.js') : global.CarnetQuantites;

  // Mots trop generiques ou trop lies a la forme du produit pour servir de reperes :
  // chercher « poudre » ou « rape » dans une instruction ne prouve rien.
  var MOTS_IGNORES = [
    'de', 'du', 'des', 'le', 'la', 'les', 'un', 'une', 'aux', 'aux', 'aui',
    'fin', 'fine', 'gros', 'grosse', 'mou', 'molle', 'froid', 'froide', 'tiede', 'chaud',
    'rape', 'rapee', 'rapes', 'rapees', 'effile', 'effilee', 'effilees', 'concasse', 'concassee',
    'concassees', 'poudre', 'ambiante', 'temperature', 'pommade', 'sec', 'seche', 'seches',
    'noir', 'noire', 'noires', 'vert', 'verte', 'vertes', 'frais', 'fraiche', 'fraiches',
    'denoyaute', 'denoyautee', 'denoyautees', 'choix', 'entier', 'entiere', 'ramolli', 'ramollie',
    'manie', 'detrempe', 'glacage', 'cristaux', 'moulu', 'moulue', 'liquide', 'epaisse',
  ];

  /** Normalise un texte : minuscules, sans accents, ligature oe developpee. */
  function normaliser(texte) {
    return String(texte || '')
      .replace(/œ/gi, 'oe')
      .replace(/æ/gi, 'ae')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u2019]/g, "'")
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Mots-cles servant a reconnaitre un ingredient dans une instruction.
   * On retire les parentheses (precisions de la source), ce qui suit « pour » (un
   * usage, pas le produit) et les qualificatifs de forme.
   */
  function motsCles(nom) {
    var propre = normaliser(nom)
      .replace(/\([^)]*\)/g, ' ')
      .split(/\bpour\b/)[0];

    return propre
      .split(/[\s,'/-]+/)
      .filter(function (mot) {
        return mot.length > 2 && MOTS_IGNORES.indexOf(mot) === -1;
      });
  }

  /** Retire un pluriel simple, pour que « courgettes » trouve « courgette ». */
  function racine(mot) {
    return mot.length > 3 && /s$/.test(mot) ? mot.slice(0, -1) : mot;
  }

  /**
   * Indice de la premiere etape qui mentionne l'ingredient, ou -1.
   * La recherche se fait sur un debut de mot, pour que « oeuf » trouve « oeufs »
   * sans que « ail » ne se declenche sur « travailler ».
   */
  function premiereEtape(nom, etapesNormalisees) {
    var cles = motsCles(nom);
    if (cles.length === 0) return -1;

    for (var i = 0; i < etapesNormalisees.length; i += 1) {
      for (var j = 0; j < cles.length; j += 1) {
        var motif = new RegExp('\\b' + racine(cles[j]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        if (motif.test(etapesNormalisees[i])) return i;
      }
    }
    return -1;
  }

  /** Premiere phrase d'un texte, pour resumer l'action d'une etape. */
  function actionCourte(texte) {
    var propre = String(texte || '').trim();
    var fin = propre.search(/[.;]\s/);
    var courte = fin === -1 ? propre : propre.slice(0, fin);
    return courte.length > 160 ? courte.slice(0, 157).replace(/\s\S*$/, '') + '…' : courte;
  }

  /**
   * Construit le deroule d'une recette.
   *
   * Retourne { genere: true, phases, nonRattaches, couverture } ou :
   * - `phases` est la liste des etapes qui recoivent au moins un ingredient, avec
   *   leur numero, l'action resumee et les ingredients concernes ;
   * - `nonRattaches` liste les ingredients qu'aucune etape ne nomme, plutot que de
   *   les placer arbitrairement ;
   * - `couverture` donne { places, total } pour pouvoir l'afficher honnetement.
   */
  function genererDeroule(recette) {
    var instructions = (recette && recette.instructions) || [];
    var etapes = instructions.map(function (etape) {
      return normaliser(etape.texte);
    });

    var phases = instructions.map(function (etape, index) {
      return {
        index: index,
        numero: typeof etape.numero === 'number' ? String(etape.numero) : String(etape.numero || index + 1),
        action: actionCourte(etape.texte),
        ingredients: [],
      };
    });

    var nonRattaches = [];
    var total = 0;

    ((recette && recette.ingredients) || []).forEach(function (groupe) {
      (groupe.items || []).forEach(function (item) {
        total += 1;
        var ligne = { nom: item.nom, quantite: item.quantite || '', groupe: groupe.groupe || null };
        var indice = premiereEtape(item.nom, etapes);
        if (indice === -1) nonRattaches.push(ligne);
        else phases[indice].ingredients.push(ligne);
      });
    });

    var utiles = phases.filter(function (phase) {
      return phase.ingredients.length > 0;
    });

    return {
      genere: true,
      phases: utiles,
      nonRattaches: nonRattaches,
      couverture: { places: total - nonRattaches.length, total: total },
    };
  }

  /**
   * Met a l'echelle une cellule du tableau fourni.
   *
   * Deux formes coexistent dans ces cellules, et elles ne se traitent pas pareil :
   *
   * 1. « Oignon : 1 », « Beurre : 70 g », « Sucre : 2 morceaux ». La partie droite
   *    est une quantite complete, souvent un nombre nu. La liste blanche d'unites
   *    utilisee pour les instructions refuserait d'y toucher, et le tableau
   *    afficherait « Oignon : 1 » a cote d'une liste d'ingredients disant 2. On
   *    traite donc la partie apres le dernier deux-points comme une quantite.
   *
   * 2. « Enfourner 45 min a 165 °C », « Prechauffer le four a 165 °C ». Ce sont des
   *    phrases d'action : on y applique la liste blanche, qui protege les durees et
   *    les temperatures.
   */
  function echelonnerCellule(texte, facteur) {
    var brut = String(texte || '');
    var coupure = brut.lastIndexOf(':');

    if (coupure !== -1) {
      var gauche = brut.slice(0, coupure).trim();
      var droite = brut.slice(coupure + 1).trim();
      if (gauche !== '' && Q.analyser(droite).lisible) {
        var mis = Q.echelonner(droite, facteur);
        return {
          texte: gauche + ' : ' + mis,
          remplacements: mis === droite ? [] : [{ avant: droite, apres: mis }],
        };
      }
    }

    var resultat = Q.echelonnerTexte(brut, facteur);
    return { texte: resultat.texte, remplacements: resultat.remplacements };
  }

  /**
   * Met a l'echelle les cellules d'un tableau fourni avec la recette.
   *
   * Le tableau fait main contient des quantites dans son texte (« Oignon : 1 »,
   * « Beurre : 70 g », « Enfourner 45 min a 165 °C »). Elles doivent suivre le
   * nombre de parts, sans que les durees ni les temperatures ne bougent : on reutilise
   * donc la meme liste blanche d'unites que pour les instructions.
   */
  function echelonnerFlowTable(flowTable, facteur) {
    if (!flowTable || !Array.isArray(flowTable.rows)) {
      return { flowTable: flowTable, remplacements: [] };
    }
    if (typeof facteur !== 'number' || !isFinite(facteur) || facteur <= 0 || facteur === 1) {
      return { flowTable: flowTable, remplacements: [] };
    }

    var remplacements = [];
    var copie = {
      headers: (flowTable.headers || []).slice(),
      rows: flowTable.rows.map(function (ligne) {
        return (ligne || []).map(function (cellule) {
          var resultat = echelonnerCellule(cellule.text || '', facteur);
          remplacements = remplacements.concat(resultat.remplacements);
          return {
            text: resultat.texte,
            rowspan: cellule.rowspan,
            colspan: cellule.colspan,
          };
        });
      }),
    };

    return { flowTable: copie, remplacements: remplacements };
  }

  var api = {
    MOTS_IGNORES: MOTS_IGNORES,
    normaliser: normaliser,
    motsCles: motsCles,
    premiereEtape: premiereEtape,
    actionCourte: actionCourte,
    genererDeroule: genererDeroule,
    echelonnerCellule: echelonnerCellule,
    echelonnerFlowTable: echelonnerFlowTable,
  };

  if (estNode) module.exports = api;
  else global.CarnetFlux = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
