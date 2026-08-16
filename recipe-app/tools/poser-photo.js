/* Pose la photo d'une recette déjà en base, depuis un fichier d'images encodées.
 *
 *   node tools/poser-photo.js <id-de-la-recette> <images>.json
 *   node tools/poser-photo.js <id-de-la-recette> <images>.json --ecrire --code <code>
 *
 * Le fichier est celui de `ajouter-recette-au-livre.js --images` : seule sa clé `plat`
 * est lue ici, `{ "vignette": "data:image/jpeg;base64,…", "grande": "…" }`.
 *
 * ## Pourquoi cet outil existe
 *
 * `ajouter-recette-au-livre.js` crée une recette et refuse d'écraser une fiche
 * existante, ce qui est la bonne règle pour un import. Poser une image sur une recette
 * déjà écrite est une autre opération : elle ne touche pas la fiche, seulement la
 * collection `photos`.
 *
 * ## Ce qu'il protège
 *
 * Deux choses. La recette doit exister, sinon la photo serait rangée sous un
 * identifiant que rien n'affiche. Et **une photo existante n'est jamais remplacée sans
 * le dire** : il faut `--remplacer` pour cela, parce qu'une photo du plat réel vaut
 * mieux qu'une illustration, et qu'on ne perd pas la première par inadvertance.
 */

const fs = require('fs');
const path = require('path');

const racine = path.join(__dirname, '..');
const Sync = require(path.join(racine, 'js/sync.js'));
const { presenterCode } = require(path.join(__dirname, 'maison.js'));

const [, , recetteId, cheminImages, ...options] = process.argv;
const ecrire = options.includes('--ecrire');
const remplacer = options.includes('--remplacer');

const BUDGET_VIGNETTE = 60000;
const BUDGET_GRANDE = 600000;

function sortir(message) {
  console.error(message);
  process.exit(1);
}

if (!recetteId || !cheminImages) {
  sortir('Usage : node tools/poser-photo.js <id-de-la-recette> <images>.json [--ecrire] [--remplacer]');
}

(async () => {
  const brut = fs.readFileSync(
    path.isAbsolute(cheminImages) ? cheminImages : path.join(process.cwd(), cheminImages),
    'utf8'
  );
  const plat = (JSON.parse(brut) || {}).plat;
  const estImage = (v) => typeof v === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(v);
  if (!plat || !estImage(plat.vignette) || !estImage(plat.grande)) {
    sortir('Le fichier ne porte pas de clé « plat » avec une vignette et une grande image.');
  }
  if (plat.vignette.length > BUDGET_VIGNETTE) {
    sortir(`Vignette de ${plat.vignette.length} caractères, plafond ${BUDGET_VIGNETTE}.`);
  }
  if (plat.grande.length > BUDGET_GRANDE) {
    sortir(`Grande image de ${plat.grande.length} caractères, plafond ${BUDGET_GRANDE}.`);
  }

  const base = JSON.parse(fs.readFileSync(path.join(racine, 'data/recipes.json'), 'utf8'));
  const distantes = await Sync.lireRecettesModifiees();
  const recette = distantes[recetteId] || base.find((r) => r.id === recetteId);
  if (!recette) sortir(`Aucune recette « ${recetteId} », ni dans data/recipes.json ni dans Firestore.`);

  const vignettes = await Sync.lireVignettes();
  const dejaLa = Boolean(vignettes[recetteId]);

  console.log(`\nRecette   : ${recette.titre} (${recetteId})`);
  console.log(`Image     : vignette ${plat.vignette.length} caractères, grande ${plat.grande.length}`);
  console.log(`Photo existante : ${dejaLa ? 'oui, ' + vignettes[recetteId].length + ' caractères' : 'non'}`);

  if (dejaLa && !remplacer) {
    sortir('Cette recette a déjà une photo. Relancer avec --remplacer pour l’écraser.');
  }
  if (!ecrire) {
    console.log('\nRien n’a été écrit. Relancer avec --ecrire pour envoyer la photo.\n');
    return;
  }

  // Le serveur n'accepte l'écriture que d'un appareil de la maison : voir
  // tools/maison.js. Sans --code, l'écriture ci-dessous sera refusée.
  await presenterCode(options, sortir);

  await Sync.ecrirePhoto(recetteId, plat.vignette, plat.grande);

  // Relu depuis le serveur : une promesse tenue ne prouve pas l'envoi.
  const apres = await Sync.lireVignettes();
  if (!apres[recetteId]) sortir('La vignette n’a pas été relue côté serveur après l’écriture.');
  const grande = await Sync.lireGrandePhoto(recetteId);
  if (!grande) sortir('La grande version n’a pas été relue côté serveur.');

  console.log(`\nÉcrite et relue depuis le serveur (vignette ${apres[recetteId].length}, grande ${grande.length})`);
  console.log(`Fiche : #/recette/${recetteId}\n`);
})().catch((erreur) => {
  sortir(`Échec : ${erreur.statut ? erreur.statut + ' ' : ''}${erreur.message}`);
});
