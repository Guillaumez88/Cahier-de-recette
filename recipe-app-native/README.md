# v2 : application Expo (React Native)

Mobile (iOS, Android) et export web depuis la même base de code. Reprend les 17 recettes de la v1 : recherche, filtres, fiche complète, liste de courses.

## Pourquoi Expo plutôt que le CLI React Native « bare »

Le CLI bare ne fournit pas d'export web ; l'obtenir demanderait de brancher `react-native-web` avec un bundler à la main. Expo gère cet export nativement (`expo export --platform web`), ce qui correspond à l'objectif « mobile + web ». Contrepartie : une couche managée au-dessus de React Native, donc moins d'accès direct à la configuration native.

## Structure

```
recipe-app-native/
├── index.js                      Point d'entrée (registerRootComponent)
├── App.js                        Navigation React Navigation + routage des URL web
├── app.config.js                 Configuration Expo (en JS, pour lire le sous-chemin)
├── package.json / package-lock.json
├── public/favicon.svg            Copié dans dist/ par l'export
├── scripts/post-export.js        Retouches de dist/ (lang, 404.html, icône)
├── tests/
│   ├── run-tests.js              34 tests de la logique métier, sous Node pur
│   ├── check-sync.js             Contrôle d'égalité des deux recipes.json
│   └── browser/                  Tests dans un vrai Chromium (v1 et v2)
└── src/
    ├── config/base-path.json     Sous-chemin de déploiement, source unique
    ├── data/recipes.json         Les 17 recettes (fichier de référence)
    ├── theme/colors.js           Palette
    ├── utils/
    │   ├── format.js             parseMinutes, splitBold, stripTipPrefix, normalisation origine/difficulté
    │   ├── filters.js            filterRecipes, recherche insensible aux accents
    │   ├── flow.js               resolveGrid, buildFlowPhases, isFlowTableInformative
    │   ├── linking.js            stripBasePath / addBasePath
    │   └── storage.js            Liste de courses (AsyncStorage, asynchrone)
    ├── components/               CategoryPill, RecipeCard, FilterBar, FlowView, BoldText, ShoppingHeaderButton
    └── screens/                  HomeScreen, RecipeDetailScreen, ShoppingListScreen
```

## Installer et lancer

```bash
cd recipe-app-native
npm ci                     # npm ci : le package-lock.json est committé
npx expo start             # QR code à scanner avec Expo Go
npx expo start --web       # dans le navigateur
npx expo start --ios       # simulateur, nécessite Xcode (macOS)
npx expo start --android   # émulateur, nécessite Android Studio
```

## Exporter la version web

```bash
npm run export:web   # expo export --platform web, puis scripts/post-export.js
npx serve dist       # ou n'importe quel serveur statique
```

## Différences volontaires par rapport à la v1

- **Tableau de flux** : React Native n'a pas de primitive de tableau, et une grille à 5 colonnes serait illisible sur un téléphone. `src/utils/flow.js` résout la grille (`rowspan`/`colspan`) puis la restitue en phases verticales : les ingrédients qui subissent la même suite d'actions sont regroupés. Changement de présentation assumé, pas un contournement.
- **Stockage** : `AsyncStorage` au lieu de `localStorage`, donc toutes les fonctions de `src/utils/storage.js` retournent des `Promise`.
- **Filtres** : pas de `<select>` natif sur mobile, les critères sont rendus en rangées de puces défilantes.
- **Impression** : retirée, pas d'équivalent mobile direct. L'alternative serait un export PDF partageable (`expo-print` + `expo-sharing`).

## Déploiement sur GitHub Pages

Le workflow `.github/workflows/deploy-pages.yml`, **à la racine du dépôt** (GitHub Actions ne lit pas les workflows placés dans un sous-dossier de projet), installe les dépendances avec `npm ci`, lance les tests, exporte la version web, y ajoute la v1 sous `/classique/`, et publie.

Le site est servi sous un sous-chemin, `https://guillaumez88.github.io/Cahier-de-recette/`, pas à la racine du domaine. Trois réglages en découlent, tous vérifiés en servant réellement l'export sous ce sous-chemin :

1. **`experiments.baseUrl`** dans `app.config.js` préfixe les actifs (bundle JS, images) à la compilation. Il ne règle **que** cela.
2. **Le routage applicatif** doit être adapté séparément. React Navigation ignore `baseUrl` : sans `src/utils/linking.js`, ouvrir `/Cahier-de-recette/recette/<id>` affiche la liste d'accueil au lieu de la fiche, et les URL produites perdent leur préfixe. `App.js` retire donc le sous-chemin des chemins entrants et le remet sur les chemins sortants.
3. **`web.output` vaut `single`, pas `static`.** Le rendu statique (un fichier HTML par route) exige Expo Router ; avec React Navigation, l'export échoue sur un import manquant de `@expo/metro-runtime`. En monopage, `dist/` ne contient qu'un `index.html`, donc un hébergement statique renvoie 404 sur un lien profond. `scripts/post-export.js` copie `index.html` en `404.html` : GitHub Pages sert ce fichier pour un chemin introuvable, et le routage reprend la main côté client. Le statut HTTP reste 404, sans effet visible pour l'utilisateur.

Le sous-chemin n'est écrit qu'une fois, dans `src/config/base-path.json`, lu par `app.config.js` et par `App.js`. Pour un hébergement à la racine d'un domaine, y mettre `""`.

`scripts/post-export.js` corrige aussi deux manques du modèle HTML d'Expo : `lang="en"` devient `lang="fr"`, et une icône est déclarée (sans quoi le navigateur demande `/favicon.ico` à la racine du domaine et reçoit une 404).

## Tests

```bash
npm test          # 34 tests de la logique métier + synchronisation des deux recipes.json
npm run export:web
npm run test:web  # 89 vérifications dans un vrai Chromium (49 sur la v1, 40 sur la v2)
```

`tests/run-tests.js` s'exécute sous Node pur, sans Expo ni Babel : il transpile les modules utilitaires en CommonJS à la volée. Il couvre l'analyse des durées, la normalisation des origines et difficultés en texte libre, la recherche, la combinaison des filtres, la résolution de la grille `rowspan`/`colspan` sur les vraies données (les 7 lignes couvertes par la sauce tomate, les 4 de la béchamel, le rowspan 15 des colonnes d'assemblage), le regroupement en phases, le sous-chemin de déploiement et l'intégrité du jeu de données.

`npm run test:web` lance un serveur qui imite GitHub Pages (repli `404.html` compris) et vérifie dans Chromium : montage sans erreur console, absence de 404 sur les actifs, les 17 vignettes, recherche et filtres, navigation, ouverture d'une fiche par URL profonde, présence du sous-chemin dans les URL produites, cycle complet de la liste de courses avec persistance après rechargement, masquage du tableau de flux non informatif, langue du document et icône servie.

Playwright n'est pas une dépendance du projet. Pour l'installer : `npm i -D playwright && npx playwright install chromium`. Pour désigner une installation existante : `PLAYWRIGHT_MODULE=/chemin/vers/node_modules/playwright CHROMIUM_PATH=/chemin/vers/chromium npm run test:web`.

## Versions

Le socle est aligné sur le SDK Expo courant au moment de l'installation, avec les versions issues de la table de compatibilité embarquée dans le paquet `expo` (`node_modules/expo/bundledNativeModules.json`) : Expo 57, React Native 0.86, React 19, React Navigation 7. `npx expo install --fix` réaligne automatiquement après une montée de SDK.

Le point d'entrée est `index.js` avec `registerRootComponent`, et il n'y a pas de `babel.config.js` : c'est la forme du modèle Expo actuel. Les anciennes conventions (`main: "node_modules/expo/AppEntry.js"`, `babel-preset-expo` déclaré à la main) ne sont plus nécessaires.

À noter en cas de test sur téléphone : l'application Expo Go ne prend en charge que le SDK courant. Pour un SDK plus ancien, il faut un development build.

## Ajouter une recette

Modifier `src/data/recipes.json` (fichier de référence), puis reporter sur la v1 :

```bash
cp src/data/recipes.json ../recipe-app/data/recipes.json
npm test   # échoue si les deux fichiers diffèrent
```
