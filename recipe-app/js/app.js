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

  // `semaineSeule` : null pour afficher les deux semaines, sinon leur rang.
  var etat = { recettes: [], criteres: criteresVides(), semaineSeule: null, rechercheReserve: '' };

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

  var INVITE_AGE = 'Rafraîchir pour voir les modifications faites depuis les autres appareils.';

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
    return 'il y a ' + heures + (heures > 1 ? ' heures' : ' heure');
  }

  /**
   * Bandeau d'etat. `sujet` est le module concerne (S ou Sm), `libelleOk` la phrase
   * affichee quand tout va bien, accordee par l'appelant.
   *
   * L'age de la donnee y est affiche, et signale au-dela d'un seuil. Ce n'est pas
   * decoratif : depuis la suppression du sondage automatique, c'est la seule chose
   * qui empeche de cocher dans une liste vieille d'une heure sans le savoir.
   */
  function barreEtat(sujet, libelleOk, apresRafraichissement, identifiantBouton) {
    var e = sujet.etatSync();
    var age = sujet.ageDonnees();
    var probleme = diagnostiquer(e);

    var libelle;
    var classe = 'sync';
    var invite = null;

    if (e.enCours) {
      libelle = 'Mise à jour…';
    } else if (probleme) {
      libelle = probleme.titre;
      if (e.enAttente > 0) {
        libelle += ', ' + e.enAttente + ' modification' + (e.enAttente > 1 ? 's' : '') + ' en attente';
      }
      classe += ' ' + probleme.classe;
      invite = probleme.explication;
    } else if (e.enLigne === true) {
      libelle = libelleOk + ', à jour ' + depuisQuand(age === null ? 0 : age);
      if (age !== null && age > window.CarnetConfig.seuilDonneesAgees) {
        classe += ' sync--age';
        // L'etat « vieillissant » doit dire quoi faire, sinon il n'est qu'une couleur.
        invite = INVITE_AGE;
      } else {
        classe += ' sync--ok';
      }
    } else {
      libelle = 'Connexion…';
    }

    var bandeau = el('div', { class: classe, 'data-bandeau': identifiantBouton }, [
      el('span', { class: 'sync__etat', texte: libelle }),
      el('button', {
        type: 'button',
        class: 'bouton bouton--sobre',
        id: identifiantBouton,
        disabled: e.enCours ? true : null,
        onclick: function () {
          sujet.rafraichir().then(apresRafraichissement);
        },
      }, [icone('fleche', { taille: 16 }), el('span', { texte: 'Rafraîchir' })]),
      invite ? el('p', { class: 'sync__erreur', texte: invite }) : null,
      probleme ? el('p', { class: 'url-source', texte: e.erreur }) : null,
    ]);

    // Le libelle porte un age (« à jour il y a 3 minutes ») qui doit vieillir tout
    // seul. Sans sondage reseau, rien ne re-rend l'ecran : ce minuteur ne touche donc
    // que ce texte et cette classe, sans aucune lecture Firestore. C'est ce qui evite
    // de cocher dans une liste vieille d'une heure en croyant qu'elle est fraiche.
    bandeau.__minuteurAge = setInterval(function () {
      if (!bandeau.isConnected) {
        clearInterval(bandeau.__minuteurAge);
        return;
      }
      var courant = sujet.etatSync();
      var ageCourant = sujet.ageDonnees();
      if (courant.enCours || diagnostiquer(courant) || courant.enLigne !== true || ageCourant === null) return;

      var vieillissant = ageCourant > window.CarnetConfig.seuilDonneesAgees;
      bandeau.querySelector('.sync__etat').textContent = libelleOk + ', à jour ' + depuisQuand(ageCourant);
      bandeau.classList.toggle('sync--age', vieillissant);
      bandeau.classList.toggle('sync--ok', !vieillissant);

      var explication = bandeau.querySelector('.sync__erreur');
      if (vieillissant && !explication) {
        bandeau.appendChild(el('p', { class: 'sync__erreur', texte: INVITE_AGE }));
      } else if (!vieillissant && explication) {
        bandeau.removeChild(explication);
      }
    }, INTERVALLE_AGE);

    return bandeau;
  }

  /* --- vue : accueil, le semainier ----------------------------------------- */

  // Plat en cours de glissement. Deux formes :
  //   { type: 'creneau', jour, moment }  un plat deja pose, qu'on deplace
  //   { type: 'recette', recetteId, titre }  une recette venue de la reserve
  var glisse = null;

  function nbArticlesRestants() {
    return getShoppingList().filter(function (a) {
      return !a.coche;
    }).length;
  }

  /**
   * Ce que l'accueil annonce en une phrase. Compte les repas prevus sur les semaines
   * affichees, pas sur tout le semainier : annoncer des repas invisibles a l'ecran
   * n'aiderait personne a savoir quoi faire.
   */
  function resumeAccueil(semainesAffichees) {
    var index = Sm.parCle();
    var prevus = 0;
    semainesAffichees.forEach(function (sem) {
      Sem.creneauxDe(sem).forEach(function (creneau) {
        if (index[creneau.cle]) prevus += 1;
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

  /** Une case de repas : le plat pose, ou une invitation a en choisir un. */
  function celluleCreneau(jour, moment, creneau) {
    var recette = creneau && creneau.type === Sm.TYPE_RECETTE ? Rc.parId(creneau.recetteId) : null;

    var contenu;
    if (!creneau) {
      contenu = [
        el('span', { class: 'creneau__vide' }, [icone('plus', { taille: 16 })]),
      ];
    } else if (recette) {
      contenu = [
        el('span', { class: 'creneau__plat' }, [
          vignetteOuMarque(recette, 'vignette--creneau', 15),
          el('span', { class: 'creneau__titre', texte: recette.titre }),
        ]),
      ];
    } else if (creneau.type === Sm.TYPE_RECETTE) {
      // Le plat designe une recette qui n'existe plus : le dire au lieu d'afficher
      // une case vide, sinon le repas semble avoir disparu tout seul.
      contenu = [
        el('span', { class: 'creneau__titre', texte: creneau.titre }),
        el('span', { class: 'creneau__note', texte: 'fiche introuvable' }),
      ];
    } else {
      contenu = [
        el('span', { class: 'creneau__plat' }, [
          el('span', { class: 'creneau__libre' }, [icone(iconeRepasLibre(creneau.titre), { taille: 16 })]),
          el('span', { class: 'creneau__titre', texte: creneau.titre }),
        ]),
      ];
    }

    var classes = ['creneau', 'creneau--' + moment.taille];
    if (creneau) classes.push('creneau--rempli');
    if (jour.estPasse) classes.push('creneau--passe');

    var cellule = el('button', {
      type: 'button',
      class: classes.join(' '),
      'data-creneau': Sem.cleCreneau(jour.cle, moment.cle),
      'aria-label':
        moment.libelle +
        ' du ' +
        jour.libelle +
        ' : ' +
        (creneau ? creneau.titre : 'aucun plat prévu, choisir un plat'),
      draggable: creneau ? 'true' : null,
      onclick: function () {
        ouvrirSelecteurCreneau(jour, moment);
      },
    }, [el('span', { class: 'creneau__moment', texte: moment.court })].concat(contenu));

    // Glisser-deposer, sur ordinateur : le tactile passe par la boite de choix, que
    // l'appui ouvre de toute facon. L'API HTML5 de glissement n'existe pas sur
    // mobile, la case doit donc rester utilisable sans elle.
    if (creneau) {
      cellule.addEventListener('dragstart', function (evenement) {
        glisse = { type: 'creneau', jour: jour.cle, moment: moment.cle };
        cellule.classList.add('creneau--enleve');
        if (evenement.dataTransfer) {
          evenement.dataTransfer.effectAllowed = 'move';
          // Certains navigateurs annulent le glissement sans donnee associee.
          evenement.dataTransfer.setData('text/plain', creneau.titre);
        }
      });
      cellule.addEventListener('dragend', function () {
        glisse = null;
        cellule.classList.remove('creneau--enleve');
      });
    }

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

      if (enCours.type === 'creneau') {
        Sm.deplacer(enCours.jour, enCours.moment, jour.cle, moment.cle).then(rendreAccueil);
      } else {
        Sm.poser(jour.cle, moment.cle, {
          type: Sm.TYPE_RECETTE,
          recetteId: enCours.recetteId,
          titre: enCours.titre,
        }).then(rendreAccueil);
      }
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

  function blocSemaine(sem, estCourante) {
    var index = Sm.parCle();

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
              Sem.MOMENTS.map(function (moment) {
                return celluleCreneau(jour, moment, index[Sem.cleCreneau(jour.cle, moment.cle)] || null);
              })
            )
          );
        })
      ),
    ]);
  }

  /** Bandeau d'etat du semainier. */
  function barreSyncSemainier() {
    return barreEtat(Sm, 'Menus partagés à la maison', rendreAccueil, 'rafraichir-semainier');
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
  function reserveDePlats() {
    var recettes = filterRecipes(
      Rc.toutes(),
      Object.assign(criteresVides(), { recherche: etat.rechercheReserve || '' })
    );

    function rendre() {
      var noeud = document.getElementById('reserve');
      if (!noeud || !noeud.parentNode) return;
      noeud.parentNode.replaceChild(reserveDePlats(), noeud);
      var champ = document.getElementById('recherche-reserve');
      if (champ) {
        champ.focus();
        try {
          champ.setSelectionRange(champ.value.length, champ.value.length);
        } catch (erreur) {
          /* sans effet */
        }
      }
    }

    return el('section', { class: 'reserve', id: 'reserve' }, [
      el('h3', { class: 'reserve__titre' }, [
        icone('poignee', { taille: 16 }),
        el('span', { texte: 'Glisser un plat dans une case' }),
      ]),
      el('input', {
        type: 'search',
        class: 'champ-recherche champ-recherche--fin',
        id: 'recherche-reserve',
        placeholder: 'Filtrer les plats…',
        'aria-label': 'Filtrer les plats de la réserve',
        value: etat.rechercheReserve || '',
        oninput: function (evenement) {
          etat.rechercheReserve = evenement.target.value;
          rendre();
        },
      }),
      recettes.length === 0
        ? el('p', { class: 'reserve__vide', texte: 'Aucun plat ne correspond.' })
        : el(
            'div',
            { class: 'reserve__plats' },
            recettes.slice(0, 24).map(function (recette) {
              var pastille = el('span', {
                class: 'pastille pastille--glissable',
                draggable: 'true',
                'data-reserve': recette.id,
                title: recette.titre,
              }, [
                el('span', { class: classeCategorie('marque-plat', recette.categorie) }, [
                  icone(Ic.pourCategorie(recette.categorie), { taille: 14 }),
                ]),
                el('span', { texte: recette.titre }),
              ]);
              pastille.addEventListener('dragstart', function (evenement) {
                glisse = { type: 'recette', recetteId: recette.id, titre: recette.titre };
                pastille.classList.add('pastille--enlevee');
                if (evenement.dataTransfer) {
                  evenement.dataTransfer.effectAllowed = 'copy';
                  evenement.dataTransfer.setData('text/plain', recette.titre);
                }
              });
              pastille.addEventListener('dragend', function () {
                glisse = null;
                pastille.classList.remove('pastille--enlevee');
              });
              return pastille;
            })
          ),
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

  function vueAccueil() {
    document.title = 'Mon carnet de recettes';

    var aujourdhui = new Date();
    var toutes = Sem.semaines(aujourdhui, Math.max(1, window.CarnetConfig.nbSemaines || 2));
    var affichees = etat.semaineSeule === null ? toutes : [toutes[etat.semaineSeule] || toutes[0]];

    var recettes = Rc.toutes();
    var restants = nbArticlesRestants();

    var fragment = document.createDocumentFragment();

    fragment.appendChild(
      el('section', { class: 'entree' }, [
        el('p', { class: 'entree__salut' }, [icone('marmite', { taille: 20 }), el('span', { texte: 'À la maison' })]),
        el('h1', { class: 'entree__titre', texte: 'Qu’est-ce qu’on mange ?' }),
        el('p', { class: 'entree__resume', id: 'resume-accueil', texte: resumeAccueil(affichees) }),
      ])
    );

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

    var bandeau = bandeauErreurRecettes();
    if (bandeau) fragment.appendChild(bandeau);

    var onglets = el('div', { class: 'onglets', role: 'group', 'aria-label': 'Semaines affichées' }, [
      { valeur: null, libelle: 'Les deux semaines' },
      { valeur: 0, libelle: 'Cette semaine' },
      { valeur: 1, libelle: 'La suivante' },
    ]
      .filter(function (onglet) {
        return onglet.valeur === null || onglet.valeur < toutes.length;
      })
      .map(function (onglet) {
        var actif = etat.semaineSeule === onglet.valeur;
        return el('button', {
          type: 'button',
          class: 'pilule',
          'aria-pressed': actif ? 'true' : 'false',
          'data-onglet-semaine': String(onglet.valeur),
          texte: onglet.libelle,
          onclick: function () {
            etat.semaineSeule = onglet.valeur;
            rendreAccueil();
          },
        });
      }));

    fragment.appendChild(
      el('section', { class: 'semainier' }, [
        el('header', { class: 'semainier__entete' }, [
          el('h2', { class: 'semainier__titre', texte: 'Les repas de la semaine' }),
          onglets,
        ]),
        el('p', {
          class: 'semainier__aide',
          texte:
            'Touchez une case pour choisir un plat du livre ou un repas hors carnet. Sur ordinateur, un plat se glisse d’une case à l’autre.',
        }),
        barreSyncSemainier(),
      ])
    );

    fragment.appendChild(reserveDePlats());

    affichees.forEach(function (sem) {
      fragment.appendChild(blocSemaine(sem, sem.contientAujourdhui));
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

    function poser(plat) {
      Sm.poser(jour.cle, moment.cle, plat).then(function () {
        fermerVoile();
        rendreAccueil();
      });
    }

    function corps() {
      var actuel = Sm.creneau(jour.cle, moment.cle);
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
        actuel
          ? el('div', { class: 'boite__actuel' }, [
              el('p', {}, [
                el('span', { class: 'boite__etiquette', texte: 'Prévu' }),
                el('span', { texte: actuel.titre }),
              ]),
              el('div', { class: 'boite__actions' }, [
                actuel.type === Sm.TYPE_RECETTE && Rc.parId(actuel.recetteId)
                  ? el('a', {
                      class: 'bouton bouton--secondaire',
                      href: '#/recette/' + actuel.recetteId,
                      texte: 'Voir la fiche',
                      onclick: fermerVoile,
                    })
                  : null,
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
              ]),
            ])
          : null,

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

      return {
        plat: plat,
        recette: recette,
        total: total,
        nbDeja: nbDeja,
        // Sans ingredients il n'y a rien a ajouter : un restaurant ne se met pas
        // dans une liste de courses.
        ajoutable: Boolean(recette) && total > nbDeja,
        coche: Boolean(recette) && total > nbDeja,
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
            })
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
            } else if (ligne.nbDeja > 0) {
              notes.push(ligne.nbDeja + ' sur ' + ligne.total + ' déjà dans la liste');
            } else {
              notes.push(ligne.total + ' ingrédients');
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
            // Sans photo, la carte garde son liseret fin : une bande de couleur
            // large et vide n'apporte rien et mange la place du texte.
            var carte = el('a', { class: 'carte', href: '#/recette/' + recette.id }, [
              vignetteRecette(recette, 'vignette--carte') ||
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

    document.title = recette.titre + ' — Mon carnet de recettes';

    var dansListe = recetteDansListe(getShoppingList(), recette.id);
    var fragment = document.createDocumentFragment();

    fragment.appendChild(el('a', { class: 'retour', href: '#/livre', texte: '‹ Retour au livre' }));

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

    /* Les 16 recettes du lot 2 ont un tableau de flux généré automatiquement, ne
       contenant que des marqueurs (« ✓ », « Selon étapes »). On ne l'affiche que
       lorsqu'il porte une information, comme la v2. */
    // Un tableau fourni avec la recette est toujours prefere : il porte une
    // interpretation (les sous-preparations qui convergent) que la generation ne
    // sait pas deviner. Sinon on reconstitue le deroule depuis les etapes.
    if (isFlowTableInformative(recette.flowTable)) {
      fragment.appendChild(
        section(
          'Déroulé des préparations',
          'Comment chaque ingrédient est préparé, puis assemblé jusqu’à la cuisson.',
          tableauFlux(recette.flowTable)
        )
      );
    } else {
      var genere = tableauDerouleGenere(recette);
      if (genere) {
        fragment.appendChild(
          section(
            'Déroulé des préparations',
            'Reconstitué automatiquement : à quelle étape chaque ingrédient entre.',
            genere
          )
        );
      }
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

  /** Bandeau d'etat de la liste de courses. */
  function barreSync() {
    return barreEtat(S, 'Liste partagée à la maison', function () {
      monter(vueListeDeCourses());
    }, 'rafraichir');
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

  function vueListeDeCourses() {
    document.title = 'Liste de courses — Mon carnet de recettes';

    var articles = getShoppingList();
    var fragment = document.createDocumentFragment();

    fragment.appendChild(el('a', { class: 'retour', href: '#/', texte: '‹ Retour à l’accueil' }));
    fragment.appendChild(el('h1', { class: 'fiche__titre', texte: 'Liste de courses commune' }));
    fragment.appendChild(
      el('p', {
        class: 'accroche',
        texte: 'Rangée par rayon, dans l’ordre du magasin. Un même ingrédient venu de plusieurs recettes est additionné.',
      })
    );

    fragment.appendChild(barreSync());
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

    fragment.appendChild(
      el('div', { class: 'barre-resultats' }, [
        el('span', {
          texte: restants + ' ligne' + (restants > 1 ? 's' : '') + ' à acheter sur ' + lignes.length,
        }),
        el('div', { class: 'actions-liste' }, [
          el('button', {
            type: 'button',
            class: 'lien-action',
            texte: 'Imprimer la liste',
            onclick: function () {
              window.print();
            },
          }),
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
      fragment.appendChild(
        el('section', { class: 'rayon' }, [
          el('h2', { class: 'rayon__titre' }, [
            el('span', { texte: groupe.rayon }),
            el('span', { class: 'rayon__compte', texte: String(groupe.lignes.length) }),
          ]),
          el('ul', { class: 'liste-courses' }, groupe.lignes.map(ligneCourses)),
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
    }

    document.title = creation
      ? 'Nouvelle recette — Mon carnet de recettes'
      : 'Modifier ' + recette.titre + ' — Mon carnet de recettes';

    var fragment = document.createDocumentFragment();

    fragment.appendChild(
      creation
        ? el('a', { class: 'retour', href: '#/livre', texte: '‹ Retour au livre' })
        : el('a', { class: 'retour', href: '#/recette/' + id, texte: '‹ Revenir à la fiche' })
    );
    fragment.appendChild(
      el('h1', { class: 'fiche__titre', texte: creation ? 'Nouvelle recette' : 'Modifier la recette' })
    );

    var bandeau = bandeauErreurRecettes();
    if (bandeau) fragment.appendChild(bandeau);

    fragment.appendChild(
      el('div', { class: 'actions-fiche' }, [
        el('button', {
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
        }),
        el('button', {
          type: 'button',
          class: 'bouton bouton--secondaire',
          id: 'annuler',
          texte: 'Annuler',
          onclick: function () {
            brouillon = null;
            erreurEditeur = null;
            window.location.hash = creation ? '#/livre' : '#/recette/' + id;
          },
        }),
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
      ])
    );

    if (erreurEditeur) {
      fragment.appendChild(
        el('div', { class: 'etat-erreur etat-erreur--compact', id: 'erreur-editeur' }, [
          el('p', { texte: erreurEditeur }),
        ])
      );
    }

    fragment.appendChild(
      section(
        'Photo',
        null,
        creation
          ? el('p', {
              class: 'section__soustitre',
              texte:
                'La photo pourra être ajoutée après le premier enregistrement : elle est rangée sous l’identifiant de la recette, qui n’existe pas encore.',
            })
          : blocPhoto(id)
      )
    );

    fragment.appendChild(section('Nombre de parts', null, blocPortions(id)));

    fragment.appendChild(
      section('Fiche', null, [
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
      ])
    );

    fragment.appendChild(
      section(
        'Temps',
        null,
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
      )
    );

    fragment.appendChild(
      section('Ingrédients', 'Le rayon indiqué à droite est déduit du nom.', blocIngredients(id))
    );
    fragment.appendChild(section('Préparation', null, blocInstructions(id)));

    return fragment;
  }

  /* --- routage par ancre --------------------------------------------------- */

  function router() {
    var ancre = window.location.hash.replace(/^#/, '');

    // Changer d'ecran ferme la boite ouverte : la laisser par-dessus la vue
    // suivante donnerait une boite qui parle d'un ecran qu'on a quitte.
    fermerVoile();

    if (ancre === '/recette/nouvelle') {
      monter(vueEditeur(null));
      window.scrollTo(0, 0);
      return;
    }
    if (ancre.indexOf('/recette/') === 0) {
      var reste = ancre.slice('/recette/'.length);
      var modification = reste.match(/^(.*)\/modifier$/);
      if (modification) {
        monter(vueEditeur(decodeURIComponent(modification[1])));
        window.scrollTo(0, 0);
        return;
      }
      // On quitte l'editeur : le brouillon non enregistre n'a plus lieu d'etre.
      brouillon = null;
      erreurEditeur = null;
      etatPhoto = { message: null, erreur: null, enCours: false };
      monter(vueRecette(decodeURIComponent(reste)));
      window.scrollTo(0, 0);
      return;
    }
    if (ancre === '/liste-de-courses') {
      monter(vueListeDeCourses());
      window.scrollTo(0, 0);
      return;
    }
    if (ancre === '/livre') {
      document.title = 'Le livre de cuisine — Mon carnet de recettes';
      monter(vueLivre());
      window.scrollTo(0, 0);
      return;
    }

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
    majBadge();
    if (surEcranListe() && !saisieEnCours()) monter(vueListeDeCourses());
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

  function demarrer() {
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

        // Les recettes modifiees sont relues une fois, au chargement. Elles changent
        // trop rarement pour justifier un sondage permanent.
        Rc.rafraichir().then(function () {
          router();
        });

        // Les vignettes sont relues une fois, comme les recettes : une photo change
        // encore plus rarement qu'une recette, et chaque lecture pese lourd.
        Ph.surChangement(surChangementPhotos);
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
