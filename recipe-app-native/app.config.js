// Configuration Expo en JavaScript plutôt qu'en app.json, afin que le sous-chemin
// de déploiement ne soit écrit qu'une seule fois : ce fichier et le routage de
// App.js lisent tous deux src/config/base-path.json.

const { basePath } = require('./src/config/base-path.json');

module.exports = {
  expo: {
    name: 'Mon carnet de recettes',
    slug: 'carnet-de-recettes',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    backgroundColor: '#FBF3E6',
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.carnetderecettes.app',
    },
    android: {
      package: 'com.carnetderecettes.app',
      adaptiveIcon: {
        backgroundColor: '#FBF3E6',
      },
    },
    web: {
      bundler: 'metro',
      // "single" et non "static" : le rendu statique (un fichier HTML par route)
      // exige Expo Router, alors que cette application utilise React Navigation.
      // Avec "static", l'export échoue sur un import manquant de
      // @expo/metro-runtime. Le repli des liens profonds est assuré par le
      // 404.html écrit par scripts/post-export.js.
      output: 'single',
    },
    experiments: {
      baseUrl: basePath,
    },
  },
};
