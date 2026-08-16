/* Présenter le code de la maison, pour un outil qui écrit.
 *
 * Depuis le partage en lecture seule (voir docs/PARTAGE-LECTURE-SEULE-2026-08-16.md),
 * Firestore n'accepte l'écriture que des appareils inscrits dans la collection
 * `appareils`. Un outil en ligne de commande est un appareil comme un autre.
 *
 * Avec une différence qui compte : **il ne garde rien entre deux exécutions**. Le
 * navigateur range son jeton anonyme dans le stockage local et conserve donc son
 * identité ; Node n'a pas de stockage local, chaque exécution ouvre une session
 * anonyme neuve, avec un identifiant neuf. S'inscrire une fois pour toutes n'a donc
 * aucun sens ici : l'inscription se refait à chaque exécution, ce qui coûte une
 * écriture et laisse un document par exécution dans `appareils`.
 *
 * D'où l'usage : passer `--code <code>` aux outils qui écrivent. Sans lui, ils
 * fonctionnent toujours en lecture (les modes sans `--ecrire`), et l'écriture est
 * refusée par le serveur avec un message clair.
 *
 * Les documents laissés dans `appareils` par les outils se suppriment depuis la
 * console Firebase quand ils encombrent : ils ne donnent aucun droit à personne
 * d'autre, l'identifiant anonyme correspondant étant perdu à la fin du processus.
 */

const path = require('path');
const Sync = require(path.join(__dirname, '..', 'js/sync.js'));

/**
 * Inscrit le processus courant comme appareil de la maison si `--code` est fourni.
 *
 * Rend { inscrit, raison }. N'échoue jamais silencieusement : un code refusé arrête
 * l'outil, parce que l'écriture qui suit échouerait de toute façon, plus loin et de
 * façon moins lisible.
 */
async function presenterCode(options, sortir) {
  const position = options.indexOf('--code');
  if (position === -1) return { inscrit: false, raison: 'aucun code présenté' };

  const code = options[position + 1];
  if (!code || code.startsWith('--')) {
    sortir('--code attend le code de la maison.');
  }

  try {
    await Sync.inscrireAppareil(code);
  } catch (erreur) {
    if (erreur.statut === 403) {
      sortir('Code de la maison refusé : rien n’a été écrit.');
    }
    sortir(`Inscription impossible : ${erreur.statut ? erreur.statut + ' ' : ''}${erreur.message}`);
  }
  return { inscrit: true, raison: 'inscrit pour cette exécution' };
}

module.exports = { presenterCode };
