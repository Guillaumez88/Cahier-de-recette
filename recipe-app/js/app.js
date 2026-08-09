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
  var Sem = window.CarnetSemaine;
  var Sm = window.CarnetSemainier;
  var Ph = window.CarnetPhotos;
  var Ic = window.CarnetIcones;
  var Cu = window.CarnetCuisson;
  var Mg = window.CarnetVueMagasin;
  var Pl = window.CarnetPlacard;

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

  // `semainesDepliees` : les semaines vides sont repliees, sauf celles qu'on a
  // explicitement demande a voir.
  var etat = {
    recettes: [],
    criteres: criteresVides(),
    semainesDepliees: {},
    rechercheReserve: '',
    // Famille affichee dans la reserve de plats. « Plat » par defaut : c'est ce qu'on
    // pose le plus souvent dans un semainier.
    familleReserve: 'Plat',
    // L'accueil s'ouvre en lecture : la grille montre le menu, sans « + » ni reserve.
    // Le bouton « Modifier » de l'entete de semaine bascule les deux modes. L'etat
    // n'est pas persiste : on ne revient pas sur un accueil en chantier.
    modeEdition: false,
    // Mode « En magasin » : les lignes deja prises sont repliees par defaut.
    magasin: { voirCoches: false },
    // Section ouverte dans l'editeur en accordeon.
    sectionEditeur: 'parts',
  };

  /** Route affichee, sans le dièse. Utilisee pour ne re-rendre que l'ecran courant. */
  function routeCourante() {
    var ancre = window.location.hash.replace(/^#/, '');
    return ancre === '' ? '/' : ancre;
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

  /** Pictogramme. Rend un fragment vide si le nom est inconnu, jamais une erreur. */
  function icone(nom, options) {
    var noeud = Ic.dessiner(document, nom, options);
    return noeud || document.createDocumentFragment();
  }

  /** Vignette photo d'une recette, ou null si elle n'en a pas. */
  function vignetteRecette(recette, classe) {
    var image = Ph.vignette(recette.id);
    if (!image) return null;
    return el('span', { class: 'vignette ' + classe }, [
      el('img', {
        class: 'vignette__image',
        src: image,
        alt: 'Photo de ' + recette.titre,
        loading: 'lazy',
      }),
    ]);
  }

  /**
   * Photo de la recette si elle en a une, sinon un petit pictogramme de categorie.
   *
   * Volontairement discret en l'absence de photo : un aplat de couleur a la taille
   * d'une photo, repete vingt fois, sature l'ecran et vole la place du titre, qui est
   * la seule information dont on a besoin pour reconnaitre un plat.
   */
  function vignetteOuMarque(recette, classeVignette, taille) {
    var image = vignetteRecette(recette, classeVignette);
    if (image) return image;
    return el('span', { class: classeCategorie('marque-plat', recette.categorie) }, [
      icone(Ic.pourCategorie(recette.categorie), { taille: taille || 16 }),
    ]);
  }

  /**
   * Ce que dit le compteur de realisations pour une recette.
   * Rend null quand le semainier n'a encore rien a dire, plutot que « 0 fois » :
   * un carnet qui vient d'etre installe n'a pas d'historique, et afficher zero
   * partout ferait passer une absence de donnee pour une information.
   */
  function libelleRealisations(recetteId) {
    if (Sm.tous().length === 0) return null;
    var nb = Sm.nbFois(recetteId);
    if (nb === 0) return { texte: 'Jamais fait', jamais: true };

    var dernier = Sm.derniereFois(recetteId);
    var date = dernier ? Sem.depuisCle(dernier) : null;
    // « fois » est invariable, mais pas le premier jour du mois : « le 1er juin ».
    var jour = date ? (date.getDate() === 1 ? '1er' : String(date.getDate())) : null;
    return {
      texte:
        'Fait ' + nb + ' fois' + (date ? ', la dernière le ' + jour + ' ' + Sem.MOIS[date.getMonth()] : ''),
      jamais: false,
    };
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

  function nbArticlesRestants() {
    return getShoppingList().filter(function (a) {
      return !a.coche;
    }).length;
  }

  // Les trois destinations de l'application. Servent a la fois a l'en-tete, sur
  // grand ecran, et a la barre d'onglets, sur mobile.
  var DESTINATIONS = [
    { href: '#/', route: '/', icone: 'calendrier', libelle: 'Semaine' },
    { href: '#/livre', route: '/livre', icone: 'livre', libelle: 'Le livre' },
    { href: '#/liste-de-courses', route: '/liste-de-courses', icone: 'panier', libelle: 'Courses' },
  ];

  /**
   * Bouton de rafraichissement de l'en-tete, discret et sans phrase d'explication.
   *
   * Il agit sur les deux jeux de donnees partagees a la fois, liste et menus : depuis
   * la suppression du sondage, l'utilisateur ne devrait pas avoir a se demander
   * lequel des deux il rafraichit.
   */
  function boutonRafraichir() {
    var e = S.etatSync();
    var age = S.ageDonnees();
    var vieux = age !== null && age > window.CarnetConfig.seuilDonneesAgees;

    var bouton = el('button', {
      type: 'button',
      class: 'bouton-rafraichir' + (vieux ? ' bouton-rafraichir--vieux' : ''),
      id: 'rafraichir',
      disabled: e.enCours ? true : null,
      title: age === null ? 'Rafraîchir' : 'À jour ' + depuisQuand(age),
      'aria-label': age === null ? 'Rafraîchir' : 'Rafraîchir, à jour ' + depuisQuand(age),
      onclick: function () {
        rafraichirTout();
      },
    }, [
      icone('rafraichir', { taille: 17 }),
      el('span', { class: 'bouton-rafraichir__age', texte: age === null ? '' : depuisQuandCourt(age) }),
    ]);

    return bouton;
  }

  /** Relit la liste et les menus, puis re-rend l'ecran courant. */
  function rafraichirTout() {
    var apres = function () {
      majChrome();
      var route = routeCourante();
      if (route === '/') monter(vueAccueil());
      else if (route === '/liste-de-courses') monter(vueListeDeCourses());
      else if (route === '/livre') monter(vueLivre());
    };
    return Promise.all([S.rafraichir(), Sm.rafraichir()]).then(apres, apres);
  }

  /**
   * Rafraichit le seul libelle d'age du bouton d'en-tete, sans reconstruire l'en-tete.
   *
   * Reconstruire suffirait, mais deplacerait le focus si l'utilisateur est en train de
   * naviguer au clavier dans l'en-tete. Aucune lecture reseau ici : le minuteur ne fait
   * que faire vieillir un texte deja affiche.
   */
  function majAgeEntete() {
    var bouton = document.getElementById('rafraichir');
    if (!bouton) return;
    var e = S.etatSync();
    var age = S.ageDonnees();
    if (e.enCours || age === null) return;
    // Le titre garde la forme longue : c'est ce qu'on lit quand on s'arrete sur le
    // bouton, et « 2j » seul y serait sec.
    bouton.querySelector('.bouton-rafraichir__age').textContent = depuisQuandCourt(age);
    bouton.title = 'À jour ' + depuisQuand(age);
    bouton.setAttribute('aria-label', 'Rafraîchir, à jour ' + depuisQuand(age));
    bouton.classList.toggle('bouton-rafraichir--vieux', age > window.CarnetConfig.seuilDonneesAgees);
  }

  /** Reconstruit l'en-tete et la barre d'onglets : badge, etat, destination active. */
  function majChrome() {
    var restants = nbArticlesRestants();
    var route = routeCourante();

    var nav = document.getElementById('nav-entete');
    if (nav) {
      nav.textContent = '';
      DESTINATIONS.filter(function (d) {
        // La semaine est atteignable par la marque, a gauche : pas besoin d'un
        // second lien vers elle sur grand ecran.
        return d.route !== '/';
      }).forEach(function (d) {
        nav.appendChild(
          el('a', {
            class: 'bouton-entete' + (route === d.route ? ' bouton-entete--actif' : ''),
            href: d.href,
          }, [
            icone(d.icone, { taille: 18 }),
            el('span', { texte: d.libelle === 'Courses' ? 'Liste de courses' : d.libelle }),
            d.route === '/liste-de-courses' && restants > 0
              ? el('span', { class: 'badge', id: 'badge-courses', texte: String(restants) })
              : null,
          ])
        );
      });
      nav.appendChild(boutonRafraichir());
    }

    var onglets = document.getElementById('onglets-mobile');
    if (onglets) {
      onglets.textContent = '';
      DESTINATIONS.forEach(function (d) {
        onglets.appendChild(
          el('a', {
            class: 'onglet' + (route === d.route ? ' onglet--actif' : ''),
            href: d.href,
            'aria-current': route === d.route ? 'page' : null,
          }, [
            icone(d.icone, { taille: 22 }),
            el('span', { class: 'onglet__libelle', texte: d.libelle }),
            d.route === '/liste-de-courses' && restants > 0
              ? el('span', { class: 'badge badge--onglet', texte: String(restants) })
              : null,
          ])
        );
      });
    }
  }

  /**
   * Annonce une phrase aux lecteurs d'ecran, sans rien changer a l'affichage.
   *
   * La zone d'annonce est videe avant d'etre reecrite : deux navigations vers le meme
   * ecran produisent le meme texte, et une zone `aria-live` dont le contenu ne change
   * pas n'est pas relue.
   */
  function annoncer(phrase) {
    var zone = document.getElementById('annonce');
    if (!zone) return;
    zone.textContent = '';
    // Le vidage et l'ecriture doivent tomber dans deux tours de boucle distincts,
    // sinon le navigateur ne voit qu'un seul changement.
    setTimeout(function () {
      zone.textContent = phrase;
    }, 60);
  }

  /* --- bandeau d'annulation ------------------------------------------------ */
  //
  // Retirer un plat se fait d'un seul appui, sans confirmation : demander « êtes-vous
  // sûr ? » a chaque geste est plus penible que le geste lui-meme. La contrepartie est
  // ce bandeau, qui laisse quelques secondes pour revenir en arriere.
  //
  // Il est pose dans le corps du document et non dans #vue : un re-rendu de la vue,
  // declenche par la synchronisation, le ferait disparaitre sous les doigts.

  var DUREE_ANNULATION = 7000;
  var bandeauAnnulation = null;
  var minuteurAnnulation = null;

  function fermerAnnulation() {
    if (minuteurAnnulation) clearTimeout(minuteurAnnulation);
    minuteurAnnulation = null;
    if (bandeauAnnulation && bandeauAnnulation.parentNode) {
      bandeauAnnulation.parentNode.removeChild(bandeauAnnulation);
    }
    bandeauAnnulation = null;
  }

  /**
   * Affiche « <message> — Annuler » pendant quelques secondes.
   * `action` est appelee si l'utilisateur annule.
   */
  function proposerAnnulation(message, action) {
    fermerAnnulation();

    bandeauAnnulation = el('div', { class: 'annulation', id: 'annulation', role: 'status' }, [
      el('span', { class: 'annulation__texte', texte: message }),
      el('button', {
        type: 'button',
        class: 'annulation__bouton',
        id: 'annuler-retrait',
        onclick: function () {
          fermerAnnulation();
          action();
        },
      }, [icone('fleche', { taille: 16 }), el('span', { texte: 'Annuler' })]),
    ]);

    document.body.appendChild(bandeauAnnulation);
    // La classe d'apparition est posee au tour suivant, sinon la transition CSS part
    // de l'etat final et ne se voit pas.
    setTimeout(function () {
      if (bandeauAnnulation) bandeauAnnulation.classList.add('annulation--visible');
    }, 20);
    minuteurAnnulation = setTimeout(fermerAnnulation, DUREE_ANNULATION);
  }

  /** Retire un plat du semainier, avec un bandeau pour revenir en arriere. */
  function retirerPlat(plat) {
    return Sm.retirer(plat.cle).then(function (retire) {
      rendreAccueil();
      if (!retire) return;
      annoncer(retire.titre + ' retiré');
      proposerAnnulation(retire.titre + ' retiré', function () {
        Sm.reposer(retire).then(function () {
          rendreAccueil();
          annoncer(retire.titre + ' remis');
        });
      });
    });
  }

  function monter(noeud) {
    var vue = document.getElementById('vue');
    vue.textContent = '';
    vue.appendChild(noeud);
    majChrome();
  }

  // Le badge et l'ecran de liste sont rafraichis par surChangementListe(),
  // abonne au demarrage (voir plus bas).

  /* --- boite de dialogue --------------------------------------------------- */
  //
  // Une seule boite a la fois, posee dans le corps du document et non dans #vue :
  // un re-rendu de la vue (declenche par le sondage de la liste commune) ne doit pas
  // faire disparaitre la boite ouverte sous les doigts de l'utilisateur.

  var voile = null;
  var focusAvantVoile = null;

  function fermerVoile() {
    if (!voile) return;
    if (voile.parentNode) voile.parentNode.removeChild(voile);
    voile = null;
    document.body.classList.remove('corps--voile');
    if (focusAvantVoile && focusAvantVoile.focus) {
      try {
        focusAvantVoile.focus();
      } catch (erreur) {
        /* l'element a disparu du document : sans effet */
      }
    }
    focusAvantVoile = null;
  }

  /**
   * Ouvre une boite modale. `construire(fermer)` rend le contenu ; la fonction
   * `fermer` est passee pour que le contenu puisse se refermer lui-meme.
   */
  function ouvrirVoile(titre, construire, options) {
    fermerVoile();
    var reglages = options || {};
    focusAvantVoile = document.activeElement;

    var boite = el('div', { class: 'boite' + (reglages.large ? ' boite--large' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': titre }, [
      el('div', { class: 'boite__entete' }, [
        el('h2', { class: 'boite__titre', texte: titre }),
        el('button', {
          type: 'button',
          class: 'boite__fermer',
          id: 'fermer-boite',
          'aria-label': 'Fermer',
          onclick: fermerVoile,
        }, [icone('croix', { taille: 20 })]),
      ]),
      el('div', { class: 'boite__corps', id: 'boite-corps' }, construire(fermerVoile)),
    ]);

    voile = el('div', {
      class: 'voile',
      id: 'voile',
      onclick: function (evenement) {
        // Clic sur le fond seulement : un clic dans la boite ne doit pas la fermer.
        if (evenement.target === voile) fermerVoile();
      },
    }, [boite]);

    voile.addEventListener('keydown', function (evenement) {
      if (evenement.key === 'Escape') {
        evenement.stopPropagation();
        fermerVoile();
        return;
      }
      if (evenement.key !== 'Tab') return;

      // Piege de focus. `aria-modal` dit aux technologies d'assistance d'ignorer le
      // reste de la page, mais aucun navigateur n'empeche la tabulation d'en sortir :
      // au clavier, on se retrouvait a parcourir un ecran masque par le voile, sans
      // rien voir bouger. La boite retient donc le focus tant qu'elle est ouverte.
      var atteignables = Array.prototype.filter.call(
        boite.querySelectorAll('a[href], button, input, select, textarea, [tabindex]'),
        function (n) {
          // Un element desactive ou replie ne prend pas le focus : l'inclure ferait
          // une etape morte dans le cycle.
          return !n.disabled && n.tabIndex !== -1 && n.offsetParent !== null;
        }
      );
      if (atteignables.length === 0) return;

      var premier = atteignables[0];
      var dernier = atteignables[atteignables.length - 1];
      var actif = document.activeElement;

      if (evenement.shiftKey && (actif === premier || !boite.contains(actif))) {
        evenement.preventDefault();
        dernier.focus();
      } else if (!evenement.shiftKey && (actif === dernier || !boite.contains(actif))) {
        evenement.preventDefault();
        premier.focus();
      }
    });

    document.body.appendChild(voile);
    document.body.classList.add('corps--voile');

    var premier = boite.querySelector('input, button:not(#fermer-boite), a[href]');
    if (premier) premier.focus();
    else boite.querySelector('#fermer-boite').focus();

    return voile;
  }

  /** Remplace le contenu de la boite ouverte, sans la refermer. */
  function rendreCorpsVoile(contenu) {
    if (!voile) return;
    var corps = voile.querySelector('#boite-corps');
    if (!corps) return;
    corps.textContent = '';
    (Array.isArray(contenu) ? contenu : [contenu]).forEach(function (noeud) {
      if (noeud) corps.appendChild(noeud);
    });
  }

  /* --- bandeau d'etat partage ---------------------------------------------- */
  //
  // Cadence de rafraichissement du seul libelle d'age, sans acces reseau.
  var INTERVALLE_AGE = window.CarnetConfig.intervalleAge || 15000;

  // Plus d'invite a rafraichir : l'action a sa place dans l'en-tete sur grand ecran,
  // et dans le geste de tirer la page sur mobile. Une phrase de plus a lire a chaque
  // affichage pour redire ce qu'un bouton visible dit deja serait du bruit.

  //
  // Un seul constructeur pour la liste de courses et pour le semainier : les deux
  // ont le meme contrat vis-a-vis de l'utilisateur, il n'y a pas de raison qu'ils
  // formulent differemment la meme situation.

  /**
   * Classe une erreur de synchronisation. Trois causes appellent trois actions
   * differentes, les confondre laisse l'utilisateur sans recours :
   *
   * - 429 « Quota exceeded » : le palier gratuit Firestore du jour est epuise. Rien
   *   a reparer, cela repart le lendemain. C'est ce qui est arrive en aout 2026.
   * - 403 PERMISSION_DENIED : les regles de securite publiees ne couvrent pas cette
   *   collection. Il faut republier firestore.rules.
   * - le reste, dont l'absence de reponse : pas de reseau.
   */
  function diagnostiquer(etatSync) {
    if (!etatSync.erreur) return null;

    if (etatSync.statut === 429 || /quota/i.test(etatSync.erreur)) {
      return {
        classe: 'sync--quota',
        titre: 'Service momentanément indisponible',
        explication:
          'Le quota gratuit de la base de données est épuisé pour aujourd’hui. Les modifications faites ici sont conservées et partiront dès que le service répondra à nouveau, au plus tard demain.',
      };
    }
    if (etatSync.statut === 403 || /permission|insufficient/i.test(etatSync.erreur)) {
      return {
        classe: 'sync--config',
        titre: 'Accès refusé par la base',
        explication:
          'Les règles de sécurité publiées ne couvrent pas cette collection : republier firestore.rules depuis le dépôt.',
      };
    }
    return {
      classe: 'sync--hors-ligne',
      titre: 'Hors ligne',
      explication: 'Les modifications faites ici sont conservées et partiront au retour de la connexion.',
    };
  }

  /** « il y a 3 minutes », en clair. */
  function depuisQuand(age) {
    var secondes = Math.round(age / 1000);
    if (secondes < 45) return 'à l’instant';
    var minutes = Math.round(secondes / 60);
    if (minutes < 60) return 'il y a ' + minutes + (minutes > 1 ? ' minutes' : ' minute');
    var heures = Math.round(minutes / 60);
    if (heures < 24) return 'il y a ' + heures + (heures > 1 ? ' heures' : ' heure');
    var jours = Math.round(heures / 24);
    return 'il y a ' + jours + (jours > 1 ? ' jours' : ' jour');
  }

  /**
   * Meme age, en trois caracteres : « 4min », « 3h », « 2j ».
   *
   * C'est la forme portee par le bouton de l'en-tete, a cote des liens. Elle doit
   * tenir sans pousser « Liste de courses » hors de la barre : la forme longue y
   * occupait la largeur d'un troisieme lien.
   */
  function depuisQuandCourt(age) {
    var secondes = Math.round(age / 1000);
    if (secondes < 45) return 'à jour';
    var minutes = Math.round(secondes / 60);
    if (minutes < 60) return minutes + 'min';
    var heures = Math.round(minutes / 60);
    if (heures < 24) return heures + 'h';
    return Math.round(heures / 24) + 'j';
  }

  /**
   * Bandeau d'etat. `sujet` est le module concerne (S ou Sm).
   *
   * **Rend null quand tout va bien.** L'age de la donnee est desormais porte par le
   * bouton de l'en-tete, sous sa forme courte (« 4min », « 2j »), visible depuis
   * n'importe quel ecran. Le bandeau ne repetait donc plus qu'une information deja
   * affichee, en occupant une ligne pleine.
   *
   * Il reste indispensable dans les autres cas : hors ligne, quota epuise, regles non
   * publiees, modifications en attente. Ces etats appellent chacun une action
   * differente, que ni un pictogramme ni un age ne peuvent porter. Voir
   * `diagnostiquer()`, qui distingue les trois causes d'echec.
   */
  function barreEtat(sujet, libelleOk, apresRafraichissement, identifiantBouton) {
    var e = sujet.etatSync();
    var probleme = diagnostiquer(e);

    // Nominal : en ligne, a jour, rien en attente. Le bouton de l'en-tete suffit.
    if (!e.enCours && !probleme && e.enLigne === true && e.enAttente === 0) return null;

    var libelle;
    var classe = 'sync';

    if (e.enCours) {
      libelle = 'Mise à jour…';
    } else if (probleme) {
      libelle = probleme.titre;
      if (e.enAttente > 0) {
        libelle += ', ' + e.enAttente + ' modification' + (e.enAttente > 1 ? 's' : '') + ' en attente';
      }
      classe += ' ' + probleme.classe;
    } else if (e.enLigne === true) {
      libelle =
        libelleOk + ', ' + e.enAttente + ' modification' + (e.enAttente > 1 ? 's' : '') + ' en cours d’envoi';
      classe += ' sync--ok';
    } else {
      libelle = 'Connexion…';
    }

    // Seules les erreurs gardent une explication : elles appellent une action
    // differente selon la cause, et la cause n'est pas devinable.
    return el('div', { class: classe, 'data-bandeau': identifiantBouton }, [
      el('span', { class: 'sync__etat', texte: libelle }),
      probleme ? el('p', { class: 'sync__erreur', texte: probleme.explication }) : null,
      probleme ? el('p', { class: 'url-source', texte: e.erreur }) : null,
    ]);
  }

  /* --- vue : accueil, le semainier ----------------------------------------- */

  // Plat en cours de glissement. Trois formes :
  //   { type: 'creneau', cle }                un plat deja pose, qu'on deplace
  //   { type: 'recette', recetteId, titre }   une recette venue de la reserve
  //   { type: 'libre', titre }                un repas hors carnet venu de la reserve
  var glisse = null;

  /**
   * Ce que l'accueil annonce en une phrase. Compte les repas prevus sur les semaines
   * affichees, pas sur tout le semainier : annoncer des repas invisibles a l'ecran
   * n'aiderait personne a savoir quoi faire.
   */
  function resumeAccueil(semainesAffichees) {
    var index = Sm.parCreneau();
    var prevus = 0;
    semainesAffichees.forEach(function (sem) {
      Sem.creneauxDe(sem).forEach(function (creneau) {
        // Un repas compte pour un, quel que soit le nombre de plats qu'il porte :
        // « 4 repas prevus » se lit, « 7 plats prevus » ne dit pas si on a de quoi
        // manger jeudi.
        if ((index[creneau.cle] || []).length > 0) prevus += 1;
      });
    });

    var restants = nbArticlesRestants();
    var morceaux = [];
    morceaux.push(prevus === 0 ? 'aucun repas encore prévu' : prevus + (prevus > 1 ? ' repas prévus' : ' repas prévu'));
    morceaux.push(
      restants === 0 ? 'liste de courses à jour' : restants + (restants > 1 ? ' articles à prendre' : ' article à prendre')
    );
    return morceaux.join(', ') + '.';
  }

  /** Depose le plat glisse `enCours` sur un repas. Rend une promesse. */
  function deposerSur(jourCle, momentCle, enCours) {
    if (enCours.type === 'creneau') return Sm.deplacer(enCours.cle, jourCle, momentCle);
    if (enCours.type === 'libre') return Sm.ajouter(jourCle, momentCle, { type: Sm.TYPE_LIBRE, titre: enCours.titre });
    return Sm.ajouter(jourCle, momentCle, {
      type: Sm.TYPE_RECETTE,
      recetteId: enCours.recetteId,
      titre: enCours.titre,
    });
  }

  /**
   * Un plat pose, tel qu'il apparait dans une case de la grille.
   *
   * En lecture, un plat du carnet est un lien vers sa fiche : c'est ce qu'on veut
   * depuis l'accueil, plutot qu'une boite de choix. En edition, il porte sa croix de
   * suppression et devient glissable.
   */
  function platDeCase(jour, moment, plat, editable) {
    var recette = plat.type === Sm.TYPE_RECETTE ? Rc.parId(plat.recetteId) : null;

    var marque = recette
      ? vignetteOuMarque(recette, 'vignette--creneau', 15)
      : el('span', { class: 'creneau__libre' }, [icone(iconeRepasLibre(plat.titre), { taille: 16 })]);

    var titre = recette
      ? el('span', { class: 'creneau__titre', texte: recette.titre })
      : el('span', { class: 'creneau__titre', texte: plat.titre });

    var enfants = [marque, titre];
    // Le plat designe une recette qui n'existe plus : le dire au lieu de laisser
    // croire que le repas a disparu tout seul.
    if (!recette && plat.type === Sm.TYPE_RECETTE) {
      enfants = [titre, el('span', { class: 'creneau__note', texte: 'fiche introuvable' })];
    }

    if (editable) {
      enfants.push(
        el('button', {
          type: 'button',
          class: 'creneau__retirer',
          'data-retirer': plat.cle,
          'aria-label': 'Retirer ' + plat.titre + ' du ' + moment.libelle + ' du ' + jour.libelle,
          onclick: function (evenement) {
            evenement.stopPropagation();
            retirerPlat(plat);
          },
        }, [icone('croix', { taille: 13 })])
      );
    }

    var noeud = el(
      editable || !recette ? 'span' : 'a',
      Object.assign(
        { class: 'creneau__plat', 'data-plat': plat.cle },
        editable || !recette ? {} : { href: '#/recette/' + recette.id }
      ),
      enfants
    );

    if (!editable) return noeud;

    // Glisser-deposer, sur ordinateur : le tactile passe par la boite de choix, que
    // l'appui ouvre de toute facon. L'API HTML5 de glissement n'existe pas sur
    // mobile, le plat doit donc rester deplacable sans elle.
    noeud.setAttribute('draggable', 'true');
    noeud.addEventListener('dragstart', function (evenement) {
      glisse = { type: 'creneau', cle: plat.cle };
      noeud.classList.add('creneau--enleve');
      if (evenement.dataTransfer) {
        evenement.dataTransfer.effectAllowed = 'move';
        // Certains navigateurs annulent le glissement sans donnee associee.
        evenement.dataTransfer.setData('text/plain', plat.titre);
      }
    });
    noeud.addEventListener('dragend', function () {
      glisse = null;
      noeud.classList.remove('creneau--enleve');
    });

    return noeud;
  }

  /**
   * Une case de repas : les plats poses, et en edition une invitation a en ajouter.
   *
   * En lecture, la case n'est pas un bouton et n'affiche pas de « + » : l'accueil est
   * la pour montrer le menu, pas pour le composer. C'est le bouton « Modifier » de
   * l'entete de semaine qui bascule les deux modes.
   */
  function celluleCreneau(jour, moment, plats, editable) {
    var contenu = plats.map(function (plat) {
      return platDeCase(jour, moment, plat, editable);
    });

    if (plats.length === 0) {
      contenu.push(
        editable
          ? el('span', { class: 'creneau__vide' }, [icone('plus', { taille: 16 })])
          : el('span', { class: 'creneau__rien', texte: '·', 'aria-hidden': 'true' })
      );
    } else if (editable) {
      contenu.push(el('span', { class: 'creneau__vide creneau__vide--ajout' }, [icone('plus', { taille: 14 })]));
    }

    var classes = ['creneau', 'creneau--' + moment.taille];
    if (plats.length > 0) classes.push('creneau--rempli');
    if (plats.length > 1) classes.push('creneau--multiple');
    if (jour.estPasse) classes.push('creneau--passe');
    if (editable) classes.push('creneau--editable');

    var resume = plats.length === 0 ? 'aucun plat prévu' : plats.map(function (p) {
      return p.titre;
    }).join(', ');

    var attributs = {
      class: classes.join(' '),
      'data-creneau': Sem.cleCreneau(jour.cle, moment.cle),
      'aria-label': moment.libelle + ' du ' + jour.libelle + ' : ' + resume,
    };

    var cellule;
    if (editable) {
      cellule = el(
        'button',
        Object.assign({ type: 'button' }, attributs, {
          'aria-label': attributs['aria-label'] + ', modifier',
          onclick: function () {
            ouvrirSelecteurCreneau(jour, moment);
          },
        }),
        [el('span', { class: 'creneau__moment', texte: moment.court })].concat(contenu)
      );
    } else {
      cellule = el('div', attributs, [el('span', { class: 'creneau__moment', texte: moment.court })].concat(contenu));
    }

    if (!editable) return cellule;

    cellule.addEventListener('dragover', function (evenement) {
      if (!glisse) return;
      evenement.preventDefault();
      cellule.classList.add('creneau--cible');
    });
    cellule.addEventListener('dragleave', function () {
      cellule.classList.remove('creneau--cible');
    });
    cellule.addEventListener('drop', function (evenement) {
      evenement.preventDefault();
      cellule.classList.remove('creneau--cible');
      if (!glisse) return;
      var enCours = glisse;
      glisse = null;
      deposerSur(jour.cle, moment.cle, enCours).then(rendreAccueil);
    });

    return cellule;
  }

  function iconeRepasLibre(titre) {
    var trouve = null;
    Sem.REPAS_LIBRES.forEach(function (repas) {
      if (repas.titre.toLowerCase() === String(titre).toLowerCase()) trouve = repas.icone;
    });
    return trouve || 'libre';
  }

  /**
   * Les creneaux a afficher pour une semaine.
   *
   * Le petit-dejeuner est masque tant qu'il ne porte rien : c'est le repas le moins
   * souvent prevu, et sept cases vides en haut de la grille repoussaient le dejeuner
   * et le diner, qui sont ce qu'on vient lire. Il reparait en mode Modifier, ou il
   * faut bien pouvoir en poser un.
   *
   * La decision se prend pour toute la semaine, pas jour par jour : sur la grille de
   * bureau, chaque jour est une colonne, et masquer la case du lundi seul decalerait
   * son dejeuner d'une ligne par rapport a celui du mardi.
   */
  function momentsDeLaSemaine(sem, index, editable) {
    return Sem.MOMENTS.filter(function (moment) {
      if (moment.cle !== 'petit-dejeuner' || editable) return true;
      return (sem.jours || []).some(function (jour) {
        return (index[Sem.cleCreneau(jour.cle, moment.cle)] || []).length > 0;
      });
    });
  }

  function blocSemaine(sem, estCourante) {
    var index = Sm.parCreneau();
    var editable = Boolean(etat.modeEdition);
    var moments = momentsDeLaSemaine(sem, index, editable);

    return el('section', { class: 'semaine' + (estCourante ? ' semaine--courante' : ''), 'data-semaine': sem.cle }, [
      el('header', { class: 'semaine__entete' }, [
        el('h3', { class: 'semaine__titre' }, [
          icone('calendrier', { taille: 18 }),
          el('span', { texte: estCourante ? 'Cette semaine' : 'Semaine suivante' }),
        ]),
        el('span', { class: 'semaine__dates', texte: sem.libelle }),
        el('button', {
          type: 'button',
          class: 'bouton bouton--sobre',
          'data-courses-semaine': sem.cle,
          onclick: function () {
            ouvrirCoursesSemaine(sem);
          },
        }, [icone('panier', { taille: 16 }), el('span', { texte: 'Ajouter aux courses' })]),
        // Un seul interrupteur pour tout l'accueil, pas un par semaine : les cases a
        // « + » et la reserve de plats apparaissent ou disparaissent ensemble.
        el('button', {
          type: 'button',
          class: 'bouton ' + (editable ? 'bouton--secondaire' : 'bouton--sobre'),
          // Un identifiant unique dans la page : il n'est porte que par la semaine
          // en cours, la suivante n'a que son attribut de donnee.
          id: estCourante ? 'modifier-semaine' : null,
          'data-modifier-semaine': sem.cle,
          'aria-pressed': editable ? 'true' : 'false',
          onclick: function () {
            etat.modeEdition = !etat.modeEdition;
            rendreAccueil();
          },
        }, [
          icone(editable ? 'coche' : 'crayon', { taille: 16 }),
          el('span', { texte: editable ? 'Terminer' : 'Modifier' }),
        ]),
      ]),
      el(
        'div',
        { class: 'grille-semaine' },
        sem.jours.map(function (jour) {
          return el(
            'div',
            { class: 'jour' + (jour.estAujourdhui ? ' jour--aujourdhui' : '') + (jour.estPasse ? ' jour--passe' : '') },
            [
              el('div', { class: 'jour__entete' }, [
                el('span', { class: 'jour__nom', texte: jour.nom }),
                el('span', { class: 'jour__numero', texte: String(jour.numero) }),
                jour.estAujourdhui ? el('span', { class: 'jour__marque', texte: 'aujourd’hui' }) : null,
              ]),
            ].concat(
              moments.map(function (moment) {
                return celluleCreneau(jour, moment, index[Sem.cleCreneau(jour.cle, moment.cle)] || [], editable);
              })
            )
          );
        })
      ),
    ]);
  }

  /** Bandeau d'etat du semainier. */
  function barreSyncSemainier() {
    return barreEtat(Sm, 'Menus partagés à la maison', rendreAccueil, 'etat-semainier');
  }

  /**
   * Reserve de plats glissables, sous le semainier.
   *
   * Sans elle, le glisser-deposer ne pourrait que deplacer un plat deja pose : les
   * recettes vivent sur un autre ecran. La reserve met le livre a portee de la
   * souris, avec sa propre recherche pour ne pas etaler vingt pastilles.
   *
   * Elle est masquee au tactile par la feuille de style : le glissement HTML5
   * n'existe pas sur mobile, et l'appui sur une case fait deja le travail.
   */
  // Les quatre onglets de la reserve. « Autres » ne vient pas du carnet : ce sont les
  // repas qu'on ne cuisine pas, et qui n'ont donc pas de fiche.
  var FAMILLES_RESERVE = [
    { cle: 'Entrée', libelle: 'Entrées' },
    { cle: 'Plat', libelle: 'Plats' },
    { cle: 'Dessert', libelle: 'Desserts' },
    { cle: 'Autres', libelle: 'Autres' },
  ];

  function reserveDePlats() {
    var famille = etat.familleReserve || 'Plat';
    var recherche = etat.rechercheReserve || '';
    var recettes =
      famille === 'Autres'
        ? []
        : filterRecipes(Rc.toutes(), Object.assign(criteresVides(), { recherche: recherche })).filter(function (r) {
            return r.categorie === famille;
          });

    var libres =
      famille !== 'Autres'
        ? []
        : Sem.REPAS_LIBRES.filter(function (repas) {
            return recherche === '' || repas.titre.toLowerCase().indexOf(recherche.toLowerCase()) !== -1;
          });

    // `cible` designe ce qui doit reprendre le focus apres le re-rendu : la reserve
    // se remplace en entier, et sans cela la frappe dans le champ de recherche serait
    // interrompue a chaque lettre.
    function rendre(cible) {
      var noeud = document.getElementById('reserve');
      if (!noeud || !noeud.parentNode) return;
      noeud.parentNode.replaceChild(reserveDePlats(), noeud);

      var champ = document.getElementById('recherche-reserve');
      if (cible === 'recherche' && champ) {
        champ.focus();
        try {
          champ.setSelectionRange(champ.value.length, champ.value.length);
        } catch (erreur) {
          /* sans effet */
        }
        return;
      }
      if (cible === 'segment') {
        var segment = document.querySelector('.segment--actif[data-famille]');
        if (segment) segment.focus();
      }
    }

    /** Une pastille glissable. `charge` decrit ce que le glissement transporte. */
    function pastilleGlissable(cle, marque, titre, charge) {
      var pastille = el('span', {
        class: 'pastille pastille--glissable',
        draggable: 'true',
        'data-reserve': cle,
        title: titre,
      }, [marque, el('span', { texte: titre })]);

      pastille.addEventListener('dragstart', function (evenement) {
        glisse = charge;
        pastille.classList.add('pastille--enlevee');
        if (evenement.dataTransfer) {
          evenement.dataTransfer.effectAllowed = 'copy';
          evenement.dataTransfer.setData('text/plain', titre);
        }
      });
      pastille.addEventListener('dragend', function () {
        glisse = null;
        pastille.classList.remove('pastille--enlevee');
      });
      return pastille;
    }

    var pastilles = recettes
      .slice(0, 40)
      .map(function (recette) {
        return pastilleGlissable(
          recette.id,
          el('span', { class: classeCategorie('marque-plat', recette.categorie) }, [
            icone(Ic.pourCategorie(recette.categorie), { taille: 14 }),
          ]),
          recette.titre,
          { type: 'recette', recetteId: recette.id, titre: recette.titre }
        );
      })
      .concat(
        libres.map(function (repas) {
          return pastilleGlissable(
            repas.titre,
            el('span', { class: 'creneau__libre' }, [icone(repas.icone, { taille: 14 })]),
            repas.titre,
            { type: 'libre', titre: repas.titre }
          );
        })
      );

    return el('section', { class: 'reserve', id: 'reserve' }, [
      el('h3', { class: 'reserve__titre' }, [
        icone('poignee', { taille: 16 }),
        el('span', { texte: 'Glisser un plat dans une case' }),
      ]),
      el(
        'div',
        { class: 'segments', role: 'tablist', 'aria-label': 'Famille de plats' },
        FAMILLES_RESERVE.map(function (f) {
          return el('button', {
            type: 'button',
            role: 'tab',
            class: 'segment' + (f.cle === famille ? ' segment--actif' : ''),
            'data-famille': f.cle,
            'aria-selected': f.cle === famille ? 'true' : 'false',
            onclick: function () {
              etat.familleReserve = f.cle;
              rendre('segment');
            },
          }, [el('span', { texte: f.libelle })]);
        })
      ),
      el('input', {
        type: 'search',
        class: 'champ-recherche champ-recherche--fin',
        id: 'recherche-reserve',
        placeholder: 'Filtrer les plats…',
        'aria-label': 'Filtrer les plats de la réserve',
        value: recherche,
        oninput: function (evenement) {
          etat.rechercheReserve = evenement.target.value;
          rendre('recherche');
        },
      }),
      pastilles.length === 0
        ? el('p', { class: 'reserve__vide', texte: 'Aucun plat ne correspond.' })
        : el('div', { class: 'reserve__plats' }, pastilles),
    ]);
  }

  function carteAcces(href, nomIcone, titre, detail) {
    return el('a', { class: 'acces', href: href }, [
      el('span', { class: 'acces__icone' }, [icone(nomIcone, { taille: 26 })]),
      el('span', { class: 'acces__texte' }, [
        el('span', { class: 'acces__titre', texte: titre }),
        el('span', { class: 'acces__detail', texte: detail }),
      ]),
      el('span', { class: 'acces__fleche' }, [icone('fleche', { taille: 20 })]),
    ]);
  }

  /**
   * Bloc « Aujourd'hui », les trois repas du jour.
   *
   * Premiere chose de la page, avant tout le reste : c'est l'information la plus
   * demandee, et sur telephone elle etait auparavant sous un titre, un resume, deux
   * cartes d'acces, trois onglets, une phrase d'aide et un bandeau d'etat.
   */
  function blocAujourdhui(sem) {
    var jour = null;
    (sem.jours || []).forEach(function (j) {
      if (j.estAujourdhui) jour = j;
    });
    if (!jour) return null;

    var index = Sm.parCreneau();

    return el('section', { class: 'aujourdhui', id: 'aujourdhui' }, [
      el('header', { class: 'aujourdhui__entete' }, [
        el('h2', { class: 'aujourdhui__titre', texte: 'Aujourd’hui' }),
        el('span', { class: 'aujourdhui__date', texte: jour.libelle }),
      ]),
      el(
        'div',
        { class: 'aujourdhui__repas' },
        // Meme regle que la grille, mais decidee pour le seul jour affiche : ces trois
        // lignes s'empilent, en masquer une ne decale rien.
        Sem.MOMENTS.filter(function (moment) {
          if (moment.cle !== 'petit-dejeuner' || etat.modeEdition) return true;
          return (index[Sem.cleCreneau(jour.cle, moment.cle)] || []).length > 0;
        }).map(function (moment) {
          var plats = index[Sem.cleCreneau(jour.cle, moment.cle)] || [];

          // Un repas peut porter un plat et un dessert : chaque plat a sa ligne et
          // sa croix, le « + » du repas reste a droite pour en ajouter un autre.
          var contenu =
            plats.length === 0
              ? [el('span', { class: 'repas-jour__vide', texte: 'Rien de prévu' })]
              : plats.map(function (plat) {
                  var recette = plat.type === Sm.TYPE_RECETTE ? Rc.parId(plat.recetteId) : null;
                  return el('span', { class: 'repas-jour__titre', 'data-plat-jour': plat.cle }, [
                    el('span', { class: classeCategorie('marque-plat', recette ? recette.categorie : 'Plat') }, [
                      icone(recette ? Ic.pourCategorie(recette.categorie) : iconeRepasLibre(plat.titre), {
                        taille: 15,
                      }),
                    ]),
                    recette
                      ? el('a', { class: 'repas-jour__lien', href: '#/recette/' + recette.id, texte: recette.titre })
                      : el('span', { texte: plat.titre }),
                    el('button', {
                      type: 'button',
                      class: 'bouton-icone bouton-icone--discret',
                      'data-retirer-jour': plat.cle,
                      'aria-label': 'Retirer ' + plat.titre + ' du ' + moment.libelle,
                      onclick: function () {
                        retirerPlat(plat);
                      },
                    }, [icone('croix', { taille: 15 })]),
                  ]);
                });

          return el('div', { class: 'repas-jour', 'data-repas-jour': moment.cle }, [
            el('span', { class: 'repas-jour__moment', texte: moment.libelle }),
            el('span', { class: 'repas-jour__plats' }, contenu),
            el('button', {
              type: 'button',
              class: 'bouton-icone',
              'data-modifier-jour': moment.cle,
              'aria-label': 'Ajouter un plat au ' + moment.libelle + ' du ' + jour.libelle,
              onclick: function () {
                ouvrirSelecteurCreneau(jour, moment);
              },
            }, [icone('plus', { taille: 18 })]),
          ]);
        })
      ),
    ]);
  }

  /**
   * Bandeau d'une semaine vide, replie.
   *
   * La semaine suivante est presque toujours entierement vide et occupait la moitie
   * de la hauteur de page pour vingt-et-une cases a remplir. Elle se deplie d'un clic.
   */
  function bandeauSemaineRepliee(sem) {
    return el('div', { class: 'semaine-repliee', 'data-semaine-repliee': sem.cle }, [
      el('span', { class: 'semaine-repliee__titre' }, [
        icone('calendrier', { taille: 16 }),
        el('span', { texte: 'Semaine suivante' }),
      ]),
      el('span', { class: 'semaine-repliee__dates', texte: sem.libelle + ' · rien de prévu pour l’instant' }),
      el('button', {
        type: 'button',
        class: 'bouton bouton--sobre',
        id: 'deplier-semaine',
        texte: 'Déplier',
        onclick: function () {
          etat.semainesDepliees[sem.cle] = true;
          rendreAccueil();
        },
      }),
    ]);
  }

  function vueAccueil() {
    document.title = 'Miam miam !';

    var aujourdhui = new Date();
    var toutes = Sem.semaines(aujourdhui, Math.max(1, window.CarnetConfig.nbSemaines || 2));
    var recettes = Rc.toutes();
    var restants = nbArticlesRestants();
    var index = Sm.parCreneau();

    /** Une semaine est vide si aucun de ses vingt-et-un creneaux ne porte de plat. */
    function estVide(sem) {
      return !Sem.creneauxDe(sem).some(function (creneau) {
        return (index[creneau.cle] || []).length > 0;
      });
    }

    var fragment = document.createDocumentFragment();

    // La question, puis tout de suite la reponse : les repas du jour. L'etat de
    // partage se tient a droite du titre, ou il est visible sans occuper une ligne.
    // Le bandeau d'etat n'apparait que s'il a quelque chose a dire : hors ligne, quota
    // epuise, envoi en attente. En marche normale, l'age est porte par le bouton de
    // l'en-tete et le bandeau n'aurait fait que le repeter sur une ligne pleine.
    fragment.appendChild(
      el('section', { class: 'entree' }, [
        el('div', { class: 'entree__texte' }, [
          el('h1', { class: 'entree__titre', texte: 'Qu’est-ce qu’on mange ?' }),
          el('p', { class: 'entree__resume', id: 'resume-accueil', texte: resumeAccueil(toutes) }),
        ]),
        barreSyncSemainier(),
      ])
    );

    var duJour = blocAujourdhui(toutes[0]);
    if (duJour) fragment.appendChild(duJour);

    var bandeau = bandeauErreurRecettes();
    if (bandeau) fragment.appendChild(bandeau);

    fragment.appendChild(
      el('nav', { class: 'acces-liste', 'aria-label': 'Accès principaux' }, [
        carteAcces(
          '#/livre',
          'livre',
          'Le livre de cuisine',
          recettes.length + ' recettes, avec recherche et filtres'
        ),
        carteAcces(
          '#/liste-de-courses',
          'panier',
          'La liste de courses',
          restants === 0
            ? 'rien à prendre pour l’instant'
            : restants + (restants > 1 ? ' articles à prendre' : ' article à prendre')
        ),
      ])
    );

    fragment.appendChild(
      el('section', { class: 'semainier' }, [
        el('h2', { class: 'semainier__titre', texte: 'Les repas de la semaine' }),
      ])
    );

    // La reserve n'apparait qu'en mode edition : l'accueil est d'abord la pour lire
    // le menu de la semaine, et vingt pastilles a glisser au-dessus de la grille
    // faisaient descendre le menu sous la ligne de flottaison.
    if (etat.modeEdition) fragment.appendChild(reserveDePlats());

    // La semaine en cours est toujours dépliée. Les suivantes ne le sont que si
    // elles portent quelque chose, ou si on a demandé à les voir.
    toutes.forEach(function (sem, rang) {
      var deplie = rang === 0 || etat.semainesDepliees[sem.cle] || !estVide(sem);
      fragment.appendChild(deplie ? blocSemaine(sem, sem.contientAujourdhui) : bandeauSemaineRepliee(sem));
    });

    return fragment;
  }

  /** Re-rendu de l'accueil, uniquement si c'est bien l'ecran affiche. */
  function rendreAccueil() {
    if (routeCourante() !== '/') return;
    monter(vueAccueil());
  }

  /* --- choix d'un plat pour un creneau ------------------------------------- */

  function ouvrirSelecteurCreneau(jour, moment) {
    var recherche = '';

    // Ajoute, ne remplace pas : un repas peut porter un plat et un dessert. Pour
    // changer de plat, on retire l'ancien, ce qui est explicite et se defait.
    function poser(plat) {
      Sm.ajouter(jour.cle, moment.cle, plat).then(function () {
        fermerVoile();
        rendreAccueil();
      });
    }

    function corps() {
      var actuels = Sm.creneaux(jour.cle, moment.cle);
      var recettes = filterRecipes(Rc.toutes(), Object.assign(criteresVides(), { recherche: recherche }));

      var champRecherche = el('input', {
        type: 'search',
        class: 'champ-recherche',
        id: 'recherche-plat',
        placeholder: 'Chercher un plat du livre…',
        'aria-label': 'Chercher un plat du livre',
        value: recherche,
        oninput: function (evenement) {
          recherche = evenement.target.value;
          var position = evenement.target.selectionStart;
          rendreCorpsVoile(corps());
          var nouveau = document.getElementById('recherche-plat');
          if (nouveau) {
            nouveau.focus();
            try {
              nouveau.setSelectionRange(position, position);
            } catch (erreur) {
              /* sans effet */
            }
          }
        },
      });

      var champLibre = el('input', {
        type: 'text',
        class: 'champ-ajout',
        id: 'repas-libre',
        placeholder: 'Autre repas (ex. Chez les voisins)',
        'aria-label': 'Autre repas, saisi à la main',
      });

      return [
        actuels.length === 0
          ? null
          : el(
              'div',
              { class: 'boite__actuel' },
              actuels
                .map(function (actuel) {
                  return el('p', { class: 'boite__prevu', 'data-prevu': actuel.cle }, [
                    el('span', { class: 'boite__etiquette', texte: 'Prévu' }),
                    el('span', { class: 'boite__prevu-titre', texte: actuel.titre }),
                    actuel.type === Sm.TYPE_RECETTE && Rc.parId(actuel.recetteId)
                      ? el('a', {
                          class: 'bouton bouton--sobre',
                          href: '#/recette/' + actuel.recetteId,
                          texte: 'Voir la fiche',
                          onclick: fermerVoile,
                        })
                      : null,
                    el('button', {
                      type: 'button',
                      class: 'bouton bouton--sobre',
                      'data-retirer-plat': actuel.cle,
                      texte: 'Retirer',
                      onclick: function () {
                        Sm.retirer(actuel.cle).then(function () {
                          rendreCorpsVoile(corps());
                          rendreAccueil();
                        });
                      },
                    }),
                  ]);
                })
                .concat([
                  // Vider n'a de sens qu'a partir de deux plats : avec un seul, c'est
                  // le bouton « Retirer » de la ligne, et deux boutons pour le meme
                  // effet font hesiter.
                  actuels.length > 1
                    ? el('div', { class: 'boite__actions' }, [
                        el('button', {
                          type: 'button',
                          class: 'bouton bouton--secondaire',
                          id: 'vider-creneau',
                          texte: 'Vider ce repas',
                          onclick: function () {
                            Sm.vider(jour.cle, moment.cle).then(function () {
                              fermerVoile();
                              rendreAccueil();
                            });
                          },
                        }),
                      ])
                    : null,
                ])
            ),

        el('h3', { class: 'boite__section', texte: 'Hors du carnet' }),
        el(
          'div',
          { class: 'pastilles' },
          Sem.REPAS_LIBRES.map(function (repas) {
            return el('button', {
              type: 'button',
              class: 'pastille',
              'data-repas-libre': repas.titre,
              onclick: function () {
                poser({ type: Sm.TYPE_LIBRE, titre: repas.titre });
              },
            }, [icone(repas.icone, { taille: 18 }), el('span', { texte: repas.titre })]);
          })
        ),
        el('div', { class: 'ajout-libre' }, [
          champLibre,
          el('button', {
            type: 'button',
            class: 'bouton bouton--secondaire',
            id: 'poser-libre',
            texte: 'Poser',
            onclick: function () {
              var titre = champLibre.value.trim();
              if (titre === '') {
                champLibre.focus();
                return;
              }
              poser({ type: Sm.TYPE_LIBRE, titre: titre });
            },
          }),
        ]),

        el('h3', { class: 'boite__section', texte: 'Un plat du livre' }),
        champRecherche,
        recettes.length === 0
          ? el('p', { class: 'boite__vide', texte: 'Aucune recette ne correspond à cette recherche.' })
          : el(
              'ul',
              { class: 'choix-plats' },
              recettes.slice(0, 40).map(function (recette) {
                return el('li', {}, [
                  el('button', {
                    type: 'button',
                    class: 'choix-plat',
                    'data-choix': recette.id,
                    onclick: function () {
                      poser({ type: Sm.TYPE_RECETTE, recetteId: recette.id, titre: recette.titre });
                    },
                  }, [
                    vignetteOuMarque(recette, 'vignette--choix', 20),
                    el('span', { class: 'choix-plat__texte' }, [
                      el('span', { class: 'choix-plat__titre', texte: recette.titre }),
                      el('span', {
                        class: 'choix-plat__meta',
                        texte: recette.categorie + ' · ' + recette.temps.total + ' · ' + recette.portions,
                      }),
                    ]),
                  ]),
                ]);
              })
            ),
        recettes.length > 40
          ? el('p', {
              class: 'boite__vide',
              texte: 'Les 40 premières recettes sont affichées : précisez la recherche pour voir les autres.',
            })
          : null,
      ];
    }

    ouvrirVoile(moment.libelle + ' du ' + jour.libelle, function () {
      return corps();
    }, { large: true });
  }

  /* --- ajout des plats de la semaine a la liste de courses ----------------- */

  /**
   * Boite de validation avant ajout. Les plats sont coches par defaut, sauf ceux
   * dont tous les ingredients sont deja en liste : ceux-la sont probablement deja
   * achetes, les recocher ne ferait rien et masquerait le reste.
   */
  function ouvrirCoursesSemaine(sem) {
    var plats = Sm.platsDeLaSemaine(sem);
    var liste = getShoppingList();

    var lignes = plats.map(function (plat) {
      var recette = plat.type === Sm.TYPE_RECETTE ? Rc.parId(plat.recetteId) : null;
      var total = recette ? nbIngredients(recette) : 0;
      var dejaPresents = recette ? S.nomsPresents(liste, recette.id) : {};
      var nbDeja = recette
        ? (recette.ingredients || []).reduce(function (compte, groupe) {
            return (
              compte +
              (groupe.items || []).filter(function (item) {
                return dejaPresents[item.nom];
              }).length
            );
          }, 0)
        : 0;
      // Ce que le placard couvre deja : ces ingredients ne partiront pas en courses.
      var enPlacard = recette ? Pl.couverts(recette) : [];
      var aAjouter = total - nbDeja - enPlacard.length;

      return {
        plat: plat,
        recette: recette,
        total: total,
        nbDeja: nbDeja,
        enPlacard: enPlacard,
        // Sans ingredients il n'y a rien a ajouter : un restaurant ne se met pas
        // dans une liste de courses. Et si tout est deja en liste ou en placard,
        // il n'y a rien a faire non plus.
        ajoutable: Boolean(recette) && aAjouter > 0,
        coche: Boolean(recette) && aAjouter > 0,
      };
    });

    function corps() {
      var ajoutables = lignes.filter(function (l) {
        return l.ajoutable;
      });
      var choisies = ajoutables.filter(function (l) {
        return l.coche;
      });

      var bouton = el('button', {
        type: 'button',
        class: 'bouton',
        id: 'valider-courses-semaine',
        texte:
          choisies.length === 0
            ? 'Aucun plat sélectionné'
            : 'Ajouter ' + choisies.length + (choisies.length > 1 ? ' plats' : ' plat') + ' à la liste',
        disabled: choisies.length === 0 ? true : null,
        onclick: function () {
          S.addRecipesToList(
            choisies.map(function (l) {
              return l.recette;
            }),
            // Le placard reste hors des courses : c'est tout l'objet de cette liste.
            function (nom) {
              return Pl.contient(nom);
            }
          ).then(function (resultat) {
            rendreCorpsVoile([
              el('p', { class: 'boite__succes', id: 'resultat-courses' }, [
                icone('coche', { taille: 18 }),
                el('span', {
                  texte:
                    resultat.ajoutes +
                    (resultat.ajoutes > 1 ? ' articles ajoutés' : ' article ajouté') +
                    (resultat.deja > 0
                      ? ', ' + resultat.deja + (resultat.deja > 1 ? ' déjà présents' : ' déjà présent')
                      : '') +
                    // Ce que le placard a retenu est dit : sans cela, un ingredient
                    // manquant en magasin passerait pour un oubli de l'application.
                    (resultat.exclus > 0
                      ? ', ' + resultat.exclus + (resultat.exclus > 1 ? ' laissés au placard' : ' laissé au placard')
                      : '') +
                    '.',
                }),
              ]),
              el('div', { class: 'boite__actions' }, [
                el('a', {
                  class: 'bouton',
                  href: '#/liste-de-courses',
                  texte: 'Voir la liste de courses',
                  onclick: fermerVoile,
                }),
                el('button', {
                  type: 'button',
                  class: 'bouton bouton--secondaire',
                  texte: 'Fermer',
                  onclick: fermerVoile,
                }),
              ]),
            ]);
            rendreAccueil();
          });
        },
      });

      if (lignes.length === 0) {
        return [
          el('p', { class: 'boite__vide', texte: 'Aucun plat n’est prévu sur cette semaine.' }),
          el('p', {
            class: 'boite__vide',
            texte: 'Touchez une case du semainier pour en choisir un, puis revenez ici.',
          }),
        ];
      }

      return [
        el('p', {
          class: 'boite__intro',
          texte:
            'Décochez les plats dont vous avez déjà les ingrédients. Seuls les plats cochés seront ajoutés.',
        }),
        el(
          'ul',
          { class: 'validation-plats' },
          lignes.map(function (ligne) {
            var notes = [];
            if (!ligne.recette && ligne.plat.type === Sm.TYPE_RECETTE) {
              notes.push('fiche introuvable dans le livre');
            } else if (!ligne.recette) {
              notes.push('repas hors carnet, sans ingrédients');
            } else if (ligne.total === 0) {
              notes.push('cette fiche n’a aucun ingrédient renseigné');
            } else if (ligne.nbDeja >= ligne.total) {
              notes.push('déjà entièrement dans la liste');
            } else if (!ligne.ajoutable) {
              notes.push('tout est déjà en liste ou en placard');
            } else if (ligne.nbDeja > 0) {
              notes.push(ligne.nbDeja + ' sur ' + ligne.total + ' déjà dans la liste');
            } else {
              notes.push(ligne.total + ' ingrédients');
            }
            // Le placard est dit a part : c'est une decision de la maison, pas un
            // etat de la liste, et on doit pouvoir se rappeler pourquoi le sel
            // n'apparait jamais dans les courses.
            if (ligne.enPlacard.length > 0) {
              notes.push(
                ligne.enPlacard.length +
                  (ligne.enPlacard.length > 1 ? ' ingrédients en placard : ' : ' ingrédient en placard : ') +
                  ligne.enPlacard.join(', ')
              );
            }
            // B1 : ce que la source ne donne pas, dit au moment ou cela compte. Une
            // recette dont deux ingredients ne sont pas dans la liste part incomplete
            // en courses, et on s'en apercoit devant les fourneaux.
            if (ligne.recette && (ligne.recette.manquants || []).length > 0) {
              notes.push(
                ligne.recette.manquants.length +
                  (ligne.recette.manquants.length > 1
                    ? ' points signalés sur la fiche : vérifiez avant de partir'
                    : ' point signalé sur la fiche : vérifiez avant de partir')
              );
            }
            if (ligne.plat.occurrences.length > 1) {
              notes.push(
                'prévu ' +
                  ligne.plat.occurrences.length +
                  ' fois cette semaine, compté une seule : les quantités ne sont pas doublées'
              );
            }

            var case_ = el('input', {
              type: 'checkbox',
              class: 'case',
              'data-valider': ligne.plat.cle,
              checked: ligne.coche ? true : null,
              disabled: ligne.ajoutable ? null : true,
              'aria-label': ligne.plat.titre,
              onchange: function (evenement) {
                ligne.coche = evenement.target.checked;
                rendreCorpsVoile(corps());
              },
            });

            return el('li', { class: 'validation-plat' + (ligne.ajoutable ? '' : ' validation-plat--inerte') }, [
              el('label', { class: 'validation-plat__label' }, [
                case_,
                el('span', {}, [
                  el('span', { class: 'validation-plat__titre', texte: ligne.plat.titre }),
                  el('span', { class: 'validation-plat__note', texte: notes.join(' · ') }),
                ]),
              ]),
            ]);
          })
        ),
        el('div', { class: 'boite__actions' }, [
          bouton,
          el('button', { type: 'button', class: 'bouton bouton--secondaire', texte: 'Annuler', onclick: fermerVoile }),
        ]),
      ];
    }

    ouvrirVoile('Ajouter aux courses, ' + sem.libelle, function () {
      return corps();
    }, { large: true });
  }

  /* --- vue : livre de cuisine ---------------------------------------------- */

  function vueLivre() {
    var recettes = Rc.toutes();
    var comptes = Sm.comptes();
    var resultats = filterRecipes(recettes, etat.criteres, comptes);
    var options = optionsDisponibles(recettes);
    var nbJamais = recettes.filter(function (r) {
      return !comptes[r.id];
    }).length;
    var fragment = document.createDocumentFragment();

    fragment.appendChild(el('a', { class: 'retour', href: '#/', texte: '‹ Retour à l’accueil' }));

    fragment.appendChild(
      el('div', { class: 'livre__entete' }, [
        el('div', {}, [
          el('h1', { class: 'fiche__titre', texte: 'Le livre de cuisine' }),
          el('p', {
            class: 'accroche',
            texte:
              recettes.length +
              ' recettes rassemblées, avec leurs astuces, leurs variantes et ce que leur source ne dit pas.',
          }),
        ]),
        el('a', { class: 'bouton', id: 'ajouter-recette', href: '#/recette/nouvelle' }, [
          icone('plus', { taille: 18 }),
          el('span', { texte: 'Ajouter une recette' }),
        ]),
      ])
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

    // Le filtre sur les realisations n'a de sens que si le semainier a un historique.
    if (Sm.tous().length > 0) {
      rangees.push({
        cle: 'realisations',
        titre: 'Déjà fait',
        valeurs: [
          { valeur: 'jamais', libelle: 'Jamais fait (' + nbJamais + ')', classe: 'pilule' },
          { valeur: 'deja', libelle: 'Déjà fait', classe: 'pilule' },
        ],
      });
    }

    var champ = el('input', {
      type: 'search',
      class: 'champ-recherche',
      placeholder: 'Rechercher un plat, un ingrédient…',
      'aria-label': 'Rechercher une recette',
      value: etat.criteres.recherche || '',
      oninput: function (evenement) {
        etat.criteres.recherche = evenement.target.value;
        rendreLivrePartiel();
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
              // Repere stable pour les tests et pour un lien profond eventuel : le
              // libelle porte un decompte, il change avec les donnees.
              'data-filtre': rangee.cle + ':' + option.valeur,
              'aria-pressed': actif ? 'true' : 'false',
              texte: option.libelle,
              onclick: function () {
                etat.criteres[rangee.cle] = actif ? null : option.valeur;
                rendreLivrePartiel();
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
        etat.criteres.temps ||
        etat.criteres.realisations
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
                rendreLivrePartiel();
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
            // Pas de liseret de couleur : la pastille de categorie porte deja cette
            // information, et l'encoder deux fois n'ajoute rien. Sans photo, la carte
            // tient en texte seul, ce qui est le cas de dix-neuf recettes sur vingt.
            var carte = el('a', { class: 'carte', href: '#/recette/' + recette.id }, [
              vignetteRecette(recette, 'vignette--carte'),
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
                (function () {
                  var fait = libelleRealisations(recette.id);
                  if (!fait) return null;
                  return el('span', {
                    class: 'carte__realisations' + (fait.jamais ? ' carte__realisations--jamais' : ''),
                    texte: fait.texte,
                  });
                })(),
              ]),
            ]);
            return carte;
          })
        )
      );
    }

    return fragment;
  }

  /* Re-rendu du livre en conservant le focus et la position du curseur du champ de
     recherche, sinon la saisie devient inutilisable. */
  function rendreLivrePartiel() {
    var actif = document.activeElement;
    var etaitDansRecherche = actif && actif.classList && actif.classList.contains('champ-recherche');
    var position = etaitDansRecherche ? actif.selectionStart : null;

    monter(vueLivre());

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

  /**
   * Selecteur Consulter / Cuisiner.
   *
   * Deux usages distincts de la meme fiche : on consulte assis, on cuisine debout
   * les mains occupees. Le mode choisi est retenu par recette, en local : deux
   * personnes qui cuisinent le meme plat ne doivent pas se pousser l'une l'autre
   * d'une etape a l'autre.
   */
  function selecteurMode(recette) {
    var courant = Cu.mode(recette.id);

    return el('div', { class: 'segments', role: 'group', 'aria-label': 'Mode d’affichage de la fiche' }, [
      { valeur: Cu.MODE_CONSULTER, libelle: 'Consulter' },
      { valeur: Cu.MODE_CUISINER, libelle: 'Cuisiner' },
    ].map(function (choix) {
      var actif = courant === choix.valeur;
      return el('button', {
        type: 'button',
        class: 'segment' + (actif ? ' segment--actif' : ''),
        'aria-pressed': actif ? 'true' : 'false',
        'data-mode': choix.valeur,
        texte: choix.libelle,
        onclick: function () {
          Cu.definirMode(recette.id, choix.valeur);
          monter(vueRecette(recette.id));
          window.scrollTo(0, 0);
        },
      });
    }));
  }

  /**
   * Mode Cuisiner : une etape a la fois, en gros caracteres.
   *
   * L'etape en cours est retenue : on repose l'appareil, on y revient, et on doit
   * retrouver ou on en etait. C'est la seule raison d'etre de js/cuisson.js.
   */
  function vueCuisiner(recette) {
    var etapes = recette.instructions || [];
    var fragment = document.createDocumentFragment();

    fragment.appendChild(
      el('div', { class: 'cuisiner__entete' }, [
        el('a', { class: 'retour', href: '#/livre', texte: '‹ Retour au livre' }),
        selecteurMode(recette),
      ])
    );

    fragment.appendChild(el('h1', { class: 'fiche__titre', texte: recette.titre }));

    if (etapes.length === 0) {
      fragment.appendChild(
        el('div', { class: 'etat-vide' }, [
          el('p', { texte: 'Cette recette n’a aucune étape renseignée.' }),
          el('p', { texte: 'Passez en mode Consulter pour voir ses ingrédients, ou complétez-la dans l’éditeur.' }),
        ])
      );
      return fragment;
    }

    var rang = Cu.etape(recette.id, etapes.length);
    var etape = etapes[rang];
    var estEntier = typeof etape.numero === 'number';

    function aller(nouveau) {
      Cu.definirEtape(recette.id, Math.max(0, Math.min(etapes.length - 1, nouveau)));
      monter(vueRecette(recette.id));
      // La nouvelle etape doit s'afficher depuis son debut : le contenu a ete
      // remplace, rester a mi-hauteur ferait lire une etape tronquee par l'en-tete.
      window.scrollTo(0, 0);
    }

    fragment.appendChild(
      el('div', { class: 'progression' }, [
        el('p', {
          class: 'progression__texte',
          id: 'progression-cuisson',
          texte: 'Étape ' + (rang + 1) + ' sur ' + etapes.length,
        }),
        el(
          'div',
          { class: 'progression__barres', 'aria-hidden': 'true' },
          etapes.map(function (sansUsage, i) {
            return el('span', { class: 'progression__barre' + (i <= rang ? ' progression__barre--faite' : '') });
          })
        ),
      ])
    );

    fragment.appendChild(
      el('article', { class: 'etape-cuisson', id: 'etape-cuisson' }, [
        el('p', { class: 'etape-cuisson__numero', texte: estEntier ? String(etape.numero) : String(etape.numero) }),
        el('p', { class: 'etape-cuisson__texte', texte: etape.texte }),
        etape.astuce
          ? el('div', { class: 'astuce astuce--cuisson' }, [
              el('span', { class: 'astuce__marque', texte: 'Astuce' }),
              el('p', { texte: stripTipPrefix(etape.astuce) }),
            ])
          : null,
      ])
    );

    // Rappel des ingredients de l'etape en cours : en cuisine, on veut savoir quoi
    // sortir du placard maintenant, sans deplier toute la liste. Il n'apparait que si
    // l'etape cite un ingredient : un rappel vide serait un bruit de plus a lire.
    // Voir L.ingredientsDeLEtape pour ce que la deduction sait faire, et ne sait pas.
    var necessaires = L.ingredientsDeLEtape(recette, etape);
    if (necessaires.length > 0) {
      fragment.appendChild(
        el('aside', { class: 'etape-ingredients', id: 'etape-ingredients' }, [
          el('h2', { class: 'etape-ingredients__titre' }, [
            icone('panier', { taille: 16 }),
            el('span', { texte: 'Ce qu’il vous faut à cette étape' }),
          ]),
          el(
            'ul',
            { class: 'etape-ingredients__liste' },
            necessaires.map(function (item) {
              return el('li', { 'data-etape-ingredient': item.nom }, [
                el('span', { class: 'nom', texte: item.nom }),
                el('span', { class: 'quantite', texte: item.quantite }),
              ]);
            })
          ),
        ])
      );
    }

    fragment.appendChild(
      el('div', { class: 'cuisiner__navigation' }, [
        el('button', {
          type: 'button',
          class: 'bouton bouton--secondaire',
          id: 'etape-precedente',
          disabled: rang === 0 ? true : null,
          texte: '‹ Précédente',
          onclick: function () {
            aller(rang - 1);
          },
        }),
        el('button', {
          type: 'button',
          class: 'bouton',
          id: 'etape-suivante',
          disabled: rang === etapes.length - 1 ? true : null,
          texte: 'Suivante ›',
          onclick: function () {
            aller(rang + 1);
          },
        }),
      ])
    );

    // Les ingredients restent a portee : en cuisine on verifie une quantite sans
    // vouloir quitter l'etape en cours.
    fragment.appendChild(
      el('details', { class: 'ingredients-repli', id: 'ingredients-repli' }, [
        el('summary', { class: 'ingredients-repli__titre', texte: 'Voir tous les ingrédients' }),
        el('p', { class: 'ingredients-repli__portions', texte: recette.portions }),
        el(
          'div',
          {},
          (recette.ingredients || []).map(function (groupe) {
            return el('div', {}, [
              groupe.groupe ? el('h3', { class: 'groupe-ingredients__titre', texte: groupe.groupe }) : null,
              el(
                'ul',
                { class: 'liste-ingredients' },
                (groupe.items || []).map(function (item) {
                  return el('li', {}, [
                    el('span', { class: 'nom', texte: item.nom }),
                    el('span', { class: 'quantite', texte: item.quantite }),
                  ]);
                })
              ),
            ]);
          })
        ),
      ])
    );

    if (rang === etapes.length - 1) {
      fragment.appendChild(
        el('div', { class: 'cuisiner__fin' }, [
          el('p', { texte: 'Dernière étape. Bon appétit.' }),
          el('button', {
            type: 'button',
            class: 'lien-action',
            id: 'recommencer-cuisson',
            texte: 'Revenir à la première étape',
            onclick: function () {
              aller(0);
            },
          }),
        ])
      );
    }

    return fragment;
  }

  function vueRecette(id) {
    var recette = Rc.parId(id);

    if (!recette) {
      return el('div', {}, [
        el('a', { class: 'retour', href: '#/livre', texte: '‹ Retour au livre' }),
        el('div', { class: 'etat-erreur' }, [
          el('h1', { texte: 'Recette introuvable' }),
          el('p', { texte: 'L’identifiant « ' + id + ' » ne correspond à aucune fiche.' }),
        ]),
      ]);
    }

    document.title = recette.titre + ' — Miam miam !';

    if (Cu.mode(id) === Cu.MODE_CUISINER) return vueCuisiner(recette);

    var dansListe = recetteDansListe(getShoppingList(), recette.id);
    var fragment = document.createDocumentFragment();

    fragment.appendChild(
      el('div', { class: 'fiche__barre' }, [
        el('a', { class: 'retour', href: '#/livre', texte: '‹ Retour au livre' }),
        selecteurMode(recette),
      ])
    );

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

    // Photo de la fiche, en deux temps : la vignette en cache s'affiche tout de
    // suite, puis la grande version la remplace quand elle arrive. Sans ce relais la
    // fiche resterait vide le temps d'une lecture reseau alors qu'une image
    // utilisable est deja la.
    //
    // Rien n'est demande pour une recette que le cache ne signale pas comme ayant
    // une photo : ce serait une lecture facturee, et un 404, pour dix-neuf recettes
    // sur vingt. Voir la limite assumee dans photos.js.
    var emplacementPhoto = el('div', { class: 'fiche__emplacement-photo' });
    fragment.appendChild(emplacementPhoto);

    function poserPhoto(source) {
      var cadre = emplacementPhoto.querySelector('#photo-fiche');
      if (cadre) {
        cadre.querySelector('img').src = source;
        return;
      }
      emplacementPhoto.appendChild(
        el('figure', { class: 'fiche__photo', id: 'photo-fiche' }, [
          el('img', { src: source, alt: 'Photo de ' + recette.titre }),
        ])
      );
    }

    function chargerGrandePhoto() {
      Ph.grande(recette.id)
        .then(function (image) {
          if (image) poserPhoto(image);
        })
        .catch(function () {
          // La grande image n'a pas pu etre lue : la vignette reste affichee si elle
          // etait en cache, ce qui vaut mieux qu'un cadre vide ou qu'un message
          // d'erreur pour une photo.
        });
    }

    if (Ph.aUnePhoto(recette.id)) {
      poserPhoto(Ph.vignette(recette.id));
      chargerGrandePhoto();
    }

    var faitFiche = libelleRealisations(recette.id);

    fragment.appendChild(
      el('p', { class: 'fiche__portions' }, [
        el('span', { texte: recette.portions }),
        faitFiche
          ? el('span', {
              class: 'marque-realisations' + (faitFiche.jamais ? ' marque-realisations--jamais' : ''),
              texte: faitFiche.texte,
            })
          : null,
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

    // « Ce que la source ne donne pas » reste visible, hors du depli : c'est une
    // garantie d'honnetete des donnees, pas du contexte. La replier reviendrait a
    // masquer ce que la fiche ne sait pas.
    if (recette.manquants.length) {
      fragment.appendChild(
        section(
          'Ce que la source ne donne pas',
          'Signalé plutôt que comblé par une hypothèse.',
          listePuces(recette.manquants)
        )
      );
    }

    // Le reste est du contexte : on le lit une fois, pas a chaque fois qu'on
    // cuisine. Replie sous un depli, jamais supprime, et ouvrable d'un clic.
    var contexte = document.createDocumentFragment();

    var lignesTemps = [
      ['Préparation', recette.temps.preparation],
      ['Cuisson', recette.temps.cuisson],
      ['Repos', recette.temps.repos],
      ['Total', recette.temps.total],
    ].filter(function (paire) {
      return Boolean(paire[1]);
    });

    contexte.appendChild(
      section(
        'Temps',
        null,
        el('table', { class: 'tableau-simple' }, [
          el(
            'tbody',
            {},
            lignesTemps.map(function (paire) {
              return el('tr', {}, [el('th', { scope: 'row', texte: paire[0] }), el('td', { texte: paire[1] })]);
            })
          ),
        ])
      )
    );

    contexte.appendChild(
      section('Origine', null, [
        el('p', { texte: recette.origine }),
        recette.difficulte
          ? el('p', { class: 'section__soustitre', texte: 'Difficulté indiquée : ' + recette.difficulte })
          : null,
        recette.calories ? el('p', { class: 'section__soustitre', texte: 'Calories : ' + recette.calories }) : null,
      ])
    );

    // Un tableau fourni avec la recette est toujours prefere : il porte une
    // interpretation (les sous-preparations qui convergent) que la generation ne
    // sait pas deviner. Sinon on reconstitue le deroule depuis les etapes.
    if (isFlowTableInformative(recette.flowTable)) {
      contexte.appendChild(
        section(
          'Déroulé des préparations',
          'Comment chaque ingrédient est préparé, puis assemblé jusqu’à la cuisson.',
          tableauFlux(recette.flowTable)
        )
      );
    } else {
      var genere = tableauDerouleGenere(recette);
      if (genere) {
        contexte.appendChild(
          section(
            'Déroulé des préparations',
            'Reconstitué automatiquement : à quelle étape chaque ingrédient entre.',
            genere
          )
        );
      }
    }

    if (recette.astuces.recette.length) {
      contexte.appendChild(section('Astuces de la recette', null, listePuces(recette.astuces.recette)));
    }
    if (recette.astuces.commentaires.length) {
      contexte.appendChild(
        section('Astuces tirées des commentaires', null, listePuces(recette.astuces.commentaires))
      );
    }
    if (recette.variantes.recette.length) {
      contexte.appendChild(section('Variantes', null, listePuces(recette.variantes.recette)));
    }
    if (recette.variantes.associees.length) {
      contexte.appendChild(
        section('Recettes associées', 'Suggestions présentes sur la page source.', listePuces(recette.variantes.associees))
      );
    }

    // Toute recette cite sa source, mais toutes n'ont pas de lien : une page de livre
    // photographiee n'a pas d'URL. Le nom de la source est alors affiche seul, plutot
    // qu'un lien mort ou qu'une section escamotee.
    contexte.appendChild(
      section('Source', null, [
        el('p', {}, [
          recette.source.url
            ? el('a', {
                class: 'lien-source',
                href: recette.source.url,
                target: '_blank',
                rel: 'noopener noreferrer',
                texte: recette.source.label,
              })
            : el('span', { class: 'lien-source lien-source--hors-ligne', texte: recette.source.label }),
        ]),
        recette.source.url
          ? el('p', { class: 'url-source', texte: recette.source.url })
          : el('p', { class: 'url-source', texte: 'Aucune adresse : source hors ligne.' }),
      ])
    );

    // `open` a l'impression : une fiche imprimee doit etre complete, un depli
    // referme y perdrait la source et les temps.
    fragment.appendChild(
      el('details', { class: 'pour-aller-plus-loin', id: 'pour-aller-plus-loin' }, [
        el('summary', { class: 'pour-aller-plus-loin__titre' }, [
          icone('fleche', { taille: 16 }),
          el('span', { texte: 'Pour aller plus loin : temps, origine, déroulé, astuces, variantes, source' }),
        ]),
        contexte,
      ])
    );

    return fragment;
  }

  /* --- vue : liste de courses ---------------------------------------------- */

  /** Bandeau d'etat de la liste de courses. */
  function barreSync() {
    return barreEtat(S, 'Liste partagée à la maison', function () {
      monter(vueListeDeCourses());
    }, 'etat-liste');
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

  /* --- le placard ---------------------------------------------------------- */

  /**
   * Boite de gestion du placard.
   *
   * Elle s'ouvre depuis la liste de courses, parce que c'est la qu'on constate qu'un
   * ingredient n'aurait pas du y etre. Les ingredients proposes viennent du carnet :
   * saisir « huile d'olive » a la main, avec ou sans apostrophe typographique, est le
   * meilleur moyen que le placard ne reconnaisse jamais rien.
   */
  function ouvrirPlacard() {
    var recherche = '';

    function corps() {
      var enPlacard = Pl.tous();
      var index = Pl.index();

      // Tous les noms d'ingredients du carnet, dedoublonnes, moins ceux deja poses.
      var candidats = [];
      var vus = {};
      Rc.toutes().forEach(function (recette) {
        (recette.ingredients || []).forEach(function (groupe) {
          (groupe.items || []).forEach(function (item) {
            var k = Pl.cle(item.nom);
            if (k === '' || index[k] || vus[k]) return;
            vus[k] = true;
            candidats.push(item.nom);
          });
        });
      });
      candidats.sort(function (a, b) {
        return a.localeCompare(b, 'fr');
      });

      var filtres =
        recherche === ''
          ? candidats
          : candidats.filter(function (nom) {
              return Pl.cle(nom).indexOf(Pl.cle(recherche)) !== -1;
            });

      var champ = el('input', {
        type: 'search',
        class: 'champ-recherche champ-recherche--fin',
        id: 'recherche-placard',
        placeholder: 'Chercher un ingrédient du carnet…',
        'aria-label': 'Chercher un ingrédient à mettre au placard',
        value: recherche,
        oninput: function (evenement) {
          recherche = evenement.target.value;
          var position = evenement.target.selectionStart;
          rendreCorpsVoile(corps());
          var nouveau = document.getElementById('recherche-placard');
          if (nouveau) {
            nouveau.focus();
            try {
              nouveau.setSelectionRange(position, position);
            } catch (erreur) {
              /* sans effet */
            }
          }
        },
      });

      var probleme = diagnostiquer(Pl.etatSync());

      return [
        el('p', {
          class: 'accroche',
          texte:
            'Ce que vous avez toujours : sel, farine, huile. Ces ingrédients ne partiront plus en courses quand vous ajouterez les plats de la semaine.',
        }),

        // Les regles de la collection `placard` peuvent ne pas etre publiees : le
        // dire plutot que de laisser croire que les ajouts ont fonctionne.
        probleme
          ? el('div', { class: 'sync ' + probleme.classe, id: 'etat-placard' }, [
              el('span', { class: 'sync__etat', texte: probleme.titre }),
              el('p', { class: 'sync__erreur', texte: probleme.explication }),
            ])
          : null,

        el('h3', { class: 'boite__section', texte: 'Au placard' }),
        enPlacard.length === 0
          ? el('p', { class: 'boite__vide', texte: 'Le placard est vide : rien n’est écarté des courses.' })
          : el(
              'div',
              { class: 'pastilles', id: 'placard-pose' },
              enPlacard.map(function (entree) {
                return el(
                  'button',
                  {
                    type: 'button',
                    class: 'pastille pastille--placard',
                    'data-placard': entree.cle,
                    'aria-label': 'Retirer ' + entree.nom + ' du placard',
                    onclick: function () {
                      Pl.retirer(entree.nom).then(function () {
                        rendreCorpsVoile(corps());
                      });
                    },
                  },
                  [el('span', { texte: entree.nom }), icone('croix', { taille: 14 })]
                );
              })
            ),

        el('h3', { class: 'boite__section', texte: 'Ajouter depuis le carnet' }),
        champ,
        filtres.length === 0
          ? el('p', { class: 'boite__vide', texte: 'Aucun ingrédient du carnet ne correspond.' })
          : el(
              'div',
              { class: 'pastilles', id: 'placard-candidats' },
              filtres.slice(0, 60).map(function (nom) {
                return el(
                  'button',
                  {
                    type: 'button',
                    class: 'pastille',
                    'data-candidat-placard': Pl.cle(nom),
                    onclick: function () {
                      Pl.ajouter(nom).then(function () {
                        rendreCorpsVoile(corps());
                      });
                    },
                  },
                  [icone('plus', { taille: 14 }), el('span', { texte: nom })]
                );
              })
            ),
        filtres.length > 60
          ? el('p', {
              class: 'boite__vide',
              texte: 'Les 60 premiers sont affichés : précisez la recherche pour voir les autres.',
            })
          : null,
      ];
    }

    ouvrirVoile('Toujours en placard', function () {
      return corps();
    }, { large: true });
  }

  /**
   * Mode « En magasin ». Le rendu est dans js/vue-magasin.js : c'est le premier ecran
   * sorti de ce fichier, qui portait les cinq vues. app.js ne garde ici que le
   * raccordement, les outils de rendu et le re-rendu.
   */
  function vueMagasin() {
    document.title = 'En magasin — Miam miam !';
    return Mg.construire({
      el: el,
      icone: icone,
      S: S,
      etat: etat.magasin,
      annoncer: annoncer,
      rendre: function () {
        if (routeCourante() === '/liste-de-courses/magasin') monter(vueMagasin());
      },
    });
  }

  function vueListeDeCourses() {
    document.title = 'Liste de courses — Miam miam !';

    var articles = getShoppingList();
    var fragment = document.createDocumentFragment();

    fragment.appendChild(el('a', { class: 'retour', href: '#/', texte: '‹ Retour à l’accueil' }));
    fragment.appendChild(el('h1', { class: 'fiche__titre', texte: 'Liste de courses commune' }));
    fragment.appendChild(
      el('p', {
        class: 'accroche',
        texte:
          'Rangée par rayon, dans l’ordre du magasin. Un même ingrédient venu de plusieurs recettes est additionné, et les lignes très proches sont encadrées ensemble sans être fusionnées.',
      })
    );

    // Null en marche normale : le bandeau ne s'affiche que s'il a quelque chose a
    // dire. L'age de la liste est porte par le bouton de l'en-tete.
    var etatListe = barreSync();
    if (etatListe) fragment.appendChild(etatListe);
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

    // Ce qui reste a prendre, en grand : c'est la seule chose qu'on regarde en
    // magasin, une main sur le caddie.
    fragment.appendChild(
      el('div', { class: 'reste-a-prendre' }, [
        el('p', { class: 'reste-a-prendre__titre', texte: 'Encore à acheter' }),
        el('p', { class: 'reste-a-prendre__nombre' }, [
          el('strong', { texte: String(restants) }),
          el('span', { texte: ' ligne' + (restants > 1 ? 's' : '') + ' sur ' + lignes.length }),
        ]),
        el('p', {
          class: 'reste-a-prendre__note',
          texte: 'Cocher fonctionne sans réseau, tout repart au retour du signal.',
        }),
        el('a', {
          class: 'bouton',
          href: '#/liste-de-courses/magasin',
          id: 'aller-magasin',
        }, [icone('panier', { taille: 18 }), el('span', { texte: 'En magasin' })]),
        el('button', {
          type: 'button',
          class: 'bouton bouton--sobre',
          id: 'ouvrir-placard',
          onclick: ouvrirPlacard,
        }, [icone('livre', { taille: 16 }), el('span', { texte: 'Placard' })]),
      ])
    );

    // Le decompte est deja porte par le bloc « Encore a acheter » ci-dessus : cette
    // barre ne garde que les actions.
    fragment.appendChild(
      el('div', { class: 'barre-resultats barre-resultats--actions' }, [
        el('div', { class: 'actions-liste' }, [
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
      // Les lignes tres proches sont encadrees ensemble, sans etre fusionnees : en
      // magasin, « Beurre », « Beurre aux cristaux de sel » et « Beurre aux cristaux
      // de sel ramolli » sont un seul produit a prendre, mais additionner sur une
      // ressemblance donnerait une quantite fausse.
      var entrees = S.grouperProches(groupe.lignes);

      fragment.appendChild(
        el('section', { class: 'rayon' }, [
          el('h2', { class: 'rayon__titre' }, [
            icone(Ic.pourRayon(groupe.rayon), { taille: 18 }),
            el('span', { class: 'rayon__nom', texte: groupe.rayon }),
            el('span', { class: 'rayon__compte', texte: String(groupe.lignes.length) }),
          ]),
          el(
            'div',
            { class: 'rayon__corps' },
            entrees.map(function (entree) {
              if (entree.type === 'ligne') {
                return el('ul', { class: 'liste-courses' }, [ligneCourses(entree.ligne)]);
              }
              return el('div', { class: 'lignes-proches', 'data-proches': entree.cle }, [
                el('p', { class: 'lignes-proches__titre' }, [
                  el('strong', { texte: entree.tete }),
                  el('span', {
                    texte: ' — ' + entree.lignes.length + ' lignes proches',
                  }),
                ]),
                el('ul', { class: 'liste-courses' }, entree.lignes.map(ligneCourses)),
              ]);
            })
          ),
        ])
      );
    });

    return fragment;
  }

  /* --- vue : modification d'une recette ------------------------------------- */

  // Brouillon en cours d'edition, garde hors du rendu pour survivre aux re-rendus
  // declenches par l'ajout ou le retrait d'une ligne.
  var brouillon = null;

  // Message d'erreur propre a l'editeur (titre manquant, suppression refusee).
  // Distinct du bandeau de synchronisation, qui parle du reseau.
  var erreurEditeur = null;

  /** Champ de saisie lie a une propriete du brouillon, sans re-rendu a la frappe. */
  function champ(valeurInitiale, surSaisie, options) {
    options = options || {};
    return el(options.multiligne ? 'textarea' : 'input', {
      class: options.classe || 'champ-edition',
      id: options.id || null,
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

  /**
   * Bloc photo de l'editeur.
   *
   * L'etat de l'operation est tenu dans une variable de module et non dans le DOM :
   * un re-rendu de l'editeur (declenche par un changement de parts) ne doit pas
   * effacer le message « photo trop lourde » qu'on vient d'afficher.
   */
  var etatPhoto = { message: null, erreur: null, enCours: false };

  function blocPhoto(id) {
    var courante = Ph.vignette(id);

    var champFichier = el('input', {
      type: 'file',
      class: 'champ-fichier',
      id: 'photo-fichier',
      accept: 'image/*',
      'aria-label': 'Choisir une photo',
      onchange: function (evenement) {
        var fichier = evenement.target.files && evenement.target.files[0];
        if (!fichier) return;

        etatPhoto = { message: 'Préparation de l’image…', erreur: null, enCours: true };
        monter(vueEditeur(id));

        Ph.preparer(fichier)
          .then(function (tailles) {
            return Ph.enregistrer(id, tailles).then(function () {
              etatPhoto = {
                message:
                  'Photo enregistrée et partagée : ' +
                  Math.round(tailles.poids / 1024) +
                  ' ko après compression, depuis ' +
                  tailles.largeur +
                  ' × ' +
                  tailles.hauteur +
                  ' px.',
                erreur: null,
                enCours: false,
              };
            });
          })
          .catch(function (erreur) {
            etatPhoto = { message: null, erreur: erreur.message, enCours: false };
          })
          .then(function () {
            monter(vueEditeur(id));
          });
      },
    });

    return el('div', { class: 'bloc-photo', id: 'bloc-photo' }, [
      courante
        ? el('figure', { class: 'bloc-photo__apercu' }, [
            el('img', { src: courante, alt: 'Photo actuelle de la recette' }),
          ])
        : el('div', { class: 'bloc-photo__apercu bloc-photo__apercu--vide' }, [
            icone('appareil', { taille: 28 }),
            el('span', { texte: 'Aucune photo' }),
          ]),
      el('div', { class: 'bloc-photo__actions' }, [
        el('label', { class: 'bouton bouton--secondaire', for: 'photo-fichier' }, [
          icone('appareil', { taille: 16 }),
          el('span', { texte: courante ? 'Remplacer la photo' : 'Ajouter une photo' }),
        ]),
        champFichier,
        courante
          ? el('button', {
              type: 'button',
              class: 'bouton bouton--secondaire',
              id: 'retirer-photo',
              texte: 'Retirer la photo',
              onclick: function () {
                Ph.supprimer(id)
                  .then(function () {
                    etatPhoto = { message: 'Photo retirée.', erreur: null, enCours: false };
                  })
                  .catch(function (erreur) {
                    etatPhoto = { message: null, erreur: erreur.message, enCours: false };
                  })
                  .then(function () {
                    monter(vueEditeur(id));
                  });
              },
            })
          : null,
      ]),
      el('p', {
        class: 'bloc-photo__aide',
        texte:
          'L’image est réduite dans le navigateur avant l’envoi (320 px pour les listes, 1200 px pour la fiche) : une photo de téléphone de plusieurs mégaoctets ne passerait pas la limite d’un document Firestore.',
      }),
      etatPhoto.message ? el('p', { class: 'bloc-photo__message', id: 'photo-message', texte: etatPhoto.message }) : null,
      etatPhoto.erreur
        ? el('p', { class: 'bloc-photo__erreur', id: 'photo-erreur', texte: 'La photo n’a pas été enregistrée : ' + etatPhoto.erreur })
        : null,
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
      monter(vueEditeur(id));
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
                      monter(vueEditeur(id));
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
                monter(vueEditeur(id));
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
              monter(vueEditeur(id));
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
                  monter(vueEditeur(id));
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
              monter(vueEditeur(id));
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

  /**
   * Editeur de recette. `id` valant null, c'est une creation : le meme formulaire
   * sert aux deux, ce qui evite de maintenir deux ecrans qui divergeraient.
   */
  function vueEditeur(id) {
    var creation = id === null || id === undefined;
    var recette = creation ? null : Rc.parId(id);

    if (!creation && !recette) {
      return el('div', {}, [
        el('a', { class: 'retour', href: '#/livre', texte: '‹ Retour au livre' }),
        el('div', { class: 'etat-erreur' }, [
          el('h1', { texte: 'Recette introuvable' }),
          el('p', { texte: 'L’identifiant « ' + id + ' » ne correspond à aucune fiche.' }),
        ]),
      ]);
    }

    // Nouveau brouillon seulement si l'on change de recette : sinon on repartirait
    // de zero a chaque re-rendu et la saisie serait perdue. En creation, le
    // brouillon porte un identifiant vide, ce qui le distingue de toute recette.
    if (!brouillon || brouillon.id !== (creation ? '' : id)) {
      brouillon = creation ? Rc.recetteVide() : JSON.parse(JSON.stringify(recette));
      // Section ouverte au depart : en creation il faut d'abord un titre, en
      // modification on vient le plus souvent changer le nombre de parts.
      etat.sectionEditeur = creation ? 'fiche' : 'parts';
    }

    document.title = creation
      ? 'Nouvelle recette — Miam miam !'
      : 'Modifier ' + recette.titre + ' — Miam miam !';

    var fragment = document.createDocumentFragment();

    // Barre du haut : annuler a gauche, enregistrer a droite, toujours atteignables.
    // On y va pour corriger une chose et repartir, pas pour parcourir un formulaire
    // du debut a la fin, donc les deux issues doivent rester sous la main.
    var boutonEnregistrer = el('button', {
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

            // Un titre vide rendrait la fiche introuvable dans le livre : on
            // refuse d'enregistrer plutot que de creer une recette sans nom.
            if (String(aEnregistrer.titre || '').trim() === '') {
              erreurEditeur = 'Le titre est obligatoire : sans lui, la recette serait introuvable dans le livre.';
              monter(vueEditeur(id));
              var champTitre = document.getElementById('champ-titre');
              if (champTitre) champTitre.focus();
              return;
            }
            erreurEditeur = null;

            var envoi = creation ? Rc.creer(aEnregistrer) : Rc.enregistrer(aEnregistrer);

            envoi
              .then(function (enregistree) {
                // On ne quitte l'editeur que si l'enregistrement a reellement abouti :
                // sinon l'utilisateur croirait son travail sauvegarde alors qu'il ne
                // survivrait pas au prochain rafraichissement.
                if (Rc.etatChargement().erreur) {
                  brouillon = aEnregistrer;
                  monter(vueEditeur(id));
                  var noeud = document.getElementById('erreur-recettes');
                  if (noeud) noeud.scrollIntoView({ block: 'center' });
                  return;
                }
                brouillon = null;
                window.location.hash = '#/recette/' + (creation ? enregistree.id : id);
              })
              .catch(function (erreur) {
                erreurEditeur = erreur.message;
                monter(vueEditeur(id));
              });
          },
        });

    var boutonAnnuler = el('button', {
          type: 'button',
          class: 'lien-action',
          id: 'annuler',
          texte: '‹ Annuler',
          onclick: function () {
            brouillon = null;
            erreurEditeur = null;
            window.location.hash = creation ? '#/livre' : '#/recette/' + id;
          },
        });

    fragment.appendChild(
      el('div', { class: 'barre-editeur' }, [
        boutonAnnuler,
        el('h1', { class: 'barre-editeur__titre', texte: creation ? 'Nouvelle recette' : 'Modifier la recette' }),
        boutonEnregistrer,
      ])
    );

    var bandeau = bandeauErreurRecettes();
    if (bandeau) fragment.appendChild(bandeau);

    // Actions rares et lourdes de conséquence : à part, en bas de page, et jamais
    // dans la barre du haut à côté d'« Enregistrer ».
    var actionsRares = el('div', { class: 'actions-rares' }, [
        // Une recette du carnet d'origine se retablit, une recette ajoutee se
        // supprime : ce ne sont pas les memes gestes et ils ne portent pas le meme
        // risque, donc pas le meme bouton.
        !creation && Rc.estAjoutee(id)
          ? el('button', {
              type: 'button',
              class: 'bouton bouton--danger',
              id: 'supprimer-recette',
              texte: 'Supprimer cette recette',
              onclick: function () {
                ouvrirVoile('Supprimer « ' + recette.titre + ' » ?', function (fermer) {
                  return [
                    el('p', {
                      class: 'boite__intro',
                      texte:
                        'Cette recette a été ajoutée depuis l’application : la supprimer l’enlève pour tout le monde, et il n’y a pas de version d’origine à rétablir.',
                    }),
                    el('div', { class: 'boite__actions' }, [
                      el('button', {
                        type: 'button',
                        class: 'bouton bouton--danger',
                        id: 'confirmer-suppression',
                        texte: 'Supprimer',
                        onclick: function () {
                          Rc.supprimer(id)
                            .then(function () {
                              return Sm.retirerRecette(id);
                            })
                            .then(function () {
                              brouillon = null;
                              fermer();
                              window.location.hash = '#/livre';
                            })
                            .catch(function (erreur) {
                              erreurEditeur = erreur.message;
                              fermer();
                              monter(vueEditeur(id));
                            });
                        },
                      }),
                      el('button', { type: 'button', class: 'bouton bouton--secondaire', texte: 'Annuler', onclick: fermer }),
                    ]),
                  ];
                });
              },
            })
          : null,
        !creation && Rc.estModifiee(id) && !Rc.estAjoutee(id)
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
      ]);

    if (erreurEditeur) {
      fragment.appendChild(
        el('div', { class: 'etat-erreur etat-erreur--compact', id: 'erreur-editeur' }, [
          el('p', { texte: erreurEditeur }),
        ])
      );
    }

    // --- Accordeon ------------------------------------------------------------
    //
    // Une seule section ouverte a la fois, les autres reduites a un resume d'une
    // ligne. On vient corriger une quantite, changer le nombre de parts ou ajouter
    // une photo : derouler six sections a chaque fois pour en modifier une n'aide
    // personne. Les pilules du haut sautent directement a la bonne.

    var nbLignesIngredients = brouillon.ingredients.reduce(function (n, g) {
      return n + g.items.length;
    }, 0);
    var nbGroupesNommes = brouillon.ingredients.filter(function (g) {
      return g.groupe && String(g.groupe).trim() !== '';
    }).length;

    var sections = [
      {
        cle: 'photo',
        titre: 'Photo',
        resume: creation ? 'après le premier enregistrement' : Ph.aUnePhoto(id) ? 'une photo' : 'aucune photo',
        contenu: function () {
          return creation
            ? el('p', {
                class: 'section__soustitre',
                texte:
                  'La photo pourra être ajoutée après le premier enregistrement : elle est rangée sous l’identifiant de la recette, qui n’existe pas encore.',
              })
            : blocPhoto(id);
        },
      },
      {
        cle: 'parts',
        titre: 'Nombre de parts',
        resume: brouillon.portions,
        contenu: function () {
          return blocPortions(id);
        },
      },
      {
        cle: 'fiche',
        titre: 'Fiche',
        resume: [brouillon.titre || 'sans titre', brouillon.categorie, difficulteCourte(brouillon.difficulte)]
          .filter(Boolean)
          .join(', '),
        contenu: function () {
          return blocFiche();
        },
      },
      {
        cle: 'temps',
        titre: 'Temps',
        resume: brouillon.temps.total ? brouillon.temps.total + ' au total' : 'non indiqué',
        contenu: function () {
          return blocTemps();
        },
      },
      {
        cle: 'ingredients',
        titre: 'Ingrédients',
        sousTitre: 'Le rayon indiqué à droite est déduit du nom.',
        resume:
          nbLignesIngredients +
          (nbLignesIngredients > 1 ? ' lignes' : ' ligne') +
          (nbGroupesNommes > 0 ? ', ' + nbGroupesNommes + (nbGroupesNommes > 1 ? ' groupes' : ' groupe') : ''),
        contenu: function () {
          return blocIngredients(id);
        },
      },
      {
        cle: 'instructions',
        titre: 'Préparation',
        resume:
          brouillon.instructions.length + (brouillon.instructions.length > 1 ? ' étapes' : ' étape'),
        contenu: function () {
          return blocInstructions(id);
        },
      },
    ];

    function ouvrirSection(cle) {
      etat.sectionEditeur = cle;
      monter(vueEditeur(id));
      var ouverte = document.querySelector('.section-pliee--ouverte');
      if (ouverte) ouverte.scrollIntoView({ block: 'nearest' });
    }

    fragment.appendChild(
      el(
        'div',
        { class: 'raccourcis-editeur', role: 'group', 'aria-label': 'Sections de la recette' },
        sections.map(function (bloc) {
          var actif = etat.sectionEditeur === bloc.cle;
          return el('button', {
            type: 'button',
            class: 'pilule',
            'aria-pressed': actif ? 'true' : 'false',
            'data-section': bloc.cle,
            texte: bloc.titre,
            onclick: function () {
              ouvrirSection(bloc.cle);
            },
          });
        })
      )
    );

    sections.forEach(function (bloc) {
      var ouverte = etat.sectionEditeur === bloc.cle;

      if (!ouverte) {
        fragment.appendChild(
          el('button', {
            type: 'button',
            class: 'section-pliee',
            'data-section-pliee': bloc.cle,
            onclick: function () {
              ouvrirSection(bloc.cle);
            },
          }, [
            el('span', { class: 'section-pliee__titre', texte: bloc.titre }),
            el('span', { class: 'section-pliee__resume', texte: bloc.resume }),
            icone('fleche', { taille: 16 }),
          ])
        );
        return;
      }

      fragment.appendChild(
        el('section', { class: 'section section-pliee--ouverte', 'data-section-ouverte': bloc.cle }, [
          el('h2', { class: 'section__titre', texte: bloc.titre }),
          bloc.sousTitre ? el('p', { class: 'section__soustitre', texte: bloc.sousTitre }) : null,
          bloc.contenu(),
        ])
      );
    });

    // Bloc vide pour une recette d'origine non modifiee : ni retablissement ni
    // suppression a proposer. Un filet horizontal sans rien dessous serait du bruit.
    if (actionsRares.childNodes.length > 0) fragment.appendChild(actionsRares);

    return fragment;
  }

  /** Champs d'identite de la recette. */
  function blocFiche() {
    return el('div', {}, [
        ligneChamp(
          'Titre',
          champ(brouillon.titre, function (valeur) {
            brouillon.titre = valeur;
          }, { libelle: 'Titre de la recette', id: 'champ-titre' })
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
      ]);
  }

  /** Les quatre durees de la recette. */
  function blocTemps() {
    return el(
      'div',
      {},
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
    );
  }

  /* --- routage par ancre --------------------------------------------------- */

  function router() {
    var ancre = window.location.hash.replace(/^#/, '');

    // Changer d'ecran ferme la boite ouverte : la laisser par-dessus la vue
    // suivante donnerait une boite qui parle d'un ecran qu'on a quitte.
    fermerVoile();

    // Chaque ecran est annonce une fois, en une phrase. `document.title` est pose par
    // la vue elle-meme, il faut donc l'annoncer apres le montage et non avant.
    var afficher = function (noeud, complement) {
      monter(noeud);
      window.scrollTo(0, 0);
      annoncer(document.title.replace(' — Miam miam !', '') + (complement ? ', ' + complement : ''));
    };

    if (ancre === '/recette/nouvelle') {
      afficher(vueEditeur(null));
      return;
    }
    if (ancre.indexOf('/recette/') === 0) {
      var reste = ancre.slice('/recette/'.length);
      var modification = reste.match(/^(.*)\/modifier$/);
      if (modification) {
        afficher(vueEditeur(decodeURIComponent(modification[1])));
        return;
      }
      // On quitte l'editeur : le brouillon non enregistre n'a plus lieu d'etre.
      brouillon = null;
      erreurEditeur = null;
      etatPhoto = { message: null, erreur: null, enCours: false };
      afficher(vueRecette(decodeURIComponent(reste)));
      return;
    }
    if (ancre === '/liste-de-courses/magasin') {
      var aPrendre = nbArticlesRestants();
      afficher(
        vueMagasin(),
        aPrendre === 0 ? 'rien à prendre' : aPrendre + (aPrendre > 1 ? ' articles à prendre' : ' article à prendre')
      );
      return;
    }
    if (ancre === '/liste-de-courses') {
      var restants = nbArticlesRestants();
      afficher(
        vueListeDeCourses(),
        restants === 0 ? 'rien à prendre' : restants + (restants > 1 ? ' articles à prendre' : ' article à prendre')
      );
      return;
    }
    if (ancre === '/livre') {
      document.title = 'Le livre de cuisine — Miam miam !';
      afficher(vueLivre(), Rc.toutes().length + ' recettes');
      return;
    }

    afficher(vueAccueil());
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

  /* --- reactions aux changements de donnees --------------------------------- */

  function surEcranListe() {
    return window.location.hash.replace(/^#/, '') === '/liste-de-courses';
  }

  /**
   * Un rafraichissement peut survenir pendant que l'utilisateur tape dans le champ
   * d'ajout : re-rendre effacerait sa saisie. On saute donc le re-rendu tant qu'un
   * champ a le focus.
   */
  function saisieEnCours() {
    var actif = document.activeElement;
    if (!actif) return false;
    return actif.tagName === 'INPUT' || actif.tagName === 'TEXTAREA';
  }

  function surChangementListe() {
    majChrome();
    if (surEcranListe() && !saisieEnCours()) monter(vueListeDeCourses());
    // Le mode magasin suit lui aussi : un article coche par quelqu'un d'autre doit
    // disparaitre de l'ecran de celui qui pousse le caddie.
    if (routeCourante() === '/liste-de-courses/magasin') monter(vueMagasin());
    // L'accueil annonce le nombre d'articles restants : il doit suivre. On ne
    // re-rend pas pendant une saisie, ni quand une boite est ouverte : le re-rendu
    // remplacerait la vue sous la boite et perdrait les cases deja decochees.
    if (routeCourante() === '/' && !saisieEnCours() && !voile) monter(vueAccueil());
  }

  function surChangementSemainier() {
    if (saisieEnCours() || voile) return;
    var route = routeCourante();
    if (route === '/') monter(vueAccueil());
    // Le livre affiche le compteur de realisations, qui est lu dans le semainier :
    // il doit suivre, sinon un rafraichissement des menus laisse des compteurs
    // perimes sur les cartes.
    else if (route === '/livre') monter(vueLivre());
  }

  function surChangementPhotos() {
    if (voile || saisieEnCours()) return;
    var route = routeCourante();
    if (route === '/') monter(vueAccueil());
    else if (route === '/livre') monter(vueLivre());
  }

  /**
   * Ouvre les replis avant l'impression, les referme apres.
   *
   * Une fiche imprimee doit etre complete : un depli referme y perdrait les temps,
   * l'origine, le deroule et la source. Le CSS ne peut pas le faire, le navigateur
   * masquant le contenu d'un <details> ferme par un mecanisme que `display` ne
   * touche pas. On ne referme que ce qu'on a ouvert, pour ne pas replier ce que
   * l'utilisateur avait deplie lui-meme.
   */
  function brancherImpression() {
    var ouvertsParNous = [];

    window.addEventListener('beforeprint', function () {
      ouvertsParNous = [];
      Array.prototype.forEach.call(document.querySelectorAll('details'), function (depli) {
        if (!depli.open) {
          depli.open = true;
          ouvertsParNous.push(depli);
        }
      });
    });

    window.addEventListener('afterprint', function () {
      ouvertsParNous.forEach(function (depli) {
        depli.open = false;
      });
      ouvertsParNous = [];
    });
  }

  /**
   * Tirer la page vers le bas pour rafraichir, sur mobile.
   *
   * Remplace le bouton, qui n'a plus sa place sur un ecran etroit : le geste est la
   * convention des applications, et il ne coute aucun pixel. Trois garde-fous, chacun
   * pour un faux declenchement constate sur ce genre d'implementation :
   *   - le geste ne part que si la page est deja tout en haut, sinon on empeche un
   *     defilement normal vers le haut ;
   *   - un seul doigt, pour ne pas confondre avec un pincement de zoom ;
   *   - un mouvement plus vertical qu'horizontal, pour ne pas capturer un balayage.
   *
   * Aucun `preventDefault` sur le toucher : le defilement natif reste maitre, on ne
   * fait que lire le geste et afficher un indicateur.
   */
  function brancherTirerPourRafraichir() {
    var SEUIL = 70; // pixels de traction avant declenchement
    var depart = null;
    var indicateur = null;

    function poserIndicateur() {
      if (indicateur) return indicateur;
      indicateur = el('div', { class: 'tirage', id: 'tirage', 'aria-hidden': 'true' }, [
        icone('fleche', { taille: 18 }),
        el('span', { class: 'tirage__texte', texte: 'Tirer pour mettre à jour' }),
      ]);
      document.body.appendChild(indicateur);
      return indicateur;
    }

    function effacer() {
      depart = null;
      if (indicateur) indicateur.classList.remove('tirage--visible', 'tirage--prete');
    }

    document.addEventListener(
      'touchstart',
      function (evenement) {
        if (evenement.touches.length !== 1) return;
        if (window.scrollY > 0) return;
        if (voile) return; // une boite est ouverte : le geste lui appartient
        depart = { y: evenement.touches[0].clientY, x: evenement.touches[0].clientX };
      },
      { passive: true }
    );

    document.addEventListener(
      'touchmove',
      function (evenement) {
        if (!depart || evenement.touches.length !== 1) return;
        var dy = evenement.touches[0].clientY - depart.y;
        var dx = Math.abs(evenement.touches[0].clientX - depart.x);
        if (dy <= 0 || dx > Math.abs(dy)) {
          effacer();
          return;
        }
        var noeud = poserIndicateur();
        noeud.classList.add('tirage--visible');
        noeud.classList.toggle('tirage--prete', dy >= SEUIL);
        noeud.querySelector('.tirage__texte').textContent =
          dy >= SEUIL ? 'Relâcher pour mettre à jour' : 'Tirer pour mettre à jour';
      },
      { passive: true }
    );

    document.addEventListener(
      'touchend',
      function (evenement) {
        if (!depart) return;
        var fin = evenement.changedTouches && evenement.changedTouches[0];
        var dy = fin ? fin.clientY - depart.y : 0;
        var declenche = dy >= SEUIL;
        effacer();
        if (!declenche) return;

        var noeud = poserIndicateur();
        noeud.classList.add('tirage--visible');
        noeud.querySelector('.tirage__texte').textContent = 'Mise à jour…';
        rafraichirTout().then(function () {
          noeud.classList.remove('tirage--visible');
        });
      },
      { passive: true }
    );
  }

  /**
   * Enregistre le service worker, qui rend le carnet consultable hors ligne.
   *
   * Echouer ici n'est pas grave : le carnet fonctionne exactement comme avant, il
   * demande simplement le reseau au premier chargement. On ne previent donc de rien.
   *
   * Le service worker n'est enregistre que sur http(s) : ouvert par un double-clic
   * (file://), l'API n'existe pas, et sur un serveur de test local elle existe mais
   * mettrait en cache des fichiers de test.
   */
  function brancherHorsLigne() {
    if (!('serviceWorker' in navigator)) return;
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {
        /* hors ligne indisponible : le carnet fonctionne, il demande le reseau */
      });
    });
  }

  function demarrer() {
    brancherHorsLigne();
    brancherImpression();
    brancherTirerPourRafraichir();
    // Le bouton d'en-tete porte l'age de la donnee : il doit vieillir tout seul,
    // sinon il affiche « à l'instant » une heure durant. Aucun reseau, juste du texte.
    setInterval(majAgeEntete, INTERVALLE_AGE);
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

        // Une seule lecture, au chargement. Il n'y a plus de sondage periodique :
        // la mise a jour passe par le bouton « Rafraichir » de chaque ecran. Voir
        // l'arithmetique des lectures Firestore dans storage.js.
        S.surChangement(surChangementListe);
        S.initialiser();

        Sm.surChangement(surChangementSemainier);
        Sm.initialiser();

        // Le placard est lu une fois, comme le reste. S'il est inaccessible (regles
        // non publiees), le carnet fonctionne sans : aucun ingredient n'est ecarte.
        Pl.initialiser();

        // Les recettes modifiees sont relues une fois, au chargement. Elles changent
        // trop rarement pour justifier un sondage permanent.
        Rc.rafraichir().then(function () {
          router();
        });

        // Les vignettes sont relues une fois, comme les recettes : une photo change
        // encore plus rarement qu'une recette, et chaque lecture pese lourd.
        Ph.surChangement(surChangementPhotos);
        // Demarrage a chaud : la copie durable (IndexedDB) s'affiche avant que
        // Firestore ait repondu. Elle ne remplace jamais ce qui vient du serveur.
        Ph.initialiser();
        Ph.rafraichirVignettes()
          .then(function () {
            router();
          })
          .catch(function () {
            // Photos illisibles (regles non republiees, hors ligne) : le carnet
            // fonctionne sans, les cases affichent l'aplat de categorie.
          });
      })
      .catch(function (erreur) {
        afficherErreurChargement(erreur.message);
      });
  }

  demarrer();
})();
