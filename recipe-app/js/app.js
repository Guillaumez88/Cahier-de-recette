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
  var Imp = window.CarnetImport;
  var Pt = window.CarnetPartage;
  var Lv = window.CarnetLivres;
  var VBib = window.CarnetVueBibliotheque;
  var MPdf = window.CarnetMenuPdf;
  var Ill = window.CarnetIllustrations;
  var Acc = window.CarnetAcces;

  /**
   * Vrai si cet appareil peut modifier le carnet. Voir js/acces.js : le vrai verrou
   * est dans les règles Firestore, celui-ci décide seulement de ce qui s'affiche.
   */
  function peutModifier() {
    return Acc.peutModifier();
  }

  /** Le nœud si l'appareil peut modifier, rien sinon. Sert à retirer un bouton. */
  function siMaison(noeud) {
    return peutModifier() ? noeud : null;
  }

  var criteresVides = L.criteresVides;
  var origineCourte = L.origineCourte;
  var difficulteCourte = L.difficulteCourte;
  var stripTipPrefix = L.stripTipPrefix;
  var TRANCHES_TEMPS = L.TRANCHES_TEMPS;
  var optionsDisponibles = L.optionsDisponibles;
  var filterRecipes = L.filterRecipes;
  var isFlowTableInformative = L.isFlowTableInformative;
  var largeurGrille = L.largeurGrille;
  var lignesNutrition = L.lignesNutrition;

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
    // Bibliotheque : le theme filtre et la recherche qui traverse tous les livres.
    // `livreCourant` sert a remettre les filtres a zero quand on change de source de
    // recettes : un filtre « Dessert » herite du livre de cuisine masquerait tout
    // dans un livre de plats, avec une puce qui n'y est meme pas proposee.
    themeBiblio: null,
    rechercheBiblio: '',
    livreCourant: null,
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
    { href: '#/bibliotheque', route: '/bibliotheque', icone: 'bibliotheque', libelle: 'Bibliothèque' },
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

  /**
   * Change d'etagere : le livre de cuisine, ou un livre de la bibliotheque.
   *
   * Les filtres sont remis a zero au passage. Sans cela, un filtre « Dessert » herite
   * du livre de cuisine masquerait tout dans un livre de plats, avec une puce qui n'y
   * est meme pas proposee : l'ecran paraitrait vide sans qu'on voie pourquoi.
   */
  function changerDeLivre(idLivre) {
    if (etat.livreCourant === idLivre) return;
    etat.livreCourant = idLivre;
    etat.criteres = criteresVides();
  }

  /** Relit la liste et les menus, puis re-rend l'ecran courant. */
  function rafraichirTout() {
    var apres = function () {
      majChrome();
      var route = routeCourante();
      if (route === '/') monter(vueAccueil());
      else if (route === '/liste-de-courses') monter(vueListeDeCourses());
      else if (route === '/livre') monter(vueLivre(null));
      else if (route === '/bibliotheque') monter(vueBibliotheque());
      else if (route.indexOf('/bibliotheque/') === 0) router();
    };
    return Promise.all([S.rafraichir(), Sm.rafraichir(), Lv.rafraichir()]).then(apres, apres);
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

    /* Une sous-page garde sa destination allumee : sur le livre « Ferrandi », c'est
       toujours la bibliotheque qu'on parcourt. La racine est exclue du prefixe, sinon
       elle serait active partout. */
    function estActive(destination) {
      if (route === destination) return true;
      return destination !== '/' && route.indexOf(destination + '/') === 0;
    }

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
            class: 'bouton-entete' + (estActive(d.route) ? ' bouton-entete--actif' : ''),
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
            class: 'onglet' + (estActive(d.route) ? ' onglet--actif' : ''),
            href: d.href,
            'aria-current': estActive(d.route) ? 'page' : null,
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

  /**
   * Retire l'ecran de demarrage, une fois.
   *
   * Appele au premier montage d'ecran : c'est le seul moment ou l'on sait que la page
   * a quelque chose a montrer. La feuille de style le retire de toute facon au bout de
   * quatre secondes, meme si aucun script ne tourne.
   */
  var demarrageRetire = false;
  function retirerDemarrage() {
    if (demarrageRetire) return;
    demarrageRetire = true;
    var ecran = document.getElementById('demarrage');
    if (ecran) ecran.classList.add('demarrage--parti');
  }

  function monter(noeud) {
    var vue = document.getElementById('vue');
    vue.textContent = '';
    vue.appendChild(noeud);
    // Une classe posee puis retiree au tour suivant : elle rejoue l'entree de l'ecran
    // a chaque navigation, ce qu'une animation CSS seule ne ferait qu'au chargement.
    vue.classList.remove('vue--entre');
    void vue.offsetWidth;
    vue.classList.add('vue--entre');
    majChrome();
    retirerDemarrage();
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

    var classes = ['creneau', 'creneau--' + moment.taille, 'creneau--' + moment.cle];
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
   * Le petit-dejeuner est-il masque, pour cette semaine et ce jour ?
   *
   * C'est le repas le moins souvent prevu, et des cases vides en tete de grille
   * repoussaient le dejeuner et le diner, qui sont ce qu'on vient lire. Il reparait
   * en mode Modifier, ou il faut bien pouvoir en poser un, et le jour ou il porte
   * quelque chose.
   *
   * La decision se prend **jour par jour**. Sur la grille de bureau, chaque jour est
   * une colonne : masquer la case du lundi seul decalerait son dejeuner d'une ligne
   * par rapport a celui du mardi. La feuille de style l'evite en donnant a chaque
   * creneau sa ligne fixe (classe `creneau--<moment>`), si bien qu'une case absente
   * laisse sa place vide au lieu de tirer les suivantes vers le haut.
   *
   * La ligne entiere disparait quand aucun jour de la semaine ne porte de
   * petit-dejeuner : sans cela, une bande vide subsisterait en haut de la grille.
   */
  function ligneMatinVisible(sem, index, editable) {
    if (editable) return true;
    return (sem.jours || []).some(function (jour) {
      return (index[Sem.cleCreneau(jour.cle, 'petit-dejeuner')] || []).length > 0;
    });
  }

  /** Les creneaux a afficher pour un jour donne. */
  function momentsDuJour(jour, index, editable, ligneMatin) {
    return Sem.MOMENTS.filter(function (moment) {
      if (moment.cle !== 'petit-dejeuner') return true;
      if (editable) return true;
      if (!ligneMatin) return false;
      return (index[Sem.cleCreneau(jour.cle, moment.cle)] || []).length > 0;
    });
  }

  function blocSemaine(sem, estCourante) {
    var index = Sm.parCreneau();
    var editable = Boolean(etat.modeEdition) && peutModifier();
    var ligneMatin = ligneMatinVisible(sem, index, editable);

    return el('section', { class: 'semaine' + (estCourante ? ' semaine--courante' : ''), 'data-semaine': sem.cle }, [
      el('header', { class: 'semaine__entete' }, [
        el('h3', { class: 'semaine__titre' }, [
          icone('calendrier', { taille: 18 }),
          el('span', { texte: estCourante ? 'Cette semaine' : 'Semaine suivante' }),
        ]),
        el('span', { class: 'semaine__dates', texte: sem.libelle }),
        siMaison(el('button', {
          type: 'button',
          class: 'bouton bouton--sobre',
          'data-courses-semaine': sem.cle,
          onclick: function () {
            ouvrirCoursesSemaine(sem);
          },
        }, [icone('panier', { taille: 16 }), el('span', { texte: 'Ajouter aux courses' })])),
        // Le menu sur papier. Chaque semaine a son bouton : ce sont deux feuilles
        // differentes, et proposer un choix de semaine dans une boite pour deux
        // valeurs serait une etape de plus pour rien.
        el('button', {
          type: 'button',
          class: 'bouton bouton--sobre',
          id: estCourante ? 'pdf-semaine' : null,
          'data-pdf-semaine': sem.cle,
          title: 'Le menu de cette semaine en PDF, à imprimer',
          onclick: function () {
            telechargerMenuPdf(sem);
          },
        }, [icone('feuille', { taille: 16 }), el('span', { texte: 'PDF' })]),
        // Un seul interrupteur pour tout l'accueil, pas un par semaine : les cases a
        // « + » et la reserve de plats apparaissent ou disparaissent ensemble.
        siMaison(el('button', {
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
        ])),
      ]),
      el(
        'div',
        { class: 'grille-semaine' + (ligneMatin ? '' : ' grille-semaine--sans-matin') },
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
              momentsDuJour(jour, index, editable, ligneMatin).map(function (moment) {
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
        : filterRecipes(Rc.duLivreDeCuisine(), Object.assign(criteresVides(), { recherche: recherche })).filter(function (r) {
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
  /** Icone du moment de la journee, pour l'entete d'une carte. */
  var ICONE_MOMENT = { 'petit-dejeuner': 'petit-dejeuner', dejeuner: 'dejeuner', diner: 'diner' };

  /**
   * Un plat, tel qu'il apparait dans le bloc du jour.
   * `grand` distingue les cartes du dejeuner et du diner de la ligne du matin.
   */
  function platDuJour(jour, moment, plat, grand) {
    var recette = plat.type === Sm.TYPE_RECETTE ? Rc.parId(plat.recetteId) : null;

    var marque = recette
      ? vignetteOuMarque(recette, grand ? 'vignette--repas' : 'vignette--creneau', grand ? 22 : 15)
      : el('span', { class: classeCategorie('marque-plat', 'Plat') }, [
          icone(iconeRepasLibre(plat.titre), { taille: grand ? 22 : 15 }),
        ]);

    var titre = recette
      ? el('a', { class: 'repas-jour__lien', href: '#/recette/' + recette.id, texte: recette.titre })
      : el('span', { texte: plat.titre });

    // La meta ne s'affiche que sur les cartes : sur la ligne du matin elle prendrait
    // plus de place que le nom du plat.
    var meta =
      grand && recette
        ? el('span', { class: 'repas-carte__meta', texte: recette.temps.total + ' · ' + recette.portions })
        : null;

    var croix = el('button', {
      type: 'button',
      class: 'bouton-icone bouton-icone--discret',
      'data-retirer-jour': plat.cle,
      'aria-label': 'Retirer ' + plat.titre + ' du ' + moment.libelle,
      onclick: function () {
        retirerPlat(plat);
      },
    }, [icone('croix', { taille: 15 })]);

    // Sur une carte, la photo est un bandeau au-dessus, et le nom occupe sa propre
    // ligne : marque, nom et croix sur une seule ligne obligeaient le nom a passer
    // dessous des qu'il depassait, ce qui laissait le pictogramme seul en tete.
    if (grand) {
      var photo = recette ? vignetteRecette(recette, 'vignette--repas') : null;
      return el('div', { class: 'repas-jour__titre', 'data-plat-jour': plat.cle }, [
        photo,
        el('div', { class: 'repas-carte__ligne' }, [
          recette
            ? el('span', { class: classeCategorie('marque-plat', recette.categorie) }, [
                icone(Ic.pourCategorie(recette.categorie), { taille: 16 }),
              ])
            : el('span', { class: classeCategorie('marque-plat', 'Plat') }, [
                icone(iconeRepasLibre(plat.titre), { taille: 16 }),
              ]),
          el('span', { class: 'repas-jour__texte' }, [titre, meta]),
          croix,
        ]),
      ]);
    }

    return el('div', { class: 'repas-jour__titre', 'data-plat-jour': plat.cle }, [
      marque,
      el('span', { class: 'repas-jour__texte' }, [titre, meta]),
      croix,
    ]);
  }

  /**
   * Bloc « Aujourd'hui », les repas du jour.
   *
   * Le dejeuner et le diner sont deux cartes, cote a cote sur grand ecran : ce sont
   * les repas qu'on cuisine, et une liste de trois lignes identiques ne disait pas
   * lequel demandait de s'y mettre. Le petit-dejeuner reste une ligne d'appoint, et
   * disparait quand il ne porte rien, comme dans la grille.
   */
  function blocAujourdhui(sem) {
    var jour = null;
    (sem.jours || []).forEach(function (j) {
      if (j.estAujourdhui) jour = j;
    });
    if (!jour) return null;

    var index = Sm.parCreneau();

    function carte(moment) {
      var plats = index[Sem.cleCreneau(jour.cle, moment.cle)] || [];
      var grand = moment.taille === 'haute';

      var contenu =
        plats.length === 0
          ? [el('span', { class: 'repas-jour__vide', texte: 'Rien de prévu' })]
          : plats.map(function (plat) {
              return platDuJour(jour, moment, plat, grand);
            });

      var ajout = el('button', {
        type: 'button',
        class: 'bouton-icone',
        'data-modifier-jour': moment.cle,
        'aria-label': 'Ajouter un plat au ' + moment.libelle + ' du ' + jour.libelle,
        onclick: function () {
          ouvrirSelecteurCreneau(jour, moment);
        },
      }, [icone('plus', { taille: 18 })]);

      var classes = ['repas-jour', grand ? 'repas-carte' : 'repas-ligne'];
      if (plats.length === 0) classes.push('repas-jour--vide');

      if (!grand) {
        return el('div', { class: classes.join(' '), 'data-repas-jour': moment.cle }, [
          el('span', { class: 'repas-jour__moment' }, [
            icone(ICONE_MOMENT[moment.cle] || 'marmite', { taille: 15 }),
            el('span', { texte: moment.libelle }),
          ]),
          el('span', { class: 'repas-jour__plats' }, contenu),
          ajout,
        ]);
      }

      return el('div', { class: classes.join(' '), 'data-repas-jour': moment.cle }, [
        el('div', { class: 'repas-carte__entete' }, [
          el('span', { class: 'repas-carte__moment' }, [
            icone(ICONE_MOMENT[moment.cle] || 'marmite', { taille: 16 }),
            el('span', { texte: moment.libelle }),
          ]),
          ajout,
        ]),
        el('div', { class: 'repas-carte__corps' }, contenu),
      ]);
    }

    var moments = Sem.MOMENTS.filter(function (moment) {
      if (moment.cle !== 'petit-dejeuner' || etat.modeEdition) return true;
      return (index[Sem.cleCreneau(jour.cle, moment.cle)] || []).length > 0;
    });

    return el('section', { class: 'aujourdhui', id: 'aujourdhui' }, [
      el('header', { class: 'aujourdhui__entete' }, [
        el('h2', { class: 'aujourdhui__titre', texte: 'Aujourd’hui' }),
        el('span', { class: 'aujourdhui__date', texte: jour.libelle }),
      ]),
      el('div', { class: 'aujourdhui__repas' }, moments.map(carte)),
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
    var recettes = Rc.duLivreDeCuisine();
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

    // Une ligne, en bas, pour dire pourquoi il n'y a aucun bouton de modification.
    // Sans elle, quelqu'un inscrit en lecture seule croirait à une panne.
    if (!peutModifier()) {
      fragment.appendChild(
        el('p', { class: 'mention-lecture' }, [
          el('span', { texte: 'Carnet en lecture seule. ' }),
          el('a', { href: '#/compte', texte: 'Mon compte' }),
        ])
      );
    }

    return fragment;
  }

  /**
   * L'écran de compte, à l'adresse #/compte.
   *
   * Trois états, et un seul visible à la fois : personne n'est connecté, quelqu'un
   * l'est et son foyer est connu, ou son compte n'appartient à aucun foyer. Il n'y a
   * plus de code : créer un compte crée son foyer, et les membres suivants sont
   * inscrits depuis #/foyer/membres par quelqu'un qui peut déjà modifier.
   *
   * `creation` bascule le premier état entre « se connecter » et « créer un foyer ».
   */
  function vueCompte(creation) {
    document.title = 'Mon compte — Miam miam !';
    var fragment = document.createDocumentFragment();
    fragment.appendChild(el('a', { class: 'retour', href: '#/', texte: '‹ Retour à l’accueil' }));

    var compte = Acc.compte();
    var message = el('p', { class: 'ecran-acces__message', id: 'acces-message' });

    function apresChangement(annonce) {
      annoncer(annonce);
      monter(vueCompte());
    }

    function boutonDeconnexion(classe) {
      return el('button', {
        type: 'button',
        class: classe,
        id: 'deconnecter',
        texte: 'Se déconnecter',
        onclick: function () {
          Acc.deconnecter();
          apresChangement('Déconnecté');
        },
      });
    }

    // --- Connecté, foyer connu : ce que ce compte peut faire, et par qui ---------
    if (compte && Acc.aUnFoyer()) {
      var modifie = peutModifier();
      fragment.appendChild(
        el('section', { class: 'ecran-acces' }, [
          el('h1', { texte: 'Connecté' }),
          el('p', {
            texte:
              compte.email +
              (modifie
                ? ' peut modifier les recettes, la liste de courses et le semainier.'
                : ' peut consulter le carnet du foyer, sans le modifier.'),
          }),
          modifie
            ? el('p', { class: 'ecran-acces__note' }, [
                el('span', { texte: 'Pour donner accès au carnet à quelqu’un du foyer : ' }),
                el('a', { href: '#/foyer/membres', id: 'lien-membres', texte: 'les membres du foyer' }),
                el('span', { texte: '.' }),
              ])
            : el('p', {
                class: 'ecran-acces__note',
                texte:
                  'Le rôle se change depuis la page des membres, par quelqu’un du foyer ' +
                  'qui peut déjà modifier.',
              }),
          el('p', {
            class: 'ecran-acces__note',
            texte:
              'Se déconnecter ne concerne que cet appareil, et rien n’est perdu : le ' +
              'carnet vit dans le foyer, pas sur le téléphone.',
          }),
          boutonDeconnexion('bouton bouton--secondaire'),
        ])
      );
      return fragment;
    }

    // --- Connecté, mais rattaché à aucun foyer ----------------------------------
    if (compte) {
      fragment.appendChild(
        el('section', { class: 'ecran-acces' }, [
          el('h1', { texte: 'Compte sans foyer' }),
          el('p', {
            texte:
              compte.email +
              ' est connecté, mais n’appartient à aucun foyer : il n’y a donc rien à ' +
              'afficher. Un membre du foyer doit l’inscrire depuis la page des membres.',
          }),
          el('p', {
            class: 'ecran-acces__note',
            texte:
              'Si c’est vous qui montez ce carnet, créer un compte neuf crée son foyer ' +
              'du même geste, avec tous les droits.',
          }),
          message,
          boutonDeconnexion('bouton bouton--secondaire'),
        ])
      );
      return fragment;
    }

    // --- Personne de connecté : se connecter, ou créer un foyer -----------------
    //
    // Deux écrans distincts, et non un seul avec trois champs : le nom du foyer ne
    // concerne que la création, et l'afficher à qui vient se connecter lui demande de
    // remplir une case dont il n'a que faire, ou pire, de deviner laquelle.
    var champEmail = el('input', {
      type: 'email',
      class: 'champ-edition',
      id: 'email-compte',
      autocomplete: 'email',
      'aria-label': 'Adresse e-mail',
      placeholder: 'Adresse e-mail',
    });
    var champMotDePasse = el('input', {
      type: 'password',
      class: 'champ-edition',
      id: 'mot-de-passe',
      autocomplete: creation ? 'new-password' : 'current-password',
      'aria-label': 'Mot de passe',
      placeholder: 'Mot de passe',
    });
    var champNomFoyer = el('input', {
      type: 'text',
      class: 'champ-edition',
      id: 'nom-foyer',
      autocomplete: 'off',
      'aria-label': 'Nom du foyer',
      placeholder: 'Nom du foyer (« Chez nous », « Rue des Lilas »…)',
    });

    function terminer(resultat) {
      if (!resultat.ok) {
        message.textContent = resultat.raison;
        if (resultat.sansFoyer) monter(vueCompte());
        return;
      }
      window.location.hash = '#/';
      router();
      annoncer(peutModifier() ? 'Connecté' : 'Connecté en lecture seule');
    }

    var champs = creation ? [champEmail, champMotDePasse, champNomFoyer] : [champEmail, champMotDePasse];

    fragment.appendChild(
      el('section', { class: 'ecran-acces' }, [
        el('h1', { texte: creation ? 'Créer un foyer' : 'Se connecter' }),
        el('p', {
          texte: creation
            ? 'Le compte que vous créez ici ouvre son propre carnet : il pourra tout ' +
              'modifier, et inscrire ensuite les autres personnes du foyer, chacune avec ' +
              'son rôle.'
            : 'Le carnet appartient à un foyer, et ne s’ouvre qu’à ses membres. Si ' +
              'quelqu’un vous a inscrit, c’est ici, avec l’adresse et le mot de passe ' +
              'qu’il vous a transmis.',
        }),
        el('form', {
          class: 'ecran-acces__forme ecran-acces__forme--colonne',
          onsubmit: function (evenement) {
            evenement.preventDefault();
            if (creation) {
              message.textContent = 'Création…';
              Acc.creerCompte(champEmail.value, champMotDePasse.value, champNomFoyer.value).then(terminer);
              return;
            }
            message.textContent = 'Connexion…';
            Acc.connecter(champEmail.value, champMotDePasse.value).then(terminer);
          },
        }, champs.concat([
          el('div', { class: 'ecran-acces__actions' }, [
            creation
              ? el('button', { type: 'submit', class: 'bouton', id: 'creer-compte', texte: 'Créer le foyer' })
              : el('button', { type: 'submit', class: 'bouton', id: 'valider-connexion', texte: 'Se connecter' }),
          ]),
        ])),
        message,
        el('button', {
          type: 'button',
          class: 'lien-action',
          id: creation ? 'revenir-connexion' : 'aller-creation',
          texte: creation ? 'J’ai déjà un compte' : 'Créer un compte et son foyer',
          onclick: function () {
            monter(vueCompte(!creation));
          },
        }),
        creation
          ? null
          : el('button', {
              type: 'button',
              class: 'lien-action',
              id: 'mot-de-passe-oublie',
              texte: 'Mot de passe oublié',
              onclick: function () {
                message.textContent = 'Envoi…';
                Acc.motDePasseOublie(champEmail.value).then(function (resultat) {
                  message.textContent = resultat.ok
                    ? 'Un courriel de réinitialisation est parti à cette adresse. Regarder aussi les indésirables.'
                    : resultat.raison;
                });
              },
            }),
      ])
    );
    return fragment;
  }

  /**
   * Les membres du foyer, à l'adresse #/foyer/membres.
   *
   * C'est la seule porte d'entrée d'un foyer : on y crée le compte de quelqu'un, avec
   * son rôle. Le mot de passe est choisi ici et se transmet de vive voix ; la personne
   * le changera par « Mot de passe oublié » si elle le souhaite.
   *
   * Le fondateur n'est ni retirable ni rétrogradable : un foyer où plus personne ne
   * peut écrire serait définitivement figé, et aucun écran ne saurait le rouvrir.
   */
  function vueMembres() {
    document.title = 'Les membres du foyer — Miam miam !';
    var fragment = document.createDocumentFragment();
    fragment.appendChild(el('a', { class: 'retour', href: '#/compte', texte: '‹ Retour au compte' }));

    var message = el('p', { class: 'ecran-acces__message', id: 'membres-message' });
    var liste = el('div', { class: 'membres__liste', id: 'membres-liste' }, [
      el('p', { class: 'membres__attente', texte: 'Lecture des membres…' }),
    ]);

    var champEmail = el('input', {
      type: 'email',
      class: 'champ-edition',
      id: 'membre-email',
      autocomplete: 'off',
      'aria-label': 'Adresse e-mail du membre',
      placeholder: 'Adresse e-mail',
    });
    var champMotDePasse = el('input', {
      type: 'text',
      class: 'champ-edition',
      id: 'membre-mot-de-passe',
      autocomplete: 'off',
      'aria-label': 'Mot de passe provisoire',
      placeholder: 'Mot de passe (six caractères au moins)',
    });
    var champRole = el('select', {
      class: 'champ-edition',
      id: 'membre-role',
      'aria-label': 'Rôle du membre',
    }, [
      el('option', { value: 'modification', texte: 'Peut modifier' }),
      el('option', { value: 'lecture', texte: 'Lecture seule' }),
    ]);

    function rafraichir() {
      Acc.membres()
        .then(function (membres) {
          liste.textContent = '';
          if (!membres.length) {
            liste.appendChild(el('p', { class: 'membres__attente', texte: 'Aucun membre lu.' }));
            return;
          }
          membres
            .slice()
            .sort(function (a, b) {
              return String(a.email || '').localeCompare(String(b.email || ''), 'fr');
            })
            .forEach(function (membre) {
              liste.appendChild(ligneMembre(membre, rafraichir, message));
            });
        })
        .catch(function (erreur) {
          liste.textContent = '';
          liste.appendChild(
            el('p', { class: 'membres__attente', texte: 'Les membres n’ont pas pu être lus : ' + erreur.message })
          );
        });
    }

    fragment.appendChild(
      el('section', { class: 'ecran-acces ecran-acces--large' }, [
        el('h1', { texte: 'Les membres du foyer' }),
        el('p', {
          texte:
            'Chaque personne du foyer a son compte. «\u00a0Peut modifier\u00a0» donne les ' +
            'mêmes droits que vous ; «\u00a0lecture seule\u00a0» laisse consulter le carnet ' +
            'sans y toucher. Tout le monde voit la même liste de courses et le même semainier.',
        }),
        liste,
        el('h2', { texte: 'Ajouter quelqu’un' }),
        el('form', {
          class: 'ecran-acces__forme ecran-acces__forme--colonne',
          onsubmit: function (evenement) {
            evenement.preventDefault();
            message.textContent = 'Création du compte…';
            Acc.ajouterMembre(champEmail.value, champMotDePasse.value, champRole.value).then(function (resultat) {
              if (!resultat.ok) {
                message.textContent = resultat.raison;
                return;
              }
              message.textContent =
                'Compte créé pour ' + resultat.membre.email + '. Lui transmettre son mot de passe.';
              champEmail.value = '';
              champMotDePasse.value = '';
              rafraichir();
            });
          },
        }, [
          champEmail,
          champMotDePasse,
          champRole,
          el('button', { type: 'submit', class: 'bouton', id: 'ajouter-membre', texte: 'Créer le compte' }),
        ]),
        message,
      ])
    );

    rafraichir();
    return fragment;
  }

  /** Une ligne de la liste des membres : l'adresse, le rôle, et de quoi les changer. */
  function ligneMembre(membre, rafraichir, message) {
    var fondateur = membre.uid === Acc.foyer();
    var moi = Acc.compte() && Acc.compte().uid === membre.uid;

    var enfants = [
      el('span', { class: 'membres__email', texte: membre.email || membre.uid }),
      el('span', {
        class: 'membres__role',
        texte: membre.role === 'modification' ? 'Peut modifier' : 'Lecture seule',
      }),
    ];
    if (fondateur) enfants.push(el('span', { class: 'membres__mention', texte: 'Fondateur du foyer' }));

    if (!fondateur) {
      enfants.push(
        el('button', {
          type: 'button',
          class: 'lien-action',
          texte: membre.role === 'modification' ? 'Passer en lecture seule' : 'Autoriser à modifier',
          onclick: function () {
            message.textContent = 'Changement du rôle…';
            Acc.changerRole(
              membre.uid,
              membre.role === 'modification' ? 'lecture' : 'modification',
              membre.email,
              membre.ajouteLe
            ).then(function (resultat) {
              message.textContent = resultat.ok ? 'Rôle modifié.' : resultat.raison;
              rafraichir();
            });
          },
        })
      );
      enfants.push(
        el('button', {
          type: 'button',
          class: 'lien-action lien-action--danger',
          texte: moi ? 'Me retirer du foyer' : 'Retirer du foyer',
          onclick: function () {
            message.textContent = 'Retrait…';
            Acc.retirerMembre(membre.uid).then(function (resultat) {
              message.textContent = resultat.ok ? 'Membre retiré.' : resultat.raison;
              rafraichir();
            });
          },
        })
      );
    }

    return el('div', { class: 'membres__ligne' }, enfants);
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
      // Le planning ne se sert que dans le livre de cuisine : une recette de la
      // bibliotheque n'y entre qu'apres avoir ete remontee. Voir recettes.js.
      var recettes = filterRecipes(Rc.duLivreDeCuisine(), Object.assign(criteresVides(), { recherche: recherche }));

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
                    siMaison(el('button', {
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
                    })),
                  ]);
                })
                .concat([
                  // Vider n'a de sens qu'a partir de deux plats : avec un seul, c'est
                  // le bouton « Retirer » de la ligne, et deux boutons pour le meme
                  // effet font hesiter.
                  actuels.length > 1 && peutModifier()
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

  /* --- vue : livre de cuisine et livre de la bibliotheque -------------------- */

  /**
   * La carte d'une recette, telle qu'elle apparait dans une grille.
   *
   * Sortie de `vueLivre` pour servir aussi a la recherche de la bibliotheque, qui
   * doit rendre exactement les memes cartes : deux dessins differents pour la meme
   * chose forceraient a se demander en quoi ils different.
   *
   * `options.origine` ajoute le nom du livre d'ou vient la recette. Utile quand la
   * grille melange plusieurs provenances, inutile a l'interieur d'un livre : la
   * repeter sur chaque carte n'apprendrait rien.
   */
  function carteRecette(recette, options) {
    var reglages = options || {};
    var livreDe = recette.livre ? Lv.parId(recette.livre) : null;

    // Pas de liseret de couleur : la pastille de categorie porte deja cette
    // information, et l'encoder deux fois n'ajoute rien. Sans photo, la carte
    // tient en texte seul, ce qui est le cas de dix-neuf recettes sur vingt.
    return el('a', { class: 'carte', href: '#/recette/' + recette.id }, [
      vignetteRecette(recette, 'vignette--carte'),
      el('span', { class: 'carte__corps' }, [
        el('span', { class: 'carte__haut' }, [
          el('span', { class: classeCategorie('etiquette', recette.categorie), texte: recette.categorie }),
          el('span', { class: 'carte__temps', texte: recette.temps.total }),
        ]),
        el('span', { class: 'carte__titre', texte: recette.titre }),
        reglages.origine && livreDe
          ? el('span', { class: 'carte__livre' }, [
              icone('livre-ferme', { taille: 13 }),
              el('span', { texte: livreDe.titre }),
            ])
          : null,
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
  }

  /** La recherche du livre, appliquee a n'importe quelle liste de recettes. */
  function chercherDans(recettes, mot) {
    return filterRecipes(recettes, Object.assign(criteresVides(), { recherche: mot }));
  }

  /**
   * Le livre de cuisine, ou un livre de la bibliotheque.
   *
   * Un seul ecran pour les deux, parce que c'est la meme chose vue depuis deux
   * etageres : la difference tient a la source des recettes, au titre et au bouton
   * d'ajout. En dupliquer deux cents lignes garantirait qu'un filtre corrige d'un cote
   * reste faux de l'autre.
   *
   * `livre` vaut null pour le livre de cuisine.
   */
  function vueLivre(livre) {
    // Les recettes affichees, et elles seules : les filtres et la recherche ne
    // portent jamais au-dela de l'etagere qu'on regarde.
    var recettes = livre ? Rc.duLivre(livre.id) : Rc.duLivreDeCuisine();
    var comptes = Sm.comptes();
    var resultats = filterRecipes(recettes, etat.criteres, comptes);
    var options = optionsDisponibles(recettes);
    var nbJamais = recettes.filter(function (r) {
      return !comptes[r.id];
    }).length;
    var fragment = document.createDocumentFragment();

    fragment.appendChild(
      livre
        ? el('a', { class: 'retour', href: '#/bibliotheque', texte: '‹ Retour à la bibliothèque' })
        : el('a', { class: 'retour', href: '#/', texte: '‹ Retour à l’accueil' })
    );

    var nbRemontees = livre
      ? recettes.filter(function (r) {
          return r.auLivre;
        }).length
      : 0;

    // La couverture, a gauche du titre. La vignette suffit : elle est deja en cache au
    // chargement, et l'afficher a 110 px n'a pas besoin des 1200 px de la grande.
    var couverture = livre ? Ph.vignette(Lv.clePhoto(livre.id)) : null;

    fragment.appendChild(
      el('div', { class: 'livre__entete' }, [
        el('div', { class: livre ? 'livre__identite' : null }, [
          couverture
            ? el('figure', { class: 'livre__couverture' }, [
                el('img', { src: couverture, alt: 'Couverture de ' + livre.titre }),
              ])
            : null,
          el('div', {}, [
          livre ? el('span', { class: 'etiquette etiquette--sobre', texte: livre.theme }) : null,
          el('h1', { class: 'fiche__titre', texte: livre ? livre.titre : 'Le livre de cuisine' }),
          el('p', {
            class: 'accroche',
            texte: livre
              ? (recettes.length === 0
                  ? 'Aucune recette rattachée à ce livre pour l’instant.'
                  : recettes.length + ' recette' + (recettes.length > 1 ? 's' : '') + ' rattachée' + (recettes.length > 1 ? 's' : '') + ' à ce livre.') +
                ' Les recettes d’un livre restent hors du planning de la semaine' +
                (nbRemontees > 0
                  ? ', sauf les ' + nbRemontees + ' remontée' + (nbRemontees > 1 ? 's' : '') + ' dans le livre de cuisine.'
                  : ' : chaque fiche propose de la remonter dans le livre de cuisine.')
              : recettes.length +
                ' recettes rassemblées, avec leurs astuces, leurs variantes et ce que leur source ne dit pas.',
          }),
          livre && livre.auteur ? el('p', { class: 'accroche', texte: livre.auteur }) : null,
          ]),
        ]),
        el('div', { class: 'livre__actions' }, [
          siMaison(el('button', {
            type: 'button',
            class: 'bouton bouton--sobre',
            id: 'importer-recette',
            onclick: function () {
              ouvrirImport(livre);
            },
          }, [icone('fleche', { taille: 16 }), el('span', { texte: 'Importer depuis un site' })])),
          siMaison(el('a', {
            class: 'bouton',
            id: 'ajouter-recette',
            href: livre ? '#/bibliotheque/' + encodeURIComponent(livre.id) + '/nouvelle' : '#/recette/nouvelle',
          }, [
            icone('plus', { taille: 18 }),
            el('span', { texte: 'Ajouter une recette' }),
          ])),
          livre && peutModifier()
            ? el('button', {
                type: 'button',
                class: 'bouton bouton--sobre',
                id: 'modifier-livre',
                onclick: function () {
                  ouvrirEditionLivre(livre);
                },
              }, [icone('crayon', { taille: 16 }), el('span', { texte: 'Modifier ce livre' })])
            : null,
          // La suppression n'est proposee que sur un livre vide : un livre garni
          // laisserait ses recettes sans etagere, donc invisibles. Le dire ici plutot
          // que de proposer un bouton qui refuse.
          livre && recettes.length === 0 && peutModifier()
            ? el('button', {
                type: 'button',
                class: 'bouton bouton--secondaire',
                id: 'supprimer-livre',
                onclick: function () {
                  supprimerLivre(livre);
                },
              }, [icone('croix', { taille: 16 }), el('span', { texte: 'Supprimer ce livre' })])
            : null,
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
            return carteRecette(recette, { origine: !livre });
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

    monter(vueLivre(etat.livreCourant ? Lv.parId(etat.livreCourant) : null));

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

  /* --- vue : la bibliotheque ------------------------------------------------ */

  function vueBibliotheque() {
    document.title = 'Bibliothèque — Miam miam !';
    return VBib.construire({
      el: el,
      icone: icone,
      Lv: Lv,
      Rc: Rc,
      Ph: Ph,
      carteRecette: function (recette) {
        return carteRecette(recette, { origine: true });
      },
      chercher: chercherDans,
      rendre: rendreBibliothequePartiel,
      annoncer: annoncer,
      surCreer: ouvrirCreationLivre,
      etat: etat,
      peutModifier: peutModifier,
    });
  }

  /* Meme precaution que pour le livre : re-rendre pendant la saisie sortirait le
     curseur du champ de recherche. */
  function rendreBibliothequePartiel() {
    var actif = document.activeElement;
    var dansRecherche = actif && actif.id === 'recherche-bibliotheque';
    var position = dansRecherche ? actif.selectionStart : null;

    monter(vueBibliotheque());

    if (!dansRecherche) return;
    var nouveau = document.getElementById('recherche-bibliotheque');
    if (!nouveau) return;
    nouveau.focus();
    if (position === null) return;
    try {
      nouveau.setSelectionRange(position, position);
    } catch (erreur) {
      /* certains types de champ n'acceptent pas setSelectionRange */
    }
  }

  /**
   * Les champs communs a la creation et a la modification d'un livre.
   *
   * `saisie` est l'objet mute au fil de la frappe, `rendre` re-rend le corps de la
   * boite. Les deux boites ont exactement les memes champs : les separer aurait
   * garanti qu'un thème corrigé d'un côté reste faux de l'autre.
   */
  function champsLivre(saisie, rendre) {
    var champTitre = el('input', {
      type: 'text',
      class: 'champ-edition',
      id: 'titre-livre',
      placeholder: 'Le grand livre de la pâtisserie',
      'aria-label': 'Titre du livre',
      oninput: function (evenement) {
        saisie.titre = evenement.target.value;
        var bouton = document.getElementById('valider-livre');
        if (bouton) bouton.disabled = saisie.titre.trim() === '';
      },
    });
    champTitre.value = saisie.titre;

    var champAuteur = el('input', {
      type: 'text',
      class: 'champ-edition',
      id: 'auteur-livre',
      placeholder: 'Auteur ou éditeur (facultatif)',
      'aria-label': 'Auteur du livre',
      oninput: function (evenement) {
        saisie.auteur = evenement.target.value;
      },
    });
    champAuteur.value = saisie.auteur;

    var champTheme = el('input', {
      type: 'text',
      class: 'champ-edition',
      id: 'theme-livre',
      placeholder: 'Thème (Pâtisserie, Plats, Boisson…)',
      'aria-label': 'Thème du livre',
      oninput: function (evenement) {
        saisie.theme = evenement.target.value;
        document.querySelectorAll('[data-theme-propose]').forEach(function (puce) {
          puce.setAttribute('aria-pressed', puce.getAttribute('data-theme-propose') === saisie.theme ? 'true' : 'false');
        });
      },
    });
    champTheme.value = saisie.theme;

    // Les themes deja utilises d'abord : un livre de plus dans un theme existant est
    // le cas courant, et retaper « Pâtisserie » a l'identique pres serait le meilleur
    // moyen de creer deux themes pour un seul.
    var proposes = Lv.themes().slice();
    Lv.THEMES_SUGGERES.forEach(function (t) {
      if (proposes.indexOf(t) === -1) proposes.push(t);
    });

    // Les libelles reprennent la forme du formulaire de recette (`ligneChamp`) : dans
    // la boite de modification, les champs sont pre-remplis, donc les indications de
    // saisie ne se voient plus et rien ne dirait ce que chaque ligne represente.
    return [
      ligneChamp('Titre du livre', champTitre),
      ligneChamp('Auteur ou éditeur', champAuteur),
      el('h3', { class: 'boite__section', texte: 'Thème' }),
      el('div', { class: 'rangee-filtre' }, proposes.map(function (t) {
        return el('button', {
          type: 'button',
          class: 'pilule',
          'data-theme-propose': t,
          'aria-pressed': saisie.theme === t ? 'true' : 'false',
          texte: t,
          onclick: function () {
            saisie.theme = t;
            rendre();
          },
        });
      })),
      champTheme,
    ];
  }

  /**
   * Boite de modification d'un livre : son titre, son auteur, son theme, sa couverture.
   *
   * **L'identifiant du livre ne change pas** avec son titre, et c'est voulu : les
   * recettes citent leur livre par cet identifiant. Le renommer obligerait a reecrire
   * toutes ses recettes, et laisserait rattachees a une etagere absente celles qui
   * auraient echoue. Un livre renomme garde donc son adresse.
   */
  function ouvrirEditionLivre(livre) {
    var saisie = { titre: livre.titre, auteur: livre.auteur || '', theme: livre.theme || '' };
    var erreur = null;
    etatPhoto = { message: null, erreur: null, enCours: false };

    function valider() {
      if (saisie.titre.trim() === '') return;
      Lv.modifier(livre.id, saisie).then(
        function () {
          var echec = Lv.etatSync().erreur;
          if (echec) {
            erreur =
              'Le changement est visible ici, mais il n’est pas encore parti vers le serveur (' +
              echec +
              '). Il repartira au retour du réseau.';
            rendreCorpsVoile(corps());
            return;
          }
          fermerVoile();
          router();
        },
        function (e) {
          erreur = e.message;
          rendreCorpsVoile(corps());
        }
      );
    }

    function corps() {
      return [
        erreur
          ? el('div', { class: 'sync sync--config', id: 'erreur-livre' }, [
              el('span', { class: 'sync__etat', texte: 'Changement non enregistré' }),
              el('p', { class: 'sync__erreur', texte: erreur }),
            ])
          : null,
      ]
        .concat(champsLivre(saisie, function () {
          rendreCorpsVoile(corps());
        }))
        .concat([
          el('h3', { class: 'boite__section', texte: 'Couverture' }),
          el('p', { class: 'apercu-import__note', texte:
            'La photo de la couverture, prise sur l’étagère : c’est ce qui permet de reconnaître ' +
            'le livre d’un coup d’œil dans la bibliothèque.' }),
          blocImage(Lv.clePhoto(livre.id), {
            nom: 'couverture',
            alt: 'Couverture de ' + livre.titre,
            libelleChoix: 'Choisir une couverture',
            motVide: 'Aucune couverture',
            motAjouter: 'Ajouter une couverture',
            motRemplacer: 'Remplacer la couverture',
            motRetirer: 'Retirer la couverture',
            motRetire: 'Couverture retirée.',
            motSucces: 'Couverture enregistrée et partagée',
            aide:
              'La photo est réduite dans le navigateur avant l’envoi : une photo de téléphone de ' +
              'plusieurs mégaoctets ne passerait pas la limite d’un document Firestore.',
            rendre: function () {
              rendreCorpsVoile(corps());
            },
          }),
          el('div', { class: 'boite__actions' }, [
            el('button', {
              type: 'button',
              class: 'bouton',
              id: 'valider-livre',
              disabled: saisie.titre.trim() === '' ? true : null,
              onclick: valider,
            }, [icone('coche', { taille: 16 }), el('span', { texte: 'Enregistrer' })]),
          ]),
        ]);
    }

    ouvrirVoile('Modifier « ' + livre.titre + ' »', corps, { large: true });
  }

  /**
   * Boite de creation d'un livre.
   *
   * Deux champs, dont un seul est obligatoire : le titre. Le theme est propose sous
   * forme de puces, plus un champ libre : la liste des themes n'est pas fermee, et
   * imposer un choix parmi six obligerait a toucher au code pour un livre de
   * conserves. La couverture s'ajoute ensuite, depuis la boite de modification : elle
   * demande de trouver le livre et de le photographier, ce qui n'a pas sa place dans
   * le geste de creation.
   */
  function ouvrirCreationLivre(themeParDefaut) {
    var saisie = { titre: '', auteur: '', theme: themeParDefaut || '' };
    var erreur = null;

    function valider() {
      if (saisie.titre.trim() === '') return;
      Lv.creer(saisie.titre, saisie.theme, saisie.auteur).then(
        function (livre) {
          var echec = Lv.etatSync().erreur;
          if (echec) {
            // Comme partout ailleurs : une promesse tenue ne prouve pas l'envoi. Le
            // livre est visible en local et la file le renverra, mais le dire.
            erreur =
              'Le livre est créé ici, mais il n’est pas encore parti vers le serveur (' +
              echec +
              '). Il repartira au retour du réseau.';
            rendreCorpsVoile(corps());
            return;
          }
          fermerVoile();
          // Le filtre et la recherche sont remis a zero : on vient de creer une
          // etagere, et la retrouver derriere un filtre herite serait absurde.
          etat.themeBiblio = null;
          etat.rechercheBiblio = '';
          window.location.hash = '#/bibliotheque/' + encodeURIComponent(livre.id);
        },
        function (e) {
          erreur = e.message;
          rendreCorpsVoile(corps());
        }
      );
    }

    function corps() {
      return [
        el('p', { class: 'accroche', texte:
          'Un livre est une étagère : vous lui rattacherez ses recettes au fur et à mesure. ' +
          'Un livre sans recette reste listé.' }),
        erreur
          ? el('div', { class: 'sync sync--config', id: 'erreur-livre' }, [
              el('span', { class: 'sync__etat', texte: 'Livre non créé' }),
              el('p', { class: 'sync__erreur', texte: erreur }),
            ])
          : null,
      ]
        .concat(champsLivre(saisie, function () {
          rendreCorpsVoile(corps());
        }))
        .concat([
          el('div', { class: 'boite__actions' }, [
            el('button', {
              type: 'button',
              class: 'bouton',
              id: 'valider-livre',
              disabled: saisie.titre.trim() === '' ? true : null,
              onclick: valider,
            }, [icone('coche', { taille: 16 }), el('span', { texte: 'Créer le livre' })]),
          ]),
        ]);
    }

    ouvrirVoile('Créer un livre', corps);
  }

  /** Supprime un livre vide, avec un retour en arriere possible. */
  function supprimerLivre(livre) {
    Lv.supprimer(livre.id, Rc.duLivre(livre.id).length).then(
      function () {
        // Idem : on revient a la grille, pas a une liste de resultats de recherche.
        etat.rechercheBiblio = '';
        window.location.hash = '#/bibliotheque';
        annoncer(livre.titre + ' supprimé');
        proposerAnnulation(livre.titre + ' supprimé', function () {
          Lv.creer(livre.titre, livre.theme, livre.auteur).then(function () {
            rendreBibliothequePartiel();
          });
        });
      },
      function (erreur) {
        ouvrirVoile('Livre non supprimé', function () {
          return [el('p', { class: 'sync__erreur', texte: erreur.message })];
        });
      }
    );
  }

  /* --- vue : fiche recette ------------------------------------------------- */

  /**
   * Le tableau des valeurs nutritionnelles, tel que la source le donne.
   *
   * Rien n'est recalcule, et surtout **rien n'est mis a l'echelle** : les valeurs sont
   * par portion et pour 100 g, deux bases qui ne dependent pas du nombre de parts.
   * Doubler la recette ne change pas ce qu'il y a dans une portion. Voir
   * L.lignesNutrition.
   *
   * Un tableau plat, sans bandeau fusionne : il doit se lire sur un telephone, ou la
   * feuille de style le fait defiler horizontalement plutot que de comprimer les
   * colonnes.
   */
  function sectionNutrition(nutrition) {
    // La premiere case de l'en-tete reste vide : elle surplombe les noms de lignes, qui
    // ne sont pas une colonne de donnees. Y ecrire un mot inventerait un intitule.
    var entete = el('tr', {}, [el('td', { class: 'nutrition__coin' })].concat(
      nutrition.colonnes.map(function (colonne) {
        return el('th', { scope: 'col', texte: colonne });
      })
    ));

    var corps = nutrition.lignes.map(function (ligne) {
      var libelle = ligne.nom + (ligne.unite ? ' (' + ligne.unite + ')' : '');
      return el('tr', { class: ligne.detail ? 'nutrition__detail' : null }, [
        el('th', { scope: 'row', texte: libelle }),
      ].concat(
        ligne.valeurs.map(function (valeur) {
          return el('td', { texte: valeur });
        })
      ));
    });

    return section('Valeurs nutritionnelles', nutrition.base || null, [
      el('div', { class: 'tableau-defilant' }, [
        el('table', { class: 'nutrition', id: 'nutrition' }, [
          el('thead', {}, [entete]),
          el('tbody', {}, corps),
        ]),
      ]),
      el('p', {
        class: 'section__soustitre',
        texte:
          'Valeurs de la source, reprises telles quelles. Elles ne suivent pas le nombre de parts : ' +
          'une portion reste une portion.',
      }),
    ]);
  }

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
        // En cuisine, l'illustration vient avant le texte : elle dit d'un coup d'œil à
        // quoi doit ressembler ce qu'on a sous les yeux.
        Ill.pour(recette.id)[String(rang + 1)]
          ? el('figure', { class: 'etape-cuisson__illustration' }, [
              el('img', {
                src: Ill.pour(recette.id)[String(rang + 1)],
                alt: 'Illustration de l’étape ' + (rang + 1),
              }),
            ])
          : null,
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

    // Les illustrations des étapes sont lues à l'ouverture de la fiche, et seulement
    // là : elles ne servent nulle part ailleurs. Une lecture par fiche consultée, une
    // seule fois, puis le re-rendu les affiche. Voir illustrations.js.
    var illustrations = Ill.pour(recette.id);
    if (!Ill.dejaLue(recette.id)) {
      Ill.charger(recette.id).then(function (table) {
        if (Object.keys(table).length === 0) return;
        if (routeCourante() === '/recette/' + recette.id) monter(vueRecette(recette.id));
      });
    }

    // Avant le mode Cuisiner, qui affiche lui aussi l'illustration de l'étape courante.
    if (Cu.mode(id) === Cu.MODE_CUISINER) return vueCuisiner(recette);

    var dansListe = recetteDansListe(getShoppingList(), recette.id);
    var fragment = document.createDocumentFragment();

    // Le retour ramene a l'etagere d'ou l'on vient : une recette de livre appartient
    // a son livre, et renvoyer au livre de cuisine ferait perdre le fil.
    var livreDeLaFiche = recette.livre ? Lv.parId(recette.livre) : null;

    fragment.appendChild(
      el('div', { class: 'fiche__barre' }, [
        livreDeLaFiche
          ? el('a', {
              class: 'retour',
              href: '#/bibliotheque/' + encodeURIComponent(livreDeLaFiche.id),
              texte: '‹ Retour à ' + livreDeLaFiche.titre,
            })
          : el('a', { class: 'retour', href: '#/livre', texte: '‹ Retour au livre' }),
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
        // D'ou vient la fiche, et si elle compte dans le planning. Deux informations
        // qu'on ne peut pas deviner en lisant la recette.
        livreDeLaFiche
          ? el('a', {
              class: 'etiquette etiquette--livre',
              href: '#/bibliotheque/' + encodeURIComponent(livreDeLaFiche.id),
            }, [icone('livre-ferme', { taille: 13 }), el('span', { texte: livreDeLaFiche.titre })])
          : null,
        livreDeLaFiche && recette.auLivre
          ? el('span', { class: 'etiquette etiquette--remontee', texte: 'dans le livre de cuisine' })
          : null,
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
        // Signale une fiche qui ne correspond plus a la source citee plus bas. Une
        // recette ajoutee ici, ou rattachee a un livre, n'a pas d'original dont elle
        // s'ecarterait : la marque y annoncerait une divergence imaginaire.
        Rc.estModifiee(id) && !Rc.estAjoutee(id)
          ? el('span', { class: 'marque-modifiee', texte: 'fiche modifiée' })
          : null,
      ])
    );

    fragment.appendChild(
      el('div', { class: 'actions-fiche' }, [
        siMaison(el('button', {
          type: 'button',
          class: 'bouton',
          texte: 'Tout ajouter à la liste',
          onclick: function () {
            addRecipeToList(recette).then(function () {
              monter(vueRecette(id));
            });
          },
        })),
        dansListe && peutModifier()
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
        // Remonter une recette de livre, c'est la rendre planifiable : c'est le seul
        // effet, et le libelle le dit plutot que de parler de visibilite.
        livreDeLaFiche && peutModifier()
          ? el('button', {
              type: 'button',
              class: 'bouton bouton--secondaire',
              id: 'basculer-livre-cuisine',
              onclick: function () {
                basculerVersLivreDeCuisine(recette, !recette.auLivre);
              },
            }, [
              icone(recette.auLivre ? 'croix' : 'livre', { taille: 16 }),
              el('span', {
                texte: recette.auLivre
                  ? 'Retirer du livre de cuisine'
                  : 'Ajouter au livre de cuisine',
              }),
            ])
          : null,
        el('button', {
          type: 'button',
          class: 'bouton bouton--secondaire',
          id: 'partager-recette',
          onclick: function () {
            ouvrirPartage(recette);
          },
        }, [icone('partager', { taille: 16 }), el('span', { texte: 'Partager' })]),
        siMaison(el('a', {
          class: 'bouton bouton--secondaire',
          id: 'modifier-recette',
          href: '#/recette/' + id + '/modifier',
          texte: 'Modifier la recette',
        })),
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
                    disabled: present || !peutModifier() ? true : null,
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
            siMaison(el('div', { class: 'actions-selection' }, [
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
            ])),
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
          recette.instructions.map(function (etape, rang) {
            // `numero` vaut parfois un libellé plutôt qu'un entier
            // (« Pour finir » dans la source des lasagnes bolognaise).
            var estEntier = typeof etape.numero === 'number';
            // L'illustration de l'étape, si elle en a une. Indexée par rang et non par
            // `numero`, qui n'est pas toujours un entier : voir illustrations.js.
            var image = illustrations[String(rang + 1)];
            // L'intitule de l'etape : son `titre` s'il en a un (les fiches HelloFresh
            // en donnent un par etape, « Top depart : on cuisine ! »), sinon le
            // `numero` quand ce n'est pas un entier. Jamais les deux : le libelle est
            // une ligne, et le numero non entier est deja un intitule.
            var libelle = etape.titre || (estEntier ? null : String(etape.numero));
            return el('li', { class: 'etape' }, [
              el('span', { class: 'etape__numero', texte: estEntier ? String(etape.numero) : '•' }),
              el('div', {}, [
                libelle ? el('p', { class: 'etape__libelle', texte: libelle }) : null,
                el('p', { class: 'etape__texte', texte: etape.texte }),
                // Apres le texte, et non avant : on lit la consigne, puis on regarde a
                // quoi cela doit ressembler. Un flottant a droite donnait une mise en
                // page irreguliere d'une etape a l'autre.
                image
                  ? el('figure', { class: 'etape__illustration' }, [
                      el('img', { src: image, alt: 'Illustration de l’étape ' + (rang + 1), loading: 'lazy' }),
                    ])
                  : null,
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

    var nutrition = lignesNutrition(recette);
    if (nutrition) contexte.appendChild(sectionNutrition(nutrition));

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
          // Le libelle enumere ce qu'il y a dedans : un depli qui ne dit pas ce qu'il
          // cache ne se deplie pas. La nutrition n'y figure que si la recette en porte.
          el('span', {
            texte:
              'Pour aller plus loin : temps, origine, déroulé, astuces, variantes, source' +
              (nutrition ? ', valeurs nutritionnelles' : ''),
          }),
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

    if (!peutModifier()) return null;
    return el('form', { class: 'ajout-libre', onsubmit: function (e) { e.preventDefault(); valider(); } }, [
      champNom,
      champQuantite,
      el('button', { type: 'submit', class: 'bouton', id: 'ajout-valider', texte: 'Ajouter' }),
    ]);
  }

  /**
   * Le bouton « Vider la liste », en deux temps.
   *
   * Premier appui : le bouton demande confirmation et le dit à voix haute pour les
   * lecteurs d'écran. Second appui dans les cinq secondes : la liste est vidée. Passé
   * ce délai, il redevient inoffensif. Pas de boîte modale : elle coûte un écran
   * entier pour une question à un mot, et la liste est reconstituable depuis les
   * recettes.
   */
  function videurDeListe(nbArticles) {
    if (nbArticles === 0) return null;
    var confirme = false;
    var minuterie = null;
    var libelle = el('span', { texte: 'Vider la liste' });

    var bouton = el('button', {
      type: 'button',
      class: 'bouton bouton--secondaire',
      id: 'vider-liste',
      onclick: function () {
        if (!confirme) {
          confirme = true;
          libelle.textContent = 'Confirmer : tout vider ?';
          annoncer('Appuyer de nouveau pour vider la liste de courses');
          minuterie = setTimeout(function () {
            confirme = false;
            if (document.body.contains(libelle)) libelle.textContent = 'Vider la liste';
          }, 5000);
          return;
        }
        if (minuterie) clearTimeout(minuterie);
        clearShoppingList().then(function () {
          annoncer('Liste de courses vidée');
          monter(vueListeDeCourses());
        });
      },
    }, [icone('croix', { taille: 16 }), libelle]);

    return bouton;
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
            siMaison(el('button', {
              type: 'button',
              class: 'lien-action',
              texte: 'Retirer',
              'aria-label': 'Retirer les ingrédients de ' + recette.titre,
              onclick: function () {
                removeRecipeFromList(recette.recetteId).then(function () {
                  monter(vueListeDeCourses());
                });
              },
            })),
          ]);
        })
      ),
    ]);
  }

  /** Une ligne de la liste : un ingredient, quantites additionnees. */
  function ligneCourses(ligne) {
    // En lecture seule, la case reste visible mais inerte : elle porte une
    // information (ce qui est déjà pris), elle n'est plus une commande.
    var caseCoche = el('input', {
      type: 'checkbox',
      checked: ligne.coche ? true : null,
      disabled: peutModifier() ? null : 'disabled',
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
      siMaison(el('button', {
        type: 'button',
        class: 'supprimer',
        texte: '×',
        'aria-label': 'Supprimer ' + ligne.nom,
        onclick: function () {
          S.removeArticles(ligne.articles).then(function () {
            monter(vueListeDeCourses());
          });
        },
      })),
    ]);
  }

  /**
   * Ce qui a empeche la derniere ecriture de recette d'aboutir, ou null.
   *
   * `recettes.js` applique la modification en local puis tente l'envoi, et **ne rejette
   * pas** quand l'envoi echoue : il enregistre l'erreur dans son etat. C'est voulu, la
   * modification reste visible et la file repartira. Mais cela veut dire qu'une
   * promesse tenue ne prouve rien : sans cette verification, un enregistrement, une
   * creation ou une suppression qui n'ont jamais atteint le serveur sont annonces
   * comme reussis, et disparaissent au prochain rafraichissement.
   *
   * Tout appel a `Rc.creer`, `Rc.enregistrer`, `Rc.supprimer` ou `Rc.reinitialiser`
   * doit donc passer par ici avant d'annoncer quoi que ce soit.
   */
  function erreurEcritureRecette() {
    return Rc.etatChargement().erreur || null;
  }

  /**
   * Remonte une recette de livre dans le livre de cuisine, ou la redescend.
   *
   * Ce qui change, et rien d'autre : elle devient (ou cesse d'etre) proposable dans
   * la semaine et dans la reserve de plats. Elle reste dans son livre dans les deux
   * cas, ce que le message d'annonce dit, parce que « retirer » pourrait s'entendre
   * comme une suppression.
   */
  function basculerVersLivreDeCuisine(recette, dedans) {
    Rc.remonter(recette.id, dedans).then(
      function () {
        var echec = erreurEcritureRecette();
        monter(vueRecette(recette.id));
        if (echec) {
          annoncer('Le changement n’a pas atteint le serveur : ' + echec);
          return;
        }
        annoncer(
          dedans
            ? recette.titre + ' est dans le livre de cuisine : elle peut aller au planning.'
            : recette.titre + ' quitte le livre de cuisine et reste dans son livre.'
        );
      },
      function (erreur) {
        annoncer(erreur.message);
      }
    );
  }

  /**
   * Boite de deplacement d'une recette d'une etagere a une autre.
   *
   * Le livre de cuisine figure dans la liste des destinations, et ce n'est pas la meme
   * chose que « Ajouter au livre de cuisine » de la fiche : celui-la remonte une recette
   * en la laissant dans son livre, celui-ci la sort de la bibliotheque. Les deux
   * libelles le disent, parce que la nuance ne se devine pas.
   *
   * Une recette du carnet d'origine n'est pas deplacable : elle vit dans le fichier
   * servi avec le site, et la ranger dans un livre la ferait reapparaitre en double au
   * prochain chargement. `Rc.deplacerVersLivre` le refuse aussi, mais la boite ne
   * propose pas ce qu'elle sait impossible.
   */
  function ouvrirDeplacement(recette) {
    var actuel = recette.livre || null;
    var erreur = null;

    function deplacer(vers) {
      Rc.deplacerVersLivre(recette.id, vers).then(
        function () {
          var echec = erreurEcritureRecette();
          if (echec) {
            erreur =
              'Le déplacement n’a pas atteint le serveur : ' + echec +
              ' La recette reviendra à sa place à la prochaine mise à jour.';
            rendreCorpsVoile(corps());
            return;
          }
          brouillon = null;
          fermerVoile();
          window.location.hash = '#/recette/' + recette.id;
          router();
          annoncer(
            vers
              ? recette.titre + ' est maintenant dans ' + (Lv.parId(vers) || {}).titre
              : recette.titre + ' est maintenant dans le livre de cuisine.'
          );
        },
        function (e) {
          erreur = e.message;
          rendreCorpsVoile(corps());
        }
      );
    }

    function destination(cle, titre, detail) {
      var ici = cle === actuel;
      return el('li', {}, [
        el('button', {
          type: 'button',
          class: 'choix-plat',
          'data-destination': cle === null ? 'livre-de-cuisine' : cle,
          disabled: ici ? true : null,
          onclick: function () {
            deplacer(cle);
          },
        }, [
          icone(cle === null ? 'livre' : 'livre-ferme', { taille: 18 }),
          el('span', { class: 'choix-plat__titre', texte: titre }),
          el('span', { class: 'choix-plat__meta', texte: ici ? 'où elle est déjà' : detail }),
        ]),
      ]);
    }

    function corps() {
      var livres = Lv.tous();

      return [
        el('p', { class: 'accroche', texte:
          'Le rattachement est la seule chose qui change : la recette, ses ingrédients, sa photo ' +
          'et son historique dans la semaine ne bougent pas.' }),
        erreur
          ? el('div', { class: 'sync sync--config', id: 'erreur-deplacement' }, [
              el('span', { class: 'sync__etat', texte: 'Déplacement refusé' }),
              el('p', { class: 'sync__erreur', texte: erreur }),
            ])
          : null,
        el(
          'ul',
          { class: 'choix-plats', id: 'destinations-livre' },
          [
            destination(
              null,
              'Le livre de cuisine',
              'elle quitte la bibliothèque et devient planifiable'
            ),
          ].concat(
            livres.map(function (l) {
              var nb = Rc.duLivre(l.id).length;
              return destination(l.id, l.titre, l.theme + ' · ' + VBib.libelleCompte(nb));
            })
          )
        ),
        livres.length === 0
          ? el('p', { class: 'boite__vide', texte:
              'La bibliothèque n’a encore aucun livre : créez-en un depuis l’écran « Bibliothèque ».' })
          : null,
      ];
    }

    ouvrirVoile('Déplacer « ' + recette.titre + ' »', corps);
  }

  /* --- partage d'une recette ------------------------------------------------ */

  /**
   * Copie un texte dans le presse-papiers. Rend une promesse de booleen.
   *
   * Trois chemins, du plus propre au plus vieux, parce que le premier n'existe pas
   * partout : `navigator.clipboard` demande un contexte securise (https, ou
   * localhost) et le carnet peut tourner ailleurs. `execCommand('copy')` est
   * officiellement obsolete mais reste implemente partout, et c'est le seul repli
   * possible sans dependance. La zone de texte est posee hors ecran, jamais dans le
   * flux, sinon la page sauterait a chaque copie.
   */
  function copierDansPressePapiers(texte) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(texte).then(
        function () {
          return true;
        },
        function () {
          return copierParSelection(texte);
        }
      );
    }
    return Promise.resolve(copierParSelection(texte));
  }

  function copierParSelection(texte) {
    try {
      var zone = document.createElement('textarea');
      zone.value = texte;
      zone.setAttribute('readonly', 'readonly');
      zone.style.position = 'fixed';
      zone.style.top = '-1000px';
      zone.style.opacity = '0';
      document.body.appendChild(zone);
      zone.select();
      var copie = document.execCommand && document.execCommand('copy');
      zone.remove();
      return Boolean(copie);
    } catch (erreur) {
      return false;
    }
  }

  /** Marque un bouton comme ayant fait son office, sans re-rendre la boite. */
  function confirmerSurBouton(bouton, phrase, libelleDorigine) {
    if (!bouton) return;
    var etiquette = bouton.querySelector('span');
    if (etiquette) etiquette.textContent = phrase;
    annoncer(phrase);
    setTimeout(function () {
      if (etiquette && document.body.contains(bouton)) etiquette.textContent = libelleDorigine;
    }, 2500);
  }

  /**
   * Boite de partage d'une recette.
   *
   * Deux objets differents s'y partagent, et la boite ne les melange pas : le texte
   * de la recette, qui se lit tel quel dans une conversation, et le lien vers la
   * fiche, utile a qui a le carnet. Voir l'en-tete de js/partage.js pour ce qu'un
   * lien donne vraiment, et a qui.
   *
   * `navigator.share` n'apparait que quand le navigateur l'a : sur un bureau, la
   * plupart ne l'ont pas, et un bouton qui ne fait rien vaut moins que son absence.
   * Le texte reste affiche en clair au bas de la boite : c'est le dernier recours
   * quand ni le partage ni le presse-papiers ne repondent.
   */
  function ouvrirPartage(recette) {
    var etatPartage = Pt.partageable(recette, {
      ajoutee: Rc.estAjoutee(recette.id),
      erreurEcriture: erreurEcritureRecette(),
    });
    var adresse = etatPartage.possible ? Pt.lien(recette, window.location.href) : '';
    var texte = Pt.enTexte(recette, { lien: null });

    function corps() {
      var elements = [];

      if (!etatPartage.possible) {
        elements.push(
          el('div', { class: 'sync sync--config', id: 'partage-impossible' }, [
            el('span', { class: 'sync__etat', texte: 'Le lien n’est pas partageable' }),
            el('p', { class: 'sync__erreur', texte: majusculePhrase(etatPartage.raison) }),
            el('p', { class: 'apercu-import__note', texte: 'Le texte de la recette, lui, reste partageable.' }),
          ])
        );
      } else if (etatPartage.reserve) {
        elements.push(
          el('div', { class: 'sync sync--config', id: 'partage-reserve' }, [
            el('span', { class: 'sync__etat', texte: 'À savoir avant d’envoyer' }),
            el('p', { class: 'sync__erreur', texte: majusculePhrase(etatPartage.reserve) }),
          ])
        );
      }

      var boutons = [];

      if (navigator.share) {
        boutons.push(
          el('button', {
            type: 'button',
            class: 'bouton',
            id: 'partager-systeme',
            onclick: function () {
              navigator.share(Pt.chargeDePartage(recette, etatPartage.possible ? window.location.href : '')).catch(
                function (erreur) {
                  // Un partage annule leve AbortError : ce n'est pas un echec, et le
                  // dire ferait passer un geste volontaire pour un probleme.
                  if (erreur && erreur.name === 'AbortError') return;
                  annoncer('Le partage n’a pas abouti. Le texte est copiable juste en dessous.');
                }
              );
            },
          }, [icone('partager', { taille: 16 }), el('span', { texte: 'Partager…' })])
        );
      }

      boutons.push(
        el('button', {
          type: 'button',
          class: 'bouton bouton--secondaire',
          id: 'copier-recette',
          onclick: function (evenement) {
            var bouton = evenement.currentTarget;
            copierDansPressePapiers(texte).then(function (fait) {
              confirmerSurBouton(
                bouton,
                fait ? 'Recette copiée' : 'Copie refusée, sélectionnez le texte',
                'Copier la recette'
              );
            });
          },
        }, [icone('copier', { taille: 16 }), el('span', { texte: 'Copier la recette' })])
      );

      if (adresse) {
        boutons.push(
          el('button', {
            type: 'button',
            class: 'bouton bouton--sobre',
            id: 'copier-lien',
            onclick: function (evenement) {
              var bouton = evenement.currentTarget;
              copierDansPressePapiers(adresse).then(function (fait) {
                confirmerSurBouton(
                  bouton,
                  fait ? 'Lien copié' : 'Copie refusée, sélectionnez l’adresse',
                  'Copier le lien'
                );
              });
            },
          }, [icone('lien', { taille: 16 }), el('span', { texte: 'Copier le lien' })])
        );
      }

      elements.push(el('div', { class: 'boite__actions', id: 'actions-partage' }, boutons));

      if (adresse) {
        elements.push(
          el('p', { class: 'apercu-import__note' }, [
            el('span', { texte: 'La fiche : ' }),
            el('span', { class: 'adresse-partage', id: 'adresse-partage', texte: adresse }),
          ])
        );
      }

      elements.push(
        el('h3', { class: 'boite__section', texte: 'Le texte envoyé' })
      );
      var zone = el('textarea', {
        class: 'champ-import',
        id: 'texte-partage',
        rows: 10,
        readonly: 'readonly',
        'aria-label': 'Texte de la recette, prêt à copier',
        onclick: function (evenement) {
          evenement.target.select();
        },
      });
      zone.value = texte;
      elements.push(zone);

      return elements;
    }

    ouvrirVoile('Partager ' + recette.titre, corps, { large: true });
  }

  /** Premiere lettre en majuscule : les raisons sont ecrites en minuscule. */
  function majusculePhrase(phrase) {
    var chaine = String(phrase || '');
    return chaine.charAt(0).toUpperCase() + chaine.slice(1);
  }

  /* --- le menu de la semaine en PDF ----------------------------------------- */

  /**
   * Fabrique le PDF du menu et le propose au telechargement.
   *
   * Le lien est cree, clique, puis retire : c'est le seul moyen de nommer un fichier
   * telecharge depuis une page. L'adresse objet n'est liberee qu'apres un delai, la
   * revoquer aussitot interrompant le telechargement sur plusieurs navigateurs.
   *
   * Limite connue et non contournable : dans une application installee sur iOS, la
   * demande de telechargement ouvre le PDF dans une nouvelle vue au lieu de
   * l'enregistrer. Le fichier est le meme, il faut le partager depuis cette vue.
   */
  function telechargerMenuPdf(sem) {
    try {
      var octets = MPdf.construire({
        semaine: sem,
        plats: Sm.parCreneau(),
        genereLe: new Date(),
      });
      var adresse = URL.createObjectURL(new Blob([octets], { type: 'application/pdf' }));
      var lien = document.createElement('a');
      lien.href = adresse;
      lien.download = MPdf.nomFichier(sem);
      document.body.appendChild(lien);
      lien.click();
      lien.remove();
      setTimeout(function () {
        URL.revokeObjectURL(adresse);
      }, 30000);
      annoncer('Menu ' + sem.libelle + ' enregistré en PDF.');
    } catch (erreur) {
      // Un echec ici ne doit pas rester muet : sans message, on cliquerait a nouveau
      // en croyant avoir mal vise. Une boite plutot qu'un bandeau, parce qu'il faut
      // pouvoir lire le message et reessayer.
      ouvrirVoile('Le PDF n’a pas pu être fabriqué', function (fermer) {
        return [
          el('p', { class: 'sync__erreur', texte: erreur.message }),
          el('div', { class: 'boite__actions' }, [
            el('button', {
              type: 'button',
              class: 'bouton',
              id: 'reessayer-pdf',
              onclick: function () {
                fermer();
                telechargerMenuPdf(sem);
              },
            }, [icone('rafraichir', { taille: 16 }), el('span', { texte: 'Réessayer' })]),
          ]),
        ];
      });
    }
  }

  /* --- import d'une recette depuis un site ---------------------------------- */

  // Le marque-page. Depose dans la barre de favoris, il s'execute **dans la page de
  // la recette** : il y lit le schema.org, qui est du meme domaine, donc sans le
  // moindre probleme d'origine croisee, et le met dans le presse-papiers.
  //
  // C'est ce qui rend l'import possible depuis un site statique : le carnet ne peut
  // pas aller chercher marmiton.org, mais un bout de code lance depuis marmiton.org
  // le peut. Repli sur le code source complet de la page quand aucun schema.org n'y
  // figure : la boite d'import sait lire les deux.
  var MARQUE_PAGE =
    "javascript:(function(){" +
    "var b=[].slice.call(document.querySelectorAll('script[type=\"application/ld+json\"]'))" +
    ".map(function(s){return s.textContent}).join('\\n');" +
    "var t=b||document.documentElement.outerHTML;" +
    "function f(){window.prompt('Copiez ceci (Ctrl+C), puis collez-le dans Miam miam :',t)}" +
    "if(navigator.clipboard&&navigator.clipboard.writeText){" +
    "navigator.clipboard.writeText(t).then(function(){alert('Recette copiee. Collez-la dans Miam miam.')},f)}" +
    "else{f()}})();";

  /**
   * Boite d'import d'une recette trouvee sur internet.
   *
   * Elle ne va rien chercher elle-meme, et la boite le dit : un site statique ne peut
   * pas lire une page d'un autre domaine, le navigateur l'interdit. Deux chemins sont
   * donc proposes, du plus rapide au plus universel : le marque-page, puis le
   * copier-coller de la page entiere.
   */
  function ouvrirImport(livre) {
    var colle = '';
    var resultat = null;
    var erreur = null;

    function analyser() {
      resultat = null;
      erreur = null;
      var lu = Imp.importer(colle);
      if (lu.erreur) erreur = lu.erreur;
      else resultat = lu.recette;
      rendreCorpsVoile(corps());
    }

    function enregistrer() {
      if (!resultat) return;
      // Importee depuis un livre : elle lui est rattachee, et n'ira donc pas dans le
      // planning tant qu'on ne l'aura pas remontee.
      if (livre) resultat.livre = livre.id;
      Rc.creer(resultat).then(
        function (creee) {
          // La promesse tenue ne prouve pas l'envoi : voir erreurEcritureRecette().
          var echec = erreurEcritureRecette();
          if (echec) {
            erreur =
              'La recette n’a pas pu être envoyée : ' + echec +
              ' Elle est visible ici, mais elle disparaîtra à la prochaine mise à jour. Réessayez une fois le réseau revenu.';
            rendreCorpsVoile(corps());
            return;
          }
          fermerVoile();
          window.location.hash = '#/recette/' + creee.id;
        },
        function (e) {
          erreur = e.message;
          rendreCorpsVoile(corps());
        }
      );
    }

    function corps() {
      var champ = el('textarea', {
        class: 'champ-import',
        id: 'contenu-importe',
        rows: 5,
        placeholder: 'Collez ici le contenu de la page de la recette…',
        'aria-label': 'Contenu de la page à importer',
        oninput: function (evenement) {
          colle = evenement.target.value;
          // Le bouton est active ici et non par un re-rendu : re-rendre la boite a
          // chaque frappe sortirait le curseur de la zone de texte.
          var bouton = document.getElementById('analyser-import');
          if (bouton) bouton.disabled = colle.trim() === '';
        },
      });
      champ.value = colle;

      var apercu = [];
      if (erreur) {
        apercu.push(
          el('div', { class: 'sync sync--config', id: 'erreur-import' }, [
            el('span', { class: 'sync__etat', texte: 'Import impossible' }),
            el('p', { class: 'sync__erreur', texte: erreur }),
          ])
        );
      } else if (resultat) {
        apercu.push(
          el('div', { class: 'apercu-import', id: 'apercu-import' }, [
            el('h3', { class: 'apercu-import__titre', texte: resultat.titre }),
            el('p', { class: 'apercu-import__meta', texte: [
              resultat.categorie,
              resultat.origine,
              resultat.portions,
              resultat.temps.total,
            ].join(' · ') }),
            el('p', { class: 'apercu-import__compte', texte:
              resultat.ingredients[0].items.length + ' ingrédients · ' +
              resultat.instructions.length + ' étapes' }),
            // Ce que la source ne donne pas, dit avant d'enregistrer et non apres :
            // c'est le moment ou l'on peut encore aller chercher l'information.
            resultat.manquants.length > 0
              ? el('div', { class: 'apercu-import__manquants' }, [
                  el('p', { class: 'apercu-import__manquants-titre', texte:
                    'Ce que la source ne donne pas (' + resultat.manquants.length + ')' }),
                  el('ul', {}, resultat.manquants.map(function (m) {
                    return el('li', { texte: m });
                  })),
                ])
              : null,
            el('div', { class: 'boite__actions' }, [
              el('button', {
                type: 'button',
                class: 'bouton',
                id: 'valider-import',
                onclick: enregistrer,
              }, [icone('coche', { taille: 16 }), el('span', { texte: 'Ajouter au livre' })]),
            ]),
            el('p', { class: 'apercu-import__note', texte:
              'La fiche s’ouvrira dans l’éditeur du carnet : tout y est modifiable, rien n’est figé.' }),
          ])
        );
      }

      return [
        el('p', { class: 'accroche', texte:
          'Le carnet ne peut pas aller lire une page d’un autre site : le navigateur l’interdit, ' +
          'et c’est cette règle qui empêche n’importe quel site de lire le contenu d’un autre en votre nom. ' +
          'Il faut donc lui apporter la page. Deux façons, de la plus rapide à la plus sûre.' }),

        el('h3', { class: 'boite__section', texte: '1. Le marque-page, en un clic' }),
        el('p', { class: 'apercu-import__note', texte:
          'Glissez ce bouton dans votre barre de favoris. Sur une page de recette, cliquez-le : ' +
          'il copie la recette, il ne reste qu’à la coller ci-dessous.' }),
        el('p', {}, [
          el('a', {
            class: 'bouton bouton--sobre',
            id: 'marque-page-import',
            href: MARQUE_PAGE,
            texte: '🍲 Recette vers Miam miam',
            onclick: function (evenement) {
              // Cliquer le lien depuis cette boite ne servirait a rien : il doit etre
              // lance depuis la page de la recette. On le dit plutot que de ne rien faire.
              evenement.preventDefault();
              erreur =
                'Ce bouton est à glisser dans votre barre de favoris, puis à cliquer depuis la page ' +
                'de la recette. Lancé ici, il ne trouverait que le carnet.';
              rendreCorpsVoile(corps());
            },
          }),
        ]),

        el('h3', { class: 'boite__section', texte: '2. Ou copiez la page entière' }),
        el('p', { class: 'apercu-import__note', texte:
          'Sur la page de la recette : Ctrl+A pour tout sélectionner, Ctrl+C pour copier, ' +
          'puis Ctrl+V ici. Sur téléphone, « Partager » puis « Copier ».' }),
        champ,
        el('div', { class: 'boite__actions' }, [
          el('button', {
            type: 'button',
            class: 'bouton bouton--secondaire',
            id: 'analyser-import',
            disabled: colle.trim() === '' ? true : null,
            onclick: analyser,
          }, [icone('recherche', { taille: 16 }), el('span', { texte: 'Lire la recette' })]),
        ]),
      ].concat(apercu);
    }

    ouvrirVoile(livre ? 'Importer une recette dans « ' + livre.titre + ' »' : 'Importer une recette', function () {
      return corps();
    }, { large: true });
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
      peutModifier: peutModifier,
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
    // Le formulaire n'existe pas pour un appareil en lecture seule : voir js/acces.js.
    var ajoutLibre = formulaireAjoutLibre();
    if (ajoutLibre) fragment.appendChild(ajoutLibre);

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
        siMaison(el('button', {
          type: 'button',
          class: 'bouton bouton--sobre',
          id: 'ouvrir-placard',
          onclick: ouvrirPlacard,
        }, [icone('livre', { taille: 16 }), el('span', { texte: 'Placard' })])),
      ])
    );

    // Le decompte est deja porte par le bloc « Encore a acheter » ci-dessus : cette
    // barre ne garde que les actions. Elle disparaît quand elle n'en a aucune :
    // liste vide, rien de coché, ou appareil en lecture seule.
    var barreVide = !peutModifier() || (coches === 0 && articles.length === 0);
    if (!barreVide) fragment.appendChild(
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
          // Vider la liste efface le travail de toute la maisonnée, y compris ce
          // qu'un autre vient d'y mettre : c'est un vrai bouton, et il demande une
          // confirmation. En petit lien discret, il se cliquait par erreur en visant
          // « Retirer les cochés », juste à côté.
          videurDeListe(articles.length),
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

  /**
   * Bloc d'envoi d'une image, reutilisable.
   *
   * `cle` est la cle sous laquelle photos.js range l'image : l'identifiant d'une
   * recette, ou « livre::<id> » pour la couverture d'un livre. Ce module ne fait aucune
   * difference entre les deux, ce qui evite une seconde collection et une seconde
   * republication des regles de securite.
   *
   * `reglages` porte les libelles et, surtout, `rendre()` : ce bloc vit dans l'editeur
   * d'une recette comme dans la boite d'un livre, et chacun se re-rend a sa maniere.
   *
   * `lire`, `enregistrer` et `supprimer` permettent de ranger l'image ailleurs que dans
   * photos.js : les illustrations d'etapes ont leur propre collection, un document par
   * recette, parce qu'elles ne servent que sur la fiche ouverte. Sans ces trois crochets,
   * c'est photos.js qui est utilise, sous la cle donnee.
   */
  function blocImage(cle, reglages) {
    var r = reglages || {};
    var rendre = r.rendre || function () {};
    var nom = r.nom || 'photo';
    var lire = r.lire || function () {
      return Ph.vignette(cle);
    };
    var deposer = r.enregistrer || function (tailles) {
      return Ph.enregistrer(cle, tailles);
    };
    var effacer = r.supprimer || function () {
      return Ph.supprimer(cle);
    };
    var courante = lire();
    // Les identifiants gardent la forme qu'ils avaient quand ce bloc ne servait qu'aux
    // recettes : « photo-fichier », « retirer-photo », « bloc-photo ». Les tests et la
    // feuille de style s'y appuient.
    var idChamp = nom + '-fichier';

    var champFichier = el('input', {
      type: 'file',
      class: 'champ-fichier',
      id: idChamp,
      accept: 'image/*',
      'aria-label': r.libelleChoix || 'Choisir une image',
      onchange: function (evenement) {
        var fichier = evenement.target.files && evenement.target.files[0];
        if (!fichier) return;

        etatPhoto = { message: 'Préparation de l’image…', erreur: null, enCours: true };
        rendre();

        Ph.preparer(fichier)
          .then(function (tailles) {
            return Promise.resolve(deposer(tailles)).then(function () {
              etatPhoto = {
                message:
                  (r.motSucces || 'Photo enregistrée et partagée') +
                  ' : ' +
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
          .then(rendre);
      },
    });

    return el('div', { class: 'bloc-photo', id: 'bloc-' + nom }, [
      courante
        ? el('figure', { class: 'bloc-photo__apercu' }, [
            el('img', { src: courante, alt: r.alt || 'Image actuelle' }),
          ])
        : el('div', { class: 'bloc-photo__apercu bloc-photo__apercu--vide' }, [
            icone('appareil', { taille: 28 }),
            el('span', { texte: r.motVide || 'Aucune photo' }),
          ]),
      el('div', { class: 'bloc-photo__actions' }, [
        el('label', { class: 'bouton bouton--secondaire', for: idChamp }, [
          icone('appareil', { taille: 16 }),
          el('span', { texte: courante ? r.motRemplacer || 'Remplacer la photo' : r.motAjouter || 'Ajouter une photo' }),
        ]),
        champFichier,
        courante
          ? el('button', {
              type: 'button',
              class: 'bouton bouton--secondaire',
              id: 'retirer-' + nom,
              texte: r.motRetirer || 'Retirer la photo',
              onclick: function () {
                Promise.resolve(effacer())
                  .then(function () {
                    etatPhoto = { message: r.motRetire || 'Photo retirée.', erreur: null, enCours: false };
                  })
                  .catch(function (erreur) {
                    etatPhoto = { message: null, erreur: erreur.message, enCours: false };
                  })
                  .then(rendre);
              },
            })
          : null,
      ]),
      el('p', {
        class: 'bloc-photo__aide',
        texte:
          r.aide ||
          'L’image est réduite dans le navigateur avant l’envoi (320 px pour les listes, 1200 px pour la fiche) : une photo de téléphone de plusieurs mégaoctets ne passerait pas la limite d’un document Firestore.',
      }),
      etatPhoto.message ? el('p', { class: 'bloc-photo__message', id: 'photo-message', texte: etatPhoto.message }) : null,
      etatPhoto.erreur
        ? el('p', { class: 'bloc-photo__erreur', id: 'photo-erreur', texte: 'L’image n’a pas été enregistrée : ' + etatPhoto.erreur })
        : null,
    ]);
  }

  /** La photo d'une recette, dans l'editeur. */
  function blocPhoto(id) {
    return blocImage(id, {
      nom: 'photo',
      alt: 'Photo actuelle de la recette',
      libelleChoix: 'Choisir une photo',
      rendre: function () {
        monter(vueEditeur(id));
      },
    });
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
  /**
   * Bloc de saisie des valeurs nutritionnelles.
   *
   * Deux colonnes par defaut, « Par portion » et « Pour 100 g », qui sont celles de
   * toutes les sources rencontrees, mais leurs libelles restent modifiables : une
   * source qui ne donnerait que « pour 100 g » ne doit pas obliger a inventer une
   * colonne.
   *
   * `detail` marque une ligne subordonnee (« dont saturés »). C'est une case a cocher
   * et non une convention de nommage : ecrire « dont » dans le nom fonctionne aussi,
   * mais l'ecran a besoin de le savoir pour decaler la ligne.
   */
  function blocNutrition(id) {
    if (!brouillon.nutrition || !Array.isArray(brouillon.nutrition.lignes)) {
      brouillon.nutrition = { colonnes: ['Par portion', 'Pour 100 g'], lignes: [] };
    }
    var n = brouillon.nutrition;
    if (!Array.isArray(n.colonnes) || n.colonnes.length === 0) n.colonnes = ['Par portion', 'Pour 100 g'];

    var enTetes = el('div', { class: 'ligne-edition' }, [
      el('span', { class: 'ligne-edition__libelle', texte: 'Colonnes' }),
    ].concat(
      n.colonnes.map(function (colonne, i) {
        return champ(colonne, function (valeur) {
          n.colonnes[i] = valeur;
        }, { classe: 'champ-edition champ-edition--nutrition', libelle: 'Libellé de la colonne ' + (i + 1) });
      })
    ));

    var lignes = n.lignes.map(function (ligne, index) {
      if (!Array.isArray(ligne.valeurs)) ligne.valeurs = [];
      return el('div', { class: 'ligne-nutrition' }, [
        champ(ligne.nom || '', function (valeur) {
          ligne.nom = valeur;
        }, { placeholder: 'Énergie, Lipides…', libelle: 'Nom de la ligne ' + (index + 1) }),
        champ(ligne.unite || '', function (valeur) {
          ligne.unite = valeur;
        }, { classe: 'champ-edition champ-edition--unite', placeholder: 'g', libelle: 'Unité de la ligne ' + (index + 1) }),
      ]
        .concat(
          n.colonnes.map(function (colonne, i) {
            return champ(ligne.valeurs[i] || '', function (valeur) {
              ligne.valeurs[i] = valeur;
            }, { classe: 'champ-edition champ-edition--nutrition', placeholder: colonne, libelle: colonne + ', ligne ' + (index + 1) });
          })
        )
        .concat([
          el('label', { class: 'case-detail' }, [
            el('input', {
              type: 'checkbox',
              checked: ligne.detail ? true : null,
              'aria-label': 'Ligne subordonnée à la précédente',
              onchange: function (evenement) {
                ligne.detail = evenement.target.checked;
              },
            }),
            el('span', { texte: 'dont' }),
          ]),
          el('button', {
            type: 'button',
            class: 'supprimer',
            texte: '×',
            'aria-label': 'Supprimer la ligne ' + (index + 1),
            onclick: function () {
              n.lignes.splice(index, 1);
              monter(vueEditeur(id));
            },
          }),
        ]));
    });

    return el('div', { class: 'bloc-edition' }, [enTetes].concat(lignes).concat([
      el('button', {
        type: 'button',
        class: 'lien-action',
        id: 'ajouter-ligne-nutrition',
        texte: 'Ajouter une ligne',
        onclick: function () {
          n.lignes.push({ nom: '', unite: '', valeurs: [], detail: false });
          monter(vueEditeur(id));
        },
      }),
      n.lignes.length > 0
        ? el('button', {
            type: 'button',
            class: 'lien-action',
            id: 'vider-nutrition',
            texte: 'Retirer toutes les valeurs',
            onclick: function () {
              brouillon.nutrition = null;
              monter(vueEditeur(id));
            },
          })
        : null,
    ]));
  }

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
                  // L'illustration part avec son étape, et celles des étapes suivantes
                  // remontent d'un rang : sans cela chaque photo se retrouverait sur
                  // l'étape suivante, en silence. Voir illustrations.js.
                  if (id) {
                    Ill.retirerEtape(id, index + 1).catch(function () {
                      /* l'étape est déjà retirée de la recette : on ne bloque pas là-dessus */
                    });
                  }
                  monter(vueEditeur(id));
                },
              }),
            ]),
            // L'intitulé, facultatif : la plupart des recettes n'en ont pas, celles qui
            // viennent d'une fiche HelloFresh en ont un par étape.
            champ(etape.titre || '', function (valeur) {
              etape.titre = valeur.trim() === '' ? null : valeur.trim();
            }, { placeholder: 'Intitulé de l’étape (facultatif)', libelle: 'Intitulé de l’étape ' + (index + 1) }),
            champ(etape.texte, function (valeur) {
              etape.texte = valeur;
            }, { multiligne: true, lignes: 3, libelle: 'Texte de l’étape ' + (index + 1) }),
            champ(etape.astuce || '', function (valeur) {
              etape.astuce = valeur.trim() === '' ? null : valeur;
            }, { multiligne: true, lignes: 2, placeholder: 'Astuce (facultatif)', libelle: 'Astuce de l’étape ' + (index + 1) }),
            // L'illustration ne se propose qu'une fois la recette enregistrée : elle est
            // rangée sous son identifiant, qu'une recette en cours de création n'a pas
            // encore. Le dire plutôt que d'afficher un bouton qui échouerait.
            id
              ? blocIllustrationEtape(id, index + 1)
              : el('p', { class: 'bloc-photo__aide', texte:
                  'La photo de l’étape pourra être ajoutée après le premier enregistrement.' }),
          ]);
        })
        .concat([
          el('button', {
            type: 'button',
            class: 'lien-action',
            texte: 'Ajouter une étape',
            onclick: function () {
              brouillon.instructions.push({
                numero: brouillon.instructions.length + 1,
                titre: null,
                texte: '',
                astuce: null,
              });
              monter(vueEditeur(id));
            },
          }),
        ])
    );
  }

  /**
   * Le bloc d'envoi de l'illustration d'une etape, dans l'editeur.
   *
   * Replie par defaut : une recette de six etapes afficherait sinon six blocs photo
   * ouverts, et l'editeur deviendrait illisible pour la chose qu'on vient le plus
   * souvent y faire, corriger un texte.
   */
  function blocIllustrationEtape(id, rang) {
    var image = Ill.pour(id)[String(rang)];

    return el('details', { class: 'depli depli--etape', open: image ? 'open' : null }, [
      el('summary', { class: 'depli__titre' }, [
        icone('appareil', { taille: 15 }),
        el('span', { texte: image ? 'Photo de cette étape' : 'Ajouter une photo à cette étape' }),
      ]),
      blocImage(null, {
        nom: 'etape-' + rang,
        alt: 'Illustration de l’étape ' + rang,
        libelleChoix: 'Choisir une photo pour l’étape ' + rang,
        motVide: 'Aucune photo pour cette étape',
        motAjouter: 'Ajouter la photo',
        motRemplacer: 'Remplacer la photo',
        motRetirer: 'Retirer la photo',
        motRetire: 'Photo de l’étape retirée.',
        motSucces: 'Photo de l’étape enregistrée et partagée',
        aide:
          'Une seule taille est conservée pour une étape, 320 px de côté : c’est la taille ' +
          'd’affichage, et une illustration par étape ne doit pas peser plus que la fiche.',
        // Les illustrations ne passent pas par photos.js pour l'enregistrement : elles
        // ont leur propre collection, un document par recette. Voir illustrations.js.
        lire: function () {
          return Ill.pour(id)[String(rang)] || null;
        },
        enregistrer: function (tailles) {
          return Ill.enregistrer(id, rang, tailles.vignette);
        },
        supprimer: function () {
          return Ill.retirer(id, rang);
        },
        rendre: function () {
          monter(vueEditeur(id));
        },
      }),
    ]);
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
  /**
   * L'editeur d'une recette.
   *
   * `livre` n'a de sens qu'en creation : la nouvelle recette est alors rattachee a ce
   * livre de la bibliotheque, et sa source prend le titre de l'ouvrage. Une recette
   * existante garde son rattachement, qui se change depuis sa fiche.
   */
  function vueEditeur(id, livre) {
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
      brouillon = creation ? Rc.recetteVide(livre) : JSON.parse(JSON.stringify(recette));
      // Section ouverte au depart : en creation il faut d'abord un titre, en
      // modification on vient le plus souvent changer le nombre de parts.
      etat.sectionEditeur = creation ? 'fiche' : 'parts';
    }

    // Le livre effectif est relu dans le brouillon, et non seulement dans l'argument :
    // les blocs de l'editeur (photo, parts, ingredients, etapes) se re-rendent par
    // `vueEditeur(id)` sans connaitre le livre, et « Annuler » doit malgre tout
    // ramener a l'etagere d'ou l'on vient.
    if (!livre && brouillon && brouillon.livre) livre = Lv.parId(brouillon.livre);

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

            // Un tableau nutritionnel sans ligne nommee n'est pas un tableau vide, c'est
            // l'absence de tableau : la fiche afficherait sinon une section sans contenu.
            if (aEnregistrer.nutrition) {
              aEnregistrer.nutrition.lignes = (aEnregistrer.nutrition.lignes || []).filter(function (ligne) {
                return String(ligne.nom || '').trim() !== '';
              });
              if (aEnregistrer.nutrition.lignes.length === 0) aEnregistrer.nutrition = null;
            }

            // Un titre vide rendrait la fiche introuvable dans le livre : on
            // refuse d'enregistrer plutot que de creer une recette sans nom.
            if (String(aEnregistrer.titre || '').trim() === '') {
              erreurEditeur = 'Le titre est obligatoire : sans lui, la recette serait introuvable dans le livre.';
              monter(vueEditeur(id, livre));
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
                  monter(vueEditeur(id, livre));
                  var noeud = document.getElementById('erreur-recettes');
                  if (noeud) noeud.scrollIntoView({ block: 'center' });
                  return;
                }
                brouillon = null;
                window.location.hash = '#/recette/' + (creation ? enregistree.id : id);
              })
              .catch(function (erreur) {
                erreurEditeur = erreur.message;
                monter(vueEditeur(id, livre));
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
            window.location.hash = creation
              ? livre
                ? '#/bibliotheque/' + encodeURIComponent(livre.id)
                : '#/livre'
              : '#/recette/' + id;
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
                        (Rc.livreDe(id)
                          ? 'Cette recette est rattachée à un livre de la bibliothèque : la supprimer l’enlève pour tout le monde, et il n’y a pas de version d’origine à rétablir. Le livre, lui, reste.'
                          : 'Cette recette a été ajoutée depuis l’application : la supprimer l’enlève pour tout le monde, et il n’y a pas de version d’origine à rétablir.'),
                    }),
                    el('div', { class: 'boite__actions' }, [
                      el('button', {
                        type: 'button',
                        class: 'bouton bouton--danger',
                        id: 'confirmer-suppression',
                        texte: 'Supprimer',
                        onclick: function () {
                          // Le livre est releve avant la suppression : apres, la
                          // recette n'existe plus et son rattachement avec elle.
                          var livreOrigine = Rc.livreDe(id);
                          Rc.supprimer(id)
                            .then(function () {
                              var echec = erreurEcritureRecette();
                              if (echec) {
                                throw new Error(
                                  'La suppression n’a pas atteint le serveur : ' + echec +
                                    ' La recette reviendra à la prochaine mise à jour.'
                                );
                              }
                              return Sm.retirerRecette(id);
                            })
                            .then(function () {
                              brouillon = null;
                              fermer();
                              window.location.hash = livreOrigine
                                ? '#/bibliotheque/' + encodeURIComponent(livreOrigine)
                                : '#/livre';
                            })
                            .catch(function (erreur) {
                              erreurEditeur = erreur.message;
                              fermer();
                              monter(vueEditeur(id, livre));
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
        // Deplacer est rare et structurel : sa place est ici, avec la suppression, et
        // non dans la barre d'actions de la fiche, qui en porte deja quatre.
        !creation && Rc.estAjoutee(id)
          ? el('button', {
              type: 'button',
              class: 'bouton bouton--sobre',
              id: 'deplacer-recette',
              onclick: function () {
                ouvrirDeplacement(recette);
              },
            }, [
              icone('bibliotheque', { taille: 16 }),
              el('span', {
                texte: recette.livre ? 'Déplacer vers un autre livre' : 'Ranger dans un livre',
              }),
            ])
          : null,
        !creation && Rc.estModifiee(id) && !Rc.estAjoutee(id)
          ? el('button', {
              type: 'button',
              class: 'bouton bouton--secondaire',
              id: 'reinitialiser',
              texte: 'Rétablir l’originale',
              onclick: function () {
                Rc.reinitialiser(id).then(function () {
                  var echec = erreurEcritureRecette();
                  if (echec) {
                    // Le retablissement n'a pas atteint le serveur : la version
                    // modifiee y est toujours et reviendra au prochain rafraichissement.
                    erreurEditeur =
                      'La version modifiée n’a pas pu être supprimée du serveur : ' + echec +
                      ' Elle reviendra à la prochaine mise à jour. Réessayez une fois le réseau revenu.';
                    monter(vueEditeur(id, livre));
                    return;
                  }
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
      {
        cle: 'nutrition',
        titre: 'Nutrition',
        sousTitre: 'Les valeurs de la source, telles quelles. Elles ne suivent pas le nombre de parts.',
        resume: (function () {
          var lu = lignesNutrition(brouillon);
          if (!lu) return 'aucune valeur';
          return lu.lignes.length + (lu.lignes.length > 1 ? ' lignes' : ' ligne');
        })(),
        contenu: function () {
          return blocNutrition(id);
        },
      },
    ];

    function ouvrirSection(cle) {
      etat.sectionEditeur = cle;
      monter(vueEditeur(id, livre));
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

    // #/compte est l'adresse ; #/acces reste acceptée, elle a circulé.
    if (ancre === '/compte' || ancre === '/acces') {
      afficher(vueCompte());
      return;
    }

    if (ancre === '/foyer/membres') {
      // Un membre en lecture seule n'a rien à y faire, et le serveur refuserait de
      // toute façon : on le renvoie à son compte plutôt que d'ouvrir un formulaire mort.
      if (!peutModifier()) {
        window.location.hash = '#/compte';
        return;
      }
      afficher(vueMembres());
      return;
    }

    // Sans foyer, il n'y a rien à afficher : aucune donnée n'a été lue, et aucune ne
    // peut l'être. Toutes les adresses mènent donc à l'écran de connexion, qui explique
    // pourquoi, au lieu d'un carnet vide qu'on prendrait pour une panne.
    if (!Acc.aUnFoyer()) {
      afficher(vueCompte());
      return;
    }

    // Les écrans d'édition n'existent pas pour un appareil en lecture seule : y
    // arriver par une adresse collée renvoie à l'écran de lecture correspondant,
    // plutôt que d'ouvrir un formulaire dont rien ne partirait.
    if (!peutModifier() && (ancre === '/recette/nouvelle' || /\/modifier$/.test(ancre)
        || /\/nouvelle$/.test(ancre))) {
      var repli = ancre.match(/^\/recette\/(.*)\/modifier$/);
      window.location.hash = repli ? '#/recette/' + repli[1] : '#/';
      return;
    }

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
      changerDeLivre(null);
      var nbLivre = Rc.duLivreDeCuisine().length;
      afficher(vueLivre(null), nbLivre + ' recettes');
      return;
    }

    if (ancre === '/bibliotheque') {
      afficher(vueBibliotheque());
      return;
    }

    if (ancre.indexOf('/bibliotheque/') === 0) {
      var suite = ancre.slice('/bibliotheque/'.length);
      var creationDansLivre = suite.match(/^(.*)\/nouvelle$/);
      var idLivre = decodeURIComponent(creationDansLivre ? creationDansLivre[1] : suite);
      var ouvrage = Lv.parId(idLivre);

      if (!ouvrage) {
        afficher(
          el('div', {}, [
            el('a', { class: 'retour', href: '#/bibliotheque', texte: '‹ Retour à la bibliothèque' }),
            el('div', { class: 'etat-erreur' }, [
              el('h1', { texte: 'Livre introuvable' }),
              el('p', { texte: 'L’identifiant « ' + idLivre + ' » ne correspond à aucun livre de la bibliothèque.' }),
            ]),
          ])
        );
        return;
      }

      if (creationDansLivre) {
        afficher(vueEditeur(null, ouvrage));
        return;
      }

      document.title = ouvrage.titre + ' — Miam miam !';
      changerDeLivre(ouvrage.id);
      var nb = Rc.duLivre(ouvrage.id).length;
      afficher(vueLivre(ouvrage), ouvrage.titre + ', ' + nb + (nb > 1 ? ' recettes' : ' recette'));
      return;
    }

    afficher(vueAccueil());
  }

  /* --- démarrage ----------------------------------------------------------- */

  function afficherErreurChargement(message) {
    retirerDemarrage();
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
    else if (route === '/livre') monter(vueLivre(null));
  }

  function surChangementPhotos() {
    if (voile || saisieEnCours()) return;
    var route = routeCourante();
    if (route === '/') monter(vueAccueil());
    else if (route === '/livre') monter(vueLivre(null));
    else if (route.indexOf('/bibliotheque') === 0) router();
  }

  /**
   * La bibliotheque a change : un livre cree ou supprime depuis un autre appareil.
   * Seuls les deux ecrans qui l'affichent sont re-rendus, et jamais par-dessus une
   * boite ouverte : le re-rendu emporterait la saisie en cours.
   */
  function surChangementLivres() {
    if (voile || saisieEnCours()) return;
    if (routeCourante().indexOf('/bibliotheque') === 0) router();
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

    // Le foyer et le rôle sont connus avant le premier rendu : sans cela, l'écran
    // afficherait une fraction de seconde des boutons qu'il va retirer.
    //
    // Rien n'est demandé au serveur ici, et c'est délibéré : une vérification au
    // chargement coûterait deux lectures Firestore à chaque ouverture. L'état mémorisé
    // suffit à décider de l'affichage, et les règles décident du reste. La vérification
    // distante existe, mais elle est à la demande.
    Acc.initialiser();
    Acc.surChangement(function () {
      // Un foyer qui apparaît (connexion, création) est le signal d'aller chercher les
      // données : avant lui, aucun chemin Firestore n'existait.
      chargerLeFoyer();
      router();
    });
    // Deux lectures, et seulement pour un compte connecté : personne d'autre ne
    // déclenche quoi que ce soit. Voir js/acces.js.
    if (Acc.compte()) Acc.verifier();

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
        chargerLeFoyer();
      })
      .catch(function (erreur) {
        afficherErreurChargement(erreur.message);
      });
  }

  // Les données du foyer ne sont lues qu'une fois, et seulement s'il y a un foyer :
  // sans lui, `sync.js` refuse de fabriquer un chemin, et il aurait raison. Le drapeau
  // évite qu'une seconde notification de `Acc` relise tout.
  var foyerCharge = null;
  var abonnementsPoses = false;
  var premierFoyer = true;

  function chargerLeFoyer() {
    if (!Acc.aUnFoyer() || !etat.recettes) {
      // Déconnexion : le prochain foyer devra être lu à nouveau.
      foyerCharge = null;
      return;
    }
    if (foyerCharge === Acc.foyer()) return;
    foyerCharge = Acc.foyer();

    // Les abonnements ne se posent qu'une fois : les reposer à chaque foyer ferait
    // rendre l'écran deux fois par changement, puis trois.
    if (!abonnementsPoses) {
      abonnementsPoses = true;
      S.surChangement(surChangementListe);
      Sm.surChangement(surChangementSemainier);
      Lv.surChangement(surChangementLivres);
      Ph.surChangement(surChangementPhotos);
    }

    // Une seule lecture par collection, au chargement. Il n'y a pas de sondage
    // periodique : la mise a jour passe par le bouton « Rafraichir » de chaque ecran.
    // Voir l'arithmetique des lectures Firestore dans storage.js.
    //
    // `initialiser` ne lit qu'une fois par chargement de page, par construction. Une
    // deconnexion suivie d'une autre connexion, sans rechargement, doit donc relire
    // explicitement : sinon les ecrans resteraient vides, caches effaces et personne
    // pour les remplir.
    var lire = premierFoyer ? function (module_) { return module_.initialiser(); }
                            : function (module_) { return module_.rafraichir(); };
    premierFoyer = false;

    lire(S);
    lire(Sm);

    // Le placard est lu une fois, comme le reste. S'il est inaccessible (regles
    // non publiees), le carnet fonctionne sans : aucun ingredient n'est ecarte.
    lire(Pl);

    // La bibliotheque est lue une fois, comme le reste. Ses livres sont des
    // documents minuscules : quelques lectures, une seule fois par chargement.
    lire(Lv);

    // Les recettes modifiees sont relues une fois, au chargement. Elles changent
    // trop rarement pour justifier un sondage permanent.
    Rc.rafraichir().then(function () {
      router();
    });

    // Les vignettes sont relues une fois, comme les recettes : une photo change
    // encore plus rarement qu'une recette, et chaque lecture pese lourd.
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
  }

  demarrer();
})();
