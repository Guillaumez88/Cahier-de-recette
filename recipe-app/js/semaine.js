/* Calendrier du semainier : semaines, jours, creneaux de repas.

   Module purement calculatoire, sans acces reseau ni stockage : il ne fait que
   fabriquer des dates et des libelles. C'est ce qui le rend testable sous Node.

   Deux pieges de dates sont traites explicitement, car ils produisent des decalages
   d'un jour selon le fuseau et la saison :

   1. `toISOString()` convertit en UTC. A Paris en ete (UTC+2), un lundi a 23 h
      donne « dimanche » en UTC. Les cles de jour sont donc fabriquees a partir de
      getFullYear/getMonth/getDate, qui sont locaux.

   2. `new Date('2026-08-03')` est interprete comme minuit UTC. A l'ouest de
      Greenwich, getDate() rend alors le 2. Les cles sont donc relues en composant
      une date locale, fixee a midi : midi resiste aux changements d'heure, qui
      deplacent l'horloge d'une heure et feraient basculer minuit d'un jour.

   Expose window.CarnetSemaine dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  var JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

  var MOIS = [
    'janvier',
    'février',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'août',
    'septembre',
    'octobre',
    'novembre',
    'décembre',
  ];

  // Les trois creneaux d'une journee. `taille` gouverne la hauteur de la case a
  // l'ecran : le dejeuner et le diner sont les repas que l'on cuisine, le
  // petit-dejeuner est une ligne d'appoint.
  var MOMENTS = [
    { cle: 'petit-dejeuner', libelle: 'Petit-déjeuner', court: 'Matin', taille: 'courte' },
    { cle: 'dejeuner', libelle: 'Déjeuner', court: 'Midi', taille: 'haute' },
    { cle: 'diner', libelle: 'Dîner', court: 'Soir', taille: 'haute' },
  ];

  // Repas qui ne viennent pas du carnet. Le champ libre reste disponible : ces
  // valeurs ne sont que des raccourcis vers les cas les plus frequents.
  var REPAS_LIBRES = [
    { titre: 'Restaurant', icone: 'restaurant' },
    { titre: 'Pizzas', icone: 'pizza' },
    { titre: 'Japonais', icone: 'sushi' },
    { titre: 'Restes', icone: 'restes' },
    { titre: 'Chacun pour soi', icone: 'libre' },
  ];

  function deuxChiffres(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function estDate(valeur) {
    return valeur instanceof Date && !isNaN(valeur.getTime());
  }

  /** Cle d'un jour, au format YYYY-MM-DD, dans le fuseau local. */
  function cleJour(date) {
    return date.getFullYear() + '-' + deuxChiffres(date.getMonth() + 1) + '-' + deuxChiffres(date.getDate());
  }

  /** Relit une cle YYYY-MM-DD en date locale a midi. Rend null si la cle est invalide. */
  function depuisCle(cle) {
    var trouve = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(cle || ''));
    if (!trouve) return null;
    var annee = Number(trouve[1]);
    var mois = Number(trouve[2]);
    var jour = Number(trouve[3]);
    if (mois < 1 || mois > 12 || jour < 1 || jour > 31) return null;
    var date = new Date(annee, mois - 1, jour, 12, 0, 0, 0);
    // Rejette le 31 fevrier : Date corrigerait silencieusement en mars.
    if (date.getMonth() !== mois - 1 || date.getDate() !== jour) return null;
    return date;
  }

  function normaliser(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  }

  function ajouterJours(date, n) {
    var copie = normaliser(date);
    copie.setDate(copie.getDate() + n);
    return copie;
  }

  /**
   * Lundi de la semaine contenant `date`. La semaine va du lundi au dimanche :
   * getDay() rend 0 pour dimanche, il faut donc reculer de 6 jours ce jour-la et
   * non de 0 comme le ferait un calcul naif sur getDay().
   */
  function lundiDe(date) {
    var jour = normaliser(date);
    var recul = (jour.getDay() + 6) % 7;
    return ajouterJours(jour, -recul);
  }

  /** Cle d'un creneau : « 2026-08-03::dejeuner ». */
  function cleCreneau(jourCle, moment) {
    return String(jourCle) + '::' + String(moment);
  }

  function decouperCreneau(cle) {
    var morceaux = String(cle || '').split('::');
    if (morceaux.length !== 2) return null;
    if (!depuisCle(morceaux[0])) return null;
    return { jour: morceaux[0], moment: morceaux[1] };
  }

  function estMomentConnu(moment) {
    return MOMENTS.some(function (m) {
      return m.cle === moment;
    });
  }

  function libelleJour(date) {
    return JOURS[(date.getDay() + 6) % 7] + ' ' + date.getDate() + ' ' + MOIS[date.getMonth()];
  }

  /**
   * Libelle d'une semaine. Le mois n'est repete que s'il change en cours de
   * semaine : « du lundi 3 au dimanche 9 août », mais « du lundi 31 août au
   * dimanche 6 septembre ».
   */
  function libelleSemaine(lundi) {
    var dimanche = ajouterJours(lundi, 6);
    if (lundi.getMonth() === dimanche.getMonth()) {
      return 'du lundi ' + lundi.getDate() + ' au dimanche ' + dimanche.getDate() + ' ' + MOIS[dimanche.getMonth()];
    }
    return 'du ' + libelleJour(lundi) + ' au ' + libelleJour(dimanche);
  }

  /** Construit une semaine a partir de son lundi. `aujourdhui` sert au marquage. */
  function semaine(lundi, aujourdhui) {
    var debut = lundiDe(lundi);
    var cleAujourdhui = estDate(aujourdhui) ? cleJour(aujourdhui) : null;
    var jours = [];
    for (var i = 0; i < 7; i += 1) {
      var date = ajouterJours(debut, i);
      var cle = cleJour(date);
      jours.push({
        cle: cle,
        nom: JOURS[i],
        numero: date.getDate(),
        mois: MOIS[date.getMonth()],
        libelle: libelleJour(date),
        estAujourdhui: cle === cleAujourdhui,
        estPasse: cleAujourdhui !== null && cle < cleAujourdhui,
      });
    }
    return {
      cle: cleJour(debut),
      libelle: libelleSemaine(debut),
      jours: jours,
      contientAujourdhui: jours.some(function (j) {
        return j.estAujourdhui;
      }),
    };
  }

  /**
   * Les `nb` semaines a afficher, la premiere etant celle de `aujourdhui`.
   * Le semainier ne regarde jamais en arriere : une semaine passee ne sert ni aux
   * courses ni a la cuisine.
   */
  function semaines(aujourdhui, nb) {
    var reference = estDate(aujourdhui) ? aujourdhui : new Date();
    var premier = lundiDe(reference);
    var total = Math.max(1, Number(nb) || 1);
    var resultat = [];
    for (var i = 0; i < total; i += 1) {
      resultat.push(semaine(ajouterJours(premier, i * 7), reference));
    }
    return resultat;
  }

  /** Tous les creneaux d'une semaine, dans l'ordre d'affichage. */
  function creneauxDe(sem) {
    var liste = [];
    (sem.jours || []).forEach(function (jour) {
      MOMENTS.forEach(function (moment) {
        liste.push({ jour: jour, moment: moment, cle: cleCreneau(jour.cle, moment.cle) });
      });
    });
    return liste;
  }

  var api = {
    JOURS: JOURS,
    MOIS: MOIS,
    MOMENTS: MOMENTS,
    REPAS_LIBRES: REPAS_LIBRES,
    cleJour: cleJour,
    depuisCle: depuisCle,
    ajouterJours: ajouterJours,
    lundiDe: lundiDe,
    cleCreneau: cleCreneau,
    decouperCreneau: decouperCreneau,
    estMomentConnu: estMomentConnu,
    libelleJour: libelleJour,
    libelleSemaine: libelleSemaine,
    semaine: semaine,
    semaines: semaines,
    creneauxDe: creneauxDe,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.CarnetSemaine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
