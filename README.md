# Mon carnet de recettes

Carnet personnel de 17 recettes extraites de leurs sites d'origine (Journal des Femmes Cuisine, Marmiton, Cuisine Actuelle), converties en une base structurée puis présentées par deux applications qui partagent les mêmes données.

| Dossier | Version | Ce qu'elle apporte |
| --- | --- | --- |
| `recipe-app/` | v1, web statique (HTML/CSS/JS, sans framework ni build) | Recherche, filtres, fiche complète, tableau de flux à cellules fusionnées, liste de courses, mode impression |
| `recipe-app-native/` | v2, Expo (React Native) | La même chose sur mobile (iOS, Android via Expo Go) plus un export web depuis la même base de code, sans le mode impression |

Les deux se déploient ensemble sur GitHub Pages par `.github/workflows/deploy-pages.yml` :

- `https://guillaumez88.github.io/Cahier-de-recette/` : l'export web de la v2
- `https://guillaumez88.github.io/Cahier-de-recette/classique/` : la v1 web

## Démarrer

```bash
# v1 web : aucune dépendance, un serveur local suffit
cd recipe-app && python3 -m http.server 8000    # puis http://localhost:8000/

# v2 Expo
cd recipe-app-native
npm ci
npx expo start          # QR code à scanner avec Expo Go
npx expo start --web    # dans le navigateur
```

Ouvrir `recipe-app/index.html` par un double-clic ne fonctionne pas : la page lit `data/recipes.json` avec `fetch()`, que les navigateurs bloquent sur une URL `file://`. La page affiche alors un message expliquant quoi lancer, au lieu de rester vide.

## Les données

Un seul schéma, deux copies du même fichier :

- `recipe-app-native/src/data/recipes.json` (référence)
- `recipe-app/data/recipes.json` (copie)

Rien dans le code ne lie ces deux fichiers. `npm test` dans `recipe-app-native/` compare leurs empreintes et échoue si elles divergent ; le workflow lance ce contrôle avant chaque déploiement. Pour ajouter une recette : modifier le fichier de référence, puis

```bash
cp recipe-app-native/src/data/recipes.json recipe-app/data/recipes.json
```

Le schéma d'une recette est détaillé dans `recipe-app/README.md`.

## Tests

```bash
cd recipe-app-native
npm test          # 34 tests de la logique métier + contrôle de synchronisation
npm run export:web
npm run test:web  # 89 vérifications dans un vrai Chromium, sur les deux versions
```

`npm run test:web` sert l'export de la v2 sous le sous-chemin `/Cahier-de-recette/` via un serveur qui imite GitHub Pages, repli `404.html` compris : c'est le seul montage qui vérifie réellement le comportement de déploiement. Playwright n'est pas une dépendance du projet ; les variables `PLAYWRIGHT_MODULE` et `CHROMIUM_PATH` permettent de désigner une installation existante.

## Deux constats sur les données, non corrigés volontairement

Ces deux écarts viennent des sources. Ils sont signalés plutôt que masqués, et le code les tolère.

1. **16 tableaux de flux sur 17 ne portent aucune information.** Seul `lasagnes-bolognaise` a un tableau construit à la main (5 colonnes, cellules fusionnées, 15 lignes d'ingrédients). Les 16 autres, générés automatiquement, ne contiennent que des marqueurs répétés à l'identique (« ✓ », « Selon étapes », « Si concerné »). Les deux versions ne montrent donc le tableau que lorsqu'il apporte quelque chose. Reconstruire les 16 manquants demande de relire chaque recette : à décider, ce n'est pas un travail automatisable.

2. **Un numéro d'étape n'est pas un entier.** Dans `lasagnes-bolognaise`, la 6ᵉ étape porte `"numero": "Pour finir"`, libellé repris du site source. Le schéma annonce un entier. La donnée n'a pas été réécrite : les deux versions affichent ce libellé tel quel, et un test échouera si une nouvelle recette introduit une autre forme.

Un troisième écart, déjà connu : pour cette même recette, le tableau de flux détaille 15 lignes d'ingrédients contre 14 dans la liste `ingredients`, parce qu'il isole « sel, poivre » pour la béchamel. Sans conséquence.

## Conventions

- Interface et contenus en français, typographie française.
- Palette « carnet de cuisine chaleureux » définie deux fois, à garder d'accord : `recipe-app-native/src/theme/colors.js` et le bloc `:root` de `recipe-app/css/style.css`.
- La logique métier de la v1 (`recipe-app/js/app.js`) est le miroir de `recipe-app-native/src/utils/`, avec les mêmes noms de fonctions. Les tests de la v2 valident cette logique ; une évolution d'un côté se reporte de l'autre.
