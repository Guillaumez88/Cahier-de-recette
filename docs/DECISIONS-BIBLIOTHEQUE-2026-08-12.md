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

## 7 bis. Renommer, déplacer, illustrer : trois ajouts du 12 août au soir

### Renommer un livre garde son identifiant

**Décidé.** `Livres.modifier()` change le titre, le thème et l'auteur. **L'identifiant
ne bouge pas.**

**Pourquoi c'est essentiel.** Les recettes citent leur livre par cet identifiant, dans
leur propre document. Le recalculer à partir du nouveau titre obligerait à réécrire
toutes les recettes du livre, et laisserait rattachées à une étagère absente celles dont
la réécriture aurait échoué. Un livre renommé garde donc son adresse
(`#/bibliotheque/ferrandi-patisserie` reste valable après un renommage en « Ferrandi, le
grand livre »). Un test le vérifie sur une recette rattachée.

**Un cas de bord traité.** L'identifiant venant du titre, un livre renommé libère son
ancien titre sans libérer son identifiant. Créer ensuite un livre portant cet ancien
titre ne doit pas ouvrir le livre renommé : `creer()` ne rend un livre existant que si
son titre **actuel** produit encore cet identifiant, et prend sinon le premier
identifiant libre (`-2`, `-3`). Sans cette règle, « créer un livre » ouvrait parfois un
autre livre, ce qui est le genre de comportement qu'on met une heure à comprendre.

### Déplacer une recette d'une étagère à une autre

**Décidé.** `Rc.deplacerVersLivre(id, versLivre)`, `versLivre` valant `null` pour le
livre de cuisine. Seul le rattachement change : la recette, ses ingrédients, sa photo et
son historique dans le semainier ne bougent pas, la photo étant rangée sous
l'identifiant de la recette et non sous celui du livre.

**Le livre de cuisine figure dans les destinations**, et ce n'est pas la même chose que
« Ajouter au livre de cuisine » de la fiche : celui-là remonte une recette **en la
laissant** dans son livre, celui-ci **la sort** de la bibliothèque. Les deux libellés le
disent, parce que la nuance ne se devine pas. Déplacer vers le livre de cuisine retire
`auLivre`, qui n'aurait plus d'objet.

**Un garde-fou.** Une recette du carnet d'origine ne peut pas être rangée dans un livre :
elle vit dans le fichier servi avec le site et réapparaîtrait dans le livre de cuisine à
la prochaine lecture, en double. Le module refuse, et la boîte ne propose pas le bouton.

**Placement.** Dans les « actions rares » de l'éditeur, avec la suppression, et non dans
la barre de la fiche qui en porte déjà quatre.

### La couverture d'un livre réutilise photos.js, telle quelle

**Décidé.** La couverture est rangée dans la collection `photos` existante, sous la clé
`livre::<id>` (`Livres.clePhoto()`).

**Pourquoi.** `photos.js` traite sa clé comme opaque : redimensionnement dans le
navigateur, deux tailles, cache durable IndexedDB, lecture de toutes les vignettes en une
requête masquée au chargement. Tout cela s'applique sans une ligne de plus, **sans
collection supplémentaire et sans seconde republication des règles de sécurité**. Le
préfixe garantit qu'une couverture ne peut jamais entrer en collision avec la photo d'une
recette, et un test l'écrit noir sur blanc.

**Contre quoi.** Un champ `couverture` dans le document du livre. Écarté : le document du
livre est lu à chaque chargement de page, l'image entière l'aurait donc été aussi, pour
chaque livre. C'est exactement ce que les deux tailles de photos.js évitent.

**Ce qui s'affiche.** Sur la carte de la bibliothèque, la couverture remplace l'aplat de
couleur, cadrée en `cover` et alignée sur le **haut** de l'image : le titre d'un ouvrage
est en haut de sa couverture, et c'est lui qu'on cherche à reconnaître. Sur l'écran du
livre, elle accompagne le titre. Dans les deux cas c'est la vignette (320 px) qui est
utilisée : elle est déjà en cache, et la grande version n'apporterait rien à 124 px.

**Un bloc d'image réutilisable.** `blocPhoto()` de l'éditeur est devenu `blocImage(cle,
reglages)`, avec ses libellés et sa fonction de re-rendu en paramètres. Les identifiants
de nœuds (`photo-fichier`, `retirer-photo`, `bloc-photo`) sont conservés : les tests et la
feuille de style s'y appuient.

---

## 8. Le coût, mesuré

| | |
|---|---|
| Un document livre | quelques centaines d'octets, lus une fois par chargement |
| Une recette de livre | un document dans `recettes`, comme une recette ajoutée à la main |
| Code ajouté | `js/livres.js` 289 lignes, `js/vue-bibliotheque.js` 304 lignes |
| Poids ajouté | 7,9 Ko compressés (livres 4,1 Ko, écran 3,9 Ko) |
| Poids du site | 201 Ko compressés en 33 fichiers, contre 182 Ko en 31 |
| Une couverture | un document de la collection `photos`, deux tailles, comme une photo de recette |

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

**Deux choses ne sont pas faites, et n'ont pas été demandées.** Déplacer plusieurs
recettes d'un coup (le déplacement se fait fiche par fiche), et supprimer un livre avec
ses recettes (la suppression reste réservée aux livres vides, pour la raison donnée au
point 1).
