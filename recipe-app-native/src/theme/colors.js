// Palette « carnet de cuisine chaleureux ».
// Source de vérité partagée avec la v1 web : toute modification ici doit être
// reportée dans recipe-app/css/style.css (bloc :root), et réciproquement.

export const colors = {
  fond: '#FBF3E6',
  surface: '#FFFDF8',
  surfaceCreuse: '#F4E8D5',

  terracotta: '#C2542D',
  terracottaSombre: '#9C3F1E',
  terracottaClair: '#F0D6C8',

  texte: '#3A2E28',
  texteDoux: '#7A6A5F',
  texteFaible: '#9E9086',

  bordure: '#E5D5BE',
  bordureForte: '#D3BC9C',

  olive: '#5F7A54',
  ocre: '#C98B2E',

  blanc: '#FFFFFF',
};

// Une teinte par catégorie, reprise à l'identique dans la v1 web.
export const couleursCategorie = {
  Entrée: colors.olive,
  Plat: colors.terracotta,
  Dessert: colors.ocre,
};

export function couleurCategorie(categorie) {
  return couleursCategorie[categorie] || colors.texteDoux;
}

export const espacements = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const rayons = { sm: 6, md: 10, lg: 16, pilule: 999 };
