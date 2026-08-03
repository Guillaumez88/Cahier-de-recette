# Mon carnet de recettes

Carnet personnel de 17 recettes extraites de leurs sites d'origine (Journal des Femmes Cuisine, Marmiton, Cuisine Actuelle), converties en une base structurée et présentées par un site statique : recherche, filtres, fiche complète, tableau de flux, liste de courses, impression.

En ligne : `https://guillaumez88.github.io/Cahier-de-recette/`

Aucune dépendance, aucune étape de construction, aucun framework : cinq fichiers JavaScript, une feuille de style, un fichier de données. La liste de courses est commune à tous les appareils, stockée dans Firestore et appelée par son API REST en `fetch`, sans le SDK Firebase.

## Structure

```
.
├── .github/workflows/deploy-pages.yml   Tests puis publication sur GitHub Pages
├── firestore.rules                      Règles de sécurité de la liste commune
└── recipe-app/
    ├── index.html               Structure de la page, un seul point de montage
    ├── css/style.css            Thème « carnet de cuisine chaleureux », responsive, impression
    ├── js/
    │   ├── firebase-config.js   Configuration Firebase (publique) et réglages de sync
    │   ├── logic.js             Logique métier : durées, filtres, recherche, tableau de flux
    │   ├── sync.js              Firestore par son API REST, session anonyme
    │   ├── storage.js           Liste commune : cache local, file d'attente hors ligne
    │   └── app.js               Rendu DOM et routage par ancre
    ├── data/recipes.json        Les 17 recettes
    ├── favicon.svg
    └── tests/
        ├── run-tests.js            26 tests de la logique métier
        ├── run-sync-tests.js       26 tests de la synchronisation
        ├── test-web.js             57 vérifications navigateur, parcours général
        ├── test-partage.js         28 vérifications navigateur, partage et hors ligne
        ├── stub-firestore.js       Émulation de Firestore pour les tests
        ├── serveur-test.js         Site + émulation sur le même port
        ├── run-browser-tests.js    Enchaîne serveur et suites navigateur
        └── serveur.js              Serveur statique sans dépendance
```

Tous les modules s'exportent sur `window` dans le navigateur et en CommonJS sous Node, sans transpilation : les tests les chargent directement. L'ordre de chargement dans `index.html` est significatif, chaque script consommant les précédents : `firebase-config.js`, `logic.js`, `sync.js`, `storage.js`, `app.js`.

`app.js` ne parle jamais au réseau ni au `localStorage` : il passe par `storage.js`, qui est le seul endroit décidant où sont rangées les données.

## Lancer en local

```bash
cd recipe-app
node tests/serveur.js          # puis http://127.0.0.1:8102/
# ou, au choix
python3 -m http.server 8000
```

Un double-clic sur `index.html` ne fonctionne pas : la page lit `data/recipes.json` avec `fetch()`, que les navigateurs bloquent sur une URL `file://`. La page affiche alors un message expliquant la commande à lancer, plutôt que de rester vide.

## Fonctionnalités

- **Routage par ancre** : `#/`, `#/recette/<id>`, `#/liste-de-courses`. Les URL sont partageables et le bouton de retour du navigateur fonctionne. C'est aussi ce qui permet un hébergement statique sans configuration : aucun chemin profond n'est demandé au serveur.
- **Recherche** insensible à la casse et aux accents, portant sur le titre, la catégorie, l'origine, les ingrédients et le texte des étapes. Plusieurs mots se cumulent.
- **Filtres** par catégorie, origine, difficulté et tranche de temps total. Un clic sur un filtre actif le désactive.
- **Fiche complète** : temps, origine, ingrédients par groupe, étapes numérotées avec leurs astuces, tableau de flux, astuces, variantes, recettes associées, ce que la source ne donne pas, source citée avec son lien.
- **Tableau de flux** rendu comme un vrai `<table>` avec les `rowspan`/`colspan` d'origine, dans un conteneur qui défile horizontalement sur petit écran.
- **Liste de courses commune** (voir la section suivante) : partagée entre tous les appareils, avec sélection d'ingrédients à la carte, ajout d'articles libres, cases à cocher, compteur dans l'en-tête et fonctionnement hors ligne.
- **Impression** (`@media print`) : la navigation, les filtres et les boutons disparaissent, le fond repasse en blanc, et les étapes comme les lignes du tableau ne sont pas coupées entre deux pages.

## Liste de courses commune

Une seule liste, partagée par tous ceux qui ouvrent le site. Ce que l'un ajoute ou coche apparaît chez les autres.

### Comment on l'utilise

- Sur une fiche recette : cocher les ingrédients voulus puis « Ajouter la sélection », ou « Tout ajouter à la liste » pour la recette entière. Les ingrédients déjà dans la liste sont marqués et leur case est désactivée.
- Sur la page liste : un champ permet d'ajouter un article libre (« pain », « lessive ») avec sa quantité, hors recette. Les articles sont groupés par recette, les ajouts libres à part.
- Cocher un article le barre chez tout le monde. « Retirer les cochés » fait le ménage au retour des courses.
- La liste se rafraîchit **toutes les 5 secondes** et un bouton « Rafraîchir » force la mise à jour. Un bandeau indique l'heure de la dernière synchronisation.

### Comment ça marche

Un document Firestore **par article**, dans `listes/commune/articles`, et non un seul document contenant toute la liste. C'est ce qui permet à deux personnes de cocher en même temps sans que l'une écrase le travail de l'autre : chacune modifie un document différent, et une modification n'envoie que le champ concerné.

Le rendu lit toujours une copie locale de la liste, jamais le réseau directement. Les modifications sont appliquées d'abord en local, puis inscrites dans une file d'attente persistée et envoyées. Conséquence concrète : au supermarché, sans réseau, la liste reste consultable et cochable, le bandeau affiche « Hors ligne, N modifications en attente d'envoi », et tout part au retour de la connexion. Sans cette file, cocher hors ligne serait perdu au rafraîchissement suivant.

La session est ouverte automatiquement en mode anonyme, sans rien demander. Elle ne sert qu'à satisfaire les règles de sécurité.

### Configuration Firebase : ce qui reste à faire côté console

La configuration Firebase est déjà dans `recipe-app/js/firebase-config.js`. Elle est publique par conception : elle identifie le projet, elle ne donne aucun droit. Ce qui protège les données, ce sont les règles de sécurité.

**Au 3 août 2026, deux réglages manquent dans le projet `cahier-de-cuisine-88`** et la liste ne fonctionnera pas avant qu'ils soient faits. Vérifié par appel direct aux API : Firestore répond `SERVICE_DISABLED`, l'authentification répond `CONFIGURATION_NOT_FOUND`. Enregistrer l'application web ne suffit pas.

1. **Créer la base Firestore.** Console Firebase → *Firestore Database* → *Créer une base de données* → mode **production** → région `europe-west` (ou une autre région européenne). Le mode test n'est pas conseillé : il ouvre tout pendant 30 jours puis ferme tout d'un coup, ce qui donne une panne inexpliquée un mois plus tard.

2. **Publier les règles.** Onglet *Règles* de Firestore → coller le contenu de `firestore.rules` (à la racine de ce dépôt) → *Publier*. En mode production, les règles par défaut refusent tout : sans cette étape le bandeau affichera « Hors ligne » en permanence.

3. **Activer la connexion anonyme.** Console → *Authentication* → *Commencer* → onglet *Sign-in method* → *Anonyme* → activer.

4. **Autoriser le domaine du site.** Console → *Authentication* → *Settings* → *Authorized domains* → ajouter `guillaumez88.github.io` s'il n'y figure pas.

Une fois ces quatre points faits, ouvrir le site : le bandeau doit passer à « Liste commune, à jour à hh:mm:ss ». S'il reste sur « Hors ligne », le message d'erreur affiché juste en dessous indique la cause exacte (`PERMISSION_DENIED` pour des règles non publiées, `CONFIGURATION_NOT_FOUND` pour la connexion anonyme non activée).

### Ce que ce choix implique, sans le cacher

- **Qui connaît l'URL du site peut lire et modifier la liste.** La session anonyme est gratuite et automatique : elle bloque les robots qui scannent les clés d'API publiques, pas une personne qui ouvre le site. C'est le compromis retenu pour une liste familiale. Pour aller plus loin il faudrait de vrais comptes, ou App Check pour n'autoriser que votre domaine.
- **On ne sait pas qui a coché quoi.** Les sessions anonymes ne portent pas de nom. Le champ existe côté données si vous voulez l'ajouter plus tard.
- **Un sondage toutes les 5 secondes, pas du temps réel.** C'est ce qui a été demandé, et cela évite le SDK Firebase et son bundle.

  Attention au coût, car il n'est pas négligeable : Firestore facture à la lecture de document, et le palier gratuit est de 50 000 lectures par jour. À 5 secondes d'intervalle, un onglet fait 720 sondages par heure ; avec 10 articles en liste cela fait 7 200 lectures par heure, soit le palier gratuit épuisé en **sept heures** par un seul onglet laissé ouvert.

  Pour cette raison, le sondage est **suspendu quand l'onglet n'est pas visible** et relancé immédiatement au retour dessus : le coût suit alors l'usage réel, quelques minutes de consultation par jour. Si le palier était malgré tout atteint, le levier suivant est de porter `intervalleRafraichissement` à 15 ou 30 secondes dans `firebase-config.js`, une seule valeur à changer.
- **Aucun test ne touche votre projet réel.** L'émulation locale sert à tout vérifier. Le revers est que le comportement contre le vrai Firestore n'est pas prouvé : c'est le premier point à confirmer après la configuration.

## Tests

```bash
cd recipe-app
node tests/run-tests.js           # 26 tests de la logique métier
node tests/run-sync-tests.js      # 26 tests de la synchronisation
node tests/run-browser-tests.js   # 85 vérifications dans un vrai Chromium
```

`run-tests.js` couvre l'analyse des durées, la normalisation des origines et difficultés en texte libre, la recherche, la combinaison des filtres, le test d'informativité du tableau de flux et l'intégrité du jeu de données.

`run-sync-tests.js` couvre la synchronisation de bout en bout : session anonyme et renouvellement de jeton, encodage des valeurs Firestore, écriture d'un document par article, mise à jour par masque de champs, propagation d'un appareil à l'autre, sélection partielle, articles libres, et tout le comportement hors ligne (cochage différé, file d'attente persistée, envoi dans l'ordre au retour du réseau, opération en échec conservée en tête de file). Ces tests **n'appellent jamais votre projet Firebase** : ils lancent l'émulation de `stub-firestore.js` sur un port local, qui sait aussi simuler une panne réseau à la demande.

`test-web.js` couvre le parcours général dans Chromium : les 17 vignettes, la recherche, les filtres, la conservation du focus pendant la saisie, la résolution de la grille fusionnée du tableau de flux (5 colonnes, telle que le navigateur la calcule), l'identifiant inconnu, le mode impression et l'absence de débordement horizontal en 360 px.

`test-partage.js` ouvre **deux contextes Chromium isolés**, c'est-à-dire deux appareils avec des stockages locaux distincts, sur la même base. C'est le seul montage qui prouve réellement le partage : ce que l'un ajoute ou coche doit apparaître chez l'autre, par le rafraîchissement automatique comme par le bouton manuel. La même suite coupe le réseau, vérifie que cocher fonctionne quand même et que les modifications en attente sont annoncées, puis rétablit le réseau et vérifie qu'elles sont bien parties.

Playwright n'est pas une dépendance du projet. Pour l'installer : `npm i -D playwright && npx playwright install chromium`. Pour désigner une installation existante : `PLAYWRIGHT_MODULE=/chemin/vers/node_modules/playwright CHROMIUM_PATH=/chemin/vers/chromium node tests/run-browser-tests.js`.

La CI joue les tests unitaires et ceux de synchronisation, qui ne demandent aucune installation. Les tests navigateur restent une étape locale, faute de Playwright en CI.

## Schéma d'une recette

```json
{
  "id": "identifiant-slug-unique",
  "titre": "...",
  "categorie": "Entrée | Plat | Dessert",
  "origine": "texte libre, souvent une origine déduite et justifiée",
  "difficulte": "texte libre",
  "portions": "texte libre (ex. 6 personnes)",
  "temps": { "preparation": "...", "cuisson": "...", "repos": "...", "total": "..." },
  "calories": "texte libre ou null",
  "source": { "label": "...", "url": "https://..." },
  "ingredients": [ { "groupe": "nom de section ou null", "items": [ { "nom": "...", "quantite": "..." } ] } ],
  "instructions": [ { "numero": 1, "texte": "...", "astuce": "... ou null" } ],
  "astuces": { "recette": ["..."], "commentaires": ["..."] },
  "variantes": { "recette": ["..."], "associees": ["..."] },
  "manquants": ["éléments signalés comme non extractibles de la source"],
  "flowTable": {
    "headers": ["Élément", "..."],
    "rows": [ [ { "text": "...", "rowspan": 1, "colspan": 1 } ] ]
  }
}
```

`origine` et `difficulte` sont du texte libre : les filtres travaillent sur des étiquettes courtes dérivées par mots-clés (`origineCourte`, `difficulteCourte` dans `js/logic.js`), le texte intégral restant affiché sur la fiche. Les 17 recettes sont toutes classées ; une source formulée autrement retomberait sur « Autre », et un test le signalerait.

Pour ajouter une recette : modifier `data/recipes.json`, puis `node tests/run-tests.js`, qui contrôle le schéma, l'unicité des identifiants et la validité des URL de source.

## Deux constats sur les données, non corrigés volontairement

Ces écarts viennent des sources. Ils sont signalés plutôt que masqués, et le code les tolère.

1. **16 tableaux de flux sur 17 ne portent aucune information.** Seul `lasagnes-bolognaise` a un tableau construit à la main (5 colonnes, cellules fusionnées, 15 lignes d'ingrédients). Les 16 autres, générés automatiquement, ne contiennent que des marqueurs répétés à l'identique (« ✓ », « Selon étapes », « Si concerné »). Le tableau n'est donc affiché que lorsqu'il apporte quelque chose. Reconstruire les 16 manquants demande de relire chaque recette : à décider, ce n'est pas automatisable.

2. **Un numéro d'étape n'est pas un entier.** Dans `lasagnes-bolognaise`, la 6ᵉ étape porte `"numero": "Pour finir"`, libellé repris du site source. Le schéma annonce un entier. La donnée n'a pas été réécrite : le libellé est affiché tel quel, et un test échouera si une nouvelle recette introduit une autre forme.

Un troisième écart, mineur : pour cette même recette, le tableau de flux détaille 15 lignes d'ingrédients contre 14 dans la liste `ingredients`, parce qu'il isole « sel, poivre » pour la béchamel.

## Historique

Une seconde version, en React Native / Expo (mobile plus export web), a existé dans `recipe-app-native/`. Elle a été retirée : cette version web statique est plus aboutie, et maintenir deux bases pour un carnet personnel coûtait plus qu'elle n'apportait. Le code reste consultable dans l'historique Git, jusqu'au commit précédant sa suppression.

## Conventions

- Interface et contenus en français, typographie française.
- Palette « carnet de cuisine chaleureux » définie dans le bloc `:root` de `css/style.css`, source unique des couleurs.
- `app.js` ne lit jamais le `localStorage` ni ne filtre lui-même : il passe par `logic.js` et `storage.js`. Cette séparation est ce qui rendra possible un changement de stockage sans toucher au rendu.
