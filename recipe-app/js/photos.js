/* Photos des recettes.

   Une photo par recette, stockee dans Firestore en data URL, en deux tailles dans
   le meme document : une vignette pour les listes et le semainier, une grande image
   pour la fiche.

   Pourquoi redimensionner dans le navigateur plutot que d'envoyer le fichier tel
   quel : une photo de telephone pese 3 a 8 Mo, alors qu'un document Firestore est
   limite a 1 Mio, et qu'une data URL en base64 ajoute encore un tiers au poids
   binaire. Envoyer l'original serait refuse par le serveur, et refuse trop tard,
   apres l'attente du televersement.

   La partie calculatoire (dimensions cibles, budget de poids) est separee du canvas
   pour rester testable sous Node, ou il n'y a ni Image ni canvas.

   Expose window.CarnetPhotos dans le navigateur, module.exports sous Node. */

(function (global) {
  'use strict';

  var estNode = typeof module !== 'undefined' && module.exports;
  var Sync = estNode ? require('./sync.js') : global.CarnetSync;

  var CLE_VIGNETTES = 'carnet-de-recettes:vignettes';

  // Cotes maximaux. La vignette sert des cases de 320 px de large au plus, en
  // affichage double densite : 320 px de cote suffisent et tiennent en ~20 ko.
  var COTE_VIGNETTE = 320;
  var COTE_GRANDE = 1200;

  // Budgets en caracteres de data URL, donc deja en base64. La limite Firestore est
  // de 1 Mio par document ; on s'arrete tres en dessous pour laisser la place aux
  // autres champs et ne jamais dependre d'une limite exacte.
  var BUDGET_VIGNETTE = 60000;
  var BUDGET_GRANDE = 600000;

  var QUALITES = [0.82, 0.72, 0.62, 0.52, 0.42];

  // Cache memoire des grandes images : elles sont trop lourdes pour le localStorage,
  // dont le quota est de quelques megaoctets pour tout le site.
  var grandesEnMemoire = {};

  var abonnes = [];

  function surChangement(rappel) {
    abonnes.push(rappel);
  }

  function notifier() {
    abonnes.forEach(function (rappel) {
      try {
        rappel();
      } catch (erreur) {
        /* un abonne fautif ne doit pas bloquer les autres */
      }
    });
  }

  // --- Cache des vignettes ----------------------------------------------------
  //
  // Deux etages, et la raison de chacun :
  //
  // 1. La memoire est la source du rendu. `vignette()` doit rester synchrone : elle
  //    est appelee pour chaque carte du livre et chaque case du semainier, et rendre
  //    le rendu asynchrone pour une image de 320 px contaminerait tout l'affichage.
  //
  // 2. IndexedDB est la copie durable, ecrite et relue de facon asynchrone. Elle sert
  //    uniquement au demarrage a chaud : les vignettes s'affichent avant que Firestore
  //    ait repondu.
  //
  // Pourquoi plus le localStorage : son quota est de 5 Mo pour tout le site, une
  // vignette pese jusqu'a 58 Ko, le plafond etait donc atteint vers 85 recettes
  // photographiees. Le depassement etait silencieux : les vignettes cessaient
  // simplement d'etre conservees entre deux visites. IndexedDB n'a pas de plafond
  // comparable et signale ses erreurs.

  var NOM_BASE = 'carnet-de-recettes';
  var MAGASIN = 'vignettes';

  var enMemoire = {};
  var basePromesse = null;

  /** Ouvre la base, ou rend null si IndexedDB n'existe pas (Node, navigation privee). */
  function ouvrirBase() {
    if (basePromesse) return basePromesse;
    basePromesse = new Promise(function (resoudre) {
      if (!global.indexedDB) return resoudre(null);
      var requete;
      try {
        requete = global.indexedDB.open(NOM_BASE, 1);
      } catch (erreur) {
        return resoudre(null);
      }
      requete.onupgradeneeded = function () {
        var base = requete.result;
        if (!base.objectStoreNames.contains(MAGASIN)) base.createObjectStore(MAGASIN);
      };
      requete.onsuccess = function () {
        resoudre(requete.result);
      };
      // Base inaccessible : le carnet fonctionne sans cache durable, les vignettes
      // seront relues depuis Firestore au chargement suivant.
      requete.onerror = function () {
        resoudre(null);
      };
      requete.onblocked = function () {
        resoudre(null);
      };
    });
    return basePromesse;
  }

  /** Relit la copie durable et la verse en memoire. A appeler une fois au demarrage. */
  async function chargerCacheDurable() {
    var base = await ouvrirBase();
    if (!base) return enMemoire;

    var index = await new Promise(function (resoudre) {
      try {
        var transaction = base.transaction(MAGASIN, 'readonly');
        var demande = transaction.objectStore(MAGASIN).get('index');
        demande.onsuccess = function () {
          resoudre(demande.result);
        };
        demande.onerror = function () {
          resoudre(null);
        };
      } catch (erreur) {
        resoudre(null);
      }
    });

    if (index && typeof index === 'object' && !Array.isArray(index)) {
      // Ce qui est deja en memoire vient de Firestore, donc fait autorite : la copie
      // durable ne comble que les trous.
      Object.keys(index).forEach(function (id) {
        if (!Object.prototype.hasOwnProperty.call(enMemoire, id)) enMemoire[id] = index[id];
      });
      notifier();
    }
    return enMemoire;
  }

  /** Ecrit la copie durable. Sans attente : le rendu ne depend pas de sa reussite. */
  function ecrireCacheDurable(index) {
    ouvrirBase().then(function (base) {
      if (!base) return;
      try {
        var transaction = base.transaction(MAGASIN, 'readwrite');
        transaction.objectStore(MAGASIN).put(index, 'index');
      } catch (erreur) {
        /* base fermee ou pleine : sans consequence sur l'affichage */
      }
    });
  }

  function ecrireCache(index) {
    enMemoire = index || {};
    ecrireCacheDurable(enMemoire);
    // Le localStorage portait ce cache jusqu'ici. On l'efface pour rendre la place :
    // jusqu'a 1,2 Mo de data URL qui ne servent plus a rien.
    try {
      if (global.localStorage) global.localStorage.removeItem(CLE_VIGNETTES);
    } catch (erreur) {
      /* sans consequence */
    }
    notifier();
  }

  /** Vignette d'une recette, ou null. Synchrone : lue en memoire. */
  function vignette(recetteId) {
    return enMemoire[recetteId] || null;
  }

  /** Copie de l'index en memoire, pour le modifier sans toucher a l'original. */
  function lireCache() {
    return Object.assign({}, enMemoire);
  }

  function aUnePhoto(recetteId) {
    return Boolean(vignette(recetteId));
  }

  /**
   * Relit toutes les vignettes depuis Firestore et remplace le cache.
   *
   * Appele une fois au chargement de la page, comme les recettes modifiees et pour
   * la meme raison : Firestore facture a la lecture de document, et sonder vingt
   * documents en permanence coute cher pour une donnee qui change rarement.
   *
   * Limite assumee : une photo ajoutee depuis un autre appareil apparait au prochain
   * chargement de la page, pas dans la seconde. Naviguer d'un ecran a l'autre ne
   * suffit pas, le routage ne change que l'ancre. Ce cache est aussi la seule source
   * d'autorite sur « qui a une photo » : c'est ce qui evite d'aller demander une
   * image a dix-neuf recettes sur vingt qui n'en ont pas.
   */
  async function rafraichirVignettes() {
    var distantes = await Sync.lireVignettes();
    ecrireCache(distantes);
    return distantes;
  }

  /**
   * Demarrage a chaud : verse la copie durable en memoire, sans reseau.
   * Les vignettes s'affichent alors avant que Firestore ait repondu.
   */
  function initialiser() {
    return chargerCacheDurable();
  }

  /**
   * Grande image d'une recette. Lue une fois puis gardee en memoire.
   * Rend null si la recette n'a pas de photo.
   */
  async function grande(recetteId) {
    if (Object.prototype.hasOwnProperty.call(grandesEnMemoire, recetteId)) {
      return grandesEnMemoire[recetteId];
    }
    var image = await Sync.lireGrandePhoto(recetteId);
    grandesEnMemoire[recetteId] = image;
    return image;
  }

  // --- Calculs de redimensionnement -------------------------------------------

  /**
   * Dimensions cibles pour tenir dans un carre de `cote`, en gardant les
   * proportions. Une image plus petite que la cible n'est jamais agrandie : cela ne
   * ferait qu'ajouter du poids et du flou.
   */
  function dimensionsCibles(largeur, hauteur, cote) {
    var l = Math.max(1, Math.round(Number(largeur) || 0));
    var h = Math.max(1, Math.round(Number(hauteur) || 0));
    var facteur = Math.min(1, cote / Math.max(l, h));
    return { largeur: Math.max(1, Math.round(l * facteur)), hauteur: Math.max(1, Math.round(h * facteur)) };
  }

  /** Poids approximatif, en octets, du binaire encode dans une data URL. */
  function poidsBinaire(dataUrl) {
    var virgule = String(dataUrl || '').indexOf(',');
    if (virgule === -1) return 0;
    var base64 = String(dataUrl).slice(virgule + 1);
    var bourrage = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((base64.length * 3) / 4) - bourrage);
  }

  // --- Encodage dans le navigateur --------------------------------------------

  function chargerImage(fichier) {
    return new Promise(function (resoudre, rejeter) {
      var lecteur = new FileReader();
      lecteur.onerror = function () {
        rejeter(new Error('le fichier n’a pas pu être lu'));
      };
      lecteur.onload = function () {
        var image = new Image();
        image.onerror = function () {
          rejeter(new Error('ce fichier n’est pas une image exploitable'));
        };
        image.onload = function () {
          resoudre(image);
        };
        image.src = lecteur.result;
      };
      lecteur.readAsDataURL(fichier);
    });
  }

  /**
   * Encode l'image au cote demande, en baissant la qualite jusqu'a tenir dans le
   * budget. Rend la derniere tentative meme si elle depasse encore : l'appelant
   * decide alors quoi en dire, plutot que de recevoir une erreur muette.
   */
  function encoder(image, cote, budget) {
    var cibles = dimensionsCibles(image.naturalWidth || image.width, image.naturalHeight || image.height, cote);
    var toile = document.createElement('canvas');
    toile.width = cibles.largeur;
    toile.height = cibles.hauteur;
    var contexte = toile.getContext('2d');
    contexte.drawImage(image, 0, 0, cibles.largeur, cibles.hauteur);

    var resultat = null;
    for (var i = 0; i < QUALITES.length; i += 1) {
      // JPEG et non PNG : une photo en PNG pese cinq a dix fois plus, sans gain
      // visible. Le fond blanc evite qu'une image transparente devienne noire.
      resultat = toile.toDataURL('image/jpeg', QUALITES[i]);
      if (resultat.length <= budget) return { dataUrl: resultat, qualite: QUALITES[i], tenu: true };
    }
    return { dataUrl: resultat, qualite: QUALITES[QUALITES.length - 1], tenu: false };
  }

  /**
   * Prepare les deux tailles a partir d'un fichier choisi par l'utilisateur.
   * Leve si l'image reste trop lourde meme a la qualite minimale : mieux vaut le
   * dire que d'envoyer un document que Firestore refusera.
   */
  async function preparer(fichier) {
    if (typeof document === 'undefined') throw new Error('le redimensionnement demande un navigateur');
    var image = await chargerImage(fichier);

    var petite = encoder(image, COTE_VIGNETTE, BUDGET_VIGNETTE);
    var grosse = encoder(image, COTE_GRANDE, BUDGET_GRANDE);

    if (!grosse.tenu) {
      // Une seconde chance a un cote plus petit avant d'abandonner : une photo tres
      // detaillee peut depasser le budget a 1200 px et tenir a 900 px.
      grosse = encoder(image, 900, BUDGET_GRANDE);
    }
    if (!grosse.tenu || !petite.tenu) {
      throw new Error(
        'cette image reste trop lourde même après compression : essayer une photo moins grande'
      );
    }

    return {
      vignette: petite.dataUrl,
      grande: grosse.dataUrl,
      largeur: image.naturalWidth || image.width,
      hauteur: image.naturalHeight || image.height,
      poids: poidsBinaire(grosse.dataUrl),
    };
  }

  // --- Ecriture ---------------------------------------------------------------

  /**
   * Enregistre la photo d'une recette. Le cache local est mis a jour d'abord, pour
   * que l'image apparaisse tout de suite, mais l'erreur reseau est propagee : une
   * photo qui n'est pas partie ne doit pas etre annoncee comme enregistree.
   */
  async function enregistrer(recetteId, tailles) {
    var index = lireCache();
    index[recetteId] = tailles.vignette;
    ecrireCache(index);
    grandesEnMemoire[recetteId] = tailles.grande;

    try {
      await Sync.ecrirePhoto(recetteId, tailles.vignette, tailles.grande);
    } catch (erreur) {
      // L'ecriture a echoue : on retire la vignette du cache pour ne pas laisser
      // croire que la photo est partagee avec les autres appareils.
      var apres = lireCache();
      delete apres[recetteId];
      ecrireCache(apres);
      delete grandesEnMemoire[recetteId];
      throw erreur;
    }
    return tailles.vignette;
  }

  async function supprimer(recetteId) {
    await Sync.supprimerPhoto(recetteId);
    var index = lireCache();
    delete index[recetteId];
    ecrireCache(index);
    delete grandesEnMemoire[recetteId];
  }

  var api = {
    CLE_VIGNETTES: CLE_VIGNETTES,
    COTE_VIGNETTE: COTE_VIGNETTE,
    COTE_GRANDE: COTE_GRANDE,
    BUDGET_VIGNETTE: BUDGET_VIGNETTE,
    BUDGET_GRANDE: BUDGET_GRANDE,

    surChangement: surChangement,
    dimensionsCibles: dimensionsCibles,
    poidsBinaire: poidsBinaire,
    vignette: vignette,
    aUnePhoto: aUnePhoto,
    grande: grande,
    initialiser: initialiser,
    rafraichirVignettes: rafraichirVignettes,
    preparer: preparer,
    enregistrer: enregistrer,
    supprimer: supprimer,
  };

  if (estNode) module.exports = api;
  else global.CarnetPhotos = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
