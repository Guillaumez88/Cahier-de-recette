/* Un ecrivain de PDF minimal, sans dependance.

   ## Pourquoi ce fichier existe

   Le projet n'a aucune dependance, et c'est le premier de ses invariants : pas de
   npm, pas de CDN, pas d'etape de construction. jsPDF pese 380 Ko et pdf-lib 1,4 Mo,
   pour un besoin qui tient en une page A4 : du texte, des traits, des rectangles.
   Le format PDF est documente et sa forme minimale est courte, alors elle est ecrite
   ici. Ce module ne connait ni recette ni semaine : il ne sait qu'ecrire des pages.

   ## La contrainte des accents, verifiee avant d'ecrire

   Un PDF sans police embarquee n'a droit qu'aux quatorze polices de base, dont
   Helvetica, et a l'encodage WinAnsi : un octet par caractere, environ 220
   caracteres disponibles. Embarquer une police voudrait dire lire un fichier .ttf,
   en extraire les tables et fabriquer un sous-ensemble, ce qui n'est pas raisonnable
   ici.

   Les caracteres hors ASCII presents dans les titres de recettes et les libelles du
   carnet ont donc ete releves : ’ ï é â è à, six caracteres, tous dans WinAnsi. La
   contrainte est donc tenue sans compromis pour les donnees existantes. Pour ce qui
   viendra plus tard (une recette importee d'un site etranger), `versWinAnsi()` retire
   les accents inconnus au lieu de rendre un octet faux, et remplace en dernier
   recours par « ? » : un titre legerement appauvri vaut mieux qu'un PDF illisible.

   ## Les largeurs de caracteres

   Couper une ligne ou centrer un titre demande de mesurer le texte, et un PDF sans
   police embarquee ne mesure rien tout seul : les largeurs des polices de base font
   partie de la specification. La table ci-dessous porte les valeurs Adobe pour les
   codes 32 a 126, plus les caracteres accentues et la ponctuation reellement
   utilises. Les lettres accentuees ont, dans Helvetica, la largeur de leur lettre de
   base, sauf les variantes du i, listees a part. Un octet absent de la table est
   compte comme un « n » : la coupure de ligne se decale alors d'une fraction de
   point, elle ne casse pas.

   ## Ce que ce module ne fait pas

   Pas de compression (le flux est ecrit tel quel : une page de menu mesuree pese de
   4,6 Ko a 6,3 Ko, un Deflate a la main n'en vaut pas le prix), pas d'image, pas de
   transparence, pas de police embarquee. Trois pages A4 de texte, proprement.

   Expose window.CarnetPdf dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  // A4 en points typographiques (1/72 de pouce) : 210 x 297 mm.
  var LARGEUR_A4 = 595.28;
  var HAUTEUR_A4 = 841.89;

  // --- Encodage WinAnsi --------------------------------------------------------

  // Les codes 0x80 a 0x9F de WinAnsi ne suivent pas Unicode : ils portent la
  // ponctuation typographique, dont l'apostrophe courbe utilisee partout dans le
  // carnet (« l’huile »).
  var SPECIAUX = {
    0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
    0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
    0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
    0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
    0x017e: 0x9e, 0x0178: 0x9f,
  };

  /**
   * Convertit une chaine en octets WinAnsi, rendus sous forme de chaine dont chaque
   * code de caractere vaut un octet.
   *
   * Un caractere hors encodage est d'abord decompose pour en retirer les accents
   * (NFD puis suppression des diacritiques) : « ā » devient « a » plutot qu'un octet
   * arbitraire. S'il ne reste rien d'imprimable, « ? » marque la place, ce qui se voit
   * a la relecture au lieu de disparaitre en silence.
   */
  function versWinAnsi(texte) {
    var entree = String(texte === null || texte === undefined ? '' : texte);
    var sortie = '';

    for (var i = 0; i < entree.length; i += 1) {
      var point = entree.charCodeAt(i);

      if (point === 0x0a || point === 0x0d || point === 0x09) {
        // Les sauts de ligne sont geres par la mise en page, pas par l'encodage :
        // dans un flux PDF ils n'auraient aucun effet, un espace au moins separe.
        sortie += ' ';
        continue;
      }
      if (point >= 0x20 && point <= 0x7e) {
        sortie += entree.charAt(i);
        continue;
      }
      if (point >= 0xa0 && point <= 0xff) {
        sortie += String.fromCharCode(point);
        continue;
      }
      if (SPECIAUX[point] !== undefined) {
        sortie += String.fromCharCode(SPECIAUX[point]);
        continue;
      }

      var replie = entree
        .charAt(i)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      var conserve = '';
      for (var j = 0; j < replie.length; j += 1) {
        var p = replie.charCodeAt(j);
        if (p >= 0x20 && p <= 0x7e) conserve += replie.charAt(j);
        else if (p >= 0xa0 && p <= 0xff) conserve += String.fromCharCode(p);
      }
      sortie += conserve === '' ? '?' : conserve;
    }

    return sortie;
  }

  // --- Largeurs ----------------------------------------------------------------

  // Codes 32 a 126, en milliemes de point (valeurs Adobe pour Helvetica).
  var LARGEURS_NORMAL = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
  ];

  // Idem pour Helvetica-Bold.
  var LARGEURS_GRAS = [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
  ];

  // Une lettre accentuee a la largeur de sa lettre de base : cette table dit
  // laquelle. Les variantes du i font exception et sont dans LARGEURS_FIXES.
  var LETTRE_DE_BASE = {};
  (function () {
    var groupes = [
      ['A', [0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5]],
      ['C', [0xc7]],
      ['E', [0xc8, 0xc9, 0xca, 0xcb]],
      ['N', [0xd1]],
      ['O', [0xd2, 0xd3, 0xd4, 0xd5, 0xd6]],
      ['U', [0xd9, 0xda, 0xdb, 0xdc]],
      ['Y', [0xdd]],
      ['a', [0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5]],
      ['c', [0xe7]],
      ['e', [0xe8, 0xe9, 0xea, 0xeb]],
      ['n', [0xf1]],
      ['o', [0xf2, 0xf3, 0xf4, 0xf5, 0xf6]],
      ['u', [0xf9, 0xfa, 0xfb, 0xfc]],
      ['y', [0xfd, 0xff]],
      [' ', [0xa0]],
    ];
    groupes.forEach(function (groupe) {
      groupe[1].forEach(function (octet) {
        LETTRE_DE_BASE[octet] = groupe[0].charCodeAt(0);
      });
    });
  })();

  // Largeurs qui ne se deduisent d'aucune lettre : ponctuation typographique,
  // ligatures, et les variantes du i, plus larges que le i a cause de l'accent.
  var LARGEURS_FIXES = {
    0x85: [1000, 1000], // …
    0x91: [191, 238], // ‘
    0x92: [191, 238], // ’
    0x93: [333, 500], // “
    0x94: [333, 500], // ”
    0x95: [350, 350], // •
    0x96: [556, 556], // – (demi-cadratin)
    0x97: [1000, 1000], // — (cadratin)
    0xab: [556, 556], // «
    0xbb: [556, 556], // »
    0xb0: [400, 400], // °
    0xb7: [278, 278], // ·
    0xc6: [1000, 1000], // Æ
    0xd8: [778, 778], // Ø
    0xdf: [500, 611], // ß
    0xe6: [889, 889], // æ
    0xec: [278, 278], // ì
    0xed: [278, 278], // í
    0xee: [278, 278], // î
    0xef: [278, 278], // ï
    0xf8: [611, 611], // ø
  };

  function largeurOctet(octet, gras) {
    var table = gras ? LARGEURS_GRAS : LARGEURS_NORMAL;
    var fixe = LARGEURS_FIXES[octet];
    if (fixe) return fixe[gras ? 1 : 0];
    var base = LETTRE_DE_BASE[octet] !== undefined ? LETTRE_DE_BASE[octet] : octet;
    if (base >= 32 && base <= 126) return table[base - 32];
    return table['n'.charCodeAt(0) - 32];
  }

  /** Largeur d'un texte, en points, pour une taille et une graisse donnees. */
  function largeurTexte(texte, taille, gras) {
    var octets = versWinAnsi(texte);
    var total = 0;
    for (var i = 0; i < octets.length; i += 1) {
      total += largeurOctet(octets.charCodeAt(i), Boolean(gras));
    }
    return (total * (Number(taille) || 0)) / 1000;
  }

  /**
   * Coupe un texte en lignes qui tiennent dans `largeurMax`.
   *
   * La coupure se fait sur les espaces. Un mot seul plus large que la colonne (une
   * adresse, un nom compose sans espace) est coupe caractere par caractere : sans
   * cela il depasserait de la page sans que rien ne le signale.
   */
  function couper(texte, largeurMax, taille, gras) {
    var mots = String(texte === null || texte === undefined ? '' : texte)
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(function (mot) {
        return mot !== '';
      });
    if (mots.length === 0) return [];

    var lignes = [];
    var courante = '';

    function couperMot(mot) {
      var morceau = '';
      for (var i = 0; i < mot.length; i += 1) {
        if (largeurTexte(morceau + mot.charAt(i), taille, gras) > largeurMax && morceau !== '') {
          lignes.push(morceau);
          morceau = '';
        }
        morceau += mot.charAt(i);
      }
      return morceau;
    }

    mots.forEach(function (mot) {
      var essai = courante === '' ? mot : courante + ' ' + mot;
      if (largeurTexte(essai, taille, gras) <= largeurMax) {
        courante = essai;
        return;
      }
      if (courante !== '') {
        lignes.push(courante);
        courante = '';
      }
      if (largeurTexte(mot, taille, gras) > largeurMax) courante = couperMot(mot);
      else courante = mot;
    });

    if (courante !== '') lignes.push(courante);
    return lignes;
  }

  // --- Ecriture des primitives -------------------------------------------------

  /** Echappe une chaine deja encodee en WinAnsi pour un litteral PDF « (…) ». */
  function litteral(octets) {
    return '(' + octets.replace(/[\\()]/g, '\\$&').replace(/\r/g, '') + ')';
  }

  /** Arrondit a deux decimales et rend une ecriture sans exposant ni virgule. */
  function nb(valeur) {
    var arrondi = Math.round((Number(valeur) || 0) * 100) / 100;
    return String(arrondi);
  }

  /** Une couleur, depuis « #c67139 » ou [r, g, b] entre 0 et 1. Rend [r, g, b]. */
  function couleur(valeur) {
    if (Array.isArray(valeur)) return [valeur[0] || 0, valeur[1] || 0, valeur[2] || 0];
    var hex = String(valeur || '#000000').replace('#', '');
    if (hex.length === 3) {
      hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
    }
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return [0, 0, 0];
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ];
  }

  // --- Le document -------------------------------------------------------------

  /**
   * Cree un document.
   *
   * **Les ordonnees sont comptees depuis le haut de la page**, comme a l'ecran, et
   * converties a l'ecriture. Le repere natif du PDF part du bas a gauche : une mise
   * en page qui descend de jour en jour se serait ecrite a l'envers, et chaque
   * ajout aurait demande de recalculer les hauteurs precedentes.
   */
  function creer(options) {
    var reglages = options || {};
    var largeur = Number(reglages.largeur) || LARGEUR_A4;
    var hauteur = Number(reglages.hauteur) || HAUTEUR_A4;

    var pages = []; // chaque page est la liste de ses instructions
    var courante = null;

    function page() {
      courante = [];
      pages.push(courante);
      return courante;
    }

    function ecrire(instruction) {
      if (courante === null) page();
      courante.push(instruction);
    }

    /** Ordonnee PDF (depuis le bas) pour une ordonnee de mise en page. */
    function y(depuisLeHaut) {
      return hauteur - (Number(depuisLeHaut) || 0);
    }

    /**
     * Une ligne de texte. `y` est la ligne de base, comptee depuis le haut.
     * `options.aligne` vaut 'gauche' (defaut), 'centre' ou 'droite'.
     */
    function texte(x, ordonnee, chaine, options) {
      var o = options || {};
      var taille = Number(o.taille) || 10;
      var gras = Boolean(o.gras);
      var italique = Boolean(o.italique);
      var octets = versWinAnsi(chaine);
      if (octets === '') return 0;

      var l = largeurTexte(chaine, taille, gras);
      var depart = x;
      if (o.aligne === 'centre') depart = x - l / 2;
      else if (o.aligne === 'droite') depart = x - l;

      var teinte = couleur(o.couleur || '#000000');
      var police = gras ? '/F2' : italique ? '/F3' : '/F1';

      ecrire(
        'BT ' +
          nb(teinte[0]) + ' ' + nb(teinte[1]) + ' ' + nb(teinte[2]) + ' rg ' +
          police + ' ' + nb(taille) + ' Tf ' +
          nb(depart) + ' ' + nb(y(ordonnee)) + ' Td ' +
          litteral(octets) + ' Tj ET'
      );
      return l;
    }

    /** Un trait droit. */
    function ligne(x1, y1, x2, y2, options) {
      var o = options || {};
      var teinte = couleur(o.couleur || '#000000');
      ecrire(
        nb(teinte[0]) + ' ' + nb(teinte[1]) + ' ' + nb(teinte[2]) + ' RG ' +
          nb(Number(o.epaisseur) || 0.5) + ' w ' +
          nb(x1) + ' ' + nb(y(y1)) + ' m ' + nb(x2) + ' ' + nb(y(y2)) + ' l S'
      );
    }

    /**
     * Un rectangle, plein et/ou borde, aux coins eventuellement arrondis.
     * `ordonnee` est le bord haut. Le rayon est ramene a la moitie du plus petit
     * cote : au-dela, les arcs se croiseraient et le trace se replierait sur lui-meme.
     */
    function rectangle(x, ordonnee, l, h, options) {
      var o = options || {};
      var teinteFond = o.fond ? couleur(o.fond) : null;
      var teinteBord = o.contour ? couleur(o.contour) : null;
      if (!teinteFond && !teinteBord) return;

      var rayon = Math.max(0, Math.min(Number(o.rayon) || 0, Math.min(l, h) / 2));
      var bas = y(ordonnee + h);
      var haut = y(ordonnee);
      var droite = x + l;
      var trace;

      if (rayon === 0) {
        trace = nb(x) + ' ' + nb(bas) + ' ' + nb(l) + ' ' + nb(h) + ' re';
      } else {
        // 0,5523 est le facteur qui approche un quart de cercle par une courbe de
        // Bezier cubique ; l'ecart maximal avec le cercle est d'environ 0,02 %.
        var k = rayon * 0.5523;
        trace =
          nb(x + rayon) + ' ' + nb(bas) + ' m ' +
          nb(droite - rayon) + ' ' + nb(bas) + ' l ' +
          nb(droite - rayon + k) + ' ' + nb(bas) + ' ' + nb(droite) + ' ' + nb(bas + rayon - k) + ' ' + nb(droite) + ' ' + nb(bas + rayon) + ' c ' +
          nb(droite) + ' ' + nb(haut - rayon) + ' l ' +
          nb(droite) + ' ' + nb(haut - rayon + k) + ' ' + nb(droite - rayon + k) + ' ' + nb(haut) + ' ' + nb(droite - rayon) + ' ' + nb(haut) + ' c ' +
          nb(x + rayon) + ' ' + nb(haut) + ' l ' +
          nb(x + rayon - k) + ' ' + nb(haut) + ' ' + nb(x) + ' ' + nb(haut - rayon + k) + ' ' + nb(x) + ' ' + nb(haut - rayon) + ' c ' +
          nb(x) + ' ' + nb(bas + rayon) + ' l ' +
          nb(x) + ' ' + nb(bas + rayon - k) + ' ' + nb(x + rayon - k) + ' ' + nb(bas) + ' ' + nb(x + rayon) + ' ' + nb(bas) + ' c';
      }

      var couleurs = '';
      if (teinteFond) {
        couleurs += nb(teinteFond[0]) + ' ' + nb(teinteFond[1]) + ' ' + nb(teinteFond[2]) + ' rg ';
      }
      if (teinteBord) {
        couleurs +=
          nb(teinteBord[0]) + ' ' + nb(teinteBord[1]) + ' ' + nb(teinteBord[2]) + ' RG ' +
          nb(Number(o.epaisseur) || 0.5) + ' w ';
      }
      var operateur = teinteFond && teinteBord ? 'B' : teinteFond ? 'f' : 'S';
      ecrire(couleurs + trace + ' ' + operateur);
    }

    // --- Assemblage du fichier -------------------------------------------------

    /**
     * Assemble le fichier et rend ses octets.
     *
     * La table xref porte l'offset de chaque objet en octets depuis le debut du
     * fichier : les morceaux sont donc accumules dans l'ordre, chaque caractere
     * valant un octet, et les positions relevees au passage.
     */
    function octets() {
      if (pages.length === 0) page();

      var objets = [];

      function ajouterObjet(contenu) {
        objets.push(contenu);
        return objets.length; // numero de l'objet
      }

      // Objets fixes : catalogue, arbre des pages, trois polices, informations.
      var numCatalogue = ajouterObjet(null); // rempli plus bas, il cite l'arbre
      var numPages = ajouterObjet(null);
      var numF1 = ajouterObjet(
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
      );
      var numF2 = ajouterObjet(
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
      );
      var numF3 = ajouterObjet(
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>'
      );

      var ressources =
        '<< /Font << /F1 ' + numF1 + ' 0 R /F2 ' + numF2 + ' 0 R /F3 ' + numF3 + ' 0 R >> >>';

      var numerosPages = [];
      pages.forEach(function (instructions) {
        var flux = instructions.join('\n');
        var numFlux = ajouterObjet(
          '<< /Length ' + flux.length + ' >>\nstream\n' + flux + '\nendstream'
        );
        var numPage = ajouterObjet(
          '<< /Type /Page /Parent ' + numPages + ' 0 R ' +
            '/MediaBox [0 0 ' + nb(largeur) + ' ' + nb(hauteur) + '] ' +
            '/Resources ' + ressources + ' ' +
            '/Contents ' + numFlux + ' 0 R >>'
        );
        numerosPages.push(numPage);
      });

      objets[numPages - 1] =
        '<< /Type /Pages /Count ' + numerosPages.length + ' /Kids [' +
        numerosPages
          .map(function (n) {
            return n + ' 0 R';
          })
          .join(' ') +
        '] >>';
      objets[numCatalogue - 1] = '<< /Type /Catalog /Pages ' + numPages + ' 0 R >>';

      var infos = ['/Producer ' + litteral(versWinAnsi('Miam miam !'))];
      if (reglages.titre) infos.push('/Title ' + litteral(versWinAnsi(reglages.titre)));
      if (reglages.horodatage) infos.push('/CreationDate ' + litteral(versWinAnsi(reglages.horodatage)));
      var numInfos = ajouterObjet('<< ' + infos.join(' ') + ' >>');

      // L'en-tete porte un commentaire d'octets hauts : c'est ainsi qu'un outil de
      // transfert reconnait un fichier binaire et cesse de convertir les fins de ligne.
      var fichier = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
      var offsets = [];

      objets.forEach(function (contenu, index) {
        offsets.push(fichier.length);
        fichier += index + 1 + ' 0 obj\n' + contenu + '\nendobj\n';
      });

      var departXref = fichier.length;
      fichier += 'xref\n0 ' + (objets.length + 1) + '\n';
      fichier += '0000000000 65535 f \n';
      offsets.forEach(function (offset) {
        var dix = String(offset);
        while (dix.length < 10) dix = '0' + dix;
        fichier += dix + ' 00000 n \n';
      });
      fichier +=
        'trailer\n<< /Size ' + (objets.length + 1) + ' /Root ' + numCatalogue + ' 0 R /Info ' +
        numInfos + ' 0 R >>\nstartxref\n' + departXref + '\n%%EOF\n';

      var tableau = new Uint8Array(fichier.length);
      for (var i = 0; i < fichier.length; i += 1) tableau[i] = fichier.charCodeAt(i) & 0xff;
      return tableau;
    }

    return {
      largeur: largeur,
      hauteur: hauteur,
      page: page,
      texte: texte,
      ligne: ligne,
      rectangle: rectangle,
      largeurTexte: largeurTexte,
      couper: couper,
      nbPages: function () {
        return pages.length;
      },
      octets: octets,
    };
  }

  /** Horodatage au format PDF : « D:20260810143000Z ». */
  function horodatage(date) {
    var d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
    function deux(n) {
      return n < 10 ? '0' + n : String(n);
    }
    return (
      'D:' + d.getUTCFullYear() + deux(d.getUTCMonth() + 1) + deux(d.getUTCDate()) +
      deux(d.getUTCHours()) + deux(d.getUTCMinutes()) + deux(d.getUTCSeconds()) + 'Z'
    );
  }

  var api = {
    LARGEUR_A4: LARGEUR_A4,
    HAUTEUR_A4: HAUTEUR_A4,
    versWinAnsi: versWinAnsi,
    largeurTexte: largeurTexte,
    couper: couper,
    couleur: couleur,
    horodatage: horodatage,
    creer: creer,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.CarnetPdf = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
