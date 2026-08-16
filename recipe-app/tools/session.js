/* Ouvrir la session d'un outil en ligne de commande, et désigner son foyer.
 *
 * Depuis les foyers (voir docs/FOYERS-2026-08-16.md), Firestore n'accepte l'écriture
 * que d'un compte inscrit comme membre du foyer, en modification. Un outil est un
 * compte comme un autre : il se connecte avec une adresse et un mot de passe.
 *
 * Usage, sur les outils qui écrivent :
 *
 *   --compte <adresse> --mot-de-passe <mot de passe>
 *
 * ou, pour ne pas laisser le mot de passe dans l'historique du terminal, les variables
 * d'environnement CARNET_COMPTE et CARNET_MOT_DE_PASSE. Sans session, les outils
 * fonctionnent toujours en lecture des fichiers locaux (les modes sans `--ecrire`),
 * mais toute lecture ou écriture Firestore est refusée : sans foyer, `sync.js` ne
 * fabrique même pas de chemin.
 */

const path = require('path');
const Sync = require(path.join(__dirname, '..', 'js/sync.js'));

function valeur(options, nom) {
  const position = options.indexOf(nom);
  if (position === -1) return null;
  const suite = options[position + 1];
  return suite && !suite.startsWith('--') ? suite : '';
}

/**
 * Connecte l'outil et pose son foyer. Rend { ouverte, email, foyer, raison }.
 *
 * N'échoue jamais silencieusement : une connexion refusée, ou un compte sans foyer,
 * arrête l'outil. L'écriture qui suit échouerait de toute façon, plus loin et de façon
 * moins lisible.
 */
async function ouvrirSession(options, sortir) {
  const email = valeur(options, '--compte') || process.env.CARNET_COMPTE || null;
  const motDePasse = valeur(options, '--mot-de-passe') || process.env.CARNET_MOT_DE_PASSE || null;

  if (!email) return { ouverte: false, raison: 'aucun compte présenté' };
  if (!motDePasse) {
    sortir('--compte demande --mot-de-passe (ou la variable CARNET_MOT_DE_PASSE).');
  }

  let compte;
  try {
    compte = await Sync.connecter(email, motDePasse);
  } catch (erreur) {
    sortir(`Connexion refusée : ${erreur.message}`);
  }

  const uid = (compte && compte.uid) || (Sync.compteCourant() || {}).uid;
  const fiche = await Sync.lireUtilisateur(uid);
  if (!fiche || !fiche.foyer) {
    sortir(`Le compte ${email} n’appartient à aucun foyer : rien à lire, rien à écrire.`);
  }

  Sync.definirFoyer(fiche.foyer);

  const membre = await Sync.lireMembre(fiche.foyer, uid);
  if (!membre || membre.role !== 'modification') {
    sortir(`Le compte ${email} est membre du foyer en lecture seule : l’écriture serait refusée.`);
  }

  return { ouverte: true, email, foyer: fiche.foyer, raison: 'session ouverte pour cette exécution' };
}

module.exports = { ouvrirSession };
