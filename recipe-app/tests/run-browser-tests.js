// Lance le serveur statique puis le test navigateur :
//   node tests/run-browser-tests.js
//
// Playwright n'est pas une dependance du projet. Pour l'installer :
//   npm i -D playwright && npx playwright install chromium
// Pour designer une installation existante :
//   PLAYWRIGHT_MODULE=/chemin/node_modules/playwright CHROMIUM_PATH=/chemin/chromium \
//     node tests/run-browser-tests.js

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const http = require('http');

const ici = __dirname;
const projet = path.join(ici, '..');
const PORT = Number(process.env.PORT || 8102);
const URL_BASE = `http://127.0.0.1:${PORT}/`;

const serveur = spawn(process.execPath, [path.join(ici, 'serveur.js'), projet, String(PORT)], {
  stdio: 'ignore',
});

function arreter() {
  try {
    serveur.kill();
  } catch (erreur) {
    /* deja termine */
  }
}
process.on('exit', arreter);
process.on('SIGINT', () => {
  arreter();
  process.exit(130);
});

function attendre(url, restants = 40) {
  return new Promise((resoudre, rejeter) => {
    http
      .get(url, (reponse) => {
        reponse.resume();
        resoudre();
      })
      .on('error', () => {
        if (restants <= 0) rejeter(new Error(`${url} ne repond pas`));
        else setTimeout(() => attendre(url, restants - 1).then(resoudre, rejeter), 250);
      });
  });
}

(async () => {
  await attendre(URL_BASE);
  console.log(`\n=== Test navigateur : ${URL_BASE} ===`);
  const resultat = spawnSync(process.execPath, [path.join(ici, 'test-web.js'), URL_BASE], { stdio: 'inherit' });
  arreter();
  process.exit(resultat.status === 0 ? 0 : 1);
})().catch((erreur) => {
  console.error('run-browser-tests :', erreur.message);
  arreter();
  process.exit(2);
});
