/* Le menu de la semaine, en PDF imprimable.

   Une feuille A4 a coller sur le frigo : les sept jours, ce qui est prevu a chaque
   repas, et rien d'autre. Ce n'est pas une copie de l'ecran d'accueil, c'est ce qui
   reste du menu quand on n'a plus le telephone en main.

   ## Ce que la page montre, et ce qu'elle ne montre pas

   Un jour sans rien de prevu porte « à définir » et non un blanc : sur du papier, un
   blanc ne se distingue pas d'un oubli d'impression. Un creneau vide, lui, est
   simplement absent : afficher « Petit-déjeuner : rien » sept fois remplirait la
   feuille de vide.

   Aucune quantite, aucun ingredient, aucune duree : la feuille repond a « qu'est-ce
   qu'on mange ? », pas a « comment on le fait ». Les fiches sont dans le carnet.

   ## Mise en page

   Les hauteurs sont calculees avant d'ecrire (`plan()`), pour deux raisons. Le pied
   de page porte « page 1 sur 2 », qui suppose de connaitre le total avant de dessiner
   la premiere page. Et une semaine chargee (plusieurs plats par repas, des titres
   longs qui se coupent en trois lignes) depasse une feuille : la coupure tombe alors
   entre deux jours, jamais au milieu d'un.

   Les couleurs sont celles de l'interface, reprises a la main depuis les variables de
   css/style.css : un PDF ne lit pas une feuille de style. Elles y sont nommees
   --organic-fond, --neutre-*, --terracotta et --sauge-700.

   Expose window.CarnetMenuPdf dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  var estNode = typeof module !== 'undefined' && module.exports;
  var Pdf = estNode ? require('./pdf.js') : global.CarnetPdf;
  var Sem = estNode ? require('./semaine.js') : global.CarnetSemaine;

  // Couleurs, reprises des variables de css/style.css.
  var ENCRE = '#201e1d'; // --organic-encre
  var DOUX = '#645c50'; // --neutre-700
  var FAIBLE = '#82796a'; // --neutre-600
  var BORDURE = '#dcd3c4'; // --neutre-300
  var CARTE = '#f5ead8'; // --organic-fond
  var CARTE_JOUR = '#ebddc5'; // --organic-creux
  var TERRACOTTA = '#c67139'; // --terracotta
  var OLIVE = '#56633f'; // --sauge-700

  // Une couleur par creneau, pour que l'oeil retrouve le diner sans lire l'etiquette.
  var COULEUR_MOMENT = {
    'petit-dejeuner': FAIBLE,
    dejeuner: TERRACOTTA,
    diner: OLIVE,
  };

  var MARGE = 42;
  var LARGEUR_UTILE = Pdf.LARGEUR_A4 - 2 * MARGE; // 511,28 pt
  var COLONNE_JOUR = 116; // le nom du jour, a gauche de la carte
  var COLONNE_MOMENT = 72; // « Petit-déjeuner », la plus large des trois etiquettes
  var PADDING = 13;

  var TAILLE_PLAT = 10.5;
  var HAUTEUR_LIGNE = 13;
  var ESPACE_MOMENT = 5;
  var ESPACE_CARTE = 9;
  var HAUT_CONTENU = 118; // sous le titre
  var BAS_CONTENU = Pdf.HAUTEUR_A4 - 54; // au-dessus du pied de page

  /** Largeur disponible pour le titre d'un plat, apres les deux colonnes. */
  var LARGEUR_PLAT = LARGEUR_UTILE - COLONNE_JOUR - COLONNE_MOMENT - 2 * PADDING;

  function majuscule(texte) {
    var chaine = String(texte || '');
    return chaine.charAt(0).toUpperCase() + chaine.slice(1);
  }

  /** « 10 août 2026 », pour le pied de page. */
  function dateLongue(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return '';
    return date.getDate() + ' ' + Sem.MOIS[date.getMonth()] + ' ' + date.getFullYear();
  }

  /**
   * Les creneaux garnis d'un jour, mis en lignes.
   *
   * Un creneau vide est absent : c'est ce qui distingue cette feuille de la grille de
   * l'ecran, ou les cases vides servent a poser un plat.
   */
  function momentsDuJour(jour, plats, moments) {
    var resultat = [];
    moments.forEach(function (moment) {
      var poses = plats[Sem.cleCreneau(jour.cle, moment.cle)] || [];
      if (poses.length === 0) return;
      var lignes = [];
      poses.forEach(function (plat) {
        Pdf.couper(plat.titre, LARGEUR_PLAT, TAILLE_PLAT, false).forEach(function (ligne) {
          lignes.push(ligne);
        });
      });
      if (lignes.length === 0) return;
      resultat.push({ cle: moment.cle, libelle: moment.libelle, lignes: lignes });
    });
    return resultat;
  }

  /**
   * Repartit les sept jours en pages, avec la hauteur de chaque carte.
   *
   * Rend { pages: [[carte, …]], nbPlats }. Une carte n'est jamais coupee entre deux
   * pages : un jour dont la moitie serait au verso ne se lirait pas.
   */
  function plan(reglages) {
    var sem = reglages.semaine;
    var plats = reglages.plats || {};
    var moments = reglages.moments || Sem.MOMENTS;

    var pages = [];
    var pageCourante = [];
    var y = HAUT_CONTENU;
    var nbPlats = 0;

    (sem.jours || []).forEach(function (jour) {
      var garnis = momentsDuJour(jour, plats, moments);
      garnis.forEach(function (m) {
        nbPlats += (plats[Sem.cleCreneau(jour.cle, m.cle)] || []).length;
      });

      var interieur = 0;
      if (garnis.length === 0) {
        interieur = HAUTEUR_LIGNE;
      } else {
        garnis.forEach(function (m, i) {
          interieur += m.lignes.length * HAUTEUR_LIGNE + (i > 0 ? ESPACE_MOMENT : 0);
        });
      }
      // Le plancher tient la colonne de gauche, qui porte jusqu'a trois lignes : le
      // nom du jour, sa date, et « aujourd’hui ». Une carte plus basse les laisserait
      // depasser sous le fond.
      var hauteur = Math.max(56, interieur + 2 * PADDING);

      if (y + hauteur > BAS_CONTENU && pageCourante.length > 0) {
        pages.push(pageCourante);
        pageCourante = [];
        y = HAUT_CONTENU;
      }

      pageCourante.push({ jour: jour, moments: garnis, haut: y, hauteur: hauteur, padding: PADDING });
      y += hauteur + ESPACE_CARTE;
    });

    if (pageCourante.length > 0) pages.push(pageCourante);
    if (pages.length === 1) etaler(pages[0]);
    return { pages: pages, nbPlats: nbPlats };
  }

  /**
   * Repartit l'espace laisse libre par une semaine qui tient sur une feuille.
   *
   * Une semaine legere, calee en haut, laissait le tiers bas de la page blanc : ce
   * n'est pas une page, c'est un brouillon. Le surplus va donc pour moitie dans la
   * hauteur des cartes (le contenu s'y centre, `padding` s'ouvrant d'autant) et pour
   * le reste dans les ecarts. Les deux sont plafonnes : au-dela, sept bandes hautes
   * et vides ressemblent a un formulaire, pas a un menu.
   */
  function etaler(cartes) {
    var derniere = cartes[cartes.length - 1];
    var libre = BAS_CONTENU - (derniere.haut + derniere.hauteur);
    if (libre <= 0) return;

    var bonusCarte = Math.min(16, libre / cartes.length);
    var reste = libre - bonusCarte * cartes.length;
    var bonusEcart = cartes.length > 1 ? Math.min(12, reste / (cartes.length - 1)) : 0;

    var y = HAUT_CONTENU;
    cartes.forEach(function (carte) {
      carte.hauteur += bonusCarte;
      carte.padding = PADDING + bonusCarte / 2;
      carte.haut = y;
      y += carte.hauteur + ESPACE_CARTE + bonusEcart;
    });
  }

  /** Le nom du fichier propose au telechargement, date par la semaine qu'il decrit. */
  function nomFichier(sem) {
    return 'menu-semaine-du-' + (sem && sem.cle ? sem.cle : 'semaine') + '.pdf';
  }

  /**
   * Fabrique le PDF. Rend un Uint8Array.
   *
   * `reglages` :
   *   semaine    la semaine, telle que semaine.js la construit
   *   plats      index { cleCreneau: [plat, …] }, tel que semainier.parCreneau()
   *   genereLe   date d'impression, pour le pied de page
   *   moments    facultatif, par defaut les trois creneaux de semaine.js
   */
  function construire(reglages) {
    var sem = reglages.semaine;
    var genereLe = reglages.genereLe instanceof Date ? reglages.genereLe : new Date();
    var repartition = plan(reglages);
    var nbPages = repartition.pages.length;

    var doc = Pdf.creer({
      titre: 'Menu ' + (sem.libelle || ''),
      horodatage: Pdf.horodatage(genereLe),
    });

    repartition.pages.forEach(function (cartes, indexPage) {
      doc.page();
      entete(doc, sem, repartition.nbPlats, indexPage);
      cartes.forEach(function (carte) {
        dessinerJour(doc, carte);
      });
      pied(doc, sem, genereLe, indexPage, nbPages);
    });

    return doc.octets();
  }

  /** Le titre de la page. La suite d'une semaine chargee le dit, sans le repeter en gros. */
  function entete(doc, sem, nbPlats, indexPage) {
    if (indexPage === 0) {
      doc.texte(MARGE, 66, 'Le menu de la semaine', { taille: 21, gras: true, couleur: ENCRE });
      doc.texte(MARGE, 86, majuscule(sem.libelle || ''), { taille: 11, couleur: DOUX });
      if (nbPlats > 0) {
        doc.texte(MARGE + LARGEUR_UTILE, 66, nbPlats + (nbPlats > 1 ? ' plats prévus' : ' plat prévu'), {
          taille: 10,
          couleur: TERRACOTTA,
          aligne: 'droite',
        });
      }
    } else {
      doc.texte(MARGE, 66, 'Le menu de la semaine (suite)', { taille: 15, gras: true, couleur: ENCRE });
      doc.texte(MARGE, 86, majuscule(sem.libelle || ''), { taille: 11, couleur: DOUX });
    }
    doc.ligne(MARGE, 98, MARGE + LARGEUR_UTILE, 98, { epaisseur: 0.8, couleur: TERRACOTTA });
  }

  /** Une carte de journee : le nom du jour a gauche, les repas a droite. */
  function dessinerJour(doc, carte) {
    var jour = carte.jour;

    doc.rectangle(MARGE, carte.haut, LARGEUR_UTILE, carte.hauteur, {
      fond: jour.estAujourdhui ? CARTE_JOUR : CARTE,
      contour: jour.estAujourdhui ? TERRACOTTA : BORDURE,
      epaisseur: jour.estAujourdhui ? 1 : 0.6,
      rayon: 10,
    });

    var padding = carte.padding || PADDING;
    var xJour = MARGE + PADDING;
    doc.texte(xJour, carte.haut + padding + 10, majuscule(jour.nom), {
      taille: 12.5,
      gras: true,
      couleur: ENCRE,
    });
    doc.texte(xJour, carte.haut + padding + 25, jour.numero + ' ' + jour.mois, {
      taille: 9.5,
      couleur: DOUX,
    });
    if (jour.estAujourdhui) {
      doc.texte(xJour, carte.haut + padding + 39, 'aujourd’hui', {
        taille: 8,
        italique: true,
        couleur: TERRACOTTA,
      });
    }

    var xMoment = MARGE + PADDING + COLONNE_JOUR;
    var xPlat = xMoment + COLONNE_MOMENT;
    var y = carte.haut + padding + 10;

    if (carte.moments.length === 0) {
      doc.texte(xMoment, y, 'à définir', { taille: TAILLE_PLAT, italique: true, couleur: FAIBLE });
      return;
    }

    carte.moments.forEach(function (moment, i) {
      if (i > 0) y += ESPACE_MOMENT;
      doc.texte(xMoment, y, moment.libelle, {
        taille: 8.5,
        gras: true,
        couleur: COULEUR_MOMENT[moment.cle] || DOUX,
      });
      moment.lignes.forEach(function (ligne, j) {
        doc.texte(xPlat, y + j * HAUTEUR_LIGNE, ligne, { taille: TAILLE_PLAT, couleur: ENCRE });
      });
      y += moment.lignes.length * HAUTEUR_LIGNE;
    });
  }

  /** Le pied de page : d'ou vient la feuille, et de quand elle date. */
  function pied(doc, sem, genereLe, indexPage, nbPages) {
    var y = Pdf.HAUTEUR_A4 - 38;
    doc.ligne(MARGE, y - 12, MARGE + LARGEUR_UTILE, y - 12, { epaisseur: 0.5, couleur: BORDURE });
    doc.texte(MARGE, y, 'Miam miam ! · imprimé le ' + dateLongue(genereLe), {
      taille: 8,
      couleur: FAIBLE,
    });
    if (nbPages > 1) {
      doc.texte(MARGE + LARGEUR_UTILE, y, 'page ' + (indexPage + 1) + ' sur ' + nbPages, {
        taille: 8,
        couleur: FAIBLE,
        aligne: 'droite',
      });
    }
  }

  var api = {
    MARGE: MARGE,
    plan: plan,
    nomFichier: nomFichier,
    construire: construire,
  };

  if (estNode) module.exports = api;
  else global.CarnetMenuPdf = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
