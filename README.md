# Miam miam !

Carnet de cuisine de la maison. Trois écrans : le **semainier** des repas de la semaine sur la page d'accueil, le **livre de cuisine** avec ses 21 recettes, et la **liste de courses commune**. Les trois sont partagés entre tous les appareils de la maison : ce que l'un pose, coche ou modifie, les autres le voient.

En ligne : `https://guillaumez88.github.io/Cahier-de-recette/`

Aucune dépendance, aucune étape de construction, aucun framework : dix-sept fichiers JavaScript, une feuille de style, un fichier de données. Le partage passe par Firestore, appelé directement par son API REST en `fetch`, sans le SDK Firebase.

---

# Reprendre ce projet

Cette section s'adresse à qui reprend le code, humain ou modèle. Le reste du fichier
est la référence détaillée, écran par écran ; ici se trouve seulement ce qu'il faut
savoir avant de toucher à quoi que ce soit.

## En cinq minutes

```bash
cd recipe-app
python3 -m http.server 8000        # puis http://localhost:8000
node tests/run-tests.js            # 128 tests de logique, sans navigateur
node tests/run-sync-tests.js       # 115 tests de synchronisation, contre une émulation locale
```

Il n'y a **rien à installer**. Pas de `npm install`, pas de `package.json`, pas d'étape
de construction. Le dossier `recipe-app/` est le site tel qu'il est publié.

Les tests navigateur demandent Playwright, qui n'est volontairement pas une dépendance
du projet (voir « Tests »).

## Les dix invariants

Ce sont les règles que le code tient partout. Les rompre casse le projet d'une façon
qui ne se voit pas tout de suite.

1. **Aucune dépendance, aucune étape de construction.** Pas de CDN, pas de police
   distante, pas de bundler. C'est ce qui fait que le carnet s'ouvre en cuisine avec
   un réseau incertain, et qu'il fonctionnera encore dans cinq ans sans rien réinstaller.
2. **Chaque module s'exporte deux fois** : `window.CarnetX` dans le navigateur,
   `module.exports` sous Node. Sans cela il n'est pas testable.
3. **L'ordre des `<script>` de `index.html` est significatif** : chaque module consomme
   les précédents. Le workflow de publication compare cet ordre à une liste ; un module
   ajouté et oublié dans la page passerait les tests Node et casserait le site.
4. **`app.js` ne touche jamais au réseau ni au stockage.** Il passe par `storage.js`,
   `semainier.js`, `placard.js`, `recettes.js`, `photos.js`, `cuisson.js`. C'est ce qui
   permettra de changer de stockage sans toucher au rendu.
5. **Le cache local est la source du rendu**, jamais le réseau. Les lectures sont
   synchrones, l'affichage n'attend rien, et le carnet reste consultable hors ligne.
6. **Une modification s'applique en local puis part**, via une file d'attente persistée.
   Cocher un article hors ligne fonctionne et repart au retour du réseau.
7. **Une écriture qui échoue n'est jamais annoncée comme réussie.** Voir le piège n° 2.
8. **Rien n'est inventé.** Une donnée absente de la source est écrite dans le champ
   `manquants` de la recette et affichée sous « Ce que la source ne donne pas ». Aucune
   quantité, aucune durée, aucune catégorie n'est devinée pour combler un trou.
9. **Aucun sondage périodique.** Une lecture au chargement, puis un bouton. Voir
   « Pourquoi il n'y a plus de rafraîchissement automatique » : le sondage a épuisé le
   palier gratuit de Firestore en deux heures.
10. **Tout chiffre écrit ici est mesuré**, jamais estimé. Les planchers des tests sont
    remesurés quand les données changent, pas décalés.

## Où se trouve quoi

| Je veux… | Fichier |
|---|---|
| Changer un écran, le routage, une boîte modale | `js/app.js` (4 400 lignes, voir le piège n° 6) |
| L'écran « En magasin » | `js/vue-magasin.js` |
| Filtres, recherche, durées, rappel d'ingrédients de l'étape | `js/logic.js` |
| Lire, additionner, mettre à l'échelle une quantité | `js/quantites.js` |
| Classer un ingrédient par rayon de magasin | `js/rayons.js` |
| Le déroulé reconstitué depuis les étapes | `js/flux.js` |
| Dates, semaines, clés de créneau | `js/semaine.js` |
| Pictogrammes SVG | `js/icones.js` |
| Tous les appels Firestore et l'authentification | `js/sync.js` |
| Une collection partagée (liste, menus, placard) | `js/storage.js`, `js/semainier.js`, `js/placard.js` |
| Recettes modifiées et ajoutées | `js/recettes.js` |
| Photos, redimensionnement, cache IndexedDB | `js/photos.js` |
| Import depuis un site | `js/import-recette.js` |
| Couleurs, espacements, animations | `css/style.css` (bloc `:root` en tête) |
| Le fonctionnement hors ligne | `sw.js` |

## Recettes de modification courantes

**Ajouter un module JavaScript.** Quatre endroits, tous vérifiés par un test ou par le
workflow : le fichier lui-même, la balise `<script>` de `index.html` **à la bonne
place**, la liste `attendus` du workflow `.github/workflows/deploy-pages.yml`, et la
`COQUILLE` de `sw.js`. En oublier un casse soit la publication, soit le hors ligne.

**Ajouter une collection Firestore.** Cinq endroits : `js/sync.js` (chemin, lecture,
écriture, suppression), un module de collection sur le modèle de `js/placard.js`,
`firestore.rules`, l'émulation `tests/stub-firestore.js`, et
`tests/verifier-firebase.js`. **Et il faut republier les règles à la main**, sinon la
fonctionnalité ne marche pas sans que rien ne le dise.

**Ajouter une recette.** Éditer `data/recipes.json`, puis remesurer les planchers des
tests : nombre de recettes, quantités lisibles, ingrédients distincts, étapes,
couverture du déroulé. `node tests/run-tests.js` nomme chaque écart.

**Ajouter un écran.** Le sortir de `app.js` dans son propre module, sur le modèle de
`js/vue-magasin.js` : il reçoit ses outils de rendu en paramètre et rend un fragment,
sans connaître le routage ni l'en-tête.

## Les six pièges qui ont déjà coûté du temps

Chacun s'est réellement produit sur ce projet.

**1. Le sondage périodique épuise le quota Firestore.** La liste était relue toutes les
5 secondes : 18 720 lectures par heure et par onglet, palier gratuit de 50 000 par jour,
tout est tombé en `429` en deux heures. Le symptôme est trompeur, chaque appareil
retombe sur sa copie locale et les copies divergent, ce qui ressemble à un défaut de
partage. **Ne jamais rétablir de sondage.**

**2. Une écriture peut échouer sans rejeter.** `recettes.js` applique en local puis tente
l'envoi et range l'erreur dans son état plutôt que de rejeter. Une promesse tenue ne
prouve donc rien. Tout appel à `Rc.creer`, `Rc.enregistrer`, `Rc.supprimer` ou
`Rc.reinitialiser` doit passer par `erreurEcritureRecette()` avant d'annoncer un succès.
Trois écrans l'avaient oublié et annonçaient des réussites qui disparaissaient au
rafraîchissement suivant.

**3. Une collection oubliée dans `firestore.rules` ne casse rien de visible.** Le
placard reste simplement vide, ce qui passe pour un placard qu'on n'a pas rempli. Seul
`node tests/verifier-firebase.js --reel` le prouve.

**4. Les planchers chiffrés des tests se remesurent, ils ne se décalent pas.** Un test
qui dit « 193 ingrédients sur 209 » protège une mesure. Le mettre à jour sans remesurer
transforme un garde-fou en décoration.

**5. Playwright annule un glisser-déposer s'il doit faire défiler la page pendant le
geste**, sans lever la moindre erreur. Les tests amènent donc leur cible à l'écran
avant de commencer, et la fenêtre de `test-semainier.js` fait 1 400 px de haut. Un
échec de glissement est presque toujours un problème de géométrie de test, pas de code.

**6. `app.js` fait 4 400 lignes**, contre 100 à 800 pour les autres modules. C'est le
seul endroit qui ne suit pas la règle « un rôle par fichier ». Le découpage a commencé
avec `vue-magasin.js` ; le poursuivre écran par écran, quand un écran change, plutôt
qu'en une fois.

## Ce que la couverture ne prouve pas

À dire clairement, pour ne pas prendre les tests pour plus qu'ils ne sont.

- **L'import depuis un site n'a jamais été joué contre un vrai site.** Les pages de test
  sont écrites depuis la spécification schema.org : l'environnement de développement
  n'a pas accès à internet. C'est le premier point à vérifier.
- **Les tests navigateur n'appellent jamais le vrai Firebase.** Ils utilisent
  l'émulation de `tests/stub-firestore.js`. Le comportement réel est couvert par
  `tests/verifier-firebase.js --reel`, à jouer à la main, qui demande les identifiants.
- **Le hors ligne n'est pas testé automatiquement.** Le service worker ne s'enregistre
  qu'en `https` ou sur `localhost`, et aucun test ne coupe le réseau après installation.

## Chiffres du projet, mesurés

| | |
|---|---|
| Recettes | 21 |
| Ingrédients | 209 occurrences, 133 noms distincts, tous classés par rayon |
| Étapes | 145, dont 107 portent un rappel d'ingrédients |
| Couverture du déroulé reconstitué | 193 / 209, soit 92 % |
| Code | 17 modules, environ 10 200 lignes de JavaScript |
| Poids transféré au chargement | 169 Ko compressés, 28 fichiers |
| Tests | 128 + 115 sous Node, 367 vérifications navigateur, 18 contre le vrai Firebase |

---

# Référence

Le détail, écran par écran et décision par décision. Les sections qui suivent
expliquent **pourquoi** chaque chose est faite ainsi, et ce qui a été écarté :
c'est ce qui évite de refaire un choix déjà tranché, ou de défaire une correction
sans voir ce qu'elle protégeait.

## Structure

```
.
├── .github/workflows/deploy-pages.yml   Tests puis publication sur GitHub Pages
├── firestore.rules                      Règles de sécurité de la liste commune
└── recipe-app/
    ├── index.html               Structure de la page, un seul point de montage
    ├── manifest.webmanifest     Nom, icônes et couleurs pour « Ajouter à l'écran d'accueil »
    ├── sw.js                    Service worker : le carnet s'ouvre sans réseau
    ├── icones/                  Icônes d'application en PNG, rastérisées depuis favicon.svg
    ├── css/style.css            Thème « carnet de cuisine chaleureux », responsive, impression
    ├── js/
    │   ├── firebase-config.js   Configuration Firebase (publique) et réglages de sync
    │   ├── logic.js             Logique métier : durées, filtres, recherche, tableau de flux
    │   ├── quantites.js         Lecture, addition et mise à l'échelle des quantités
    │   ├── rayons.js            Classement des ingrédients par rayon de magasin
    │   ├── flux.js              Déroulé des préparations : génération et mise à l'échelle
    │   ├── semaine.js           Calendrier du semainier : semaines, jours, créneaux
    │   ├── icones.js            Pictogrammes, en SVG écrit dans la page
    │   ├── sync.js              Firestore par son API REST, session anonyme
    │   ├── recettes.js          Recettes d'origine, modifications, créations, parts
    │   ├── storage.js           Liste commune : cache local, fusion, file d'attente
    │   ├── semainier.js         Menus communs : cache local, file d'attente
    │   ├── placard.js           Ce qu'on a toujours et qu'il ne faut pas racheter
    │   ├── photos.js            Photos : redimensionnement, deux tailles, cache IndexedDB
    │   ├── cuisson.js           Où l'on en est dans une recette, en local
    │   ├── import-recette.js    Lecture d'une recette schema.org trouvée sur un site
    │   ├── vue-magasin.js       L'écran « En magasin », premier écran sorti de app.js
    │   └── app.js               Rendu DOM et routage par ancre
    ├── data/recipes.json        Les 21 recettes
    ├── favicon.svg
    ├── tools/
    │   └── importer-extraction.js  Import d'une extraction Markdown (voir plus bas)
    └── tests/
        ├── run-tests.js           128 tests de la logique métier
        ├── run-sync-tests.js      115 tests de la synchronisation
        ├── test-web.js             88 vérifications navigateur, parcours général
        ├── test-partage.js         57 vérifications navigateur, partage, placard, magasin
        ├── test-edition.js         72 vérifications navigateur, modification, parts, accordéon
        ├── test-semainier.js      150 vérifications navigateur, semainier, photos, import
        ├── stub-firestore.js       Émulation de Firestore pour les tests
        ├── serveur-test.js         Site + émulation sur le même port
        ├── run-browser-tests.js    Enchaîne serveur et suites navigateur
        ├── verifier-firebase.js     Contrôle en conditions réelles (opt-in)
        └── serveur.js              Serveur statique sans dépendance
```

Tous les modules s'exportent sur `window` dans le navigateur et en CommonJS sous Node, sans transpilation : les tests les chargent directement. L'ordre de chargement dans `index.html` est significatif, chaque script consommant les précédents : `firebase-config.js`, `logic.js`, `quantites.js`, `rayons.js`, `flux.js`, `semaine.js`, `icones.js`, `sync.js`, `recettes.js`, `storage.js`, `semainier.js`, `placard.js`, `photos.js`, `cuisson.js`, `import-recette.js`, `vue-magasin.js`, `app.js`. Le workflow de publication vérifie cet ordre : un script oublié dans la page passerait les tests Node, qui chargent les modules directement, et casserait le site.

`app.js` ne parle jamais au réseau ni au stockage : il passe par `storage.js`, `semainier.js`, `placard.js`, `recettes.js` et `photos.js`, seuls endroits décidant où sont rangées les données.

## Lancer en local

```bash
cd recipe-app
node tests/serveur.js          # puis http://127.0.0.1:8102/
# ou, au choix
python3 -m http.server 8000
```

Un double-clic sur `index.html` ne fonctionne pas : la page lit `data/recipes.json` avec `fetch()`, que les navigateurs bloquent sur une URL `file://`. La page affiche alors un message expliquant la commande à lancer, plutôt que de rester vide.

## Fonctionnalités

- **Routage par ancre** : `#/` (semainier), `#/livre`, `#/recette/<id>`, `#/recette/<id>/modifier`, `#/recette/nouvelle`, `#/liste-de-courses`. Les URL sont partageables et le bouton de retour du navigateur fonctionne. C'est aussi ce qui permet un hébergement statique sans configuration : aucun chemin profond n'est demandé au serveur.
- **Semainier des repas** sur la page d'accueil (voir la section suivante) : une ou deux semaines, trois repas par jour, plats du livre ou repas hors carnet, glisser-déposer, et ajout des ingrédients de la semaine à la liste de courses après validation plat par plat.
- **Photo par recette** : prise depuis le téléphone ou choisie dans les fichiers, réduite dans le navigateur, partagée avec les autres appareils (voir plus bas).
- **Compteur de réalisations** : combien de fois chaque plat a été fait, calculé sur l'historique du semainier, avec un filtre « jamais fait » dans le livre (voir plus bas).
- **Ajout d'une recette** depuis le livre, et suppression des recettes ajoutées.
- **Recherche** insensible à la casse et aux accents, portant sur le titre, la catégorie, l'origine, les ingrédients et le texte des étapes. Plusieurs mots se cumulent.
- **Filtres** par catégorie, origine, difficulté et tranche de temps total. Un clic sur un filtre actif le désactive.
- **Fiche complète** : temps, origine, ingrédients par groupe, étapes numérotées avec leurs astuces, tableau de flux, astuces, variantes, recettes associées, ce que la source ne donne pas, source citée avec son lien.
- **Déroulé des préparations** : le tableau fourni avec la recette quand il existe, reconstitué automatiquement sinon (voir plus bas).
- **Liste de courses commune** (voir la section suivante) : partagée entre tous les appareils, rangée par rayon de magasin, avec addition des quantités d'un même ingrédient, sélection d'ingrédients à la carte, ajout d'articles libres, compteur dans l'en-tête et fonctionnement hors ligne.
- **Modification des recettes** et **changement du nombre de parts** (voir plus bas).
- **Le carnet s'ouvre sans réseau.** Un *service worker* (`sw.js`) met en cache les 20 fichiers du site, soit 119 Ko compressés, et les sert en priorité avec mise à jour en arrière-plan : un fichier modifié est récupéré immédiatement et s'affiche au chargement suivant, une version périmée ne survivant jamais plus d'une ouverture. Incrémenter `VERSION` dans `sw.js` force une purge immédiate, et devient nécessaire quand un fichier est retiré de la liste, qui resterait sinon en cache. Sans lui, une page ouverte hors ligne n'affichait rien du tout : les données survivaient dans le stockage local, mais il n'y avait plus d'application pour les afficher. Un `manifest.webmanifest` permet « Ajouter à l'écran d'accueil », qui donne une icône et un lancement sans barre d'URL.
- **Annuler le retrait d'un plat.** La croix retire sans confirmation, parce que demander « êtes-vous sûr ? » à chaque geste est plus pénible que le geste. La contrepartie est un bandeau « Plat retiré — Annuler » pendant sept secondes, qui repose le plat **avec sa clé d'origine** : il retrouve sa place dans l'ordre du repas, alors qu'une clé neuve l'enverrait en fin de liste, ce qui ne serait pas une annulation. Si la clé a été reprise entre-temps par un autre appareil, le plat présent gagne : écraser serait pire que de ne pas annuler.
- **Navigation adaptée à l'écran.** Sur ordinateur, l'en-tête porte les liens « Le livre » et « Liste de courses », chacun avec son pictogramme, l'état actif visible, le compteur d'articles restants et le bouton de rafraîchissement, qui affiche l'âge de la donnée en trois caractères (« 4min », « 3h », « 2j »). Sur téléphone, l'en-tête n'a plus de liens : une **barre d'onglets** en bas de l'écran (Semaine, Le livre, Courses) met les trois destinations sous le pouce, avec un retrait pour l'encoche du bas, et le rafraîchissement se fait en **tirant la page vers le bas**.
- **Pictogrammes** en SVG écrit dans la page, dans `js/icones.js` : aucune police d'icônes ni CDN, donc rien à charger et rien qui casse en cuisine sans connexion. Ils se colorent par `currentColor` et suivent la palette sans code supplémentaire.
- **Impression** (`@media print`) : la navigation, les filtres et les boutons disparaissent, le fond repasse en blanc, et les étapes comme les lignes du tableau ne sont pas coupées entre deux pages.

## Semainier des repas

La page d'accueil répond à une seule question : qu'est-ce qu'on mange. Elle montre la semaine, puis donne accès au livre et à la liste de courses.

### Comment on l'utilise

- **Le bloc « Aujourd'hui » est la première chose de la page.** Le déjeuner et le dîner y sont deux **cartes**, côte à côte sur grand écran et empilées sous 560 px : ce sont les repas qu'on cuisine, et une liste de trois lignes identiques ne disait pas lequel demandait de s'y mettre. Chaque carte porte le pictogramme du moment, la photo du plat quand il y en a une, son nom en grand, le temps et le nombre de parts. Le petit-déjeuner reste une ligne d'appoint. Un bouton « + » de 44 px par repas, une croix par plat. Sur téléphone, cette information était auparavant sous un titre, un résumé, deux cartes d'accès, trois onglets, une phrase d'aide et un bandeau d'état : il fallait faire défiler pour savoir ce qu'on mange le soir. Un test vérifie que ce bloc tient dans la hauteur d'un écran de 390 × 850 px.
- **La semaine commence le lundi** et finit le dimanche. Trois créneaux par jour : petit-déjeuner, déjeuner, dîner, nommés de la même façon dans la grille et dans le récapitulatif du jour.
- **Le petit-déjeuner est masqué tant qu'il ne porte rien**, jour par jour. C'est le repas le moins souvent prévu, et des cases vides en tête de grille repoussaient le déjeuner et le dîner, qui sont ce qu'on vient lire. Il reparaît le jour où il porte quelque chose, et en mode Modifier, où il faut bien pouvoir en poser un.

  L'alignement des colonnes est tenu par la feuille de style et non par le rendu : chaque créneau a sa **ligne fixe** dans la grille du jour (`grid-row` par moment), si bien qu'un petit-déjeuner absent le lundi laisse sa place vide au lieu de tirer le déjeuner d'une ligne vers le haut et de le désaligner de celui du mardi. Sur trois colonnes, c'est la colonne qui devient fixe. La ligne entière disparaît quand aucun jour de la semaine n'en porte, sinon une bande vide subsisterait. Le déjeuner et le dîner ont plus de hauteur que le petit-déjeuner, parce que ce sont les repas qu'on cuisine.
- **Une semaine vide est repliée en un bandeau** d'une ligne, dépliable d'un clic. La semaine suivante est presque toujours entièrement vide et occupait la moitié de la hauteur de page pour vingt-et-une cases à remplir. La semaine en cours est toujours dépliée, et une semaine qui porte des plats ne se replie pas.
- **Jamais de semaine passée** : un repas déjà mangé ne sert ni aux courses ni à la cuisine.
- **L'accueil s'ouvre en lecture.** La grille montre le menu : pas de « + » dans les cases, pas de réserve de plats à glisser. Le bouton « Modifier », à côté de « Ajouter aux courses », fait apparaître les deux. Le « + » du bloc « Aujourd'hui » reste là en permanence : c'est le geste du jour même, celui qu'on fait le plus.
- **Plusieurs plats par repas.** Un déjeuner peut porter un plat et un dessert. Chaque plat est un document distinct, avec une clé propre : deux téléphones qui ajoutent un dessert en même temps n'en écrasent pas un. Chaque plat se retire seul, par sa croix, depuis la grille ou depuis « Aujourd'hui ». « Vider ce repas » n'est proposé qu'à partir de deux plats, sinon il ferait doublon avec « Retirer ».
- **En mode Modifier, toucher une case** ouvre le choix du repas : un plat du livre (avec sa propre recherche), ou un repas hors carnet. Neuf raccourcis sont proposés (Restaurant, Pizzas, Japonais, Burger King, McDonnalds, La boucherie, Au bureau, Restes, Chacun pour soi) et un champ libre accepte n'importe quoi d'autre.
- **Glisser-déposer** sur ordinateur, en mode Modifier : un plat se glisse d'une case à l'autre, et la réserve permet de glisser un plat du livre ou un repas hors carnet directement dans une case. Glisser sur une case occupée **ajoute** le plat au repas : il n'y a plus d'échange, puisqu'un repas peut porter les deux, et rien n'est déplacé sans qu'on l'ait demandé.
- La réserve se filtre par famille : **Entrées, Plats, Desserts, Autres**. « Autres » ne vient pas du carnet, ce sont les repas qu'on ne cuisine pas. La recherche ne cherche que dans la famille affichée. Les pastilles portent le titre et un pictogramme de catégorie, jamais la photo de la recette : une pastille est un nom de plat à saisir, pas une image à regarder.
- La réserve glissable est masquée au tactile et sous 700 px : le glisser-déposer HTML5 n'existe pas sur mobile, et l'appui sur une case fait déjà le travail. **Toute action est faisable sans glisser.**
- Les menus sont lus **une fois au chargement de la page**, puis mis à jour par le bouton de rafraîchissement de l'en-tête. Voir « Pourquoi il n'y a plus de rafraîchissement automatique » plus bas.

### Ajouter les plats de la semaine aux courses

Le bouton « Ajouter aux courses » de chaque semaine n'ajoute rien directement : il ouvre la liste des plats prévus, **cochés par défaut**, à décocher pour ce dont on a déjà les ingrédients. Seuls les plats restés cochés partent en liste.

Quatre cas sont traités explicitement, parce qu'ils se produisent :

- **Un plat déjà entièrement en liste arrive décoché**, avec la mention « déjà entièrement dans la liste ». Le recocher n'ajouterait rien.
- **Un plat partiellement en liste** arrive coché, avec « 3 sur 12 déjà dans la liste » : seuls les manquants seront ajoutés.
- **Un repas hors carnet n'est pas ajoutable** et le dit : « repas hors carnet, sans ingrédients ». Un restaurant ne se met pas dans une liste de courses.
- **Un plat prévu deux fois dans la semaine n'est compté qu'une fois**, et l'écran l'annonce : « prévu 2 fois cette semaine, compté une seule : les quantités ne sont pas doublées ». Doubler automatiquement serait un pari sur une intention inconnue, entre cuisiner deux fois et manger un reste. Pour doubler, changez le nombre de parts sur la fiche.

### Comment ça marche

Un document Firestore **par plat posé**, dans `semainiers/commune/creneaux`, avec une clé qui porte la date, le moment et un suffixe (`2026-08-03::dejeuner::k3f9za`). Même raison que pour les articles de la liste : deux personnes qui posent deux plats différents modifient deux documents distincts. Avec un document par semaine, le dernier qui écrit effacerait le plat de l'autre.

Le suffixe est **tiré au hasard et non incrémenté**, parce qu'un repas peut porter plusieurs plats : deux téléphones qui ajoutent un dessert au même déjeuner en même temps produiraient le même rang, donc la même clé, et l'un des deux ajouts disparaîtrait sans un mot.

Les clés à deux morceaux écrites avant ce changement (`2026-08-03::dejeuner`) **restent valides** et se lisent comme le plat unique de leur repas. Il n'y a pas eu de migration et il n'en faut pas. Un test le vérifie sur un document écrit directement dans l'émulation, sous l'ancienne forme.

**Un créneau vide n'est pas un document vide, c'est un document absent** : vider un repas est une suppression. Cela évite d'accumuler des documents pour les repas non prévus, qui sont la majorité.

Le reste suit exactement le modèle de la liste de courses : cache local comme source du rendu, file d'attente persistée, lecture initiale au chargement puis rafraîchissement manuel. Poser un plat fonctionne donc sans réseau et part au retour de la connexion.

Deux pièges de dates sont traités dans `js/semaine.js`, et des tests les fixent, parce que chacun produit un décalage d'un jour :

- `toISOString()` convertit en UTC : à Paris en été, un lundi à 23 h donnerait « dimanche ». Les clés de jour sont donc fabriquées avec `getFullYear/getMonth/getDate`, qui sont locaux.
- `new Date('2026-08-03')` est interprété comme minuit UTC : à l'ouest de Greenwich, `getDate()` rendrait le 2. Les clés sont relues en composant une date locale fixée à midi, midi résistant aux changements d'heure.

## L'éditeur : une chose à la fois

On ouvre l'éditeur pour corriger une quantité, changer le nombre de parts ou ajouter une photo, pas pour parcourir un formulaire du début à la fin. Il est donc en accordéon :

- **une barre collante** en haut, « Annuler » à gauche et « Enregistrer » à droite, atteignables même au bas d'une longue section ;
- **des pastilles de raccourci** (Photo, Nombre de parts, Fiche, Temps, Ingrédients, Préparation) qui sautent directement à une section ;
- **une seule section ouverte à la fois**, les autres réduites à un résumé d'une ligne qui dit ce qu'elles contiennent : « Ingrédients, 12 lignes », « Préparation, 7 étapes », « Temps, 40 min au total ».

La section ouverte au départ est « Fiche » en création, parce qu'un titre est obligatoire, et « Nombre de parts » en modification, parce que c'est le changement le plus fréquent. **Une nouvelle entrée dans l'éditeur avec un brouillon en cours conserve la section ouverte** : déplacer l'utilisateur sous ses doigts serait pire que le contraire.

Les actions lourdes de conséquence, « Rétablir l'originale » et « Supprimer cette recette », sont à part en bas de page, jamais dans la barre du haut à côté d'« Enregistrer ». Le bloc disparaît quand il n'a rien à proposer, plutôt que de laisser un filet horizontal sans rien dessous.

## La fiche : consulter ou cuisiner

La fiche sert à deux choses qui n'ont ni la même posture ni le même besoin : on la consulte assis, on cuisine debout les mains occupées. Un sélecteur en haut de fiche bascule entre les deux.

**Consulter.** Les ingrédients et la préparation d'abord, immédiatement. Le contexte (temps, origine, déroulé des préparations, astuces, variantes, recettes associées, source) est replié sous « Pour aller plus loin », visible en un clic, jamais supprimé. Onze sections de même poids visuel s'enchaînaient auparavant, alors qu'en cuisinant on ne veut que deux d'entre elles.

**Une exception délibérée au repli : « Ce que la source ne donne pas » reste visible.** C'est une garantie d'honnêteté des données, pas du contexte. La replier reviendrait à masquer ce que la fiche ne sait pas.

**Cuisiner.** Une étape à la fois, en 19 px, lisible à 60 cm d'une tablette posée sur le plan de travail. L'astuce de l'étape est mise en évidence, une barre de progression dit où l'on en est, et deux boutons de 52 px de haut passent d'une étape à l'autre. **Les ingrédients de l'étape en cours sont rappelés** sous l'étape, avec leurs quantités : en cuisine, ce qu'on veut savoir est quoi sortir du placard maintenant. La liste complète reste à portée dans un repli, elle n'est jamais remplacée.

Ce rappel est déduit du texte de l'étape, rien n'est saisi recette par recette : une association tenue à la main sur vingt fiches ne resterait pas juste. Sur les 145 étapes du carnet, 107 portent un rappel. Les deux limites sont connues et assumées : une étape qui dit « la préparation » ou « le mélange » ne cite aucun ingrédient et n'affiche donc rien, plutôt que de deviner ; et deux ingrédients partageant un mot (« Sucre » et « Sucre glace ») remontent tous les deux, parce qu'un ingrédient de trop sous les yeux vaut mieux qu'un manquant.

**L'étape en cours est retenue**, ainsi que le mode choisi, par recette et **en local** (`js/cuisson.js`). On repose l'appareil, on y revient, on retrouve où on en était. Volontairement non partagé : deux personnes qui cuisinent le même plat sur deux appareils ne doivent pas se pousser mutuellement d'une étape à l'autre, et cela évite une écriture Firestore à chaque « Suivante ». Ce module existe aussi pour que `app.js` ne touche jamais au `localStorage`, ce qui est l'invariant du projet.

L'étape est bornée **à la lecture** et non à l'écriture : une recette raccourcie par une modification laisserait sinon un index au-delà de la dernière étape, et l'écran resterait vide sans qu'on comprenne pourquoi.

**Il n'y a plus de bouton « Imprimer la fiche ».** L'impression reste possible par le navigateur, et **les replis y sont ouverts par JavaScript** (`beforeprint`), puis refermés ensuite, et seulement ceux que le code a ouverts. Une fiche imprimée doit être complète : un dépli refermé y perdrait les temps, le déroulé et la source. Le CSS ne peut pas le faire, le navigateur masquant le contenu d'un `<details>` fermé par un mécanisme que `display` ne touche pas.

## Compteur de réalisations

Combien de fois un plat a été fait, lu dans l'historique du semainier. Aucune donnée nouvelle n'est stockée : les créneaux passés étaient déjà là, ils n'étaient simplement pas affichés.

Où cela apparaît :

- sur chaque carte du livre : « Fait 3 fois, la dernière le 2 février » ou « Jamais fait » ;
- sur la fiche, à côté du nombre de parts ;
- comme filtre dans le livre : « Jamais fait (18) » et « Déjà fait ». Le filtre n'apparaît que si le semainier a un historique.

Trois règles, chacune pour une raison :

- **Seuls les créneaux strictement antérieurs à aujourd'hui comptent.** Un repas prévu pour jeudi prochain n'a pas été fait, et le repas du jour ne l'est pas non plus tant que la journée n'est pas finie : le compter ferait apparaître le plat comme réalisé avant qu'on l'ait cuisiné.
- **Un repas hors carnet ne compte pas.** « Restaurant » n'est pas un plat du livre.
- **Rien n'est affiché tant que le semainier est vide.** Écrire « 0 fois » partout ferait passer une absence de données pour une information.

À nombre égal de réalisations, le classement met devant le plat le plus récemment fait, et une recette renommée apparaît sous son nom actuel et non sous celui qu'elle portait il y a six mois.

**Limite de coût, à connaître.** Le comptage porte sur **tout l'historique**, choix explicite. Il lit donc la totalité de la collection des créneaux, qui grossit d'environ 1 100 documents par an (21 créneaux par semaine). Firestore facture à la lecture de document, et cette lecture a lieu une fois par chargement de page. À 20 chargements par jour, cela représente environ 22 000 lectures quotidiennes après un an, pour un palier gratuit de 50 000. C'est donc sans conséquence aujourd'hui, tenable un à deux ans, puis il faudra un document d'agrégation par recette plutôt qu'un comptage à la lecture. Le moment de basculer se reconnaîtra à un bandeau « Service momentanément indisponible ».

## Photo par recette

Une photo par recette, ajoutée depuis l'éditeur de la fiche, partagée avec les autres appareils.

**L'image est réduite dans le navigateur avant l'envoi**, en deux tailles rangées dans le même document Firestore : une vignette de 320 px pour les listes et le semainier, une grande de 1200 px pour la fiche. Ce n'est pas une optimisation cosmétique : une photo de téléphone pèse 3 à 8 Mo, un document Firestore est limité à 1 Mio, et une data URL en base64 ajoute encore un tiers au poids binaire. Envoyer l'original serait refusé par le serveur, et refusé trop tard, après l'attente du téléversement. La qualité JPEG descend par paliers jusqu'à tenir dans le budget ; si l'image ne tient toujours pas, l'application le dit au lieu d'envoyer un document que Firestore refusera.

**Le livre ne télécharge que les vignettes.** L'API REST accepte un masque de lecture (`mask.fieldPaths`) : afficher vingt vignettes de 320 px ne fait donc pas descendre vingt images de 1200 px, ce qui représenterait plusieurs mégaoctets. La grande version n'est lue qu'à l'ouverture d'une fiche.

Deux limites assumées :

- **Les vignettes sont relues au chargement de la page**, comme les recettes modifiées, et pas en continu : une photo ajoutée depuis un autre appareil apparaît au prochain rechargement, pas dans la seconde. Naviguer d'un écran à l'autre ne suffit pas, le routage ne change que l'ancre. Sonder vingt documents en permanence coûterait cher pour une donnée qui change quelques fois par mois.
- **Une recette sans photo connue n'est pas interrogée.** Le cache des vignettes est la seule source d'autorité sur « qui a une photo » : sans cela, ouvrir une fiche déclencherait une lecture facturée et un 404 pour dix-neuf recettes sur vingt.
- **Pas de Firebase Storage** : il faudrait le SDK ou une seconde API à signer, alors que Firestore est déjà en place et qu'une photo compressée y tient largement.

### Où sont rangées les vignettes

Deux étages, et la raison de chacun :

1. **La mémoire est la source du rendu.** `vignette()` doit rester synchrone : elle est appelée pour chaque carte du livre et chaque case du semainier, et rendre le rendu asynchrone pour une image de 320 px contaminerait tout l'affichage.
2. **IndexedDB est la copie durable**, écrite et relue de façon asynchrone. Elle sert au démarrage à chaud : les vignettes s'affichent avant que Firestore ait répondu, et ce qui vient du serveur fait toujours autorité sur elle.

Pourquoi plus le `localStorage` : son quota est de 5 Mo pour tout le site, une vignette pèse jusqu'à 58 Ko, le plafond était donc atteint vers **85 recettes photographiées**. Le dépassement était silencieux, les vignettes cessant simplement d'être conservées entre deux visites. IndexedDB n'a pas de plafond comparable. L'ancien cache est effacé du `localStorage` au premier chargement, ce qui rend jusqu'à 1,2 Mo.

Si IndexedDB est indisponible (navigation privée sur certains navigateurs), le carnet fonctionne sans copie durable : les vignettes sont simplement relues depuis Firestore à chaque chargement.

## Ajouter et supprimer une recette

Le livre a un bouton « Ajouter une recette » qui ouvre le même formulaire que la modification : un seul écran à maintenir plutôt que deux qui divergeraient.

- **Le titre est obligatoire.** Sans lui, la fiche serait introuvable dans le livre : l'enregistrement est refusé et l'écran le dit, plutôt que de créer une recette sans nom.
- **Deux recettes de même nom ne s'écrasent pas** : l'identifiant reçoit un rang (`soupe`, `soupe-2`).
- **Une recette ajoutée ne peut pas prendre l'identifiant d'une recette d'origine**, qui vit dans le fichier servi avec le site.
- **La photo vient après le premier enregistrement**, et l'écran l'explique : elle est rangée sous l'identifiant de la recette, qui n'existe pas encore.
- **Une recette ajoutée se supprime, une recette d'origine se rétablit.** Ce ne sont pas les mêmes gestes et ils ne portent pas le même risque, donc pas le même bouton. La suppression demande confirmation, dit qu'elle vaut pour tout le monde et qu'il n'y a pas d'original à rétablir, puis retire aussi la recette du semainier. Supprimer une recette d'origine est refusé par le code : elle réapparaîtrait à la prochaine lecture du fichier.

## Le placard, et le mode « En magasin »

### Le placard : ce qu'on a toujours

Le sel, la farine et l'huile d'olive reviennent dans presque toutes les recettes. Sans cette liste, ils repartaient en courses chaque semaine, et on les décochait à la main ou on les rachetait.

Le placard s'ouvre depuis la liste de courses, bouton « Placard ». Les ingrédients proposés viennent du carnet et non d'une saisie libre : taper « huile d'olive » à la main, avec ou sans apostrophe typographique, est le meilleur moyen que le placard ne reconnaisse jamais rien. Les noms sont comparés sans casse ni accent, « Crème fraîche » et « creme fraiche » désignant le même bocal.

**Le placard est partagé, comme le reste.** Il décrit la maison, pas l'appareil. S'il était local, l'un curerait sa liste et l'autre recevrait quand même le sel dans ses courses : c'est exactement le défaut corrigé sur le semainier. Il demande donc **une republication de `firestore.rules`**, qui couvre désormais une cinquième collection, `placard`.

Tant que ces règles ne sont pas publiées, le carnet fonctionne sans : le placard reste vide, aucun ingrédient n'est écarté, et la boîte affiche « Accès refusé par la base » avec la marche à suivre. Une fonctionnalité absente vaut mieux qu'un écran bloqué.

Ce que le placard a retenu est dit au moment de l'ajout : « 12 articles ajoutés, 3 laissés au placard ». Sans cette mention, un ingrédient manquant en magasin passerait pour un oubli de l'application.

### Le mode « En magasin »

Le pendant du mode « Cuisiner » de la fiche recette. Il enlève le formulaire d'ajout, les groupes de lignes proches, la provenance des ingrédients et les actions de nettoyage. Il garde l'ordre des rayons, qui est l'ordre du parcours, et le total restant, qui dit s'il faut encore avancer.

Une ligne cochée **quitte l'écran** : c'est ce qui fait avancer la liste sous les yeux. Elle reste consultable d'un dépli, sinon décocher une erreur demanderait de quitter le mode. Toute la ligne est la cible, pas seulement la case : viser une case de 20 px en marchant est le geste que ce mode existe pour supprimer. La ligne fait 60 px de haut, la case 30 px.

Le rendu est dans `js/vue-magasin.js` : c'est **le premier écran sorti de `app.js`**, qui portait les cinq vues dans un fichier de 3 700 lignes. Le contrat est étroit : le module ne connaît ni le routage, ni l'en-tête, ni les boîtes modales ; il reçoit ses outils de rendu en paramètre et rend un fragment. Les autres écrans suivront le jour où ils changeront.

## Liste de courses commune

Une seule liste, partagée par tous ceux qui ouvrent le site. Ce que l'un ajoute ou coche apparaît chez les autres.

### Comment on l'utilise

- Sur une fiche recette : cocher les ingrédients voulus puis « Ajouter la sélection », ou « Tout ajouter à la liste » pour la recette entière. Les ingrédients déjà dans la liste sont marqués et leur case est désactivée.
- Sur la page liste : un champ permet d'ajouter un article libre (« pain », « lessive ») avec sa quantité, hors recette. Les articles sont groupés par recette, les ajouts libres à part.
- Cocher un article le barre chez tout le monde. « Retirer les cochés » fait le ménage au retour des courses.
- La liste est lue **une fois au chargement**, puis mise à jour par le bouton de rafraîchissement de l'en-tête. Le bandeau indique l'âge de ce qui est affiché.

### Rangement par rayon et addition des quantités

La liste est rangée dans l'ordre d'un parcours de magasin : Fruits et légumes, Viandes et poissons, Crèmerie, Boulangerie, Surgelés, Épices et herbes, Épicerie salée, Épicerie sucrée, Boissons. On ne revient donc pas trois fois au même rayon.

Le classement se fait par mots-clés dans `js/rayons.js`, et les 133 ingrédients du carnet sont tous classés, ce qu'un test vérifie. Trois traitements évitent des erreurs constatées sur les données réelles : la ligature `œ` est convertie en `oe` (sans quoi « Œufs » n'était pas reconnu, et « Bœuf haché » partait en crèmerie), ce qui suit « pour » est ignoré car c'est un usage et non un produit (« Farine pour beurre manié » est de la farine), et les parenthèses de la source sont retirées. Un ingrédient inclassable tomberait dans « Autre », ce qui est un signal à traiter, pas un résultat normal.

**Les quantités du même ingrédient s'additionnent** : 300 g de beurre venus d'une recette et 125 g d'une autre donnent une seule ligne « Beurre 425 g », avec le nom des recettes d'origine en regard. Les conversions se font dans une même famille (50 cl + 1 l = 1,5 l), jamais entre familles : « 3 c. à s. » et « 200 g » restent affichés côte à côte, et une cuillère à soupe n'est pas convertie en cuillère à café.

Deux garde-fous délibérés :

- **Rien n'est perdu.** Une quantité non chiffrable (« Selon goût », « Pour le moule ») est conservée mot pour mot, et un commentaire attaché à un nombre (« 130 g, plus pour le moule ») n'est jamais fondu dans un total, ce qui l'effacerait.
- **Une fourchette est intouchable.** « 6 à 8 c. à c. », « 2-3 gousses » portent deux nombres et non un : multiplier reviendrait à choisir lequel compte, additionner à sommer une valeur qui n'existe pas. Elles sont donc traitées comme « Selon goût ». Sans cette règle, doubler la recette donnait « 12, à 8 c. à c. ». La forme `6/8` n'est **pas** reconnue comme une fourchette : elle est indistinguable de la fraction six-huitièmes, et « 1/2 sachet » doit rester une demie. Une source qui écrit « 6/8 » pour « 6 à 8 » doit être transcrite « 6 à 8 » dans la donnée, sans quoi le calcul lit 0,75.
- **La fusion ne rapproche que des noms identiques**, à la casse, aux accents, à la ligature et au pluriel près : « Œufs » rejoint « Œuf », mais « Sucre glace » n'est pas confondu avec « Sucre en poudre », ni « Beurre » avec « Beurre mou ». Additionner sur une ressemblance approximative donnerait une liste fausse. Pour regrouper deux libellés voisins, renommez l'un des deux dans la recette.

### Les lignes très proches sont encadrées, jamais fusionnées

Constaté en magasin avec deux recettes seulement : « Beurre 70 g », « Beurre aux cristaux de sel 75 g » et « Beurre aux cristaux de sel ramolli 120 g » formaient trois lignes de crèmerie éparpillées, pour un seul produit à prendre. Idem pour trois farines, trois sucres et deux œufs.

Les lignes qui partagent leur premier mot significatif sont donc **encadrées ensemble**, avec un en-tête « BEURRE — 3 lignes proches ». Chaque ligne garde sa quantité, sa case à cocher et son bouton de suppression : rien n'est additionné, et cocher l'une ne coche pas ses voisines.

Deux garde-fous limitent les faux rapprochements : le mot de tête doit faire au moins quatre caractères, ce qui écarte « ail », « sel » ou « thé », déjà courts et sans variantes ; et il faut au moins deux lignes, sinon il n'y a rien à regrouper. Un faux rapprochement ne coûte qu'un cadre de trop, jamais une quantité fausse : c'est précisément pourquoi ce regroupement est visuel et non calculé.

La fusion est faite à l'affichage, pas en base : chaque ingrédient de chaque recette reste un document Firestore distinct. C'est ce qui permet de retirer une recette et de voir le total baisser d'autant, et c'est aussi ce qui préserve la propriété de concurrence : deux personnes qui cochent ne se marchent pas dessus. Cocher ou supprimer une ligne agit sur toutes ses contributions en une seule salve.

### Comment ça marche

Un document Firestore **par article**, dans `listes/commune/articles`, et non un seul document contenant toute la liste. C'est ce qui permet à deux personnes de cocher en même temps sans que l'une écrase le travail de l'autre : chacune modifie un document différent, et une modification n'envoie que le champ concerné.

Le rendu lit toujours une copie locale de la liste, jamais le réseau directement. Les modifications sont appliquées d'abord en local, puis inscrites dans une file d'attente persistée et envoyées. Conséquence concrète : au supermarché, sans réseau, la liste reste consultable et cochable, le bandeau affiche « Hors ligne, N modifications en attente », et tout part au retour de la connexion. Sans cette file, cocher hors ligne serait perdu au rafraîchissement suivant.

La session est ouverte automatiquement en mode anonyme, sans rien demander. Elle ne sert qu'à satisfaire les règles de sécurité.

### Configuration Firebase : ce qui reste à faire côté console

La configuration Firebase est déjà dans `recipe-app/js/firebase-config.js`. Elle est publique par conception : elle identifie le projet, elle ne donne aucun droit. Ce qui protège les données, ce sont les règles de sécurité.

Le projet `cahier-de-cuisine-88` est configuré : base Firestore créée, connexion anonyme activée, domaine `guillaumez88.github.io` autorisé, et la liste de courses fonctionne (vérifiée en conditions réelles, voir ci-dessous).

**Le passage à plusieurs plats par repas ne demande pas de republier les règles.** La clé d'un plat passe de 18 à 35 caractères (`2026-08-03::dejeuner::k3f9za`), la borne de la règle est de 100. Conclusion tirée de la lecture de `firestore.rules` ; le contrôle qui la prouve contre le vrai projet fait partie de `tests/verifier-firebase.js --reel`.

**Le semainier, les photos et le placard demandent une republication des règles.** `firestore.rules` couvre désormais cinq collections : `listes/{id}/articles`, `recettes`, `semainiers/{id}/creneaux`, `placard` et `photos`. `placard` est la plus récente, ajoutée le 9 août 2026 : tant que les règles publiées ne la contiennent pas, le placard reste vide, aucun ingrédient n'est écarté des courses, et la boîte du placard affiche « Accès refusé par la base ». Le reste du carnet fonctionne. De même pour `semainiers` et `photos` : sans elles, le semainier reste bloqué sur « Hors ligne » et aucune photo ne s'enregistre. Coller `firestore.rules` dans la console Firebase (*Firestore Database* → *Règles* → *Publier*), puis relancer `node tests/verifier-firebase.js --reel`.

Ce contrôle ne vérifie pas seulement que l'écriture passe : il vérifie aussi qu'un repas accepte bien deux plats en deux documents distincts, et que les règles **refusent** ce qu'elles doivent refuser, un créneau au moment inconnu et une photo hors borne de taille. Si ces deux contrôles-là échouent, les règles publiées ne sont pas celles du dépôt même si le reste fonctionne.

Si l'application affiche un jour un bandeau `PERMISSION_DENIED`, c'est que les règles publiées ont divergé de `firestore.rules` : les republier depuis le fichier du dépôt, puis relancer ce contrôle.

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

Les contrôles portent sur : la session anonyme, l'écriture d'un document par article, la conservation des accents et des quantités à l'aller-retour, le cochage n'écrivant que le champ concerné, la relecture depuis un cache local vide (le cas du second appareil), l'article libre, le retrait des cochés, la suppression, l'intégrité des articles préexistants, l'accès à la collection des recettes et le cycle complet d'une recette modifiée, le semainier (un plat écrit, relu et vidé, deux plats dans un même repas en deux documents distincts, le refus d'un moment inconnu), les photos, et le placard (une entrée écrite, relue depuis le serveur et non depuis le cache, puis supprimée, et le refus d'une entrée sans nom).

Au 9 août 2026, **les 18 contrôles passent** contre le vrai projet, règles republiées. Les cinq collections sont couvertes : articles, recettes, créneaux, photos et placard.

Ces contrôles sont les seuls qui prouvent qu'une republication de règles a bien eu lieu. Une collection oubliée dans les règles ne casse rien de visible : le placard reste simplement vide, ce qui passe pour un placard qu'on n'a pas rempli. En cas d'échec sur la collection des recettes, le message nomme précisément l'action à faire.

C'est le contrôle à lancer après toute modification de la configuration Firebase ou des règles : si le bandeau du site reste sur « Hors ligne », il nomme la cause exacte (`SERVICE_DISABLED`, `CONFIGURATION_NOT_FOUND` ou `PERMISSION_DENIED`).

### Ce que ce choix implique, sans le cacher

- **Qui connaît l'URL du site peut lire et modifier la liste.** La session anonyme est gratuite et automatique : elle bloque les robots qui scannent les clés d'API publiques, pas une personne qui ouvre le site. C'est le compromis retenu pour une liste familiale. Pour aller plus loin il faudrait de vrais comptes, ou App Check pour n'autoriser que votre domaine.
- **On ne sait pas qui a coché quoi.** Les sessions anonymes ne portent pas de nom. Le champ existe côté données si vous voulez l'ajouter plus tard.
- **Aucun rafraîchissement automatique.** Voir la section suivante : la mise à jour est déclenchée par un bouton.

## Pourquoi il n'y a plus de rafraîchissement automatique

La liste était relue toutes les 5 secondes et le semainier toutes les 20 secondes. **Cela a épuisé le palier gratuit de Firestore**, et le projet a répondu `429 Quota exceeded` sur tout, y compris les écritures. Constaté le 3 août 2026 sur les quatre collections, la session anonyme fonctionnant toujours.

L'arithmétique, mesurée et non estimée : Firestore facture **à la lecture de document**, le palier gratuit est de 50 000 lectures par jour, et un sondage lit tous les documents de la collection. À 5 secondes d'intervalle, cela fait 720 sondages par heure, donc 18 720 lectures par heure avec 26 articles en liste, **et par onglet ouvert**. Deux onglets oubliés épuisaient la journée en deux heures.

Le symptôme était trompeur : quand les lectures et les écritures échouent, chaque appareil retombe sur sa copie locale et les copies divergent. La liste et les menus paraissaient alors ne pas être partagés, alors qu'il n'existe qu'une seule version commune côté serveur.

La mise à jour est donc désormais **explicite** :

- une seule lecture au chargement de la page, pour chaque collection ;
- un seul bouton de rafraîchissement, dans l'en-tête, qui relit la liste **et** les menus du même geste ; sur téléphone, tirer la page vers le bas fait la même chose ;
- aucun sondage périodique, aucune relecture au retour sur l'onglet.

En échange, **l'âge de ce qui est affiché est visible en permanence**, sur le bouton de l'en-tête, en trois caractères : « à jour », « 4min », « 3h », « 2j ». Au-delà de deux minutes (`seuilDonneesAgees`), le bouton change de couleur. Un minuteur de 15 secondes réécrit ce seul libellé, sans aucune lecture réseau : sans lui, l'âge affiché resterait figé à sa valeur du dernier rendu, ce qui serait pire que de ne rien afficher.

**Le bandeau d'état ne s'affiche plus quand tout va bien.** Il répétait sur une ligne pleine (« Menus partagés à la maison, à jour il y a 3 minutes ») une information que le bouton de l'en-tête porte déjà, et depuis n'importe quel écran. Il reste indispensable dans tous les autres cas, où il est seul à pouvoir dire quoi faire :

Il distingue **trois causes d'échec**, qui n'appellent pas les mêmes actions :

| Ce que dit le bandeau | Cause réelle | Ce qu'il faut faire |
|---|---|---|
| Hors ligne | Pas de réseau | Attendre, les modifications sont conservées et partiront |
| Service momentanément indisponible | `429`, quota gratuit du jour épuisé | Rien, cela repart le lendemain |
| Accès refusé par la base | `403 PERMISSION_DENIED` | Republier `firestore.rules` |

Confondre les trois était le vrai défaut de la version précédente : elle annonçait « Hors ligne » pour un quota épuisé.
- **Aucun test ne touche votre projet réel.** L'émulation locale sert à tout vérifier. Le revers est que le comportement contre le vrai Firestore n'est pas prouvé : c'est le premier point à confirmer après la configuration.

## Écran de démarrage, icônes et animations

### L'écran de démarrage

Il est écrit dans `index.html` et non construit par `app.js` : il doit être peint au tout premier rendu, avant que le moindre script ne tourne, sinon il arriverait après ce qu'il est censé couvrir. Il remplace l'écran blanc puis le texte « Chargement des recettes… » quand on lance l'application depuis l'écran d'accueil du téléphone.

**Il ne peut pas rester coincé**, et c'est la seule chose qui compte vraiment : un écran de démarrage bloqué vaut moins que pas d'écran du tout. Trois sorties, indépendantes :

1. `app.js` le retire dès le premier écran monté ;
2. il le retire aussi quand le chargement échoue, pour laisser voir le message d'erreur ;
3. une animation CSS le fait disparaître au bout de 4 secondes, **sans aucun JavaScript**, y compris sous `prefers-reduced-motion`, où l'animation générale est neutralisée mais celle-ci explicitement conservée.

Un test vérifie ces quatre points sur les fichiers eux-mêmes.

### Les icônes d'application

`favicon.svg` est rastérisé en PNG par Chromium (script hors application, joué une fois), dans `icones/` :

| Fichier | Usage |
|---|---|
| `icone-192.png`, `icone-512.png` | Écran d'accueil, et l'écran de démarrage qu'Android génère depuis le manifeste |
| `icone-192-maskable.png`, `icone-512-maskable.png` | Android rogne un cercle de 80 % dans le carré : le dessin y est réduit de 14 % et posé sur un aplat plein bord, sinon les coins sont coupés |
| `apple-touch-icon.png` | iOS, qui ignore le manifeste pour l'icône |

Un SVG seul ne suffit pas : les deux systèmes demandent du PNG pour l'écran d'accueil, et sans le 512 px Android ne propose pas d'écran de démarrage. Des tests vérifient que ces tailles existent, qu'une icône `maskable` est déclarée, que chaque fichier est présent, et que toutes sont dans la coquille du service worker, sans quoi l'application installée perdrait son icône dès que le réseau manque.

### Les animations

Deux règles, tenues partout :

1. **Rien ne bouge sans raison.** Chaque animation dit quelque chose : l'écran qui arrive, la carte qui apparaît, la case visée pendant un glissement, la ligne qui part au panier, le bouton de rafraîchissement qui tourne pendant qu'il travaille. Une décoration qui ne dit rien ajoute de l'attente.
2. **Tout s'arrête sous `prefers-reduced-motion`.** Ce réglage n'est pas une préférence esthétique : le mouvement déclenche des nausées et des migraines chez une partie des gens. Un bloc final ramène toutes les durées à 0,001 ms, sans exception, et seule la sortie de l'écran de démarrage est réécrite pour continuer de fonctionner.

Les entrées d'écran durent 200 ms : au-delà, une transition de page se ressent comme une lenteur et non comme une réponse.

## Accessibilité

Trois points traités, chacun parce qu'il était cassé et non par principe :

- **Une zone d'annonce dédiée.** `aria-live` enveloppait `#vue`, c'est-à-dire l'écran entier : un lecteur d'écran relisait toute la page à chaque navigation. L'annonce passe par `#annonce`, invisible à l'œil (`clip-path` et non `display: none`, qui supprimerait aussi l'annonce), où l'on écrit une phrase par écran : « Liste de courses, 14 articles ». La zone est vidée puis réécrite au tour de boucle suivant, sinon un même texte affiché deux fois de suite ne serait pas relu.
- **Un piège de focus dans les boîtes.** `aria-modal` dit aux technologies d'assistance d'ignorer le reste de la page, mais aucun navigateur n'empêche la tabulation d'en sortir : au clavier, on parcourait un écran masqué par le voile, sans rien voir bouger. La boîte retient désormais le focus, en excluant les éléments désactivés ou repliés, qui feraient une étape morte dans le cycle.
- **Les cibles tactiles.** 44 px pour les boutons du bloc du jour, 60 px de haut pour une ligne du mode magasin, toute la ligne étant cliquable et pas seulement la case.

## Tests

```bash
cd recipe-app
node tests/run-tests.js           # 128 tests de la logique métier
node tests/run-sync-tests.js      # 115 tests de la synchronisation
node tests/run-browser-tests.js   # 367 vérifications dans un vrai Chromium
```

`run-tests.js` couvre l'analyse des durées, la normalisation des origines et difficultés en texte libre, la recherche, la combinaison des filtres, le test d'informativité du tableau de flux, le calendrier du semainier (dont les deux pièges de fuseau et les semaines à cheval sur deux mois ou deux années) et l'intégrité du jeu de données.

`run-sync-tests.js` couvre la synchronisation de bout en bout : session anonyme et renouvellement de jeton, encodage des valeurs Firestore, écriture d'un document par article, mise à jour par masque de champs, propagation d'un appareil à l'autre, sélection partielle, articles libres, et tout le comportement hors ligne (cochage différé, file d'attente persistée, envoi dans l'ordre au retour du réseau, opération en échec conservée en tête de file). Ces tests **n'appellent jamais votre projet Firebase** : ils lancent l'émulation de `stub-firestore.js` sur un port local, qui sait aussi simuler une panne réseau à la demande.

`test-web.js` couvre le parcours général dans Chromium : les 21 vignettes, la recherche, les filtres, la conservation du focus pendant la saisie, la résolution de la grille fusionnée du tableau de flux (5 colonnes, telle que le navigateur la calcule), l'identifiant inconnu, le mode impression et l'absence de débordement horizontal en 360 px.

`test-semainier.js` couvre le semainier, les photos et la création de recettes, également sur **deux contextes isolés** : poser un plat du livre et un repas hors carnet, remplacer, vider, glisser d'une case à l'autre, échanger deux plats occupés, glisser depuis la réserve, la validation plat par plat avant ajout aux courses (dont le plat déjà en liste décoché et le repas hors carnet non ajoutable), l'envoi d'une photo réduite en deux tailles dans les bornes des règles Firestore, la création refusée sans titre, la suppression d'une recette ajoutée, un repas posé hors ligne, et l'absence de débordement horizontal en 360 px.

`test-partage.js` ouvre **deux contextes Chromium isolés**, c'est-à-dire deux appareils avec des stockages locaux distincts, sur la même base. C'est le seul montage qui prouve réellement le partage : ce que l'un ajoute ou coche doit apparaître chez l'autre après un rafraîchissement. La même suite vérifie qu'**aucune** lecture Firestore n'a lieu pendant quatre secondes d'inactivité, que la nouveauté de l'autre appareil n'arrive donc pas toute seule, et que le bandeau invite à rafraîchir. Puis elle coupe le réseau, vérifie que cocher fonctionne quand même et que les modifications en attente sont annoncées, et enfin qu'elles sont bien parties au retour.

Playwright n'est pas une dépendance du projet. Pour l'installer : `npm i -D playwright && npx playwright install chromium`. Pour désigner une installation existante : `PLAYWRIGHT_MODULE=/chemin/vers/node_modules/playwright CHROMIUM_PATH=/chemin/vers/chromium node tests/run-browser-tests.js`.

La CI joue les tests unitaires et ceux de synchronisation, qui ne demandent aucune installation. Les tests navigateur restent une étape locale, faute de Playwright en CI.

## Déroulé des préparations

La fiche affiche un tableau qui montre à quelle étape chaque ingrédient entre. Deux sources possibles, dans cet ordre de préférence :

**1. Le tableau fourni avec la recette.** Une seule recette du carnet en a un : `lasagnes-bolognaise`. Il est rendu comme un vrai `<table>` avec ses `rowspan`/`colspan` d'origine, dans un conteneur qui défile horizontalement sur petit écran. Il va plus loin que ce qu'on sait générer : il regroupe les ingrédients en sous-préparations qui convergent (la sauce tomate, la béchamel), ce qui est une interprétation humaine du texte. Un tableau fourni est donc toujours préféré.

**2. Un déroulé reconstitué**, pour les seize autres. Le tableau que la source avait produit pour elles ne contenait que des marqueurs répétés (« ✓ », « Selon étapes », « Si concerné ») sans information propre à la recette : il n'est plus affiché. À la place, `js/flux.js` reconstruit le déroulé à partir de ce que la recette contient déjà, en cherchant pour chaque ingrédient la première étape qui le nomme. Le tableau se lit « à l'étape 2, ces ingrédients entrent, et voilà ce qu'on en fait ».

**Il n'y a donc rien à réimporter.**

### Ce que la reconstitution sait faire, et ce qu'elle ne sait pas

Mesuré sur les 21 recettes : **193 ingrédients sur 209 sont rattachés à une étape, soit 92 %**, et 12 recettes le sont entièrement. Un test protège ce plancher.

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

Une nuance à connaître : les recettes modifiées sont relues au chargement de la page et après chaque enregistrement, pas en continu. Une recette modifiée sur un autre appareil apparaît donc au prochain rechargement de la page. C'est désormais la même politique que pour la liste et les menus, à ceci près que ces deux-là ont un bouton de rafraîchissement.

### Nombre de parts

Le formulaire porte un réglage du nombre de parts, avec deux boutons et un champ. Le changer recalcule proportionnellement :

- les quantités des ingrédients, en accordant les unités dénombrables (« 1 gousse » devient « 2 gousses », « 2 morceaux » devient « 4 morceaux ») ;
- les quantités qui figurent **dans le texte des instructions** (« ajouter 800 g de pulpe » devient « 1600 g »).

Un rapport affiche le facteur appliqué, la liste des quantités ajustées dans les instructions, et ce qui a été laissé inchangé faute de quantité chiffrée (« Sel, poivre : Selon le goût »). Rien n'est enregistré avant d'avoir cliqué sur « Enregistrer ».

**Le point délicat, traité explicitement : les durées et les températures ne sont jamais multipliées.** Doubler une recette ne double ni le temps de cuisson ni la température du four. Sur les 75 occurrences numériques des instructions des 20 premières recettes, 69 sont des durées (minutes, heures), des températures (°C) ou des dimensions (cm, mm), et 6 seulement sont des quantités : un facteur appliqué naïvement transformerait « 45 minutes » en « 90 minutes » et « 165 °C » en « 330 °C ». La mise à l'échelle travaille donc sur **liste blanche d'unités** (masses, volumes, cuillerées, gousses, pincées, sachets, tranches) et ne touche jamais un nombre nu, qui serait ambigu (« thermostat 6 »). Un test vérifie, sur les 21 recettes et pour chaque étape, qu'aucune durée ni température ne bouge après un changement de parts.

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

`origine` et `difficulte` sont du texte libre : les filtres travaillent sur des étiquettes courtes dérivées par mots-clés (`origineCourte`, `difficulteCourte` dans `js/logic.js`), le texte intégral restant affiché sur la fiche. Les 21 recettes sont toutes classées ; une source formulée autrement retomberait sur « Autre », et un test le signalerait. La règle « Maghrébine » passe avant « Française » : l'ordre des règles est significatif, sans quoi « Maghrébine, version familiale française » ressortait « Française ».

Pour ajouter une recette : modifier `data/recipes.json`, puis `node tests/run-tests.js`, qui contrôle le schéma, l'unicité des identifiants et la validité des URL de source.

## Importer une recette trouvée sur internet

### Pourquoi un lien seul ne peut pas suffire

Le carnet est un site statique : aucun serveur ne peut aller chercher la page à sa place. Et un `fetch` direct depuis le navigateur vers `marmiton.org` est **bloqué par le navigateur lui-même**. Sans en-tête `Access-Control-Allow-Origin`, la réponse n'est jamais lisible, et aucun site de cuisine ne l'assouplit.

Ce n'est pas un défaut à corriger : c'est la règle qui empêche n'importe quel site de lire le contenu d'un autre en votre nom. Les contournements existent et ont tous été écartés :

| Contournement | Pourquoi non |
|---|---|
| Un relais CORS public | Une dépendance à un service tiers qui voit chaque adresse consultée, peut disparaître du jour au lendemain et limite le débit. Le projet n'a aucune dépendance externe, c'est ce qui fait qu'il ne casse pas en cuisine. |
| Une fonction serveur (Firebase Functions) | Demande le plan facturé, et un serveur à maintenir pour un carnet de famille. |
| Un analyseur par site | Casse à chaque refonte du site en question, et il en faudrait un par site. |

### Ce qui est fait à la place

`js/import-recette.js` lit **`schema.org/Recipe`**, la norme que la quasi-totalité des sites de cuisine publient dans une balise `<script type="application/ld+json">`. Lire une norme donne un import qui marche partout, au lieu d'un analyseur par site. Un repli lit les microdonnées (`itemprop="recipeIngredient"`), forme plus ancienne encore employée.

Le module ne va jamais rien chercher : il reçoit du texte déjà obtenu. Deux façons de le lui apporter, proposées dans la boîte « Importer depuis un site » de l'écran Le livre :

1. **Le marque-page**, en un clic. On le glisse dans la barre de favoris ; cliqué depuis la page d'une recette, il s'exécute **dans cette page**, y lit le `schema.org` qui est du même domaine, et le met dans le presse-papiers. C'est ce qui rend l'import possible depuis un site statique : le carnet ne peut pas aller lire `marmiton.org`, mais un bout de code lancé depuis `marmiton.org` le peut.
2. **Le copier-coller de la page entière** (Ctrl+A, Ctrl+C, Ctrl+V). Plus long d'un geste, mais sans aucune condition.

### Ce que l'import n'invente jamais

La règle du projet s'applique telle quelle : **un trou se déclare, il ne se comble pas.**

- Un temps absent reste « Non indiqué », et la fiche l'écrit dans `manquants`.
- **Le temps total n'est jamais calculé** à partir de la préparation et de la cuisson : les additionner supposerait qu'elles ne se chevauchent pas, ce que la source ne dit pas.
- Une quantité illisible reste dans le nom de l'ingrédient, mot pour mot. « Sel » n'a pas de quantité, et c'est correct.
- Une catégorie inconnue tombe sur « Plat » **et le déclare**, plutôt que de se faire passer pour une donnée de la source.

Tout cela est affiché **avant d'enregistrer**, dans l'aperçu : c'est le moment où l'on peut encore aller chercher l'information sur la page. La fiche créée est ensuite modifiable comme n'importe quelle autre.

**Limite de la couverture** : les deux pages de test sont écrites à partir de la spécification schema.org, pas capturées sur un site réel, l'environnement de développement n'ayant pas accès à internet. Elles reproduisent les formes réellement employées (un `@graph`, des `HowToStep`, des durées ISO 8601, des entités HTML, un bloc JSON cassé parmi d'autres), mais **aucun import contre un vrai site n'a été joué**. C'est le premier point à vérifier à l'usage.

## Importer une extraction

`node tools/importer-extraction.js <fichier.md>` lit une extraction Markdown (une recette par section `## n. Titre`, avec les tableaux « Fiche recette » et « Ingrédients ») et l'ajoute à `data/recipes.json`. Sans `--ecrire`, l'outil ne fait qu'un essai à blanc et affiche ce qu'il ferait.

Deux règles sont tenues par le code, pas par la vigilance de l'opérateur :

1. **Aucune recette existante n'est écrasée.** L'appariement se fait sur des ensembles de mots du titre, et non sur une égalité de chaînes : « Lasagnes bolognaise » est reconnue comme la recette déjà présente sous « Lasagnes bolognaise : la meilleure recette ». Sans cela, la dernière extraction aurait créé trois doublons. Quand plusieurs candidates conviennent, l'outil refuse d'écrire plutôt que de choisir.

2. **Aucune unité n'est inventée.** Quand l'extraction a collé la quantité au nom de l'ingrédient et perdu l'unité au passage (« Farine 200 » sans `g`, « sel 1 c. à » tronqué), la valeur est reprise telle quelle et le manque est écrit dans le champ `manquants` de la recette, que la fiche affiche sous « Ce que la source ne donne pas ». Cette détection est mécanique : elle ne se déclenche que lorsque la colonne quantité était vide et que le nombre a dû être extrait du nom.

Les 17 recettes antérieures n'ont **pas** été réécrites depuis la dernière extraction : celle-ci est en recul mesuré sur les recettes déjà présentes (de −29 % à −80 % de texte d'instructions, et par exemple 17 ingrédients ramenés à 12). Seules les 3 recettes absentes du carnet ont été ajoutées. Les trois sites sources sont inaccessibles depuis l'environnement de développement, les unités perdues n'ont donc pas pu être recoupées : elles sont à corriger dans l'éditeur de l'application.

## La recette venue d'une page de livre

`couscous-poulet-merguez` a été saisie le 9 août 2026 depuis une page de livre de cuisine photographiée. C'est la première recette du carnet **sans source en ligne** : son champ `source.url` vaut `null`, et la fiche affiche alors le nom de la source seul, plutôt qu'un lien mort. Un test vérifie que le nom est toujours présent et que l'adresse est soit absente, soit une vraie URL.

La page se contredit ou se tait sur sept points. **Aucun n'a été comblé** : ils sont écrits dans le champ `manquants`, que la fiche affiche sous « Ce que la source ne donne pas ».

| Ce que dit la page | Ce qui manque ou se contredit |
|---|---|
| Étape 4 : « ajoutez les pois chiches » | Les pois chiches ne figurent pas dans la liste des ingrédients, aucune quantité |
| Étape 5 : « placez la graine de couscous » | La semoule ne figure pas dans la liste des ingrédients, aucune quantité |
| Liste : 4 c. à c. de cumin — Étape 2 : 1 c. à s. de cumin | Deux valeurs différentes, la page ne dit pas laquelle retenir ; les deux sont conservées telles quelles |
| Étape 2 : « salez et poivrez » | Ni sel ni poivre dans la liste des ingrédients |
| Liste : « 1 blette » — Étape 4 : « les feuilles de blette » | Une feuille ou une botte, la page ne le précise pas |
| Étape 3 : 20 min — Étape 4 : 1 heure | Aucun temps de préparation ni de repos ; la cuisson affichée, 1 h 20 min, est la somme de ces deux durées seules et exclut le rissolage des étapes 1 et 2, qui n'est pas chronométré |
| Rien | Aucune difficulté, aucune valeur calorique, aucun éditeur ni auteur |

Deux règles de classement ont dû être ajoutées pour cette recette : `merguez` va en « Viandes et poissons » et `blette` en « Fruits et légumes ». Sans elles, elles tombaient dans « Autre », ce qui est un signal à traiter et non un résultat normal.

## Trois constats sur les données, non corrigés volontairement

Ces écarts viennent des sources. Ils sont signalés plutôt que masqués, et le code les tolère.

1. **Un seul tableau de flux sur 21 porte une information.** Seul `lasagnes-bolognaise` a un tableau construit à la main (5 colonnes, cellules fusionnées, 15 lignes d'ingrédients). Les 16 tableaux fournis par les extractions précédentes ne contiennent que des marqueurs répétés à l'identique (« ✓ », « Selon étapes », « Si concerné ») et ne sont donc pas affichés ; les 3 recettes de la dernière extraction et le couscous n'en embarquent plus du tout, pour la même raison. C'est sans conséquence à l'affichage : l'application reconstitue le déroulé depuis les étapes (voir plus haut), ce qui est plus juste qu'un tableau de marqueurs.

2. **Un numéro d'étape n'est pas un entier.** Dans `lasagnes-bolognaise`, la 6ᵉ étape porte `"numero": "Pour finir"`, libellé repris du site source. Le schéma annonce un entier. La donnée n'a pas été réécrite : le libellé est affiché tel quel, et un test échouera si une nouvelle recette introduit une autre forme.

3. **Vingt quantités sur 209 n'ont pas d'unité (7, 7 et 6 pour les trois recettes de la dernière extraction), et une recette n'a pas de nombre de parts.** L'unité manque à la source telle qu'elle a été extraite, et n'a pas été devinée. Chaque recette concernée le déclare dans son champ `manquants`, affiché sur la fiche. Conséquence assumée : pour `gougeres-de-courgettes-et-comte`, faute de nombre de parts exploitable (« Non indiqué »), le recalcul automatique des quantités est désactivé.

Un quatrième écart, mineur : pour `lasagnes-bolognaise`, le tableau de flux détaille 15 lignes d'ingrédients contre 14 dans la liste `ingredients`, parce qu'il isole « sel, poivre » pour la béchamel.

## Documents de conception

- `docs/BRIEF-UX-2026-08-03.md` : le brief remis au design. Contexte d'usage, contraintes techniques non négociables, inventaire des écrans et de leurs états, modèle de données mesuré, identité visuelle d'alors, problèmes constatés avec leurs preuves, critères d'acceptation. Les captures de l'état au 3 août 2026 sont dans `docs/captures-2026-08-03/`.
- `docs/refonte-2026-08-03/` : la proposition retenue (`HANDOFF-DESIGN.md`, `design-final.html`, six plans). Les cinq écrans qu'elle décrit sont implémentés. Deux points ont été volontairement écartés depuis, à la demande : la pastille de partage compacte, remplacée par un bouton de rafraîchissement dans l'en-tête, et le vocabulaire « Matin / Midi / Soir » de la grille, remplacé par « Petit-déjeuner / Déjeuner / Dîner ».
- `docs/PISTES-2026-08-09.md` : analyse du projet à date et pistes d'amélioration chiffrées, à valider ou invalider. Dit aussi ce qui n'a pas besoin d'être amélioré (poids du site, vitesse de la recherche), pour ne pas encombrer la liste de faux problèmes.
- `docs/DECISIONS-2026-08-04.md` : ce qui a été tranché lors du passage à plusieurs plats par repas, contre quoi, et pourquoi. À lire avant de revenir sur la forme des clés de créneau, sur le comportement du glisser-déposer ou sur le rappel d'ingrédients de l'étape en cours.

## Historique

Une seconde version, en React Native / Expo (mobile plus export web), a existé dans `recipe-app-native/`. Elle a été retirée : cette version web statique est plus aboutie, et maintenir deux bases pour un carnet personnel coûtait plus qu'elle n'apportait. Le code reste consultable dans l'historique Git, jusqu'au commit précédant sa suppression.

## Conventions d'écriture

- **Interface et contenus en français**, typographie française : espace insécable avant `: ; ! ?`, guillemets « », virgule décimale.
- **Palette** définie dans le bloc `:root` de `css/style.css`, source unique des couleurs. Aucune couleur en dur ailleurs.
- **Commentaires en français, sans accents dans le code JavaScript** (les fichiers sont en UTF-8, mais les commentaires historiques sont sans accents ; les chaînes affichées, elles, sont accentuées).
- **Un commentaire dit pourquoi, pas quoi.** Le code dit déjà ce qu'il fait. Ce qui se perd, c'est la raison d'un choix et ce qui a été écarté.
- **Les messages d'erreur nomment l'action à faire.** « Accès refusé par la base » est suivi de « republier `firestore.rules` », parce que la cause n'est pas devinable.
- **Les identifiants et classes sont en français**, comme le reste : `creneau`, `placard`, `repas-carte`.

## Comment travailler avec ce dépôt

- **Mesurer avant d'affirmer.** Tous les chiffres de ce fichier viennent d'une exécution, pas d'une estimation. Un chiffre qu'on ne peut pas refaire ne doit pas y entrer.
- **Ne pas combler un trou de donnée.** Le déclarer dans `manquants`, que la fiche affiche.
- **Consigner les décisions.** `docs/DECISIONS-2026-08-04.md` porte ce qui a été tranché et contre quoi. Une décision revue s'y ajoute, datée, sans réécrire les précédentes.
- **Jouer les trois suites avant de pousser.** Node d'abord, navigateur ensuite : les tests Node sont vingt fois plus rapides et attrapent l'essentiel.
