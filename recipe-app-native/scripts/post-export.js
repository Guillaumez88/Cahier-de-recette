// Retouches appliquées à dist/ après « expo export --platform web ».
// Exécuté par le script npm « export:web », donc aussi par la CI.
//
// Deux corrections, toutes deux constatées en servant réellement l'export sous le
// sous-chemin /Cahier-de-recette/ :
//
// 1. `web.output` vaut "single" (application monopage). Le mode "static", qui
//    pré-rend un fichier HTML par route, exige Expo Router ; cette application
//    utilise React Navigation, et l'export échoue alors sur un import manquant
//    de @expo/metro-runtime. En monopage, dist/ ne contient qu'index.html : un
//    hébergement statique renvoie donc 404 sur /recette/<id> ouvert directement.
//    GitHub Pages sert 404.html quand un chemin est introuvable, et le routage
//    de React Navigation reprend la main côté client. Copier index.html en
//    404.html suffit donc à faire fonctionner les liens profonds et le
//    rechargement de page.
//
// 2. Le modèle HTML d'Expo écrit <html lang="en">. L'interface et les contenus
//    sont en français : on corrige l'attribut, qui compte pour les lecteurs
//    d'écran et la synthèse vocale.
//
// 3. Le modèle ne déclare aucune icône : le navigateur demande alors /favicon.ico
//    à la racine du domaine, hors du sous-chemin, et reçoit une 404 (constatée en
//    console). On déclare public/favicon.svg, préfixé par le sous-chemin.

const fs = require('fs');
const path = require('path');

const { basePath } = require('../src/config/base-path.json');

const dist = path.join(__dirname, '..', 'dist');
const index = path.join(dist, 'index.html');

if (!fs.existsSync(index)) {
  console.error(`post-export : ${index} est introuvable, l'export a-t-il bien tourné ?`);
  process.exit(1);
}

let html = fs.readFileSync(index, 'utf8');

const avant = html;
html = html.replace(/<html\s+lang="[^"]*"/i, '<html lang="fr"');
if (html === avant && !/<html[^>]*lang="fr"/i.test(html)) {
  console.warn('post-export : attribut lang introuvable dans index.html, aucune substitution.');
}

const favicon = path.join(dist, 'favicon.svg');
if (!fs.existsSync(favicon)) {
  console.error(
    'post-export : dist/favicon.svg est absent. Expo copie le dossier public/ dans dist/ ;\n' +
      "  verifier que public/favicon.svg existe et que l'export a bien tourne."
  );
  process.exit(1);
}

if (!/rel="icon"/.test(html)) {
  html = html.replace('</head>', `  <link rel="icon" href="${basePath}/favicon.svg" type="image/svg+xml" />\n  </head>`);
}

fs.writeFileSync(index, html);
fs.writeFileSync(path.join(dist, '404.html'), html);

console.log('post-export : lang="fr", icone declaree, 404.html ecrit (repli des liens profonds).');
