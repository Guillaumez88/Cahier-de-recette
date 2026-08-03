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
const PORT = Number(process.env.PORT || 8104);
const URL_BASE = `http://127.0.0.1:${PORT}/`;

// serveur-test.js sert le site ET l'emulation de Firestore sur le meme port : la
// page testee est celle du depot, seules les URL de service sont redirigees.
const serveur = spawn(process.execPath, [path.join(ici, 'serveur-test.js'), String(PORT)], {
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

  const suites = [
    ['Parcours general', 'test-web.js'],
    ['Liste commune, partage et hors ligne', 'test-partage.js'],
    ['Modification des recettes et nombre de parts', 'test-edition.js'],
    ['Semainier, photos et création de recettes', 'test-semainier.js'],
  ];

  let echecs = 0;
  for (const [nom, fichier] of suites) {
    console.log(`\n=== ${nom} : ${URL_BASE} ===`);
    const resultat = spawnSync(process.execPath, [path.join(ici, fichier), URL_BASE], { stdio: 'inherit' });
    if (resultat.status !== 0) echecs += 1;
  }

  arreter();
  if (echecs > 0) {
    console.error(`\n${echecs} suite(s) navigateur en echec.`);
    process.exit(1);
  }
  console.log('\nToutes les suites navigateur passent.');
})().catch((erreur) => {
  console.error('run-browser-tests :', erreur.message);
  arreter();
  process.exit(2);
});
