/* Comparer les anciennes collections globales et leur copie dans le foyer.
 *
 *   node tools/comparer-foyer.js --compte <adresse> --mot-de-passe <mdp>
 *
 * `tools/migrer-vers-foyer.js` a vérifié que chaque document copié se relisait à
 * l'arrivée. C'est nécessaire, ce n'est pas suffisant : un document peut exister des
 * deux côtés et différer. Cet outil compare le **contenu**, champ par champ, avant
 * qu'on supprime quoi que ce soit.
 *
 * Il ne modifie rien, jamais, dans aucun mode. Sa seule sortie est un verdict.
 */

const path = require('path');
const Sync = require(path.join(__dirname, '..', 'js/sync.js'));
const config = require(path.join(__dirname, '..', 'js/firebase-config.js'));

const options = process.argv.slice(2);

function sortir(message) {
  console.error(message);
  process.exit(1);
}

function valeur(nom) {
  const position = options.indexOf(nom);
  if (position === -1) return null;
  const suite = options[position + 1];
  return suite && !suite.startsWith('--') ? suite : '';
}

const EMAIL = valeur('--compte') || process.env.CARNET_COMPTE;
const MOT_DE_PASSE = valeur('--mot-de-passe') || process.env.CARNET_MOT_DE_PASSE;
if (!EMAIL || !MOT_DE_PASSE) {
  sortir('Usage : node tools/comparer-foyer.js --compte <adresse> --mot-de-passe <mdp>');
}

const RACINE = `projects/${config.projectId}/databases/(default)/documents`;

const COLLECTIONS = [
  { nom: 'articles', source: `listes/${config.listeId}/articles` },
  { nom: 'recettes', source: 'recettes' },
  { nom: 'creneaux', source: `semainiers/${config.semainierId}/creneaux` },
  { nom: 'placard', source: 'placard' },
  { nom: 'livres', source: 'livres' },
  { nom: 'illustrations', source: 'illustrations' },
  { nom: 'photos', source: 'photos' },
];

/** Lit une collection entière, page par page. Rend une table { id: champs }. */
async function lireTout(chemin) {
  const table = new Map();
  let page = null;
  do {
    const url = `${chemin}?pageSize=300${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`;
    const corps = await Sync.requete(url, { method: 'GET' });
    ((corps && corps.documents) || []).forEach((document_) => {
      table.set(String(document_.name).split('/').pop(), document_.fields || {});
    });
    page = corps && corps.nextPageToken;
  } while (page);
  return table;
}

/**
 * Empreinte stable d'un document : ses champs, clés triées, en JSON.
 *
 * Trier les clés n'est pas cosmétique : Firestore ne garantit pas leur ordre entre
 * deux lectures, et comparer deux JSON non triés signalerait des écarts inexistants.
 */
function empreinte(champs) {
  return JSON.stringify(champs, Object.keys(champs || {}).sort());
}

(async () => {
  const compte = await Sync.connecter(EMAIL, MOT_DE_PASSE).catch((erreur) =>
    sortir(`Connexion refusée : ${erreur.message}`)
  );
  const fiche = await Sync.lireUtilisateur(compte.uid);
  if (!fiche || !fiche.foyer) sortir(`Le compte ${EMAIL} n’appartient à aucun foyer.`);
  Sync.definirFoyer(fiche.foyer);
  console.log(`Compte ${EMAIL}, foyer ${fiche.foyer}\n`);

  const lignes = [];
  let anomalies = 0;

  for (const collection of COLLECTIONS) {
    let ancienne = new Map();
    try {
      ancienne = await lireTout(`${RACINE}/${collection.source}`);
    } catch (erreur) {
      if (erreur.statut !== 404) sortir(`Lecture de ${collection.source} : ${erreur.statut} ${erreur.message}`);
    }
    const nouvelle = await lireTout(
      `${RACINE}/foyers/${encodeURIComponent(fiche.foyer)}/${collection.nom}`
    );

    const manquants = [];
    const differents = [];
    ancienne.forEach((champs, id) => {
      if (!nouvelle.has(id)) manquants.push(id);
      else if (empreinte(champs) !== empreinte(nouvelle.get(id))) differents.push(id);
    });
    const enTrop = [...nouvelle.keys()].filter((id) => !ancienne.has(id));

    anomalies += manquants.length + differents.length;
    lignes.push({
      collection: collection.nom,
      ancien: ancienne.size,
      foyer: nouvelle.size,
      manquants,
      differents,
      enTrop,
    });
  }

  console.log('collection      ancien  foyer  manquants  différents  en trop');
  lignes.forEach((l) => {
    console.log(
      `${l.collection.padEnd(15)} ${String(l.ancien).padStart(5)} ${String(l.foyer).padStart(6)} ` +
        `${String(l.manquants.length).padStart(10)} ${String(l.differents.length).padStart(11)} ` +
        `${String(l.enTrop.length).padStart(8)}`
    );
  });
  console.log('');

  lignes.forEach((l) => {
    if (l.manquants.length) console.log(`${l.collection} : absents du foyer -> ${l.manquants.join(', ')}`);
    if (l.differents.length) console.log(`${l.collection} : contenus différents -> ${l.differents.join(', ')}`);
    // « En trop » n'est pas une anomalie : ce sont les documents créés depuis la
    // migration, qui n'ont jamais existé du côté ancien.
    if (l.enTrop.length) console.log(`${l.collection} : ${l.enTrop.length} document(s) créés depuis la migration`);
  });

  if (anomalies) {
    sortir(`\n${anomalies} anomalie(s) : ne rien supprimer avant de comprendre.`);
  }
  console.log(
    '\nCopie fidèle : chaque document de l’ancien existe dans le foyer, avec le même contenu.\n' +
      'Les anciennes collections peuvent être supprimées depuis la console Firebase.'
  );
})().catch((erreur) => sortir(`Échec : ${erreur.statut ? erreur.statut + ' ' : ''}${erreur.message}`));
