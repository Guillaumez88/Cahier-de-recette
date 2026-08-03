/* Serveur des tests navigateur : sert le site ET l'emulation de Firestore sur le
   meme port, ce qui evite toute question de CORS.
   Le fichier de configuration est reecrit a la volee pour pointer sur l'emulation :
   la page chargee est donc bien celle du depot, seules les URL de service changent.

   Usage : node tests/serveur-test.js [port] */

const http = require('http');
const fs = require('fs');
const path = require('path');

const stub = require('./stub-firestore.js');

const racine = path.join(__dirname, '..');
const port = Number(process.argv[2] || 8104);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// Injecte dans la page la configuration pointant vers l'emulation, avant tout script.
const SURCHARGE = `<script>
  window.CARNET_CONFIG_OVERRIDE = {
    baseFirestore: '/__firestore/v1',
    baseAuth: '/__auth/v1',
    baseSecureToken: '/__auth/v1',
    projectId: 'projet-de-test',
    // Le seuil de vieillissement est rapproche pour que les tests puissent verifier
    // le signalement sans attendre deux minutes.
    seuilDonneesAgees: 3000,
    // Idem pour la cadence du libelle d'age, qui n'entraine aucune lecture reseau.
    intervalleAge: 1000
  };
</script>`;

const serveur = http.createServer(async (requete, reponse) => {
  if (await stub.traiter(requete, reponse)) return;

  const demande = decodeURIComponent(requete.url.split('?')[0]);
  let fichier = path.join(racine, demande);
  if (demande.endsWith('/')) fichier = path.join(fichier, 'index.html');

  if (!path.resolve(fichier).startsWith(racine)) {
    reponse.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    reponse.end('interdit');
    return;
  }

  if (!fs.existsSync(fichier) || !fs.statSync(fichier).isFile()) {
    reponse.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    reponse.end('introuvable');
    return;
  }

  // La surcharge doit precede tous les scripts de la page.
  if (path.extname(fichier) === '.html') {
    const html = fs.readFileSync(fichier, 'utf8').replace('</head>', `${SURCHARGE}\n  </head>`);
    reponse.writeHead(200, { 'Content-Type': types['.html'], 'Cache-Control': 'no-store' });
    reponse.end(html);
    return;
  }

  reponse.writeHead(200, {
    'Content-Type': types[path.extname(fichier)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(fichier).pipe(reponse);
});

serveur.listen(port, '127.0.0.1', () => {
  console.log(`Carnet + emulation Firestore sur http://127.0.0.1:${port}/`);
});
