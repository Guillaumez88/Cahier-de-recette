/* Configuration Firebase du carnet.

   Ces valeurs sont publiques par conception : la configuration web Firebase
   identifie le projet, elle ne donne aucun droit. Elle figure forcement en clair
   dans toute page qui parle a Firebase. Ce qui protege reellement les donnees, ce
   sont les regles de securite Firestore, cote serveur (voir le README).

   Cette application n'utilise pas le SDK Firebase : elle appelle directement l'API
   REST de Firestore en fetch. Deux raisons : le projet reste sans dependance et sans
   etape de construction, et le rafraichissement periodique demande ne necessite pas
   les ecoutes temps reel du SDK. */

(function (global) {
  'use strict';

  var config = {
    apiKey: 'AIzaSyCS0cVbmZi7roN1WroRFyDiR_Trs7lRNvc',
    authDomain: 'cahier-de-cuisine-88.firebaseapp.com',
    projectId: 'cahier-de-cuisine-88',
    storageBucket: 'cahier-de-cuisine-88.firebasestorage.app',
    messagingSenderId: '717841115066',
    appId: '1:717841115066:web:a8a86f00c26a721cd7df83',

    // Identifiant de la liste partagee. Une seule liste commune pour l'instant ;
    // changer cette valeur ouvrirait une liste distincte, sans autre modification.
    listeId: 'commune',

    // Identifiant du semainier partage, meme principe que listeId.
    semainierId: 'commune',

    // Intervalle de rafraichissement automatique, en millisecondes.
    intervalleRafraichissement: 5000,

    // Le semainier est sonde plus lentement que la liste de courses, et c'est
    // delibere : en magasin on coche a plusieurs mains dans la meme minute, alors
    // qu'un menu de la semaine change quelques fois par semaine. Firestore facture
    // a la lecture de document ; sonder le semainier aussi vite que la liste
    // doublerait la facture pour un confort nul.
    intervalleSemainier: 20000,

    // Nombre de semaines affichees sur l'accueil : la semaine en cours et la
    // suivante. Une semaine passee ne sert ni aux courses ni a la cuisine.
    nbSemaines: 2,

    // Bases d'URL, surchargeables pour les tests (voir tests/stub-firestore.js).
    baseFirestore: 'https://firestore.googleapis.com/v1',
    baseAuth: 'https://identitytoolkit.googleapis.com/v1',
    // Le renouvellement de jeton passe par un autre domaine que la creation de
    // session : il doit donc etre configurable a part.
    baseSecureToken: 'https://securetoken.googleapis.com/v1',
  };

  // Point de surcharge reserve aux tests : le serveur de test injecte une
  // configuration pointant vers son emulation locale de Firestore avant le
  // chargement des scripts. Sans surcharge, rien ne change.
  if (global.CARNET_CONFIG_OVERRIDE) {
    Object.keys(global.CARNET_CONFIG_OVERRIDE).forEach(function (nom) {
      config[nom] = global.CARNET_CONFIG_OVERRIDE[nom];
    });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = config;
  else global.CarnetConfig = config;
})(typeof globalThis !== 'undefined' ? globalThis : this);
