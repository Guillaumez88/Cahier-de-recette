# Décisions de l'import HelloFresh, 12 août 2026

Ce qui a été tranché en ajoutant les valeurs nutritionnelles, les photos d'étapes, et
les cinq fiches HelloFresh de la semaine 06 | 2026 au livre « Hello Fresh ».

---

## 1. Les valeurs nutritionnelles ne suivent jamais le nombre de parts

**Décidé.** Le champ `nutrition` porte ses colonnes (« Par portion », « Pour 100 g »),
ses lignes et une phrase de base. La fiche affiche le tableau tel quel, et le dit :
« Valeurs de la source, reprises telles quelles. Elles ne suivent pas le nombre de
parts : une portion reste une portion. »

**Pourquoi.** Changer le nombre de parts multiplie les quantités d'ingrédients, ce qui
est juste. Multiplier une valeur « par portion » serait faux, et multiplier une valeur
« pour 100 g » n'aurait aucun sens. Le calcul est donc refusé, et l'absence de calcul
est écrite à l'écran plutôt que laissée à deviner.

**Conséquence.** `L.lignesNutrition()` est tolérante : une colonne vide n'est pas une
colonne, une ligne sans nom est ignorée, une valeur absente donne une case vide. Un
tableau sans aucune ligne nommée vaut `null`, c'est-à-dire pas de section.

---

## 2. Les illustrations d'étapes vivent dans leur propre collection

**Décidé.** Collection `illustrations`, **un document par recette**, lu à l'ouverture de
la fiche. Voir l'en-tête de `js/illustrations.js`.

**Contre quoi.** Les ranger dans `photos`, qui aurait été le réflexe. `photos` est lue
en entier au chargement de la page, avec un masque, pour connaître toutes les vignettes
des listes. Cinq recettes de six étapes y ajoutaient trente documents et environ 600 Ko
lus à chaque visite pour n'afficher aucune illustration.

**Indexées par rang, pas par `numero`.** Le champ `numero` vaut parfois un libellé
(« Pour finir » dans les lasagnes). Supprimer une étape décale donc les illustrations
suivantes, ce que fait `retirerEtape()` : sans cela chaque photo se retrouvait, en
silence, sur l'étape d'après.

---

## 3. Une étape peut porter un intitulé

**Décidé.** Champ `titre` facultatif sur une étape, affiché au-dessus de son texte avec
la classe `.etape__libelle` déjà utilisée par les `numero` non entiers.

**Pourquoi.** Les fiches HelloFresh nomment chaque étape (« Top départ : on cuisine ! »,
« Service express »). Mettre ce nom dans le texte de l'étape l'aurait noyé, et le jeter
aurait perdu la seule structure que la fiche donne à sa préparation.

**Jamais les deux à la fois.** Le libellé affiché est le `titre` s'il existe, sinon le
`numero` non entier. Deux lignes d'intitulé pour une étape se liraient comme deux
étapes.

---

## 4. Les fractions typographiques sont lues, mais pas réécrites

**Décidé.** `Q.analyser()` résout ½, ¼, ¾, ⅓… et les nombres mixtes (« 1½ pièce »).
Le champ `brut` garde ce que la source écrit : la fiche continue d'afficher « ½ sachet ».

**Pourquoi.** Sans cela, la moitié des lignes d'une fiche HelloFresh était illisible :
ni additionnable dans la liste de courses, ni multipliable par le nombre de parts, alors
que le nombre est parfaitement déterminé. Les unités `pièce`, `pot` et `paquet` ont été
ajoutées aux dénombrables pour la même raison.

**Limite assumée.** ⅓ vaut 0,333 et non un tiers exact. C'est assez pour une liste de
courses, et cela évite d'afficher un nombre à dix-sept chiffres après un changement de
parts.

---

## 5. L'import écrit la recette, puis la photo, puis les illustrations

**Décidé.** Dans cet ordre, et jamais l'inverse. `tools/ajouter-recette-au-livre.js
--images` prend un fichier de data URLs déjà redimensionnées, contrôle les budgets
(vignette 60 000 caractères, grande 600 000, illustrations 600 000 au total), écrit, puis
**relit depuis le serveur**.

**Pourquoi cet ordre.** Une photo rattachée à un identifiant de recette absent ne
s'afficherait nulle part et resterait en base.

**Pourquoi les images arrivent déjà encodées.** Node n'a ni canvas ni encodeur d'image.
Le redimensionnement est fait à l'extraction, directement depuis le PDF à la taille
voulue, sans passer par un PNG intermédiaire. L'outil ne redimensionne rien et refuse ce
qui dépasse les budgets, au lieu de laisser Firestore échouer plus tard sans explication.

**Reprise séparée.** `tools/poser-illustrations.js` pose les illustrations d'une recette
déjà en base. Il existe parce que les deux écritures ne réussissent pas forcément en
même temps : voir le point suivant.

---

## 6. Ce qui reste à faire côté Firebase

**`firestore.rules` doit être republié.** La collection `illustrations` y est déclarée
dans le dépôt, mais pas encore publiée sur le projet : une lecture répond
`403 Missing or insufficient permissions`. Tant que ce n'est pas fait, les illustrations
d'étapes ne peuvent être ni écrites ni lues, et l'application affiche simplement les
fiches sans elles.

Les cinq recettes et leurs cinq photos de plat, elles, sont écrites et relues depuis le
serveur : les collections `recettes`, `photos` et `livres` sont publiées.

---

## 7. Conventions de transcription des fiches HelloFresh

Appliquées aux cinq fiches, et à réappliquer aux suivantes :

| Élément de la fiche | Où il va |
|---|---|
| Titre et sous-titre | `titre` (le sous-titre n'est pas repris, il redit les ingrédients) |
| « À table dans : 25 - 35 Min » | `temps.total`, seul temps donné |
| « Ingrédients pour N personnes » | `portions`, et deux groupes : « Dans la box », « À ajouter vous-même » |
| Intitulé vert d'une étape | `instructions[].titre` |
| Puces d'une étape | réunies dans `instructions[].texte` |
| L'ASTUCE DU CHEF, LE SAVIEZ-VOUS ?, MAKE IT AIRFRYER | `instructions[].astuce` |
| Mes ustensiles, « Conserver au réfrigérateur », mentions Végétarien / Air Fryer | `astuces.recette` |
| Valeurs nutritionnelles | `nutrition` |
| kcal par portion | `calories`, avec la mention que la valeur est déclarée |

Jamais repris : la première puce « Veillez à bien respecter les quantités indiquées à
gauche… », qui parle de la mise en page de la fiche papier et non d'un geste de cuisine,
et le paragraphe allergènes, qui renvoie aux étiquettes sans donner de liste. Les deux
sont consignés dans `manquants`, comme l'absence de difficulté, d'origine et de temps
détaillés.
