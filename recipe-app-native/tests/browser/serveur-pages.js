// Serveur statique qui imite GitHub Pages : sert les fichiers du dossier racine,
// et pour un chemin introuvable renvoie le contenu de 404.html avec un statut 404
// (comportement documenté de Pages, sur lequel repose le routage monopage).
const http = require('http');
const fs = require('fs');
const path = require('path');

const racine = process.argv[2];
const port = Number(process.argv[3] || 8099);
const sousChemin = process.argv[4] || '/Cahier-de-recette';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

http
  .createServer((req, res) => {
    const chemin = decodeURIComponent(req.url.split('?')[0]);
    let fichier = path.join(racine, chemin);
    if (chemin.endsWith('/')) fichier = path.join(fichier, 'index.html');

    if (fs.existsSync(fichier) && fs.statSync(fichier).isFile()) {
      res.writeHead(200, { 'Content-Type': types[path.extname(fichier)] || 'application/octet-stream' });
      fs.createReadStream(fichier).pipe(res);
      return;
    }

    // Repli 404.html du sous-chemin, comme le fait GitHub Pages pour un projet.
    const repli = path.join(racine, sousChemin, '404.html');
    if (fs.existsSync(repli)) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(repli).pipe(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('introuvable');
  })
  .listen(port, '127.0.0.1', () => console.log(`serveur-pages sur http://127.0.0.1:${port}${sousChemin}/`));
