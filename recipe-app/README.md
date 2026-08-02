# v1 : application web statique

HTML, CSS et JavaScript, sans framework, sans build, sans dépendance. Trois fichiers de code et un fichier de données.

```
recipe-app/
├── index.html          Structure de la page, un seul point de montage
├── css/style.css       Thème « carnet de cuisine chaleureux », responsive, impression
├── js/app.js           Routage par ancre, filtres, rendu, tableau de flux, liste de courses
├── data/recipes.json   Les 17 recettes (copie de la v2, voir le README racine)
└── favicon.svg
```

## Lancer

```bash
cd recipe-app
python3 -m http.server 8000   # puis http://localhost:8000/
```

Un double-clic sur `index.html` ne fonctionne pas : `fetch('data/recipes.json')` est bloqué par les navigateurs sur une URL `file://`. La page affiche dans ce cas un message expliquant la commande à lancer, plutôt que de rester vide.

## Fonctionnalités

- **Routage par ancre** : `#/`, `#/recette/<id>`, `#/liste-de-courses`. Les URL sont partageables et le bouton de retour du navigateur fonctionne.
- **Recherche** insensible à la casse et aux accents, portant sur le titre, la catégorie, l'origine, les ingrédients et le texte des étapes. Plusieurs mots se cumulent (conjonction).
- **Filtres** par catégorie, origine, difficulté et tranche de temps total. Un clic sur un filtre actif le désactive.
- **Fiche complète** : temps, origine, ingrédients par groupe, étapes numérotées avec leurs astuces, tableau de flux, astuces, variantes, recettes associées, ce que la source ne donne pas, source citée avec son lien.
- **Tableau de flux** rendu comme un vrai `<table>` avec les `rowspan`/`colspan` d'origine, dans un conteneur qui défile horizontalement sur petit écran.
- **Liste de courses** persistée en `localStorage`, groupée par recette, avec cases à cocher et compteur dans l'en-tête.
- **Impression** (`@media print`) : la navigation, les filtres et les boutons disparaissent, le fond repasse en blanc, et les étapes comme les lignes du tableau ne sont pas coupées entre deux pages.

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

`origine` et `difficulte` sont du texte libre : les filtres travaillent sur des étiquettes courtes dérivées par mots-clés (`origineCourte`, `difficulteCourte` dans `js/app.js`). Le texte intégral reste affiché sur la fiche. Les 17 recettes sont toutes classées ; une source formulée autrement retomberait sur « Autre », et le test correspondant de la v2 le signalerait.

`numero` n'est pas toujours un entier : voir le README racine.

`flowTable` est une grille générique, à la façon d'un tableau HTML. Elle n'est affichée que lorsqu'elle porte une information ; sur 17 recettes, une seule remplit cette condition (voir le README racine).

## Tests

Cette version n'a pas de chaîne de test propre, pour rester sans dépendance. Elle est couverte depuis la v2 :

```bash
cd ../recipe-app-native
npm run test:web   # 49 vérifications sur la v1 dans un vrai Chromium
```

Ces vérifications couvrent le rendu des 17 vignettes, la recherche, la combinaison des filtres, la conservation du focus pendant la saisie, la résolution de la grille fusionnée du tableau de flux (5 colonnes), le cycle complet de la liste de courses avec sa persistance, l'identifiant inconnu, le mode impression et l'absence de débordement horizontal en 360 px.

## Conventions

La logique métier de `js/app.js` (normalisation, filtres, tranches de temps, test d'informativité du tableau de flux, liste de courses) est le miroir de `recipe-app-native/src/utils/`, avec les mêmes noms de fonctions. Toute évolution ici se reporte là-bas, et réciproquement. La palette du bloc `:root` de `css/style.css` doit rester d'accord avec `recipe-app-native/src/theme/colors.js`.
