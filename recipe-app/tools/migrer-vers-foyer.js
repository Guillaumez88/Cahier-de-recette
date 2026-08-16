/* Déplacer les données globales dans le foyer d'un compte.
 *
 *   node tools/migrer-vers-foyer.js --compte <adresse> --mot-de-passe <mdp> [--creer-compte]
 *   node tools/migrer-vers-foyer.js --compte … --mot-de-passe … --ecrire
 *
 * Sans `--ecrire`, l'outil compte et n'écrit rien : c'est le mode par défaut, et c'est
 * lui qu'on lance en premier.
 *
 * ## Ce qu'il fait
 *
 * Les sept collections de contenu vivaient à la racine de la base : `listes/commune/
 * articles`, `recettes`, `semainiers/commune/creneaux`, `placard`, `livres`,
 * `illustrations`, `photos`. Depuis les foyers, elles vivent sous
 * `foyers/<identifiant du compte>/…`. Cet outil copie, document par document, de
 * l'ancien vers le nouveau.
 *
 * ## Ce qu'il ne fait pas
 *
 * **Il ne supprime rien.** L'ancien reste en place, en lecture seule d'après les
 * règles. Vérifier d'abord, supprimer ensuite, à la main et en connaissance de cause :
 * une copie ratée qu'on ne peut plus comparer à sa source n'est pas réparable.
 *
 * **Il ne déclare pas un succès qu'il n'a pas vérifié.** Après la copie, chaque
 * collection est relue du côté du foyer et comptée. Un écart, même d'un document,
 * arrête l'outil avec le détail : combien de part et d'autre, et lesquels manquent.
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
const ECRIRE = options.includes('--ecrire');
const CREER_COMPTE = options.includes('--creer-compte');

if (!EMAIL || !MOT_DE_PASSE) {
  sortir('Usage : node tools/migrer-vers-foyer.js --compte <adresse> --mot-de-passe <mdp> [--creer-compte] [--ecrire]');
}

const RACINE = `projects/${config.projectId}/databases/(default)/documents`;

// Les sept collections, avec leur ancien chemin global et leur nom sous le foyer.
const COLLECTIONS = [
  { nom: 'articles', source: `listes/${config.listeId}/articles` },
  { nom: 'recettes', source: 'recettes' },
  { nom: 'creneaux', source: `semainiers/${config.semainierId}/creneaux` },
  { nom: 'placard', source: 'placard' },
  { nom: 'livres', source: 'livres' },
  { nom: 'illustrations', source: 'illustrations' },
  { nom: 'photos', source: 'photos' },
];

/** Lit une collection entière, page par page. Rend [{ id, fields }]. */
async function lireTout(chemin) {
  const documents = [];
  let page = null;
  do {
    const url = `${chemin}?pageSize=300${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`;
    const corps = await Sync.requete(url, { method: 'GET' });
    ((corps && corps.documents) || []).forEach((document_) => {
      documents.push({ id: String(document_.name).split('/').pop(), fields: document_.fields || {} });
    });
    page = corps && corps.nextPageToken;
  } while (page);
  return documents;
}

async function ecrireDocument(chemin, id, fields) {
  return Sync.requete(`${chemin}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
}

/** Connecte le compte, en le créant s'il n'existe pas et si on l'a demandé. */
async function ouvrirLeCompte() {
  try {
    return await Sync.connecter(EMAIL, MOT_DE_PASSE);
  } catch (erreur) {
    const code = String(erreur.message || '');
    const inconnu = /EMAIL_NOT_FOUND|INVALID_LOGIN_CREDENTIALS/.test(code);
    if (!inconnu || !CREER_COMPTE) {
      sortir(
        `Connexion refusée pour ${EMAIL} : ${erreur.message}` +
          (inconnu ? '\nAjouter --creer-compte pour créer ce compte avec ce mot de passe.' : '')
      );
    }
  }
  console.log(`Le compte ${EMAIL} n’existe pas : création.`);
  return Sync.creerCompte(EMAIL, MOT_DE_PASSE);
}

/** Retrouve le foyer du compte, ou le crée. Rend son identifiant. */
async function assurerLeFoyer(uid) {
  const fiche = await Sync.lireUtilisateur(uid);
  if (fiche && fiche.foyer) {
    Sync.definirFoyer(fiche.foyer);
    console.log(`Foyer existant : ${fiche.foyer}`);
    return fiche.foyer;
  }
  if (!ECRIRE) {
    console.log('Aucun foyer pour ce compte : il serait créé (relancer avec --ecrire).');
    return null;
  }
  const foyerId = await Sync.creerFoyer('Ma cuisine');
  console.log(`Foyer créé : ${foyerId}`);
  return foyerId;
}

(async () => {
  const compte = await ouvrirLeCompte();
  const uid = (compte && compte.uid) || (Sync.compteCourant() || {}).uid;
  if (!uid) sortir('Session ouverte sans identifiant : rien ne peut être écrit.');
  console.log(`Compte ${EMAIL} : ${uid}`);

  const foyerId = await assurerLeFoyer(uid);
  if (!foyerId && ECRIRE) sortir('Foyer introuvable et non créé : arrêt.');

  const bilan = [];
  let ecarts = 0;

  for (const collection of COLLECTIONS) {
    const cheminSource = `${RACINE}/${collection.source}`;
    let source;
    try {
      source = await lireTout(cheminSource);
    } catch (erreur) {
      // Une collection absente n'est pas une erreur : elle n'a peut-être jamais servi.
      if (erreur.statut === 404) source = [];
      else sortir(`Lecture de ${collection.source} impossible : ${erreur.statut || ''} ${erreur.message}`);
    }

    if (!ECRIRE) {
      bilan.push({ collection: collection.nom, source: source.length, copies: 0, foyer: '(non lu)' });
      continue;
    }

    const cheminCible = `${RACINE}/foyers/${encodeURIComponent(foyerId)}/${collection.nom}`;
    let copies = 0;
    for (const document_ of source) {
      try {
        await ecrireDocument(cheminCible, document_.id, document_.fields);
        copies += 1;
      } catch (erreur) {
        sortir(
          `Écriture de ${collection.nom}/${document_.id} refusée : ${erreur.statut || ''} ${erreur.message}\n` +
            `${copies} document(s) de cette collection avaient déjà été copiés. Rien n’a été supprimé.`
        );
      }
    }

    // Le compte qui fait foi n'est pas celui des écritures réussies : c'est ce que le
    // serveur rend quand on relit. Une écriture acceptée puis perdue existe.
    const relu = await lireTout(cheminCible);
    const manquants = source
      .map((d) => d.id)
      .filter((id) => !relu.some((r) => r.id === id));
    if (manquants.length) ecarts += manquants.length;
    bilan.push({
      collection: collection.nom,
      source: source.length,
      copies,
      foyer: relu.length,
      manquants: manquants.slice(0, 5).join(', '),
    });
  }

  console.log('');
  console.log('collection      source  copiés  dans le foyer  manquants');
  bilan.forEach((ligne) => {
    console.log(
      `${ligne.collection.padEnd(15)} ${String(ligne.source).padStart(5)} ${String(ligne.copies).padStart(7)} ` +
        `${String(ligne.foyer).padStart(14)}  ${ligne.manquants || ''}`
    );
  });
  console.log('');

  if (!ECRIRE) {
    console.log('Rien n’a été écrit. Relancer avec --ecrire pour copier.');
    return;
  }
  if (ecarts) {
    sortir(`${ecarts} document(s) manquent côté foyer : la copie n’est pas complète. Rien n’a été supprimé.`);
  }
  console.log('Copie vérifiée : chaque document de la source a été relu dans le foyer.');
  console.log('Les anciennes collections sont intactes. Les supprimer à la main, plus tard.');
})().catch((erreur) => {
  sortir(`Échec : ${erreur.statut ? erreur.statut + ' ' : ''}${erreur.message}`);
});
