/* Classement des ingredients par rayon de magasin.
   Fonctions pures, sans DOM : testables sous Node.

   Sert a organiser la liste de courses dans l'ordre ou on remplit le caddie, plutot
   que par recette : on ne revient pas trois fois au rayon cremerie.

   Le classement se fait par mots-cles, en parcourant les regles dans l'ordre : la
   premiere qui correspond gagne. L'ordre est donc porteur de sens, et plusieurs
   regles n'existent que pour desamorcer un piege :
     « Beurre aux cristaux de sel »   contient « sel »      -> cremerie d'abord
     « Sucre et eau pour sirop »      contient « eau »      -> sucre d'abord
     « Vinaigre de vin »              contient « vin »      -> vinaigre d'abord
     « Noix de muscade »              contient « noix »     -> muscade d'abord
     « Pulpe de tomate en conserve »  contient « tomate »   -> conserve d'abord
     « Arôme de citron »              contient « citron »   -> arome d'abord

   Toute regle ajoutee doit l'etre a la bonne place, et les tests verifient que les
   114 noms du carnet restent classes sans retomber sur « Autre ».

   Expose window.CarnetRayons dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  // Ordre d'affichage dans la liste de courses : l'ordre d'un parcours de magasin,
  // du frais vers le sec, les boissons en fin de course.
  var RAYONS = [
    'Fruits et légumes',
    'Viandes et poissons',
    'Crèmerie',
    'Boulangerie',
    'Surgelés',
    'Épices et herbes',
    'Épicerie salée',
    'Épicerie sucrée',
    'Boissons',
    'Autre',
  ];

  var RAYON_DEFAUT = 'Autre';

  /**
   * Normalise un nom d'ingredient avant classement.
   *
   * Trois traitements, chacun pour une raison constatee sur les donnees reelles :
   *
   * 1. Les ligatures. « Œufs » ne se decompose pas en « oeufs » par NFD : le
   *    caractere œ est une lettre a part entiere. Sans cette conversion, les sept
   *    entrees a base d'oeuf et « Bœuf haché » retombaient sur « Autre ».
   *
   * 2. Ce qui suit « pour » est un usage, pas un produit. « Farine pour beurre
   *    manié » est de la farine et se range en epicerie ; sans coupure, le mot
   *    « beurre » l'envoyait en cremerie. On ne garde donc que la tete du nom.
   *
   * 3. Les parentheses sont des precisions de la source (« Plaques de lasagnes
   *    (fraîches ou sèches...) », « Pulpe de tomate en conserve (ou 500 g de
   *    tomates fraîches) ») et brouillent le classement.
   */
  function clef(texte) {
    return String(texte || '')
      .replace(/œ/gi, 'oe')
      .replace(/æ/gi, 'ae')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u2019]/g, "'")
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .split(/\bpour\b/)[0]
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Regles evaluees dans l'ordre. Les motifs sont deja normalises (sans accents).
  var REGLES = [
    // --- Desamorcages : ces regles doivent passer avant les mots-cles generiques ---
    [/vinaigre/, 'Épicerie salée'],
    [/muscade/, 'Épices et herbes'],
    [/arome/, 'Épicerie sucrée'],
    [/conserve|pulpe de tomate/, 'Épicerie salée'],
    // Un coulis de fruits est un produit sucre en bocal, pas un fruit frais.
    [/coulis/, 'Épicerie sucrée'],
    [/anchois a l'huile|anchois a l huile/, 'Épicerie salée'],

    // --- Crèmerie ---
    // « \boeuf » et non « oeuf » : sans la limite de mot, le motif s'accroche a
    // l'interieur de « boeuf » et « Bœuf haché » partait en cremerie.
    [/beurre|creme fraiche|creme liquide|creme epaisse|mascarpone|lait\b|\boeuf|fromage|emmental|gruyere|beaufort|comte\b|reblochon|tomme|parmesan|yaourt|ricotta|mozzarella/, 'Crèmerie'],

    // --- Épicerie sucrée : farines, sucres, chocolat, fruits secs, aides pâtissières ---
    [/farine|maizena|fecule|sucre|chocolat|cacao|levure|amande|noisette|noix de pecan|noix\b|praline|vanille|miel|confiture|cranberries|raisins secs|pepites|nappage|sirop/, 'Épicerie sucrée'],

    // --- Boulangerie et pâtisserie prête ---
    [/pain\b|baguette|brioche|pate brisee|pate feuilletee|pate sablee|biscuit|speculoos|boudoir|genoise/, 'Boulangerie'],

    // --- Viandes et poissons ---
    [/boeuf|veau|porc|agneau|poulet|dinde|lardon|jambon|saucisse|chair a saucisse|steak|viande|saumon|cabillaud|thon|crevette|poisson|anchois/, 'Viandes et poissons'],

    // --- Fruits et légumes ---
    [/abricot|pomme\b|poire|fraise|framboise|banane|citron|orange|ail\b|oignon|echalote|aubergine|courgette|carotte|tomate|poivron|champignon|salade|epinard|persil|basilic frais|aneth|ciboulette|coriandre|menthe|pomme de terre|patate|brocoli|chou|haricot|petits pois|concombre|radis|betterave|celeri|poireau|navet|fenouil|potiron|courge/, 'Fruits et légumes'],

    // --- Épices et herbes séchées ---
    [/sel\b|poivre|piment|paprika|curry|cumin|curcuma|cannelle|gingembre|quatre-epices|epice|origan|thym|romarin|laurier|herbes aromatiques|safran|noix de muscade|graine/, 'Épices et herbes'],

    // --- Boissons ---
    [/vin\b|biere|cidre|rhum|kirsch|amaretto|cognac|whisky|liqueur|porto|cafe|the\b|jus d'orange|eau\b|limonade|sirop de/, 'Boissons'],

    // --- Épicerie salée : huiles, conserves, pâtes, riz ---
    [/huile|olive|capre|cornichon|moutarde|ketchup|mayonnaise|sauce|bouillon|lasagne|pate alimentaire|pates\b|riz\b|semoule de ble|quinoa|lentille|pois chiche|tortilla|feuille de brick/, 'Épicerie salée'],

    // --- Surgelés (aucun dans le carnet actuel, la règle prépare la suite) ---
    [/surgele|glace\b|glacon|petits pois surgeles/, 'Surgelés'],
  ];

  /**
   * Rayon d'un ingredient, d'apres son nom.
   * Retourne toujours un rayon de la liste RAYONS ; « Autre » quand rien ne
   * correspond, ce qui est un signal a traiter plutot qu'un resultat normal.
   */
  function rayonDe(nom) {
    var k = clef(nom);
    if (k === '') return RAYON_DEFAUT;

    for (var i = 0; i < REGLES.length; i += 1) {
      if (REGLES[i][0].test(k)) return REGLES[i][1];
    }
    return RAYON_DEFAUT;
  }

  /** Position d'un rayon dans l'ordre de parcours, pour trier. */
  function ordreRayon(rayon) {
    var i = RAYONS.indexOf(rayon);
    return i === -1 ? RAYONS.length : i;
  }

  /**
   * Regroupe des articles par rayon, dans l'ordre de parcours du magasin.
   * Retourne [{ rayon, articles }], sans les rayons vides.
   */
  function grouperParRayon(articles) {
    var index = {};
    (articles || []).forEach(function (article) {
      var rayon = article.rayon || rayonDe(article.nom);
      if (!index[rayon]) index[rayon] = [];
      index[rayon].push(article);
    });

    return Object.keys(index)
      .sort(function (a, b) {
        return ordreRayon(a) - ordreRayon(b);
      })
      .map(function (rayon) {
        return { rayon: rayon, articles: index[rayon] };
      });
  }

  var api = {
    RAYONS: RAYONS,
    RAYON_DEFAUT: RAYON_DEFAUT,
    REGLES: REGLES,
    clef: clef,
    rayonDe: rayonDe,
    ordreRayon: ordreRayon,
    grouperParRayon: grouperParRayon,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.CarnetRayons = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
