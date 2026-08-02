# Mon carnet de recettes (React Native / Expo)

Application Expo (React Native) pour mobile, avec export web possible depuis le même code. Reprend les 17 recettes de la v1 web (`recipe-app/`) : recherche et filtres, fiche détaillée complète, liste de courses persistante. Le mode impression de la v1 web n'a pas été repris (pas d'équivalent natif sur mobile).

## Pourquoi Expo plutôt que le CLI React Native « bare »

Le CLI bare ne fournit pas d'export web intégré ; l'obtenir demanderait de brancher `react-native-web` avec Webpack à la main. Expo gère cet export nativement (`expo export --platform web`), ce qui correspond à l'objectif « mobile + web » retenu. Contrepartie : Expo ajoute une couche managée au-dessus de React Native (moins de configuration native directe que le bare).

## Structure du projet

```
recipe-app-native/
├── App.js                        Point d'entrée, navigation (React Navigation)
├── app.json                      Configuration Expo
├── babel.config.js
├── package.json
└── src/
    ├── data/recipes.json          Les 17 recettes (même schéma que la v1 web)
    ├── theme/colors.js            Palette de couleurs
    ├── utils/
    │   ├── format.js               parseMinutes, mise en forme du texte
    │   ├── filters.js              Logique de recherche/filtres (fonction pure)
    │   ├── flow.js                 Résolution du tableau de flux (rowspan/colspan → grille pleine) et regroupement en "phases"
    │   └── storage.js              Liste de courses (AsyncStorage, async)
    ├── components/
    │   ├── CategoryPill.js
    │   ├── RecipeCard.js
    │   ├── FilterBar.js
    │   ├── FlowView.js              Vue mobile du tableau de flux (voir plus bas)
    │   ├── BoldText.js              Rendu de "**gras**" sans dépendance Markdown
    │   └── ShoppingHeaderButton.js  Bouton d'en-tête avec badge du nombre d'articles
    └── screens/
        ├── HomeScreen.js            Recherche, filtres, grille de recettes
        ├── RecipeDetailScreen.js    Fiche complète
        └── ShoppingListScreen.js    Liste de courses
```

## Différences volontaires par rapport à la version web

- **Tableau de flux** : la version web affichait une grille HTML avec cellules fusionnées (`rowspan`/`colspan`). React Native n'a pas de primitive de tableau, et un tel tableau serait de toute façon peu lisible sur un écran de téléphone. `src/utils/flow.js` résout la grille (algorithme standard de résolution des `rowspan`/`colspan`) puis la restitue comme une timeline verticale : étapes préalables, puis pour chaque étape, les groupes d'ingrédients qui suivent la même action. C'est un changement de présentation assumé, pas un compromis technique caché.
- **Stockage** : la liste de courses utilise `AsyncStorage` (asynchrone) au lieu de `localStorage` (synchrone côté web). Toutes les fonctions de `src/utils/storage.js` retournent donc des `Promise`.
- **Filtres** : pas de `<select>` HTML natif sur mobile ; les filtres Origine/Difficulté/Temps sont rendus en puces (chips) au lieu de menus déroulants.
- **Impression** : retirée (décision prise pour cette version, pas d'équivalent mobile direct). Si besoin plus tard, l'alternative naturelle serait un export PDF partageable (`expo-print` + `expo-sharing`).

## Installer et lancer

```bash
cd recipe-app-native
npm install
npx expo start
```

`npx expo start` affiche un QR code : le scanner avec l'app **Expo Go** (iOS/Android) lance l'application sur le téléphone sans build natif. Pour un simulateur :

```bash
npx expo start --ios       # nécessite Xcode (macOS)
npx expo start --android   # nécessite Android Studio / un émulateur configuré
```

Pour tester la version web dans le navigateur :

```bash
npx expo start --web
```

## Exporter la version web (déploiement statique)

```bash
npx expo export --platform web
```

Génère un dossier `dist/` déployable comme site statique (GitHub Pages, Netlify, Vercel...), exactement comme la v1 web.

## Publier sur GitHub (dépôt `Guillaumez88/Cahier-de-recette`)

Le contenu de ce dossier doit être poussé à la **racine** du dépôt (pas dans un sous-dossier `recipe-app-native/`) :

```bash
cd recipe-app-native
git init
git add .
git commit -m "Carnet de recettes - version Expo (mobile + web)"
git branch -M main
git remote add origin https://github.com/Guillaumez88/Cahier-de-recette.git
git push -u origin main
```

`.gitignore` exclut déjà `node_modules/`, `.expo/` et `dist/`.

## Déploiement automatique sur GitHub Pages (Actions)

Le paramètre Pages du dépôt étant réglé sur « GitHub Actions » comme source, le fichier `.github/workflows/deploy-pages.yml` fourni ici suffit : à chaque `push` sur `main`, il installe les dépendances, exporte la version web (`npx expo export --platform web` → dossier `dist/`) et publie ce dossier sur Pages. Rien d'autre à configurer côté Settings.

Le site sera servi sous un sous-chemin (`https://guillaumez88.github.io/Cahier-de-recette/`), pas à la racine du domaine. J'ai ajouté dans `app.json` :

```json
"experiments": { "baseUrl": "/Cahier-de-recette" }
```

**Point à vérifier après le premier déploiement** : ce réglage (`experiments.baseUrl`) est documenté pour les exports statiques Expo, mais son comportement exact avec le bundler Metro en dehors d'Expo Router n'a pas pu être testé ici (impossible d'exécuter `expo export` dans cet environnement, faute d'accès au registre npm). Après le premier déploiement automatique :
- Si le site s'affiche correctement à `https://guillaumez88.github.io/Cahier-de-recette/` : rien à faire.
- Si la page est blanche ou que la console du navigateur montre des erreurs 404 sur des fichiers `.js`/`.css` : c'est un souci de chemin de base. Renvoyez-moi le message d'erreur exact (ou une capture de l'onglet Réseau des outils de développement) et j'ajusterai la configuration.

Le premier run du workflow est visible dans l'onglet **Actions** du dépôt ; s'il échoue, le journal indique la ligne en cause (transmettez-le-moi si besoin, `npm install` sans `package-lock.json` existant peut occasionnellement résoudre des versions légèrement différentes de celles testées ici).

## Ajouter de nouvelles recettes

Même schéma JSON que la v1 web (voir `recipe-app/README.md` pour le détail des champs). Le plus simple reste de fournir la fiche d'extraction Markdown habituelle et de demander la mise à jour de `src/data/recipes.json`.

## Limites de la vérification effectuée

Ce projet a été rédigé et relu attentivement, mais **n'a pas pu être exécuté** dans l'environnement où il a été généré : l'accès au registre npm y est bloqué (impossible d'installer les dépendances, donc pas de `npx expo start` ni de build réel). Ce qui a été fait à la place :
- Vérification syntaxique réelle (`node --check`) sur tous les fichiers utilitaires purs (`format.js`, `filters.js`, `flow.js`, `storage.js`) : aucune erreur.
- Test fonctionnel de la logique de filtrage et de résolution du tableau de flux sur les 17 recettes (via Node, en import direct des modules) : résultats cohérents, aucune anomalie.
- Relecture manuelle ligne à ligne des composants et écrans React Native (JSX), faute d'outillage Babel disponible pour une vérification automatique.

Il est donc possible qu'une erreur mineure apparaisse au premier `npx expo start` (import manquant, faute de frappe non détectée). Signalez le message d'erreur exact et il sera corrigé rapidement.

## Versions

Les versions d'Expo/React Native indiquées dans `package.json` (`expo ~52`, `react-native 0.76`) reflètent les dernières versions connues au moment de la rédaction ; le SDK Expo évolue vite. Si `npm install` ou `npx expo start` signale une incompatibilité de version, lancer :

```bash
npx expo install --fix
```

qui aligne automatiquement les dépendances sur la version du SDK Expo installée.
