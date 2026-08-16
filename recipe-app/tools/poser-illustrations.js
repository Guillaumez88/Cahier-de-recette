/* Pose les illustrations d'étapes d'une recette déjà en base.
 *
 *   node tools/poser-illustrations.js <id-de-la-recette> <images>.json
 *   node tools/poser-illustrations.js <id-de-la-recette> <images>.json --ecrire --compte <adresse> --mot-de-passe <mdp>
 *
 * Le fichier d'images est celui de `ajouter-recette-au-livre.js --images` : seule sa
 * clé `etapes` est lue ici, `{ "1": "data:image/jpeg;base64,…", "2": "…" }`.
 *
 * ## Pourquoi un outil séparé
 *
 * Parce que l'import d'une recette et la pose de ses illustrations ne réussissent pas
 * forcément en même temps. La collection `illustrations` est récente : tant que ses
 * règles ne sont pas publiées, Firestore refuse l'écriture, alors que la recette et sa
 * photo passent. L'import le dit et s'arrête là ; cet outil reprend ce qui reste,
 * sans réécrire la recette.
 *
 * Il refuse une recette absente de Firestore : des illustrations rattachées à un
 * identifiant inconnu ne s'afficheraient nulle part et resteraient en base.
 */

const fs = require('fs');
const path = require('path');

const racine = path.join(__dirname, '..');
const Sync = require(path.join(racine, 'js/sync.js'));
const Illustrations = require(path.join(racine, 'js/illustrations.js'));
const { ouvrirSession } = require(path.join(__dirname, 'session.js'));

const [, , recetteId, cheminImages, ...options] = process.argv;
const ecrire = options.includes('--ecrire');

const BUDGET_ILLUSTRATIONS = 600000;

function sortir(message) {
  console.error(message);
  process.exit(1);
}

if (!recetteId || !cheminImages) {
  sortir('Usage : node tools/poser-illustrations.js <id-de-la-recette> <images>.json [--ecrire]');
}

(async () => {
  const images = JSON.parse(
    fs.readFileSync(path.isAbsolute(cheminImages) ? cheminImages : path.join(process.cwd(), cheminImages), 'utf8')
  );
  // `normaliser` est celle de l'application : ce qu'elle écarte ne s'afficherait pas.
  const table = Illustrations.normaliser(images.etapes || {});
  const rangs = Object.keys(table).sort((a, b) => Number(a) - Number(b));
  if (rangs.length === 0) sortir('Aucune illustration lisible dans ce fichier (clé « etapes »).');

  const poids = JSON.stringify(table).length;
  if (poids > BUDGET_ILLUSTRATIONS) {
    sortir(`Illustrations de ${poids} caractères en tout, plafond ${BUDGET_ILLUSTRATIONS}.`);
  }

  const recettes = await Sync.lireRecettesModifiees();
  const recette = recettes[recetteId];
  if (!recette) sortir(`Aucune recette « ${recetteId} » dans Firestore.`);
  if (rangs.length > (recette.instructions || []).length) {
    sortir(
      `${rangs.length} illustrations pour ${(recette.instructions || []).length} étapes : ` +
        'une illustration sans étape ne s’afficherait nulle part.'
    );
  }

  const existantes = await Sync.lireIllustrations(recetteId);
  console.log(`\nRecette      : ${recette.titre} (${recetteId})`);
  console.log(`Étapes       : ${(recette.instructions || []).length}`);
  console.log(`Illustrations : rangs ${rangs.join(', ')} — ${poids} caractères`);
  console.log(`Déjà en base : ${Object.keys(existantes).length} rang(s)`);

  if (!ecrire) {
    console.log('\nRien n’a été écrit. Relancer avec --ecrire pour envoyer les illustrations.\n');
    return;
  }

  await ouvrirSession(options, sortir);
  await Sync.ecrireIllustrations(recetteId, table);

  // Relu depuis le serveur : c'est le seul contrôle qui prouve que les images sont
  // arrivées, et aux bons rangs.
  const relues = await Sync.lireIllustrations(recetteId);
  const obtenus = Object.keys(relues).sort((a, b) => Number(a) - Number(b)).join(', ');
  if (obtenus !== rangs.join(', ')) {
    sortir(`Relu les rangs ${obtenus || '(aucun)'} au lieu de ${rangs.join(', ')}.`);
  }
  console.log(`\nÉcrites et relues depuis le serveur : ${rangs.length} illustration(s)`);
  console.log(`Fiche : #/recette/${recetteId}\n`);
})().catch((erreur) => {
  sortir(`Échec : ${erreur.statut ? erreur.statut + ' ' : ''}${erreur.message}`);
});
