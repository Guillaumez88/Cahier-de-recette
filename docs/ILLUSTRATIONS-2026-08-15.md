# Les illustrations de plats, 15 août 2026

Les 24 recettes qui n'avaient pas de photo en ont désormais une : une illustration
vectorielle, dessinée par `recipe-app/tools/illustrations/`, écrite dans la collection
`photos` comme n'importe quelle photo. Les 47 recettes du carnet ont donc une image.

## Ce qui a été décidé

**Un dessin vectoriel, pas une image générée.** L'environnement de travail n'a pas de
modèle d'image. Le dessin géométrique n'imite pas la photo, mais il donne trois choses
qu'un lot d'images générées ne donne pas : un style rigoureusement identique d'une
recette à l'autre, un poids dérisoire (8 à 11 Ko la vignette, contre 25 à 35 Ko pour une
photo HelloFresh), et la possibilité de tout regénérer d'une commande.

**Le style « trois quarts », choisi sur trois pistes.** Une vue de dessus et un plat à
four ont été écartés : la première se lit mal en vignette carrée, le second ne se
transpose ni aux desserts ni aux salades. Le volume de trois quarts, lui, marche pour
les vingt-quatre.

**Les photos réelles n'ont pas été touchées.** Les 23 fiches HelloFresh gardent la photo
de leur plat : une photo du plat réel vaut mieux qu'un dessin. `tools/poser-photo.js`
refuse d'ailleurs d'écraser une photo existante sans `--remplacer`.

## Comment c'est construit

Cinq primitives couvrent les vingt-quatre recettes, et c'est ce qui fait tenir la série
ensemble : la mise en scène, les ombres et la lumière ne sont jamais réglées recette par
recette.

| Primitive | Ce qu'elle dessine | Recettes |
|---|---|---|
| `part_en_couches` | un bloc dont la tranche montre les couches | lasagnes, tiramisu, cheesecake, brownie, club sandwich, tropézienne… |
| `tranche_de_tarte` | une part triangulaire, pointe vers l'avant | tarte au citron, tarte aux abricots, flan |
| `bol` | un bol de trois quarts et son contenu | tapenade, anchoïade, fondue, poke bowl |
| `pieces_sur_assiette` | plusieurs petites pièces posées | gougères, mini-cakes |
| `gateau_rond` | un cylindre entier | galette des rois, focaccia |

Trois règles tenues partout : aucun filtre SVG (MuPDF, qui rasterise, ne les rend pas,
les ombres sont donc des ellipses translucides empilées), deux tons par volume, et une
palette prise dans les jetons CSS du carnet. Le fond porte une tache ronde teintée selon
la catégorie : pêche pour un plat, sauge pour une entrée, crème pour un dessert.

Les couleurs viennent de ce que la recette contient : la tapenade est noire parce
qu'elle est aux olives noires, le gratin violet et vert parce qu'il est aux aubergines
et aux courgettes.

## Regénérer

```bash
cd recipe-app/tools/illustrations
PYTHONPATH=<où est pymupdf> python3 rendre.py     # svg/, png/, images/<id>.json, planche.png
cd ../..
node tools/poser-photo.js <id-de-la-recette> tools/illustrations/images/<id>.json --ecrire
```

`rendre.py` produit les data URLs aux tailles de `photos.js` (vignette 320 px bornée à
60 000 caractères, grande 1200 px bornée à 600 000) et refuse d'écrire ce qui dépasse.
`planche.png` montre les vingt-quatre d'un coup : c'est le contrôle à faire avant de
poser quoi que ce soit.

## Limites assumées

- C'est du dessin géométrique. Une tarte aux abricots et une tarte aux pêches se
  ressembleraient beaucoup.
- Le flan pâtissier et sa version sans pâte se distinguent par la seule croûte, ce qui
  est ténu mais exact.
- Les pièces d'une même famille (les trois lasagnes, les deux flans) partagent la même
  silhouette : c'est voulu, ce sont les couleurs qui les séparent.
