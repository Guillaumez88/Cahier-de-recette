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

  function lireCache() {
    try {
      var brut = global.localStorage && global.localStorage.getItem(CLE_VIGNETTES);
      if (!brut) return {};
      var valeur = JSON.parse(brut);
      return valeur && typeof valeur === 'object' && !Array.isArray(valeur) ? valeur : {};
    } catch (erreur) {
      return {};
    }
  }

  function ecrireCache(index) {
    try {
      if (global.localStorage) global.localStorage.setItem(CLE_VIGNETTES, JSON.stringify(index));
    } catch (erreur) {
      // Quota atteint : les vignettes ne sont pas conservees entre deux visites,
      // mais elles seront relues au prochain chargement. Rien a signaler a
      // l'utilisateur, l'application reste utilisable.
    }
    notifier();
  }

  /** Vignette d'une recette, ou null. Synchrone : lue dans le cache local. */
  function vignette(recetteId) {
    return lireCache()[recetteId] || null;
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
    rafraichirVignettes: rafraichirVignettes,
    preparer: preparer,
    enregistrer: enregistrer,
    supprimer: supprimer,
  };

  if (estNode) module.exports = api;
  else global.CarnetPhotos = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
