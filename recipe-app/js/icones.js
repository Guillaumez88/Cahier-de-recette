/* Pictogrammes, en SVG ecrit dans la page.

   Pourquoi en ligne et non des fichiers ou une police d'icones : le site n'a aucune
   dependance et doit rester utilisable hors ligne. Un jeu d'icones charge depuis un
   CDN ajouterait une requete reseau bloquante pour l'affichage et casserait la page
   en cuisine sans connexion. Un SVG ecrit dans le DOM se colore par currentColor et
   suit donc la palette sans code supplementaire.

   Toutes les icones sont dessinees dans une grille de 24 unites, trait de 1,7, sans
   remplissage : elles restent lisibles de 16 a 48 px.

   Expose window.CarnetIcones dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  // Chaque entree est la liste des elements du dessin : ['tag', { attributs }].
  var DESSINS = {
    // Navigation et sections
    livre: [
      ['path', { d: 'M4 5.5A2 2 0 0 1 6 3.5h4.5v17H6a2 2 0 0 0-2 2z' }],
      ['path', { d: 'M20 5.5a2 2 0 0 0-2-2h-4.5v17H18a2 2 0 0 1 2 2z' }],
      ['path', { d: 'M12 3.5v17' }],
    ],
    // Le livre ferme, vu de face : c'est celui de la proposition de design pour la
    // couverture d'une carte de la bibliotheque. Distinct de `livre`, qui est un
    // livre ouvert et sert a la navigation.
    'livre-ferme': [
      ['path', { d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20' }],
      ['path', { d: 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z' }],
    ],
    // Trois volumes debout : l'etagere, donc la bibliotheque.
    bibliotheque: [
      ['rect', { x: '3.5', y: '5', width: '4.5', height: '14', rx: '1' }],
      ['rect', { x: '10', y: '5', width: '4.5', height: '14', rx: '1' }],
      ['path', { d: 'M16.8 6.4l3.5.9-2.6 12-3.5-.9z' }],
    ],
    panier: [
      ['path', { d: 'M4 7.5h16l-1.4 10a2 2 0 0 1-2 1.7H7.4a2 2 0 0 1-2-1.7z' }],
      ['path', { d: 'M9 7.5V6a3 3 0 0 1 6 0v1.5' }],
      ['path', { d: 'M9.5 11.5v4M14.5 11.5v4' }],
    ],
    calendrier: [
      ['rect', { x: '3.5', y: '5', width: '17', height: '15', rx: '2' }],
      ['path', { d: 'M3.5 10h17M8 3v4M16 3v4' }],
    ],
    marmite: [
      ['path', { d: 'M5 9.5h14v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z' }],
      ['path', { d: 'M3 12h2M19 12h2' }],
      ['path', { d: 'M9 6.5c0-1 1.5-1 1.5-2M13.5 6.5c0-1 1.5-1 1.5-2' }],
    ],
    recherche: [
      ['circle', { cx: '11', cy: '11', r: '6' }],
      ['path', { d: 'M15.5 15.5 20 20' }],
    ],
    // Deux arcs et deux pointes : la fleche circulaire de mise a jour. Les arcs sont
    // ouverts en haut a droite et en bas a gauche, pour laisser la place aux pointes.
    rafraichir: [
      ['path', { d: 'M20 12a8 8 0 0 1-13.7 5.6' }],
      ['path', { d: 'M4 12a8 8 0 0 1 13.7-5.6' }],
      ['path', { d: 'M17.7 3.2v3.3h-3.3' }],
      ['path', { d: 'M6.3 20.8v-3.3h3.3' }],
    ],
    plus: [['path', { d: 'M12 5.5v13M5.5 12h13' }]],
    croix: [['path', { d: 'M6.5 6.5l11 11M17.5 6.5l-11 11' }]],
    crayon: [
      ['path', { d: 'M4.5 19.5h4l10-10a2.1 2.1 0 0 0-3-3l-10 10z' }],
      ['path', { d: 'M14.5 6.5l3 3' }],
    ],
    appareil: [
      ['rect', { x: '3.5', y: '6.5', width: '17', height: '13', rx: '2.5' }],
      ['circle', { cx: '12', cy: '13', r: '3.5' }],
      ['path', { d: 'M8.5 6.5l1.2-2h4.6l1.2 2' }],
    ],
    fleche: [['path', { d: 'M5 12h13M13 7l5 5-5 5' }]],
    poignee: [
      ['path', { d: 'M9 7h.01M15 7h.01M9 12h.01M15 12h.01M9 17h.01M15 17h.01' }],
    ],
    horloge: [
      ['circle', { cx: '12', cy: '12', r: '8' }],
      ['path', { d: 'M12 8v4.5l3 1.8' }],
    ],
    coche: [['path', { d: 'M5 12.5l4.5 4.5L19 7' }]],
    // Trois noeuds relies : le symbole de partage, celui des menus systeme sur
    // Android et sur le bureau. Pas la fleche sortant d'un cadre, qui est celui d'iOS
    // et que personne ne reconnait ailleurs.
    partager: [
      ['circle', { cx: '18', cy: '5.5', r: '2.5' }],
      ['circle', { cx: '6', cy: '12', r: '2.5' }],
      ['circle', { cx: '18', cy: '18.5', r: '2.5' }],
      ['path', { d: 'M15.8 6.8 8.2 10.7M8.2 13.3l7.6 3.9' }],
    ],
    // Deux feuilles superposees : copier. Le presse-papiers dessine comme une
    // planchette se confond avec une note ou une liste, a 16 pixels.
    copier: [
      ['rect', { x: '9', y: '9', width: '11.5', height: '11.5', rx: '2' }],
      ['path', { d: 'M15 5.5A2 2 0 0 0 13 3.5H5.5a2 2 0 0 0-2 2V13a2 2 0 0 0 2 2' }],
    ],
    // Deux maillons : une adresse. Distinct de la fleche, qui veut dire « aller a ».
    lien: [
      ['path', { d: 'M10.5 13.5a3.5 3.5 0 0 1 0-5l2-2a3.5 3.5 0 0 1 5 5l-1 1' }],
      ['path', { d: 'M13.5 10.5a3.5 3.5 0 0 1 0 5l-2 2a3.5 3.5 0 0 1-5-5l1-1' }],
    ],
    // Une feuille au coin replie : le document a imprimer ou a enregistrer.
    feuille: [
      ['path', { d: 'M6 3.5h7.5L19 9v11.5H6z' }],
      ['path', { d: 'M13.5 3.5V9H19' }],
      ['path', { d: 'M9 13h7M9 16.5h5' }],
    ],

    // Moments de la journee
    'petit-dejeuner': [
      ['path', { d: 'M4.5 9.5h11v4a4 4 0 0 1-4 4h-3a4 4 0 0 1-4-4z' }],
      ['path', { d: 'M15.5 10.5h2a2.5 2.5 0 0 1 0 5h-2' }],
      ['path', { d: 'M4 20.5h13' }],
    ],
    dejeuner: [
      ['path', { d: 'M7 3.5v8M4.5 3.5v4a2.5 2.5 0 0 0 5 0v-4' }],
      ['path', { d: 'M7 11.5v9' }],
      ['path', { d: 'M16.5 3.5c-2 1.5-2 4.5 0 6 2-1.5 2-4.5 0-6z' }],
      ['path', { d: 'M16.5 9.5v11' }],
    ],
    diner: [
      ['path', { d: 'M20 13.5a8 8 0 1 1-8.6-8 6.4 6.4 0 0 0 8.6 8z' }],
      ['path', { d: 'M16.5 4.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z' }],
    ],

    // Repas hors carnet
    restaurant: [
      ['path', { d: 'M6 3.5v7M4 3.5v3a2 2 0 0 0 4 0v-3' }],
      ['path', { d: 'M6 10.5v10' }],
      ['path', { d: 'M18 3.5v17' }],
      ['path', { d: 'M14.5 3.5c0 3 1 4.5 3.5 4.5' }],
    ],
    pizza: [
      ['path', { d: 'M12 3.5 20.5 19a20 20 0 0 1-17 0z' }],
      ['circle', { cx: '10.5', cy: '12', r: '1.2' }],
      ['circle', { cx: '14', cy: '15.5', r: '1.2' }],
    ],
    sushi: [
      ['rect', { x: '4.5', y: '9.5', width: '15', height: '9', rx: '4.5' }],
      ['circle', { cx: '12', cy: '14', r: '2.5' }],
      ['path', { d: 'M12 5.5v3' }],
    ],
    restes: [
      ['path', { d: 'M5 8.5h14v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z' }],
      ['path', { d: 'M3.5 8.5 6 5h12l2.5 3.5' }],
      ['path', { d: 'M12 5v3.5' }],
    ],
    libre: [
      ['circle', { cx: '9', cy: '8', r: '3' }],
      ['path', { d: 'M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5' }],
      ['path', { d: 'M17 9.5h4M19 7.5v4' }],
    ],

    // Rayons de magasin, pour la liste de courses
    'fruits-legumes': [
      ['path', { d: 'M12 20a6 6 0 0 1 0-12 6 6 0 0 1 0 12z' }],
      ['path', { d: 'M12 8c0-2 1.5-4 4-4.5C15.5 6 14 8 12 8z' }],
    ],
    viandes: [
      ['path', { d: 'M6 15a5.5 5.5 0 0 1 9-6.5c2.5 2 2.5 6 0 8S8 19 6 15z' }],
      ['circle', { cx: '10.5', cy: '13', r: '2' }],
    ],
    cremerie: [
      ['path', { d: 'M8 3.5h8l-1 3v12a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-12z' }],
      ['path', { d: 'M8.5 10h7' }],
    ],
    epicerie: [
      ['path', { d: 'M7 8.5h10l1 11H6z' }],
      ['path', { d: 'M9.5 8.5V6a2.5 2.5 0 0 1 5 0v2.5' }],
    ],
    boissons: [
      ['path', { d: 'M8 3.5h8l-1 6v9a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-9z' }],
      ['path', { d: 'M8.2 11.5h7.6' }],
    ],
  };

  // Rayon -> icone. Les rayons sans entree prennent l'icone d'epicerie.
  var PAR_RAYON = {
    'Fruits et légumes': 'fruits-legumes',
    'Viandes et poissons': 'viandes',
    Crèmerie: 'cremerie',
    Boulangerie: 'epicerie',
    Surgelés: 'epicerie',
    'Épices et herbes': 'epicerie',
    'Épicerie salée': 'epicerie',
    'Épicerie sucrée': 'epicerie',
    Boissons: 'boissons',
    Autre: 'epicerie',
  };

  var CATEGORIES = { Entrée: 'petit-dejeuner', Plat: 'marmite', Dessert: 'diner' };

  function existe(nom) {
    return Object.prototype.hasOwnProperty.call(DESSINS, nom);
  }

  function pourRayon(rayon) {
    return PAR_RAYON[rayon] || 'epicerie';
  }

  function pourCategorie(categorie) {
    return CATEGORIES[categorie] || 'marmite';
  }

  /**
   * Construit le noeud SVG. `document` est passe explicitement pour que la fonction
   * reste appelable depuis un test qui fournit son propre document.
   */
  function dessiner(doc, nom, options) {
    var reglages = options || {};
    var dessin = DESSINS[nom];
    if (!dessin) return null;

    var NS = 'http://www.w3.org/2000/svg';
    var svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(reglages.taille || 24));
    svg.setAttribute('height', String(reglages.taille || 24));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', String(reglages.trait || 1.7));
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('class', 'icone' + (reglages.classe ? ' ' + reglages.classe : ''));
    // Une icone accompagne toujours un texte dans cette interface : elle est donc
    // decorative pour un lecteur d'ecran, sauf titre explicite.
    if (reglages.titre) {
      svg.setAttribute('role', 'img');
      var titre = doc.createElementNS(NS, 'title');
      titre.textContent = reglages.titre;
      svg.appendChild(titre);
    } else {
      svg.setAttribute('aria-hidden', 'true');
    }

    dessin.forEach(function (element) {
      var noeud = doc.createElementNS(NS, element[0]);
      Object.keys(element[1]).forEach(function (attribut) {
        noeud.setAttribute(attribut, element[1][attribut]);
      });
      svg.appendChild(noeud);
    });

    return svg;
  }

  var api = {
    DESSINS: DESSINS,
    PAR_RAYON: PAR_RAYON,
    CATEGORIES: CATEGORIES,
    existe: existe,
    pourRayon: pourRayon,
    pourCategorie: pourCategorie,
    dessiner: dessiner,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.CarnetIcones = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
