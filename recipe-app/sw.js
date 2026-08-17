/* Service worker : le carnet s'ouvre sans réseau.

   Sans lui, une page ouverte hors ligne n'affichait rien du tout : ni HTML, ni CSS,
   ni recettes. Les données déjà chargées survivaient dans le stockage local, mais
   il n'y avait plus d'application pour les afficher. C'est une application de
   cuisine, consultée sur un téléphone, parfois dans une pièce mal couverte.

   Le piège d'un service worker est connu et il est pire que l'absence de cache :
   servir éternellement une vieille version, sans que personne comprenne pourquoi
   l'application ne change plus. Trois règles l'évitent ici :

   1. **La coquille est servie depuis le cache, puis mise à jour en arrière-plan.**
      Un fichier modifié est donc bien récupéré, et s'affiche au chargement suivant :
      une version périmée ne survit jamais plus d'une ouverture. Incrémenter VERSION
      n'est pas obligatoire à chaque déploiement ; c'est le moyen de forcer une purge
      immédiate quand on ne veut pas de ce décalage d'un chargement, ou quand la liste
      COQUILLE elle-même change (un fichier retiré resterait sinon en cache).

   2. **Le réseau gagne pour les données.** `data/recipes.json` est relu depuis le
      réseau quand il répond, et le cache ne sert que de secours. Une recette
      corrigée ne doit pas rester invisible parce qu'une copie traîne.

   3. **Rien de Firestore n'est mis en cache.** La liste de courses et les menus ont
      déjà leur propre cache local, avec une file d'attente et une notion d'âge.
      Un second cache par-dessus servirait des réponses périmées sans que le code
      applicatif le sache, ce qui est exactement le bogue que la suppression du
      sondage automatique avait pour but d'éliminer.

   Portée : ce fichier est servi depuis la racine du site, il contrôle donc toute
   l'application. Sur GitHub Pages, cette racine est /Cahier-de-recette/. */

// v8 : partage-compte.js rejoint la coquille (partage d'un livre ou d'une recette).
var VERSION = 'v8';
var CACHE = 'carnet-' + VERSION;

// La coquille de l'application : tout ce qu'il faut pour afficher un écran. Cette
// liste doit rester alignée sur l'ordre des scripts de index.html, que le workflow
// de publication vérifie déjà.
var COQUILLE = [
  './',
  './index.html',
  './favicon.svg',
  './manifest.webmanifest',
  './icones/icone-192.png',
  './icones/icone-512.png',
  './icones/icone-192-maskable.png',
  './icones/icone-512-maskable.png',
  './icones/apple-touch-icon.png',
  './css/style.css',
  './js/firebase-config.js',
  './js/logic.js',
  './js/quantites.js',
  './js/rayons.js',
  './js/flux.js',
  './js/semaine.js',
  './js/icones.js',
  './js/sync.js',
  './js/acces.js',
  './js/partage-compte.js',
  './js/collection.js',
  './js/recettes.js',
  './js/storage.js',
  './js/semainier.js',
  './js/placard.js',
  './js/livres.js',
  './js/photos.js',
  './js/illustrations.js',
  './js/cuisson.js',
  './js/import-recette.js',
  './js/partage.js',
  './js/pdf.js',
  './js/menu-pdf.js',
  './js/vue-magasin.js',
  './js/vue-bibliotheque.js',
  './js/app.js',
  './data/recipes.json',
];

self.addEventListener('install', function (evenement) {
  evenement.waitUntil(
    caches
      .open(CACHE)
      .then(function (cache) {
        // `reload` force le contournement du cache HTTP du navigateur : sans cela,
        // l'installation pourrait mettre en cache une version déjà périmée.
        return cache.addAll(
          COQUILLE.map(function (url) {
            return new Request(url, { cache: 'reload' });
          })
        );
      })
      // Le nouveau service worker prend la main sans attendre la fermeture de tous
      // les onglets : sinon une correction n'arrive qu'au prochain démarrage complet
      // du navigateur, ce que personne ne fait sur un téléphone.
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', function (evenement) {
  evenement.waitUntil(
    caches
      .keys()
      .then(function (noms) {
        return Promise.all(
          noms
            .filter(function (nom) {
              return nom.indexOf('carnet-') === 0 && nom !== CACHE;
            })
            .map(function (nom) {
              return caches.delete(nom);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

/** Vrai pour tout ce qui ne doit jamais passer par le cache. */
function horsCache(url) {
  // Firestore et l'authentification : ces données ont leur propre cache applicatif,
  // avec un âge affiché. Les doubler ici servirait du périmé en silence.
  return (
    url.hostname.indexOf('googleapis.com') !== -1 ||
    url.hostname.indexOf('firebaseio.com') !== -1 ||
    url.pathname.indexOf('/__firestore/') !== -1 ||
    url.pathname.indexOf('/__auth/') !== -1 ||
    url.pathname.indexOf('/__stub/') !== -1
  );
}

self.addEventListener('fetch', function (evenement) {
  var requete = evenement.request;
  if (requete.method !== 'GET') return;

  var url = new URL(requete.url);
  if (url.origin !== self.location.origin) return;
  if (horsCache(url)) return;

  // Les données passent d'abord par le réseau : une recette corrigée doit arriver.
  // Le cache n'est qu'un secours hors ligne.
  if (url.pathname.indexOf('/data/') !== -1) {
    evenement.respondWith(
      fetch(requete)
        .then(function (reponse) {
          if (reponse && reponse.ok) {
            var copie = reponse.clone();
            caches.open(CACHE).then(function (cache) {
              cache.put(requete, copie);
            });
          }
          return reponse;
        })
        .catch(function () {
          return caches.match(requete);
        })
    );
    return;
  }

  // Le reste, c'est la coquille : le cache d'abord, pour un démarrage immédiat, et
  // une mise à jour en arrière-plan pour la visite suivante.
  evenement.respondWith(
    caches.match(requete).then(function (enCache) {
      var duReseau = fetch(requete)
        .then(function (reponse) {
          if (reponse && reponse.ok) {
            var copie = reponse.clone();
            caches.open(CACHE).then(function (cache) {
              cache.put(requete, copie);
            });
          }
          return reponse;
        })
        .catch(function () {
          // Hors ligne et rien en cache : on laisse le navigateur afficher son
          // erreur, plutôt que de rendre une page vide qui ressemblerait à un bogue.
          return enCache || Response.error();
        });

      return enCache || duReseau;
    })
  );
});
