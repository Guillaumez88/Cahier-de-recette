# Mon carnet de recettes

Carnet personnel de 20 recettes extraites de leurs sites d'origine (Journal des Femmes Cuisine, Marmiton, Cuisine Actuelle, CuisineAZ, Plaisirs culinaires), converties en une base structurée et présentées par un site statique : recherche, filtres, fiche complète, tableau de flux, liste de courses, impression.

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
    │   ├── quantites.js         Lecture, addition et mise à l'échelle des quantités
    │   ├── rayons.js            Classement des ingrédients par rayon de magasin
    │   ├── flux.js              Déroulé des préparations : génération et mise à l'échelle
    │   ├── sync.js              Firestore par son API REST, session anonyme
    │   ├── recettes.js          Recettes d'origine, modifications partagées, parts
    │   ├── storage.js           Liste commune : cache local, fusion, file d'attente
    │   └── app.js               Rendu DOM et routage par ancre
    ├── data/recipes.json        Les 20 recettes
    ├── favicon.svg
    ├── tools/
    │   └── importer-extraction.js  Import d'une extraction Markdown (voir plus bas)
    └── tests/
        ├── run-tests.js            67 tests de la logique métier
        ├── run-sync-tests.js       53 tests de la synchronisation
        ├── test-web.js             61 vérifications navigateur, parcours général
        ├── test-partage.js         28 vérifications navigateur, partage et hors ligne
        ├── test-edition.js         59 vérifications navigateur, modification, parts, déroulé
        ├── stub-firestore.js       Émulation de Firestore pour les tests
        ├── serveur-test.js         Site + émulation sur le même port
        ├── run-browser-tests.js    Enchaîne serveur et suites navigateur
        ├── verifier-firebase.js     Contrôle en conditions réelles (opt-in)
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

- **Routage par ancre** : `#/`, `#/recette/<id>`, `#/recette/<id>/modifier`, `#/liste-de-courses`. Les URL sont partageables et le bouton de retour du navigateur fonctionne. C'est aussi ce qui permet un hébergement statique sans configuration : aucun chemin profond n'est demandé au serveur.
- **Recherche** insensible à la casse et aux accents, portant sur le titre, la catégorie, l'origine, les ingrédients et le texte des étapes. Plusieurs mots se cumulent.
- **Filtres** par catégorie, origine, difficulté et tranche de temps total. Un clic sur un filtre actif le désactive.
- **Fiche complète** : temps, origine, ingrédients par groupe, étapes numérotées avec leurs astuces, tableau de flux, astuces, variantes, recettes associées, ce que la source ne donne pas, source citée avec son lien.
- **Déroulé des préparations** : le tableau fourni avec la recette quand il existe, reconstitué automatiquement sinon (voir plus bas).
- **Liste de courses commune** (voir la section suivante) : partagée entre tous les appareils, rangée par rayon de magasin, avec addition des quantités d'un même ingrédient, sélection d'ingrédients à la carte, ajout d'articles libres, compteur dans l'en-tête et fonctionnement hors ligne.
- **Modification des recettes** et **changement du nombre de parts** (voir plus bas).
- **Impression** (`@media print`) : la navigation, les filtres et les boutons disparaissent, le fond repasse en blanc, et les étapes comme les lignes du tableau ne sont pas coupées entre deux pages.

## Liste de courses commune

Une seule liste, partagée par tous ceux qui ouvrent le site. Ce que l'un ajoute ou coche apparaît chez les autres.

### Comment on l'utilise

- Sur une fiche recette : cocher les ingrédients voulus puis « Ajouter la sélection », ou « Tout ajouter à la liste » pour la recette entière. Les ingrédients déjà dans la liste sont marqués et leur case est désactivée.
- Sur la page liste : un champ permet d'ajouter un article libre (« pain », « lessive ») avec sa quantité, hors recette. Les articles sont groupés par recette, les ajouts libres à part.
- Cocher un article le barre chez tout le monde. « Retirer les cochés » fait le ménage au retour des courses.
- La liste se rafraîchit **toutes les 5 secondes** et un bouton « Rafraîchir » force la mise à jour. Un bandeau indique l'heure de la dernière synchronisation.

### Rangement par rayon et addition des quantités

La liste est rangée dans l'ordre d'un parcours de magasin : Fruits et légumes, Viandes et poissons, Crèmerie, Boulangerie, Surgelés, Épices et herbes, Épicerie salée, Épicerie sucrée, Boissons. On ne revient donc pas trois fois au même rayon.

Le classement se fait par mots-clés dans `js/rayons.js`, et les 126 ingrédients du carnet sont tous classés, ce qu'un test vérifie. Trois traitements évitent des erreurs constatées sur les données réelles : la ligature `œ` est convertie en `oe` (sans quoi « Œufs » n'était pas reconnu, et « Bœuf haché » partait en crèmerie), ce qui suit « pour » est ignoré car c'est un usage et non un produit (« Farine pour beurre manié » est de la farine), et les parenthèses de la source sont retirées. Un ingrédient inclassable tomberait dans « Autre », ce qui est un signal à traiter, pas un résultat normal.

**Les quantités du même ingrédient s'additionnent** : 300 g de beurre venus d'une recette et 125 g d'une autre donnent une seule ligne « Beurre 425 g », avec le nom des recettes d'origine en regard. Les conversions se font dans une même famille (50 cl + 1 l = 1,5 l), jamais entre familles : « 3 c. à s. » et « 200 g » restent affichés côte à côte, et une cuillère à soupe n'est pas convertie en cuillère à café.

Deux garde-fous délibérés :

- **Rien n'est perdu.** Une quantité non chiffrable (« Selon goût », « Pour le moule ») est conservée mot pour mot, et un commentaire attaché à un nombre (« 130 g, plus pour le moule ») n'est jamais fondu dans un total, ce qui l'effacerait.
- **La fusion ne rapproche que des noms identiques**, à la casse, aux accents, à la ligature et au pluriel près : « Œufs » rejoint « Œuf », mais « Sucre glace » n'est pas confondu avec « Sucre en poudre », ni « Beurre » avec « Beurre mou ». Additionner sur une ressemblance approximative donnerait une liste fausse. Pour regrouper deux libellés voisins, renommez l'un des deux dans la recette.

La fusion est faite à l'affichage, pas en base : chaque ingrédient de chaque recette reste un document Firestore distinct. C'est ce qui permet de retirer une recette et de voir le total baisser d'autant, et c'est aussi ce qui préserve la propriété de concurrence : deux personnes qui cochent ne se marchent pas dessus. Cocher ou supprimer une ligne agit sur toutes ses contributions en une seule salve.

### Comment ça marche

Un document Firestore **par article**, dans `listes/commune/articles`, et non un seul document contenant toute la liste. C'est ce qui permet à deux personnes de cocher en même temps sans que l'une écrase le travail de l'autre : chacune modifie un document différent, et une modification n'envoie que le champ concerné.

Le rendu lit toujours une copie locale de la liste, jamais le réseau directement. Les modifications sont appliquées d'abord en local, puis inscrites dans une file d'attente persistée et envoyées. Conséquence concrète : au supermarché, sans réseau, la liste reste consultable et cochable, le bandeau affiche « Hors ligne, N modifications en attente d'envoi », et tout part au retour de la connexion. Sans cette file, cocher hors ligne serait perdu au rafraîchissement suivant.

La session est ouverte automatiquement en mode anonyme, sans rien demander. Elle ne sert qu'à satisfaire les règles de sécurité.

### Configuration Firebase : ce qui reste à faire côté console

La configuration Firebase est déjà dans `recipe-app/js/firebase-config.js`. Elle est publique par conception : elle identifie le projet, elle ne donne aucun droit. Ce qui protège les données, ce sont les règles de sécurité.

Le projet `cahier-de-cuisine-88` est configuré : base Firestore créée, connexion anonyme activée, domaine `guillaumez88.github.io` autorisé, et la liste de courses fonctionne (vérifiée en conditions réelles, voir ci-dessous).

Les règles couvrant la collection des recettes modifiées ont été republiées et vérifiées : `node tests/verifier-firebase.js --reel` passe ses 11 contrôles, collection `recettes` comprise.

Si l'application affiche un jour un bandeau `PERMISSION_DENIED` sur les recettes, c'est que les règles publiées ont divergé de `firestore.rules` : les republier depuis le fichier du dépôt, puis relancer ce contrôle.

Les quatre réglages, pour mémoire, s'il fallait refaire le projet ou en créer un second :

1. **Créer la base Firestore.** Console Firebase → *Firestore Database* → *Créer une base de données* → mode **production** → région européenne. Le mode test n'est pas conseillé : il ouvre tout pendant 30 jours puis ferme tout d'un coup, ce qui donne une panne inexpliquée un mois plus tard.
2. **Publier les règles** : onglet *Règles* de Firestore → coller `firestore.rules` → *Publier*. En mode production, les règles par défaut refusent tout.
3. **Activer la connexion anonyme** : *Authentication* → *Sign-in method* → *Anonyme*.
4. **Autoriser le domaine** : *Authentication* → *Settings* → *Authorized domains* → `guillaumez88.github.io`.

### Contrôler que Firebase répond vraiment

```bash
cd recipe-app
node tests/verifier-firebase.js --reel
```

À la différence des autres suites, celle-ci n'utilise **aucune émulation** : elle charge `sync.js` et `storage.js` avec la configuration réelle et écrit dans la vraie base. Le drapeau `--reel` est obligatoire pour qu'elle ne puisse pas partir par accident ni en CI. Les articles créés portent la recette `__verification__` et sont supprimés à la fin, même en cas d'échec ; le script compte les articles réels avant et après pour prouver qu'il n'y a pas touché.

Onze contrôles : session anonyme, écriture d'un document par article, conservation des accents et des quantités à l'aller-retour, cochage n'écrivant que le champ concerné, relecture depuis un cache local vide (le cas du second appareil), article libre, retrait des cochés, suppression, intégrité des articles préexistants, puis accès à la collection des recettes et cycle complet d'une recette modifiée.

Au 3 août 2026, les onze passent. En cas d'échec sur la collection des recettes, le message nomme précisément l'action à faire.

C'est le contrôle à lancer après toute modification de la configuration Firebase ou des règles : si le bandeau du site reste sur « Hors ligne », il nomme la cause exacte (`SERVICE_DISABLED`, `CONFIGURATION_NOT_FOUND` ou `PERMISSION_DENIED`).

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
node tests/run-tests.js           # 67 tests de la logique métier
node tests/run-sync-tests.js      # 53 tests de la synchronisation
node tests/run-browser-tests.js   # 148 vérifications dans un vrai Chromium
```

`run-tests.js` couvre l'analyse des durées, la normalisation des origines et difficultés en texte libre, la recherche, la combinaison des filtres, le test d'informativité du tableau de flux et l'intégrité du jeu de données.

`run-sync-tests.js` couvre la synchronisation de bout en bout : session anonyme et renouvellement de jeton, encodage des valeurs Firestore, écriture d'un document par article, mise à jour par masque de champs, propagation d'un appareil à l'autre, sélection partielle, articles libres, et tout le comportement hors ligne (cochage différé, file d'attente persistée, envoi dans l'ordre au retour du réseau, opération en échec conservée en tête de file). Ces tests **n'appellent jamais votre projet Firebase** : ils lancent l'émulation de `stub-firestore.js` sur un port local, qui sait aussi simuler une panne réseau à la demande.

`test-web.js` couvre le parcours général dans Chromium : les 20 vignettes, la recherche, les filtres, la conservation du focus pendant la saisie, la résolution de la grille fusionnée du tableau de flux (5 colonnes, telle que le navigateur la calcule), l'identifiant inconnu, le mode impression et l'absence de débordement horizontal en 360 px.

`test-partage.js` ouvre **deux contextes Chromium isolés**, c'est-à-dire deux appareils avec des stockages locaux distincts, sur la même base. C'est le seul montage qui prouve réellement le partage : ce que l'un ajoute ou coche doit apparaître chez l'autre, par le rafraîchissement automatique comme par le bouton manuel. La même suite coupe le réseau, vérifie que cocher fonctionne quand même et que les modifications en attente sont annoncées, puis rétablit le réseau et vérifie qu'elles sont bien parties.

Playwright n'est pas une dépendance du projet. Pour l'installer : `npm i -D playwright && npx playwright install chromium`. Pour désigner une installation existante : `PLAYWRIGHT_MODULE=/chemin/vers/node_modules/playwright CHROMIUM_PATH=/chemin/vers/chromium node tests/run-browser-tests.js`.

La CI joue les tests unitaires et ceux de synchronisation, qui ne demandent aucune installation. Les tests navigateur restent une étape locale, faute de Playwright en CI.

## Déroulé des préparations

La fiche affiche un tableau qui montre à quelle étape chaque ingrédient entre. Deux sources possibles, dans cet ordre de préférence :

**1. Le tableau fourni avec la recette.** Une seule recette du carnet en a un : `lasagnes-bolognaise`. Il est rendu comme un vrai `<table>` avec ses `rowspan`/`colspan` d'origine, dans un conteneur qui défile horizontalement sur petit écran. Il va plus loin que ce qu'on sait générer : il regroupe les ingrédients en sous-préparations qui convergent (la sauce tomate, la béchamel), ce qui est une interprétation humaine du texte. Un tableau fourni est donc toujours préféré.

**2. Un déroulé reconstitué**, pour les seize autres. Le tableau que la source avait produit pour elles ne contenait que des marqueurs répétés (« ✓ », « Selon étapes », « Si concerné ») sans information propre à la recette : il n'est plus affiché. À la place, `js/flux.js` reconstruit le déroulé à partir de ce que la recette contient déjà, en cherchant pour chaque ingrédient la première étape qui le nomme. Le tableau se lit « à l'étape 2, ces ingrédients entrent, et voilà ce qu'on en fait ».

**Il n'y a donc rien à réimporter.**

### Ce que la reconstitution sait faire, et ce qu'elle ne sait pas

Mesuré sur les 20 recettes : **182 ingrédients sur 198 sont rattachés à une étape, soit 92 %**, et 11 recettes le sont entièrement. Un test protège ce plancher.

Les 11 restants ne sont pas des défauts réparables, mais des cas où l'instruction désigne une catégorie plutôt qu'un produit :

| Cas | Ce que dit l'instruction | Ce que dit la liste |
| --- | --- | --- |
| Fondue savoyarde | « faire fondre les fromages » | Beaufort, Comté, Tomme de Savoie |
| Gratin, cake aux olives | « saler » | Sel |
| Carrot cake | « ajouter les épices » | Cannelle, gingembre en poudre |
| Tiramisu | « les jaunes », « les blancs » | Œufs |

Ces ingrédients sont **listés sous le tableau**, sous la mention « Non rattaché à une étape, faute d'être nommé dans le texte », plutôt que placés au hasard à une étape plausible. Pour les rattacher, il suffit de reformuler l'étape dans l'éditeur (« faire fondre le Beaufort, le Comté et la Tomme »), ce qui est de toute façon plus clair à la lecture.

### Les quantités du tableau suivent le nombre de parts

Les deux formes sont traitées, mais pas de la même façon :

- **Le déroulé reconstitué** n'a rien à recalculer : il est dérivé des ingrédients et des étapes, déjà mis à l'échelle. C'est un argument de fond en faveur de la génération plutôt que du stockage.
- **Le tableau fourni** a ses quantités écrites dans ses cellules, sous la forme « Oignon : 1 », « Beurre : 70 g ». Elles sont recalculées, sinon la fiche afficherait deux valeurs différentes pour le même ingrédient. Un détail avait son importance : la partie droite d'un « Nom : quantité » est souvent un **nombre nu**, que la liste blanche d'unités refuse par principe de toucher. Ces cellules sont donc traitées comme des quantités et non comme du texte libre, tandis que les cellules d'action (« Enfourner 45 min à 165 °C ») restent sous la liste blanche et gardent leurs durées et températures. Un test vérifie cellule par cellule qu'aucune durée ni température ne bouge, et que les fusions `rowspan`/`colspan` sont préservées.

## Modifier une recette, changer le nombre de parts

Depuis une fiche, « Modifier la recette » ouvre un formulaire (`#/recette/<id>/modifier`) qui permet de corriger le titre, la catégorie, l'origine, la difficulté, les quatre durées, les ingrédients (avec leurs sections) et les étapes avec leurs astuces. Le rayon déduit de chaque ingrédient est affiché en regard, ce qui permet de voir tout de suite l'effet d'un renommage sur la liste de courses.

Les modifications sont **partagées** comme la liste de courses, dans une collection Firestore `recettes`. Chaque recette modifiée y est enregistrée comme une seule chaîne JSON : une recette est un objet profondément imbriqué, et on ne l'interroge jamais champ par champ, on la lit en entier. Le coût assumé est qu'une recette n'est pas interrogeable côté serveur.

**`data/recipes.json` n'est jamais modifié.** Une recette modifiée remplace l'originale à l'affichage ; « Rétablir l'originale » supprime la version modifiée et la recette d'origine reprend sa place. Aucune modification n'est donc irréversible.

Une nuance à connaître : les recettes modifiées sont relues au chargement de la page et après chaque enregistrement, pas en continu. Une recette modifiée sur un autre appareil apparaît donc au prochain rafraîchissement de la page, contrairement à la liste de courses qui se met à jour toutes les cinq secondes. Sonder en permanence des données qui changent quelques fois par mois coûterait des lectures Firestore pour rien.

### Nombre de parts

Le formulaire porte un réglage du nombre de parts, avec deux boutons et un champ. Le changer recalcule proportionnellement :

- les quantités des ingrédients, en accordant les unités dénombrables (« 1 gousse » devient « 2 gousses », « 2 morceaux » devient « 4 morceaux ») ;
- les quantités qui figurent **dans le texte des instructions** (« ajouter 800 g de pulpe » devient « 1600 g »).

Un rapport affiche le facteur appliqué, la liste des quantités ajustées dans les instructions, et ce qui a été laissé inchangé faute de quantité chiffrée (« Sel, poivre : Selon le goût »). Rien n'est enregistré avant d'avoir cliqué sur « Enregistrer ».

**Le point délicat, traité explicitement : les durées et les températures ne sont jamais multipliées.** Doubler une recette ne double ni le temps de cuisson ni la température du four. Sur les 75 occurrences numériques des instructions des 20 recettes, 69 sont des durées (minutes, heures), des températures (°C) ou des dimensions (cm, mm), et 6 seulement sont des quantités : un facteur appliqué naïvement transformerait « 45 minutes » en « 90 minutes » et « 165 °C » en « 330 °C ». La mise à l'échelle travaille donc sur **liste blanche d'unités** (masses, volumes, cuillerées, gousses, pincées, sachets, tranches) et ne touche jamais un nombre nu, qui serait ambigu (« thermostat 6 »). Un test vérifie, sur les 20 recettes et pour chaque étape, qu'aucune durée ni température ne bouge après un changement de parts.

Si le nombre de parts ne commence pas par un nombre, le recalcul automatique est désactivé et le formulaire le dit, plutôt que de deviner.

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

`origine` et `difficulte` sont du texte libre : les filtres travaillent sur des étiquettes courtes dérivées par mots-clés (`origineCourte`, `difficulteCourte` dans `js/logic.js`), le texte intégral restant affiché sur la fiche. Les 20 recettes sont toutes classées ; une source formulée autrement retomberait sur « Autre », et un test le signalerait.

Pour ajouter une recette : modifier `data/recipes.json`, puis `node tests/run-tests.js`, qui contrôle le schéma, l'unicité des identifiants et la validité des URL de source.

## Importer une extraction

`node tools/importer-extraction.js <fichier.md>` lit une extraction Markdown (une recette par section `## n. Titre`, avec les tableaux « Fiche recette » et « Ingrédients ») et l'ajoute à `data/recipes.json`. Sans `--ecrire`, l'outil ne fait qu'un essai à blanc et affiche ce qu'il ferait.

Deux règles sont tenues par le code, pas par la vigilance de l'opérateur :

1. **Aucune recette existante n'est écrasée.** L'appariement se fait sur des ensembles de mots du titre, et non sur une égalité de chaînes : « Lasagnes bolognaise » est reconnue comme la recette déjà présente sous « Lasagnes bolognaise : la meilleure recette ». Sans cela, la dernière extraction aurait créé trois doublons. Quand plusieurs candidates conviennent, l'outil refuse d'écrire plutôt que de choisir.

2. **Aucune unité n'est inventée.** Quand l'extraction a collé la quantité au nom de l'ingrédient et perdu l'unité au passage (« Farine 200 » sans `g`, « sel 1 c. à » tronqué), la valeur est reprise telle quelle et le manque est écrit dans le champ `manquants` de la recette, que la fiche affiche sous « Ce que la source ne donne pas ». Cette détection est mécanique : elle ne se déclenche que lorsque la colonne quantité était vide et que le nombre a dû être extrait du nom.

Les 17 recettes antérieures n'ont **pas** été réécrites depuis la dernière extraction : celle-ci est en recul mesuré sur les recettes déjà présentes (de −29 % à −80 % de texte d'instructions, et par exemple 17 ingrédients ramenés à 12). Seules les 3 recettes absentes du carnet ont été ajoutées. Les trois sites sources sont inaccessibles depuis l'environnement de développement, les unités perdues n'ont donc pas pu être recoupées : elles sont à corriger dans l'éditeur de l'application.

## Trois constats sur les données, non corrigés volontairement

Ces écarts viennent des sources. Ils sont signalés plutôt que masqués, et le code les tolère.

1. **Un seul tableau de flux sur 20 porte une information.** Seul `lasagnes-bolognaise` a un tableau construit à la main (5 colonnes, cellules fusionnées, 15 lignes d'ingrédients). Les 16 tableaux fournis par les extractions précédentes ne contiennent que des marqueurs répétés à l'identique (« ✓ », « Selon étapes », « Si concerné ») et ne sont donc pas affichés ; les 3 recettes de la dernière extraction n'en embarquent plus du tout, pour la même raison. C'est sans conséquence à l'affichage : l'application reconstitue le déroulé depuis les étapes (voir plus haut), ce qui est plus juste qu'un tableau de marqueurs.

2. **Un numéro d'étape n'est pas un entier.** Dans `lasagnes-bolognaise`, la 6ᵉ étape porte `"numero": "Pour finir"`, libellé repris du site source. Le schéma annonce un entier. La donnée n'a pas été réécrite : le libellé est affiché tel quel, et un test échouera si une nouvelle recette introduit une autre forme.

3. **Vingt quantités sur 198 n'ont pas d'unité (7, 7 et 6 pour les trois recettes de la dernière extraction), et une recette n'a pas de nombre de parts.** L'unité manque à la source telle qu'elle a été extraite, et n'a pas été devinée. Chaque recette concernée le déclare dans son champ `manquants`, affiché sur la fiche. Conséquence assumée : pour `gougeres-de-courgettes-et-comte`, faute de nombre de parts exploitable (« Non indiqué »), le recalcul automatique des quantités est désactivé.

Un quatrième écart, mineur : pour `lasagnes-bolognaise`, le tableau de flux détaille 15 lignes d'ingrédients contre 14 dans la liste `ingredients`, parce qu'il isole « sel, poivre » pour la béchamel.

## Historique

Une seconde version, en React Native / Expo (mobile plus export web), a existé dans `recipe-app-native/`. Elle a été retirée : cette version web statique est plus aboutie, et maintenir deux bases pour un carnet personnel coûtait plus qu'elle n'apportait. Le code reste consultable dans l'historique Git, jusqu'au commit précédant sa suppression.

## Conventions

- Interface et contenus en français, typographie française.
- Palette « carnet de cuisine chaleureux » définie dans le bloc `:root` de `css/style.css`, source unique des couleurs.
- `app.js` ne lit jamais le `localStorage` ni ne filtre lui-même : il passe par `logic.js` et `storage.js`. Cette séparation est ce qui rendra possible un changement de stockage sans toucher au rendu.
