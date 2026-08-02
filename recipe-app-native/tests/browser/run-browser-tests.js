// Enchaine les deux tests navigateur : npm run test:web
//
// 1. La v1 web statique, servie telle quelle.
// 2. L'export web de la v2, servi sous le sous-chemin de deploiement
//    (/Cahier-de-recette) par un serveur qui imite GitHub Pages, repli 404.html
//    compris. C'est le seul montage qui verifie vraiment le reglage baseUrl et le
//    comportement des liens profonds.
//
// Prerequis : un export a jour (npm run export:web) et Playwright disponible
// (voir l'en-tete des fichiers de test pour PLAYWRIGHT_MODULE / CHROMIUM_PATH).

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

const ici = __dirname;
const projet = path.join(ici, '..', '..');
const racineDepot = path.join(projet, '..');
const dist = path.join(projet, 'dist');
const v1 = path.join(racineDepot, 'recipe-app');

const PORT_V1 = Number(process.env.PORT_V1 || 8102);
const PORT_V2 = Number(process.env.PORT_V2 || 8100);
const { basePath } = require('../../src/config/base-path.json');

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error("dist/ est absent ou incomplet. Lancer d'abord : npm run export:web");
  process.exit(1);
}

// L'export doit etre servi sous le sous-chemin : on le recopie dans une racine
// temporaire, sous un dossier portant le nom du sous-chemin.
const racineTemporaire = fs.mkdtempSync(path.join(os.tmpdir(), 'carnet-pages-'));
const cible = path.join(racineTemporaire, basePath.replace(/^\//, '') || 'site');
fs.cpSync(dist, cible, { recursive: true });

const serveurs = [];
function lancer(commande, args, options) {
  const enfant = spawn(commande, args, { stdio: 'ignore', ...options });
  serveurs.push(enfant);
  return enfant;
}

function attendre(url, essais = 40) {
  return new Promise((resoudre, rejeter) => {
    const essai = (restants) => {
      http
        .get(url, (reponse) => {
          reponse.resume();
          resoudre();
        })
        .on('error', () => {
          if (restants <= 0) rejeter(new Error(`${url} ne repond pas`));
          else setTimeout(() => essai(restants - 1), 250);
        });
    };
    essai(essais);
  });
}

function arreter() {
  serveurs.forEach((s) => {
    try {
      s.kill();
    } catch (erreur) {
      /* deja termine */
    }
  });
  fs.rmSync(racineTemporaire, { recursive: true, force: true });
}

process.on('exit', arreter);
process.on('SIGINT', () => {
  arreter();
  process.exit(130);
});

(async () => {
  // Serveur de la v1 : Node plutot que python3, pour ne dependre que de Node.
  lancer(process.execPath, [path.join(ici, 'serveur-pages.js'), v1, String(PORT_V1), '/']);
  lancer(process.execPath, [path.join(ici, 'serveur-pages.js'), racineTemporaire, String(PORT_V2), basePath]);

  await attendre(`http://127.0.0.1:${PORT_V1}/`);
  await attendre(`http://127.0.0.1:${PORT_V2}${basePath}/`);

  const etapes = [
    ['v1 web statique', 'test-v1-web.js', `http://127.0.0.1:${PORT_V1}/`],
    ['v2 export web (sous-chemin)', 'test-export-web.js', `http://127.0.0.1:${PORT_V2}${basePath}/`],
  ];

  let echecs = 0;
  for (const [nom, fichier, url] of etapes) {
    console.log(`\n=== ${nom} : ${url} ===`);
    const resultat = spawnSync(process.execPath, [path.join(ici, fichier), url], { stdio: 'inherit' });
    if (resultat.status !== 0) echecs += 1;
  }

  arreter();
  if (echecs > 0) {
    console.error(`\n${echecs} suite(s) navigateur en echec.`);
    process.exit(1);
  }
  console.log('\nLes deux suites navigateur passent.');
})().catch((erreur) => {
  console.error('run-browser-tests :', erreur.message);
  arreter();
  process.exit(2);
});
