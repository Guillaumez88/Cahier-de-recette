# Import HelloFresh du 13 août 2026 : 18 fiches

Deux PDF couleur non OCR, une fiche par paire de pages (couverture, puis étapes) :
20 pages pour 10 fiches, 16 pages pour 8 fiches. Conventions de transcription : voir
`docs/DECISIONS-HELLOFRESH-2026-08-12.md`, section 7, appliquées telles quelles.

Le livre « Hello Fresh » compte désormais **23 recettes** : les 5 du 12 août et ces 18.
Vérifié en relisant Firestore : aucune sans photo de plat, aucune sans tableau
nutritionnel, aucune étape sans intitulé.

## Ce qui a été écrit

| Recette | Parts | Étapes | Semaine annoncée |
|---|---|---|---|
| Lieu pané au pesto, pecorino & purée | 2 | 6 | 06 \| 2026 |
| Gratin de butternut & parmesan AOP | 2 | 6 | 06 \| 2026 |
| Rigatoni bacon, crème de bleu & ciboulette | 2 | 4 | 07 \| 2026 |
| Pavé de saumon à la toscane & tagliatelle | 2 | 6 | 07 \| 2026 |
| Farfalle tricolore poulet Label Rouge & poireau | 2 | 4 | 07 \| 2026 |
| Tartines champis & crème aux herbes | 2 | 6 | 07 \| 2026 |
| Poulet doré au curry & à la mangue | 2 | 6 | 08 \| 2026 |
| Canard sauce échalote & carottes Vichy | 2 | 6 | 08 \| 2026 |
| Porc grillé au thym, jus de viande & brocoli | 2 | 6 | 08 \| 2026 |
| Tartine camembert fondant qui file au panier | 2 | 6 | non lisible |
| Les fameuses pâtes carbo à la française | 2 | 4 | non lisible |
| Poulet pané à la provençale & sauce ravigote | 2 | 6 | non lisible |
| Wok peps de nouilles, poulet & cajous | 2 | 4 | non lisible |
| Lieu printanier en croûte de noisettes & thym | 3 | 6 | non lisible |
| Hachis au bœuf & purée de lentilles corail | 3 | 6 | non lisible |
| Dinde grillée, pak choï & cacahuètes | 2 | 4 | 26 \| 2026 |
| Lieu doré, purée & tomates cerises confites | 2 | 6 | 26 \| 2026 |
| Tomates farcies au quinoa, pecorino AOP & chorizo | 2 | 6 | 26 \| 2026 |

Chaque recette porte sa photo de plat, extraite de la page de couverture, écrite puis
relue depuis le serveur.

## Les illustrations d'étapes

Écrites, après publication des règles Firestore de la collection `illustrations` le
13 août. **124 illustrations pour 23 recettes**, une par étape, posées avec
`tools/poser-illustrations.js` puis relues depuis le serveur : aucun écart entre les
rangs présents et le nombre d'étapes de chaque recette.

Répartition : 26 pour les 5 fiches du 12 août, 98 pour les 18 de ce lot.

Les fichiers d'images (data URLs déjà redimensionnées) ont été envoyés en archive : ils
ne vivent que dans le répertoire de travail de la session, qui ne survit pas à celle-ci.
Pour les régénérer, les deux PDF suffisent (`reperer.py`, puis `exporter2.py`).

## Ce que la source ne dit pas, et qui n'a pas été deviné

Consigné fiche par fiche dans le champ `manquants`, donc visible sur chaque fiche sous
« Ce que la source ne donne pas ». Récurrent sur les 18 :

- aucun temps détaillé, seulement « À table dans : X - Y Min » ;
- ni difficulté, ni origine, même quand le titre évoque un pays (« La Viking »,
  « façon teriyaki », « Direction la Normandie ») ;
- les allergènes, que la fiche renvoie aux étiquettes sans en donner la liste ;
- le numéro de semaine, illisible en bas de page sur 6 fiches du second PDF.

Ponctuel :

- **Canard sauce échalote** : l'étape 4 dit « 6 min côté peau, puis 5-6 min sur chaque
  face », sans préciser si le côté peau compte parmi ces faces.
- **Lieu printanier** : la fin de l'astuce Air Fryer est coupée en bas de page.
- **Gratin de butternut** : l'astuce sur la sucrine est imprimée sous l'étape 5 alors
  qu'elle concerne la salade de l'étape 6 ; elle a été laissée où la fiche la place.

## Repérage des découpes

Le repérage des photos est celui du 12 août (`detecter2.py`, `grille.py`, `affiner.py`),
avec un ajout : sur deux couvertures du second PDF, la photo du plat n'est pas détectée,
l'assiette étant blanche sur fond clair. Le cadre médian des fiches voisines est alors
repris, la mise en page étant régulière, et le résultat a été vérifié à l'œil sur la
planche de contrôle. C'est une déduction de gabarit, pas une photo devinée.
