// Traitement du tableau de flux (`flowTable`).
//
// `flowTable.rows` est une liste de lignes de cellules { text, rowspan, colspan },
// exactement comme un <table> HTML : une cellule à rowspan 7 occupe sa colonne sur
// 7 lignes, et les lignes suivantes ne la répètent pas. React Native n'ayant pas
// de primitive de tableau, on résout d'abord la grille, puis on la restitue en
// « phases » verticales lisibles sur un téléphone.
//
// Fonctions pures, sans React Native : testables sous Node, et la résolution de
// grille est dupliquée à l'identique dans la v1 web (qui, elle, rend un vrai
// <table> avec les attributs rowspan/colspan d'origine).

/**
 * Résout la grille en un tableau rectangulaire de cellules.
 * Retourne { nbColonnes, grille } où grille[l][c] vaut soit une cellule
 * { texte, rowspan, colspan, origine: true } à sa position d'ancrage, soit
 * { couvertePar: [ligne, colonne] } pour une case absorbée par une fusion,
 * soit null si la source laisse un trou.
 */
export function resolveGrid(flowTable) {
  const lignes = (flowTable && flowTable.rows) || [];
  if (lignes.length === 0) return { nbColonnes: 0, grille: [] };

  const grille = lignes.map(() => []);

  const largeurLibre = (l, c) => grille[l][c] === undefined;

  lignes.forEach((cellules, l) => {
    let c = 0;
    (cellules || []).forEach((cellule) => {
      while (!largeurLibre(l, c)) c += 1; // sauter les cases déjà couvertes

      const rowspan = Math.max(1, Number(cellule.rowspan) || 1);
      const colspan = Math.max(1, Number(cellule.colspan) || 1);

      grille[l][c] = {
        texte: typeof cellule.text === 'string' ? cellule.text : '',
        rowspan,
        colspan,
        origine: true,
        ligne: l,
        colonne: c,
      };

      for (let dl = 0; dl < rowspan; dl += 1) {
        for (let dc = 0; dc < colspan; dc += 1) {
          if (dl === 0 && dc === 0) continue;
          const cible = l + dl;
          if (cible >= grille.length) continue; // rowspan qui dépasse la source
          grille[cible][c + dc] = { couvertePar: [l, c] };
        }
      }

      c += colspan;
    });
  });

  const nbColonnes = grille.reduce((max, ligne) => Math.max(max, ligne.length), 0);

  // Combler les trous éventuels pour obtenir un rectangle plein.
  grille.forEach((ligne) => {
    for (let c = 0; c < nbColonnes; c += 1) {
      if (ligne[c] === undefined) ligne[c] = null;
    }
  });

  return { nbColonnes, grille };
}

// Vocabulaire de remplissage produit par le script d'extraction du lot 2 :
// ces valeurs ne portent aucune information propre à la recette.
const CELLULE_VIDE_DE_SENS = /^(|✓|x|Selon étapes|Si concerné|Non concerné|-|—|Cuisson\s*:.*)$/i;

/**
 * Indique si un tableau de flux apporte une information réelle.
 *
 * Sur les 17 recettes, seule « lasagnes bolognaise » a un tableau construit à la
 * main : les 16 autres ont été générées automatiquement et ne contiennent que des
 * marqueurs (« ✓ », « Selon étapes », « Si concerné ») répétés à l'identique sur
 * chaque ligne. Les afficher ajouterait un pavé de bruit à chaque fiche, donc
 * l'interface ne montre le tableau de flux que quand il est informatif.
 *
 * Critère : présence d'au moins une fusion de cellules, ou d'au moins une cellule
 * hors première colonne qui sorte du vocabulaire de remplissage.
 */
export function isFlowTableInformative(flowTable) {
  const lignes = (flowTable && flowTable.rows) || [];
  if (lignes.length === 0) return false;

  const fusion = lignes.some((ligne) =>
    (ligne || []).some((c) => (Number(c.rowspan) || 1) > 1 || (Number(c.colspan) || 1) > 1)
  );
  if (fusion) return true;

  return lignes.some((ligne) =>
    (ligne || []).slice(1).some((c) => !CELLULE_VIDE_DE_SENS.test(String(c.text || '').trim()))
  );
}

/**
 * Restitue le tableau de flux en une suite de phases verticales.
 *
 * Retourne { preambule, phases, colonnes } où :
 * - `preambule` liste les cellules pleine largeur placées avant tout ingrédient
 *   (« Beurrer un plat à gratin », « Préchauffer le four »),
 * - chaque phase regroupe les ingrédients qui partagent la même suite d'actions,
 *   avec `elements` (première colonne) et `etapes` (les colonnes suivantes,
 *   dédoublonnées dans l'ordre),
 * - `colonnes` reprend les en-têtes quand la source en fournit.
 */
export function buildFlowPhases(flowTable) {
  const { nbColonnes, grille } = resolveGrid(flowTable);
  if (nbColonnes === 0) return { preambule: [], phases: [], colonnes: [] };

  const colonnes = ((flowTable && flowTable.headers) || []).slice();

  const preambule = [];
  const phases = [];
  // Clé de regroupement : les ancres des cellules d'action d'une ligne. Deux
  // ingrédients qui pointent vers les mêmes cellules appartiennent à la phase.
  const indexPhase = new Map();

  grille.forEach((ligne, l) => {
    const premiere = ligne[0];
    if (!premiere) return;

    // Ligne pleine largeur : consigne générale, pas un ingrédient.
    if (premiere.origine && premiere.colspan >= nbColonnes) {
      const texte = premiere.texte.trim();
      if (texte) {
        if (phases.length === 0) preambule.push(texte);
        else phases[phases.length - 1].consignes.push(texte);
      }
      return;
    }

    if (!premiere.origine) return; // première colonne couverte par une fusion

    const element = premiere.texte.trim();

    const ancres = [];
    for (let c = 1; c < nbColonnes; c += 1) {
      const case_ = ligne[c];
      if (!case_) continue;
      const ancre = case_.origine ? [case_.ligne, case_.colonne] : case_.couvertePar;
      if (!ancre) continue;
      const cle = `${ancre[0]}:${ancre[1]}`;
      if (!ancres.some((a) => a.cle === cle)) {
        const cellule = grille[ancre[0]][ancre[1]];
        ancres.push({ cle, colonne: ancre[1], texte: cellule ? cellule.texte.trim() : '' });
      }
    }

    const clePhase = ancres.map((a) => a.cle).join('|') || `solo:${l}`;

    if (!indexPhase.has(clePhase)) {
      const phase = {
        cle: clePhase,
        elements: [],
        etapes: ancres
          .filter((a) => a.texte !== '')
          .map((a) => ({ colonne: a.colonne, libelle: colonnes[a.colonne] || null, texte: a.texte })),
        consignes: [],
      };
      indexPhase.set(clePhase, phase);
      phases.push(phase);
    }

    if (element) indexPhase.get(clePhase).elements.push(element);
  });

  return { preambule, phases, colonnes };
}
