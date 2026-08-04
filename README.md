# Miam miam !

Carnet de cuisine de la maison. Trois écrans : le **semainier** des repas de la semaine sur la page d'accueil, le **livre de cuisine** avec ses 20 recettes, et la **liste de courses commune**. Les trois sont partagés entre tous les appareils de la maison : ce que l'un pose, coche ou modifie, les autres le voient.

En ligne : `https://guillaumez88.github.io/Cahier-de-recette/`

Aucune dépendance, aucune étape de construction, aucun framework : quatorze fichiers JavaScript, une feuille de style, un fichier de données. Le partage passe par Firestore, appelé directement par son API REST en `fetch`, sans le SDK Firebase.

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
    │   ├── semaine.js           Calendrier du semainier : semaines, jours, créneaux
    │   ├── icones.js            Pictogrammes, en SVG écrit dans la page
    │   ├── sync.js              Firestore par son API REST, session anonyme
    │   ├── recettes.js          Recettes d'origine, modifications, créations, parts
    │   ├── storage.js           Liste commune : cache local, fusion, file d'attente
    │   ├── semainier.js         Menus communs : cache local, file d'attente
    │   ├── photos.js            Photos : redimensionnement, deux tailles, cache
    │   ├── cuisson.js           Où l'on en est dans une recette, en local
    │   └── app.js               Rendu DOM et routage par ancre
    ├── data/recipes.json        Les 20 recettes
    ├── favicon.svg
    ├── tools/
    │   └── importer-extraction.js  Import d'une extraction Markdown (voir plus bas)
    └── tests/
        ├── run-tests.js           111 tests de la logique métier
        ├── run-sync-tests.js      105 tests de la synchronisation
        ├── test-web.js             88 vérifications navigateur, parcours général
        ├── test-partage.js         40 vérifications navigateur, partage et hors ligne
        ├── test-edition.js         69 vérifications navigateur, modification, parts, accordéon
        ├── test-semainier.js      126 vérifications navigateur, semainier, photos, compteur
        ├── stub-firestore.js       Émulation de Firestore pour les tests
        ├── serveur-test.js         Site + émulation sur le même port
        ├── run-browser-tests.js    Enchaîne serveur et suites navigateur
        ├── verifier-firebase.js     Contrôle en conditions réelles (opt-in)
        └── serveur.js              Serveur statique sans dépendance
```

Tous les modules s'exportent sur `window` dans le navigateur et en CommonJS sous Node, sans transpilation : les tests les chargent directement. L'ordre de chargement dans `index.html` est significatif, chaque script consommant les précédents : `firebase-config.js`, `logic.js`, `quantites.js`, `rayons.js`, `flux.js`, `semaine.js`, `icones.js`, `sync.js`, `recettes.js`, `storage.js`, `semainier.js`, `photos.js`, `cuisson.js`, `app.js`. Le workflow de publication vérifie cet ordre : un script oublié dans la page passerait les tests Node, qui chargent les modules directement, et casserait le site.

`app.js` ne parle jamais au réseau ni au `localStorage` : il passe par `storage.js`, `semainier.js`, `recettes.js` et `photos.js`, seuls endroits décidant où sont rangées les données.

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
- **Navigation adaptée à l'écran.** Sur ordinateur, l'en-tête porte les liens « Le livre » et « Liste de courses », chacun avec son pictogramme, l'état actif visible, le compteur d'articles restants et le bouton de rafraîchissement. Sur téléphone, l'en-tête n'a plus de liens : une **barre d'onglets** en bas de l'écran (Semaine, Le livre, Courses) met les trois destinations sous le pouce, avec un retrait pour l'encoche du bas, et le rafraîchissement se fait en **tirant la page vers le bas**.
- **Pictogrammes** en SVG écrit dans la page, dans `js/icones.js` : aucune police d'icônes ni CDN, donc rien à charger et rien qui casse en cuisine sans connexion. Ils se colorent par `currentColor` et suivent la palette sans code supplémentaire.
- **Impression** (`@media print`) : la navigation, les filtres et les boutons disparaissent, le fond repasse en blanc, et les étapes comme les lignes du tableau ne sont pas coupées entre deux pages.

## Semainier des repas

La page d'accueil répond à une seule question : qu'est-ce qu'on mange. Elle montre la semaine, puis donne accès au livre et à la liste de courses.

### Comment on l'utilise

- **Le bloc « Aujourd'hui » est la première chose de la page**, avec les trois repas du jour, un bouton « + » de 44 px par ligne pour en ajouter un et une croix par plat pour le retirer. Sur téléphone, cette information était auparavant sous un titre, un résumé, deux cartes d'accès, trois onglets, une phrase d'aide et un bandeau d'état : il fallait faire défiler pour savoir ce qu'on mange le soir. Un test vérifie que ce bloc tient dans la hauteur d'un écran de 390 × 850 px.
- **La semaine commence le lundi** et finit le dimanche. Trois créneaux par jour : petit-déjeuner, déjeuner, dîner, nommés de la même façon dans la grille et dans le récapitulatif du jour. Le déjeuner et le dîner ont plus de hauteur que le petit-déjeuner, parce que ce sont les repas qu'on cuisine.
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

Ce rappel est déduit du texte de l'étape, rien n'est saisi recette par recette : une association tenue à la main sur vingt fiches ne resterait pas juste. Sur les 140 étapes du carnet, 103 portent un rappel. Les deux limites sont connues et assumées : une étape qui dit « la préparation » ou « le mélange » ne cite aucun ingrédient et n'affiche donc rien, plutôt que de deviner ; et deux ingrédients partageant un mot (« Sucre » et « Sucre glace ») remontent tous les deux, parce qu'un ingrédient de trop sous les yeux vaut mieux qu'un manquant.

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

## Ajouter et supprimer une recette

Le livre a un bouton « Ajouter une recette » qui ouvre le même formulaire que la modification : un seul écran à maintenir plutôt que deux qui divergeraient.

- **Le titre est obligatoire.** Sans lui, la fiche serait introuvable dans le livre : l'enregistrement est refusé et l'écran le dit, plutôt que de créer une recette sans nom.
- **Deux recettes de même nom ne s'écrasent pas** : l'identifiant reçoit un rang (`soupe`, `soupe-2`).
- **Une recette ajoutée ne peut pas prendre l'identifiant d'une recette d'origine**, qui vit dans le fichier servi avec le site.
- **La photo vient après le premier enregistrement**, et l'écran l'explique : elle est rangée sous l'identifiant de la recette, qui n'existe pas encore.
- **Une recette ajoutée se supprime, une recette d'origine se rétablit.** Ce ne sont pas les mêmes gestes et ils ne portent pas le même risque, donc pas le même bouton. La suppression demande confirmation, dit qu'elle vaut pour tout le monde et qu'il n'y a pas d'original à rétablir, puis retire aussi la recette du semainier. Supprimer une recette d'origine est refusé par le code : elle réapparaîtrait à la prochaine lecture du fichier.

## Liste de courses commune

Une seule liste, partagée par tous ceux qui ouvrent le site. Ce que l'un ajoute ou coche apparaît chez les autres.

### Comment on l'utilise

- Sur une fiche recette : cocher les ingrédients voulus puis « Ajouter la sélection », ou « Tout ajouter à la liste » pour la recette entière. Les ingrédients déjà dans la liste sont marqués et leur case est désactivée.
- Sur la page liste : un champ permet d'ajouter un article libre (« pain », « lessive ») avec sa quantité, hors recette. Les articles sont groupés par recette, les ajouts libres à part.
- Cocher un article le barre chez tout le monde. « Retirer les cochés » fait le ménage au retour des courses.
- La liste est lue **une fois au chargement**, puis mise à jour par le bouton de rafraîchissement de l'en-tête. Le bandeau indique l'âge de ce qui est affiché.

### Rangement par rayon et addition des quantités

La liste est rangée dans l'ordre d'un parcours de magasin : Fruits et légumes, Viandes et poissons, Crèmerie, Boulangerie, Surgelés, Épices et herbes, Épicerie salée, Épicerie sucrée, Boissons. On ne revient donc pas trois fois au même rayon.

Le classement se fait par mots-clés dans `js/rayons.js`, et les 126 ingrédients du carnet sont tous classés, ce qu'un test vérifie. Trois traitements évitent des erreurs constatées sur les données réelles : la ligature `œ` est convertie en `oe` (sans quoi « Œufs » n'était pas reconnu, et « Bœuf haché » partait en crèmerie), ce qui suit « pour » est ignoré car c'est un usage et non un produit (« Farine pour beurre manié » est de la farine), et les parenthèses de la source sont retirées. Un ingrédient inclassable tomberait dans « Autre », ce qui est un signal à traiter, pas un résultat normal.

**Les quantités du même ingrédient s'additionnent** : 300 g de beurre venus d'une recette et 125 g d'une autre donnent une seule ligne « Beurre 425 g », avec le nom des recettes d'origine en regard. Les conversions se font dans une même famille (50 cl + 1 l = 1,5 l), jamais entre familles : « 3 c. à s. » et « 200 g » restent affichés côte à côte, et une cuillère à soupe n'est pas convertie en cuillère à café.

Deux garde-fous délibérés :

- **Rien n'est perdu.** Une quantité non chiffrable (« Selon goût », « Pour le moule ») est conservée mot pour mot, et un commentaire attaché à un nombre (« 130 g, plus pour le moule ») n'est jamais fondu dans un total, ce qui l'effacerait.
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

**Le semainier et les photos demandent une republication des règles.** `firestore.rules` couvre désormais quatre collections : `listes/{id}/articles`, `recettes`, `semainiers/{id}/creneaux` et `photos`. Les deux dernières sont nouvelles : tant que les règles publiées ne les contiennent pas, Firestore refuse l'accès, le semainier reste bloqué sur « Hors ligne » et aucune photo ne s'enregistre. Coller `firestore.rules` dans la console Firebase (*Firestore Database* → *Règles* → *Publier*), puis relancer `node tests/verifier-firebase.js --reel`.

Ce contrôle ne vérifie pas seulement que l'écriture passe : il vérifie aussi que les règles **refusent** ce qu'elles doivent refuser, un créneau au moment inconnu et une photo hors borne de taille. Si ces deux contrôles-là échouent, les règles publiées ne sont pas celles du dépôt même si le reste fonctionne.

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

Onze contrôles : session anonyme, écriture d'un document par article, conservation des accents et des quantités à l'aller-retour, cochage n'écrivant que le champ concerné, relecture depuis un cache local vide (le cas du second appareil), article libre, retrait des cochés, suppression, intégrité des articles préexistants, puis accès à la collection des recettes et cycle complet d'une recette modifiée.

Au 3 août 2026, les onze passent. En cas d'échec sur la collection des recettes, le message nomme précisément l'action à faire.

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

En échange, **l'âge de ce qui est affiché est visible en permanence** : « Liste partagée, à jour il y a 3 minutes » dans le bandeau, et « il y a 3 min » sur le bouton de l'en-tête. Au-delà de deux minutes (`seuilDonneesAgees`), les deux changent de couleur. Un minuteur de 15 secondes réécrit ces seuls libellés, sans aucune lecture réseau : sans lui, l'âge affiché resterait figé à sa valeur du dernier rendu, ce qui serait pire que de ne rien afficher.

Le bandeau distingue par ailleurs **trois causes d'échec**, qui n'appellent pas les mêmes actions :

| Ce que dit le bandeau | Cause réelle | Ce qu'il faut faire |
|---|---|---|
| Hors ligne | Pas de réseau | Attendre, les modifications sont conservées et partiront |
| Service momentanément indisponible | `429`, quota gratuit du jour épuisé | Rien, cela repart le lendemain |
| Accès refusé par la base | `403 PERMISSION_DENIED` | Republier `firestore.rules` |

Confondre les trois était le vrai défaut de la version précédente : elle annonçait « Hors ligne » pour un quota épuisé.
- **Aucun test ne touche votre projet réel.** L'émulation locale sert à tout vérifier. Le revers est que le comportement contre le vrai Firestore n'est pas prouvé : c'est le premier point à confirmer après la configuration.

## Tests

```bash
cd recipe-app
node tests/run-tests.js           # 111 tests de la logique métier
node tests/run-sync-tests.js      # 105 tests de la synchronisation
node tests/run-browser-tests.js   # 323 vérifications dans un vrai Chromium
```

`run-tests.js` couvre l'analyse des durées, la normalisation des origines et difficultés en texte libre, la recherche, la combinaison des filtres, le test d'informativité du tableau de flux, le calendrier du semainier (dont les deux pièges de fuseau et les semaines à cheval sur deux mois ou deux années) et l'intégrité du jeu de données.

`run-sync-tests.js` couvre la synchronisation de bout en bout : session anonyme et renouvellement de jeton, encodage des valeurs Firestore, écriture d'un document par article, mise à jour par masque de champs, propagation d'un appareil à l'autre, sélection partielle, articles libres, et tout le comportement hors ligne (cochage différé, file d'attente persistée, envoi dans l'ordre au retour du réseau, opération en échec conservée en tête de file). Ces tests **n'appellent jamais votre projet Firebase** : ils lancent l'émulation de `stub-firestore.js` sur un port local, qui sait aussi simuler une panne réseau à la demande.

`test-web.js` couvre le parcours général dans Chromium : les 20 vignettes, la recherche, les filtres, la conservation du focus pendant la saisie, la résolution de la grille fusionnée du tableau de flux (5 colonnes, telle que le navigateur la calcule), l'identifiant inconnu, le mode impression et l'absence de débordement horizontal en 360 px.

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

Une nuance à connaître : les recettes modifiées sont relues au chargement de la page et après chaque enregistrement, pas en continu. Une recette modifiée sur un autre appareil apparaît donc au prochain rechargement de la page. C'est désormais la même politique que pour la liste et les menus, à ceci près que ces deux-là ont un bouton de rafraîchissement.

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

## Refonte du design en cours

`docs/BRIEF-UX-2026-08-03.md` réunit tout ce qu'il faut pour reprendre le design de l'application : contexte d'usage, contraintes techniques non négociables, inventaire des écrans et de leurs états, modèle de données mesuré, identité visuelle actuelle, problèmes constatés avec leurs preuves, et critères d'acceptation. Les captures de l'état au 3 août 2026 sont dans `docs/captures-2026-08-03/`.

## Historique

Une seconde version, en React Native / Expo (mobile plus export web), a existé dans `recipe-app-native/`. Elle a été retirée : cette version web statique est plus aboutie, et maintenir deux bases pour un carnet personnel coûtait plus qu'elle n'apportait. Le code reste consultable dans l'historique Git, jusqu'au commit précédant sa suppression.

## Conventions

- Interface et contenus en français, typographie française.
- Palette « carnet de cuisine chaleureux » définie dans le bloc `:root` de `css/style.css`, source unique des couleurs.
- `app.js` ne lit jamais le `localStorage` ni ne filtre lui-même : il passe par `logic.js` et `storage.js`. Cette séparation est ce qui rendra possible un changement de stockage sans toucher au rendu.
