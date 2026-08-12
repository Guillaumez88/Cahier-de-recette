# Décisions de la bibliothèque, 12 août 2026

Ce qui a été tranché en écrivant « Ma bibliothèque », contre quoi, et ce qui reste
ouvert. Le raisonnement qui a précédé, y compris le modèle abandonné, est dans
`docs/BIBLIOTHEQUE-2026-08-12.md`.

---

## 1. Un livre est une étagère, pas un recueil

**Décidé.** Un livre porte un titre, un thème, un auteur. Rien d'autre. Il ne contient
pas la liste de ses recettes : c'est chaque recette qui nomme son livre, dans son
propre document.

**Pourquoi.** Deux appareils qui rattachent chacun une recette au même livre modifient
alors deux documents distincts. Avec la liste des recettes dans le document du livre, le
dernier qui écrit écrase le travail de l'autre. C'est exactement la raison qui a fait
choisir un document par article dans la liste de courses, et un document par créneau
dans le semainier.

**Conséquence utile.** Supprimer un livre ne supprime aucune recette. C'est aussi
pourquoi la suppression est refusée tant qu'il en contient : ses recettes resteraient en
base en désignant une étagère absente, donc visibles nulle part. Le bouton n'apparaît
que sur un livre vide, et `Livres.supprimer()` refuse quand même, au cas où.

---

## 2. Remonter une recette est un drapeau, pas une copie

**Décidé.** Une recette rattachée à un livre porte deux champs facultatifs dans son
document, qui est une seule chaîne JSON :

| Champ | Sens |
|---|---|
| `livre` | identifiant du livre. Absent pour les recettes du livre de cuisine. |
| `auLivre` | vrai quand la recette a été remontée dans le livre de cuisine, donc rendue planifiable. Absent sinon. |

**Contre quoi.** Une copie de la recette dans le livre de cuisine, qui était la
conception retenue avant de voir l'écran. La copie divergeait de son original dès la
première correction. Le drapeau ne duplique rien.

**Contre quoi encore.** Une collection Firestore de « recettes mises en avant », qui
n'aurait porté que des identifiants. Écarté : une recette seulement pointée n'a pas son
contenu sous la main, et tout le chemin du planning est synchrone (réserve de plats,
boîte de choix d'un créneau, « Ajouter aux courses » de la semaine, PDF du menu). Le
drapeau porte sur une recette déjà en cache, donc rien de ce chemin ne bouge.

**Conséquence dans le code.** Aucune modification de `sync.js` ni de `firestore.rules`
pour les recettes : les deux champs voyagent dans le JSON existant. `recettes.js` gagne
seulement des sélecteurs : `duLivreDeCuisine()`, `duLivre()`, `deLaBibliotheque()`,
`comptesParLivre()`, `livreDe()`, `estRemontee()`, `remonter()`.

**Un effet de bord traité.** `estAjoutee()` répond « oui » pour une recette de livre,
qui n'est pas dans `data/recipes.json`. La fiche proposait donc « Supprimer », ce qui
est juste, mais le texte laissait croire que le livre partait avec : il dit maintenant
que le livre reste.

---

## 3. Le thème d'un livre n'est pas la catégorie d'une recette

**Décidé.** Deux mots différents, tenus à l'écart. La **catégorie** (Entrée, Plat,
Dessert) décrit un plat et existe depuis le début. Le **thème** (Pâtisserie, Plats,
Boisson) décrit un ouvrage.

**Décidé aussi.** La liste des thèmes n'est pas fermée. Les puces de filtre sont
déduites des livres présents, comme `optionsDisponibles()` le fait déjà pour les filtres
du livre de cuisine : un livre de conserves fait apparaître « Conserves » sans qu'on
touche au code. `THEMES_SUGGERES` ne sert qu'à proposer des raccourcis à la création.

---

## 4. Deux couleurs de couverture, pas trois

**Décidé.** La couleur d'une couverture vient d'une empreinte du nom du thème, ramenée
sur **deux** palettes (terracotta, sauge). Un livre vide reste neutre.

**Pourquoi pas trois.** La troisième aurait été un neutre, or le neutre est déjà pris
par les livres vides. Un livre garni qui ressemble à un livre vide est pire qu'une
couleur répétée : deux thèmes de même couleur ne gênent personne, chaque groupe portant
son intertitre.

**Pourquoi une empreinte et pas une table.** Une table thème → couleur devrait être
tenue à jour à chaque thème inventé, et un thème absent de la table n'aurait pas de
couleur. L'empreinte est stable d'un chargement à l'autre et couvre tout.

---

## 5. Un seul écran pour le livre de cuisine et pour un livre

**Décidé.** `vueLivre(livre)` rend les deux, `livre` valant `null` pour le livre de
cuisine. La différence tient à trois choses : la source des recettes, le titre, et le
bouton d'ajout.

**Pourquoi.** Dupliquer deux cents lignes garantissait qu'un filtre corrigé d'un côté
reste faux de l'autre. Et la demande était explicitement une page « qui ressemble à la
page Le livre de cuisine ».

**Ce qui en découle, et qui était demandé.** Les filtres d'un livre sont calculés sur
ses seules recettes : un livre de desserts ne propose pas la puce « Entrée ». La
recherche d'un livre ne regarde que ses recettes. Celle de la bibliothèque traverse tous
les livres, et ses résultats portent le nom du livre d'origine.

**Un piège traité.** Les critères de filtre sont remis à zéro quand on change
d'étagère (`changerDeLivre`). Sans cela, un filtre « Dessert » hérité du livre de
cuisine viderait l'écran d'un livre de plats, avec une puce qui n'y est même pas
proposée : la page paraîtrait vide sans qu'on voie pourquoi.

---

## 6. « Ajouter une recette » écrit dans le livre qu'on regarde

**Décidé.** Le bouton de la page d'un livre crée dans ce livre, par la route
`#/bibliotheque/<id>/nouvelle`. Celui du livre de cuisine continue d'écrire dans le
livre de cuisine. La source du brouillon prend le titre de l'ouvrage : une recette venue
d'un livre papier a une source, et c'est ce livre.

L'import depuis un site fait de même : ouvert depuis un livre, il rattache la recette
importée à ce livre, et la boîte le dit dans son titre.

---

## 7. Un défaut trouvé et corrigé au passage

`lireRecettesModifiees()` lisait **une seule page de 300 documents**, sans pagination,
alors que les autres collections en ont une. Tant que la collection `recettes` ne portait
que des recettes modifiées à la main, la limite était théorique. Avec les recettes des
livres dans la même collection, la 301e aurait disparu de l'application sans le moindre
message. La boucle de pagination est ajoutée, et un test écrit 305 documents pour le
vérifier.

Deuxième défaut, plus petit : `slug()` ne traitait pas les ligatures, que la
normalisation NFD ne décompose pas. « Œufs mimosa » donnait `ufs-mimosa`. Corrigé dans
`recettes.js` et dans `livres.js`.

Troisième : la marque « fiche modifiée » s'affichait sur toute recette vivant dans
Firestore, donc sur une recette créée à l'instant, qui n'a aucun original dont elle
s'écarterait. Elle est maintenant réservée aux recettes d'origine réellement modifiées.

---

## 8. Le coût, mesuré

| | |
|---|---|
| Un document livre | quelques centaines d'octets, lus une fois par chargement |
| Une recette de livre | un document dans `recettes`, comme une recette ajoutée à la main |
| Code ajouté | `js/livres.js` 247 lignes, `js/vue-bibliotheque.js` 292 lignes |
| Poids ajouté | 6,9 Ko compressés (livres 3,3 Ko, écran 3,6 Ko) |
| Poids du site | 196 Ko compressés en 33 fichiers, contre 182 Ko en 31 |

**Le seuil à surveiller.** Toutes les recettes de la collection `recettes` sont relues à
chaque chargement de page. Aujourd'hui elles se comptent sur les doigts. À 500 recettes
de livres, cela ferait 500 lectures par chargement, soit 11 000 par jour à 22
chargements, sur un palier gratuit de 50 000, et cela s'ajouterait au semainier (piste
A1, échéance à deux ans). Si la bibliothèque devait atteindre cet ordre de grandeur, la
sortie est connue : lire les recettes d'un livre à l'ouverture du livre, par une requête
filtrée sur le champ `livre`, en ne gardant au chargement que celles du livre de cuisine.
Rien ne presse, et le dire maintenant évite de le découvrir par une panne.

---

## 9. Ce qui reste à faire, et qui n'est pas du code

**`firestore.rules` doit être republié.** Une collection de plus, `livres`. Tant que
c'est fait, la bibliothèque ne peut ni lire ni écrire, et l'application le dira sans se
bloquer : la bibliothèque paraîtra vide.

**Rien n'est prévu pour renommer un livre depuis l'écran.** `Livres.modifier()` existe et
est testé, mais aucun bouton ne l'appelle. À ajouter quand le besoin se présentera.
