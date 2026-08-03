// Petit serveur statique, sans dependance, pour les tests et le developpement local.
//   node tests/serveur.js [dossier] [port]
//
// L'application utilise un routage par ancre (#/recette/<id>) : le serveur n'a donc
// aucun repli a gerer, toutes les URL demandees au serveur sont des fichiers reels.

const http = require('http');
const fs = require('fs');
const path = require('path');

const racine = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const port = Number(process.argv[3] || 8102);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

http
  .createServer((requete, reponse) => {
    const demande = decodeURIComponent(requete.url.split('?')[0]);
    let fichier = path.join(racine, demande);
    if (demande.endsWith('/')) fichier = path.join(fichier, 'index.html');

    // Refuse toute sortie du dossier servi.
    if (!path.resolve(fichier).startsWith(racine)) {
      reponse.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      reponse.end('interdit');
      return;
    }

    if (fs.existsSync(fichier) && fs.statSync(fichier).isFile()) {
      reponse.writeHead(200, { 'Content-Type': types[path.extname(fichier)] || 'application/octet-stream' });
      fs.createReadStream(fichier).pipe(reponse);
      return;
    }

    reponse.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    reponse.end('introuvable');
  })
  .listen(port, '127.0.0.1', () => console.log(`Carnet servi sur http://127.0.0.1:${port}/`));
