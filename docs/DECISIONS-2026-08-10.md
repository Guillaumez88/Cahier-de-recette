# Décisions du 10 août 2026 : partager une recette, imprimer le menu

Deux fonctions demandées le même jour, sans rapport technique entre elles. Ce document
dit ce qui a été tranché, contre quoi, et ce qui reste ouvert. À lire avant de revenir
sur l'un de ces choix.

---

## 1. Le partage rend deux objets, pas un

**Décidé.** La boîte de partage propose le **texte** de la recette et le **lien** vers
la fiche, séparément.

**Contre quoi.** Un seul bouton « Partager » qui envoie un lien, comme le font la
plupart des sites. Le cas d'usage réel ne s'y prête pas : on envoie une recette à
quelqu'un qui n'a pas le carnet, et il veut la recette dans la conversation, pas un
onglet à ouvrir. Inversement, entre deux appareils de la maison, le texte recopié est
inférieur au lien, qui ouvre la version à jour.

**Conséquence.** `js/partage.js` expose `enTexte()` et `lien()`, et l'écran montre les
deux. C'est une boîte de plus, pas un bouton de plus.

---

## 2. Le texte partagé est brut, sans mise en forme

**Décidé.** Aucun astérisque, aucun tiret décoratif, aucun émoji.

**Pourquoi.** WhatsApp lit `*gras*`, Telegram lit `**gras**`, Signal et les SMS ne
lisent rien. Une syntaxe qui ne s'interprète pas est plus laide qu'une absence de gras,
et il n'existe pas de dénominateur commun.

---

## 3. Un lien partagé fonctionne pour tout le monde, et on le dit

**Constat, pas décision.** Le site est public et l'authentification est anonyme :
n'importe qui ouvrant le lien obtient une session et peut lire les recettes ajoutées ou
modifiées. Un lien partagé n'est donc pas réservé à la maison. Ce n'est pas un défaut
introduit ici, c'est la conséquence du modèle d'accès en place depuis le début.

**Décidé.** Ne rien changer aux règles Firestore pour cette fonction. Restreindre la
lecture demanderait des comptes nommés, donc une gestion d'utilisateurs, pour un carnet
de recettes de famille. Le contenu est une recette de cuisine.

**Deux réserves réelles, traitées.** `js/recettes.js` applique en local puis tente
l'envoi, sans file d'attente : un envoi échoué n'est pas rejoué.

| Situation | Ce que fait la boîte |
|---|---|
| Recette ajoutée ici, envoi en échec | Le lien est retiré : il mènerait à « Recette introuvable ». Le texte reste partageable. |
| Recette modifiée ici, envoi en échec | Le lien reste proposé, avec un bandeau : il ouvrira la version précédente. |

**Ouvert.** Donner une file d'attente aux recettes, comme en ont la liste de courses,
les menus et le placard via `js/collection.js`. Cela ferait disparaître le premier cas.
Non fait ici : c'est un changement de `js/recettes.js`, pas du partage, et il mérite
d'être décidé pour lui-même.

---

## 4. Le PDF est écrit à la main, sans bibliothèque

**Décidé.** `js/pdf.js`, un écrivain de PDF minimal, 21 Ko de source et 7,1 Ko
compressés.

**Contre quoi.** jsPDF (380 Ko) et pdf-lib (1,4 Mo). Le premier invariant du projet est
l'absence de dépendance : ni npm, ni CDN, ni étape de construction. Le besoin est du
texte, des traits et des rectangles sur une page A4.

**Contre quoi encore.** `window.print()` avec une feuille de style d'impression, qui
n'aurait rien coûté. Écarté : le résultat n'est pas un fichier. On ne l'envoie pas, on
ne le garde pas, et sur téléphone la boîte d'impression du système donne un rendu qu'on
ne maîtrise pas. La demande était un PDF.

**La contrainte vérifiée avant d'écrire.** Un PDF sans police embarquée n'a droit qu'à
l'encodage WinAnsi. Les caractères hors ASCII des titres et libellés du carnet ont été
relevés : `’ ï é â è à`, six caractères, tous dans WinAnsi. Si un seul avait manqué, il
aurait fallu embarquer une police, et la décision aurait basculé.

**Ce qui a été accepté comme approximation, et son effet.** Les lettres accentuées
prennent la largeur de leur lettre de base, exact dans Helvetica sauf pour les
variantes du i, listées à part. Un octet absent de la table compte pour un « n ».
Effet : une coupure de ligne décalée d'une fraction de point. Aucun effet visible.

**Ce qui n'est pas fait.** Pas de compression, pas d'image, pas de transparence. Une
page de menu mesurée pèse de 4,6 Ko (semaine vide) à 6,3 Ko (quatorze plats).

---

## 5. La feuille dit « à définir », jamais rien

**Décidé.** Un jour sans repas prévu porte « à définir ». Un créneau vide, lui, n'est
pas affiché.

**Pourquoi la différence.** Sur du papier, un jour blanc ne se distingue pas d'un
défaut d'impression, alors qu'un créneau non affiché ne pose aucune question : personne
ne cherche le petit-déjeuner qu'il n'a pas prévu. Écrire « Petit-déjeuner : rien » sept
fois remplirait la feuille de vide.

---

## 6. Les hauteurs sont calculées avant d'écrire

**Décidé.** `plan()` répartit les jours en pages et fixe chaque hauteur, puis le rendu
écrit.

**Pourquoi.** Deux raisons, et la première est dirimante : le pied de page porte
« page 1 sur 2 », qui suppose de connaître le total avant de dessiner la première page.
La seconde est qu'une coupure doit tomber entre deux jours et jamais au milieu d'un.

**Effet secondaire retenu.** Une semaine légère laissait le tiers bas blanc. Le surplus
est réparti pour moitié dans la hauteur des cartes et pour le reste dans les écarts,
les deux plafonnés. Sans plafond, sept bandes hautes et vides ressemblent à un
formulaire.

---

## 7. Un bouton PDF par semaine

**Décidé.** Le bouton est dans l'en-tête de chaque semaine, à côté de « Ajouter aux
courses » et « Modifier ».

**Contre quoi.** Un bouton unique ouvrant une boîte de choix de semaine. Pour deux
valeurs, c'est une étape de plus sans information de plus.

**Nom du fichier.** `menu-semaine-du-2026-08-10.pdf`, daté par la semaine décrite et
non par le jour d'impression : deux feuilles de deux semaines ne s'écrasent pas, et
réimprimer la même semaine remplace bien la même feuille.

---

## 8. Ce que les tests prouvent, faute de lecteur de PDF

Aucune bibliothèque n'est disponible pour relire le fichier produit. Les tests
vérifient donc la structure : chaque offset de la table `xref` tombe sur la déclaration
de son objet, `startxref` désigne le début de la table, chaque longueur de flux
déclarée vaut sa longueur réelle. Ce sont les trois contrôles qu'un lecteur fait avant
d'ouvrir un document.

Le test navigateur clique le bouton, récupère le fichier téléchargé, vérifie l'en-tête
et la fin, puis reconstruit un PDF dans la page pour vérifier qu'il porte les plats
posés. Un PDF valide mais vide de ce qu'on a prévu serait un faux succès.

**Ce que cela ne prouve pas.** Qu'un lecteur donné l'affiche comme prévu. Le fichier a
été relu et rendu en image hors du projet pendant la mise au point, mais ce contrôle
n'est pas automatisable ici, faute de dépendance.

---

## 9. Une limite non contournable, sur iPhone

Dans une application installée sur iOS, la demande de téléchargement ouvre le PDF dans
une nouvelle vue au lieu de l'enregistrer. Le fichier est le même, il faut le partager
depuis cette vue. Aucun contournement depuis une page web.
