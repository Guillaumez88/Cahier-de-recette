// Verifie que les deux versions partagent exactement le meme jeu de recettes.
//
// recipe-app/data/recipes.json (v1 web) et recipe-app-native/src/data/recipes.json
// (v2 Expo) sont deux copies du meme fichier. Rien dans le code ne les lie : une
// recette ajoutee d'un seul cote passerait inapercue. Ce controle est la pour que
// l'ecart soit constate au lieu d'etre decouvert plus tard.
//
// Usage : node tests/check-sync.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const racine = path.join(__dirname, '..', '..');
const fichiers = {
  'v2 Expo': path.join(racine, 'recipe-app-native/src/data/recipes.json'),
  'v1 web': path.join(racine, 'recipe-app/data/recipes.json'),
};

const empreintes = {};
const problemes = [];

Object.entries(fichiers).forEach(([nom, fichier]) => {
  if (!fs.existsSync(fichier)) {
    problemes.push(`${nom} : fichier absent (${fichier})`);
    return;
  }
  const brut = fs.readFileSync(fichier, 'utf8');
  let donnees;
  try {
    donnees = JSON.parse(brut);
  } catch (erreur) {
    problemes.push(`${nom} : JSON invalide (${erreur.message})`);
    return;
  }
  empreintes[nom] = {
    // Empreinte sur le JSON re-serialise : une difference de mise en forme seule
    // ne doit pas etre signalee comme un ecart de contenu.
    somme: crypto.createHash('sha256').update(JSON.stringify(donnees)).digest('hex'),
    nb: donnees.length,
    ids: donnees.map((r) => r.id),
  };
});

const noms = Object.keys(empreintes);
if (noms.length === 2) {
  const [a, b] = noms;
  if (empreintes[a].somme !== empreintes[b].somme) {
    problemes.push(
      `les deux jeux de recettes diffèrent : ${a} = ${empreintes[a].nb} recettes, ${b} = ${empreintes[b].nb}`
    );
    const seulementA = empreintes[a].ids.filter((id) => !empreintes[b].ids.includes(id));
    const seulementB = empreintes[b].ids.filter((id) => !empreintes[a].ids.includes(id));
    if (seulementA.length) problemes.push(`  présentes uniquement dans ${a} : ${seulementA.join(', ')}`);
    if (seulementB.length) problemes.push(`  présentes uniquement dans ${b} : ${seulementB.join(', ')}`);
    if (!seulementA.length && !seulementB.length) {
      problemes.push('  mêmes identifiants des deux côtés : la différence porte sur le contenu des fiches');
    }
  }
}

if (problemes.length) {
  console.error('\nSynchronisation des recettes : ECHEC\n');
  problemes.forEach((p) => console.error(`  ${p}`));
  console.error(
    '\nCopier le fichier de reference sur l autre :\n' +
      '  cp recipe-app-native/src/data/recipes.json recipe-app/data/recipes.json\n'
  );
  process.exit(1);
}

console.log(
  `Synchronisation des recettes : OK (${empreintes[noms[0]].nb} recettes identiques dans les deux versions)`
);
