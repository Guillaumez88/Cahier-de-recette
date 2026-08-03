# Mon carnet de recettes

Carnet personnel de 17 recettes extraites de leurs sites d'origine (Journal des Femmes Cuisine, Marmiton, Cuisine Actuelle), converties en une base structurée et présentées par un site statique : recherche, filtres, fiche complète, tableau de flux, liste de courses, impression.

En ligne : `https://guillaumez88.github.io/Cahier-de-recette/`

Aucune dépendance, aucune étape de construction, aucun framework. Trois fichiers JavaScript, une feuille de style, un fichier de données.

## Structure

```
.
├── .github/workflows/deploy-pages.yml   Tests puis publication sur GitHub Pages
└── recipe-app/
    ├── index.html          Structure de la page, un seul point de montage
    ├── css/style.css       Thème « carnet de cuisine chaleureux », responsive, impression
    ├── js/
    │   ├── logic.js        Logique métier : durées, filtres, recherche, tableau de flux
    │   ├── storage.js      Liste de courses : lecture et écriture, sans rendu
    │   └── app.js          Rendu DOM et routage par ancre
    ├── data/recipes.json   Les 17 recettes
    ├── favicon.svg
    └── tests/
        ├── run-tests.js            26 tests de la logique métier, sous Node pur
        ├── test-web.js             49 vérifications dans un vrai Chromium
        ├── run-browser-tests.js    Enchaîne serveur et test navigateur
        └── serveur.js              Serveur statique sans dépendance
```

`logic.js` et `storage.js` sont séparés du rendu pour deux raisons : ils sont testables sous Node sans navigateur, et `app.js` reste lisible. Les deux s'exportent sur `window` dans le navigateur et en CommonJS sous Node, sans transpilation. L'ordre de chargement des scripts dans `index.html` est significatif : `logic.js`, puis `storage.js`, puis `app.js`.

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
- **Liste de courses** persistée en `localStorage`, groupée par recette, avec cases à cocher et compteur dans l'en-tête.
- **Impression** (`@media print`) : la navigation, les filtres et les boutons disparaissent, le fond repasse en blanc, et les étapes comme les lignes du tableau ne sont pas coupées entre deux pages.

## Tests

```bash
cd recipe-app
node tests/run-tests.js           # 26 tests, sous Node pur, instantané
node tests/run-browser-tests.js   # 49 vérifications dans un vrai Chromium
```

Les tests unitaires couvrent l'analyse des durées, la normalisation des origines et difficultés en texte libre, la recherche, la combinaison des filtres, le test d'informativité du tableau de flux, le cycle complet de la liste de courses (ajout, absence de doublon, cochage, retrait d'une recette parmi deux, vidage, résistance à un stockage corrompu) et l'intégrité du jeu de données.

Les tests navigateur couvrent le rendu des 17 vignettes, la recherche, la combinaison des filtres, la conservation du focus pendant la saisie, la résolution de la grille fusionnée du tableau de flux (5 colonnes, telle que le navigateur la calcule), le cycle de la liste de courses avec sa persistance après rechargement, l'identifiant inconnu, le mode impression et l'absence de débordement horizontal en 360 px.

Playwright n'est pas une dépendance du projet. Pour l'installer : `npm i -D playwright && npx playwright install chromium`. Pour désigner une installation existante : `PLAYWRIGHT_MODULE=/chemin/vers/node_modules/playwright CHROMIUM_PATH=/chemin/vers/chromium node tests/run-browser-tests.js`.

La CI ne joue que les tests unitaires, qui ne demandent aucune installation. Les tests navigateur restent une étape locale.

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
