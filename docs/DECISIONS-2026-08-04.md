# Décisions de conception, 4 août 2026

Ce fichier ne consigne que des **décisions** : ce qui a été tranché, contre quoi, et
pourquoi. Le fonctionnement du produit est décrit dans le `README.md`, les mesures dans
les tests. Une décision qui serait revue plus tard doit l'être ici, en ajoutant une
entrée datée, sans réécrire celles qui précèdent.

Contexte : lot de dix demandes du 4 août 2026 (titre, navigation mobile,
rafraîchissement, suppression d'un plat, plusieurs plats par repas, terminologie des
créneaux, rappel d'ingrédients, retrait de l'impression, semaine en lecture par défaut,
réserve filtrable).

## 1. La clé d'un plat porte un suffixe tiré au hasard, pas un rang

**Décidé** : `2026-08-03::dejeuner::k3f9za`, suffixe de six caractères tiré au hasard.

**Écarté** : un rang incrémenté (`::1`, `::2`), qui aurait été plus lisible en base.

**Pourquoi** : deux téléphones qui ajoutent un dessert au même déjeuner en même temps
calculent le même rang à partir du même état local, donc écrivent la même clé de
document. Le second écrase le premier, sans erreur et sans un mot à l'écran. C'est
exactement le défaut qu'un document par unité était censé éliminer.

**Conséquence acceptée** : une clé en base n'est plus devinable. Le script
`tests/verifier-firebase.js` ne peut plus supprimer un résidu par sa clé, il relit la
collection et filtre sur le jour de vérification.

## 2. Glisser sur une case occupée ajoute, il n'y a plus d'échange

**Décidé** : le plat glissé vient s'ajouter au repas d'arrivée.

**Écarté** : conserver l'échange des deux plats, qui existait et était testé.

**Pourquoi** : l'échange n'a jamais été un choix, c'était une conséquence. Un repas ne
portant qu'un plat, il fallait bien libérer la case sans effacer ce qui s'y trouvait.
Maintenant qu'un repas en porte plusieurs, l'échange déplace un plat que personne n'a
demandé à bouger.

## 3. En lecture, une case remplie est un lien vers la fiche

**Décidé** : hors mode Modifier, la grille n'est pas interactive, sauf les plats du
carnet qui sont des liens vers leur fiche. Les cases ne sont plus des `<button>`.

**Pourquoi** : la demande est « une page d'accueil qui affiche le menu de la semaine le
plus clairement possible ». Depuis l'accueil, le geste attendu sur un plat est de lire
sa recette, pas d'ouvrir une boîte de composition du menu.

**Conséquence acceptée** : sur téléphone, modifier la semaine demande un appui de plus
(le bouton « Modifier »). Le « + » du bloc « Aujourd'hui » reste en place sans condition,
parce que c'est le geste du jour même.

## 4. « Vider ce repas » n'apparaît qu'à partir de deux plats

**Décidé** : avec un seul plat, seul le bouton « Retirer » de sa ligne est proposé.

**Pourquoi** : deux boutons pour le même effet font hésiter, et le doute coûte plus
qu'un clic.

## 5. Le rappel d'ingrédients est déduit du texte de l'étape

**Décidé** : `L.ingredientsDeLEtape` rapproche un ingrédient d'une étape quand le texte
de l'étape cite un mot significatif de son nom, réduit au singulier et sans accent.

**Écarté** : une association saisie recette par recette, qui serait exacte.

**Pourquoi** : une table de correspondance tenue à la main sur vingt fiches, soit 140
étapes et 198 ingrédients, ne resterait pas juste après la première modification de
recette. Une déduction imparfaite mais toujours à jour vaut mieux qu'une table exacte
puis fausse.

**Mesuré sur les vraies fiches, pas estimé** : 103 des 140 étapes portent un rappel,
soit 74 %. Un test fixe un plancher de 95 étapes comme garde-fou contre une régression
silencieuse.

**Deux limites connues et assumées** :

- une étape qui dit « la préparation » ou « le mélange » ne cite aucun ingrédient : le
  rappel reste vide, plutôt que de deviner ;
- deux ingrédients partageant un mot remontent tous les deux (« Sucre » et « Sucre
  glace » ; « Beurre » et « Farine pour beurre manié » sur l'étape de frangipane de la
  galette). Un ingrédient de trop sous les yeux vaut mieux qu'un manquant.

La liste complète reste accessible d'un pli, elle n'est jamais remplacée par ce rappel.

## 6. Le seuil de rapprochement des mots est de trois lettres

**Décidé** : un mot de trois lettres compte, avec une liste explicite de mots de liaison
à écarter (`une`, `est`, `son`, `sur`, `par`, `que`, `qui`…).

**Pourquoi** : à quatre lettres, « Ail », « Sel », « Eau » et « Riz » n'étaient jamais
rappelés. Ce sont de vrais ingrédients, et l'ail apparaît dans la première étape des
lasagnes.

**Détail qui a coûté une correction** : l'apostrophe coupe le mot au lieu d'en faire
partie. Sans cela, « une gousse d'ail » produisait le mot `d'ail`, qui ne rencontrait
pas l'ingrédient « Ail ».

## 7. Les clés à deux morceaux restent valides, il n'y a pas de migration

**Décidé** : `decouperCreneau` accepte les deux formes. Une clé à deux morceaux se lit
comme le plat unique de son repas.

**Écarté** : un script de migration réécrivant les documents existants.

**Pourquoi** : une migration sur une base partagée par plusieurs appareils est une
opération à risque pour un gain nul ici, les deux formes coexistant sans ambiguïté. Un
test écrit un document sous l'ancienne forme dans l'émulation et vérifie qu'il s'affiche
et se retire.

## 8. Les pictogrammes des nouveaux repas hors carnet réutilisent le jeu existant

**Décidé** : Burger King et McDonnalds prennent le pictogramme `restaurant`, La
boucherie prend `viandes`, Au bureau prend `horloge`.

**Écarté** : dessiner quatre pictogrammes de plus.

**Pourquoi** : le jeu du dépôt compte 26 dessins d'un style homogène (grille 24,
épaisseur 1,7, sans remplissage). Un dessin de plus mal calibré se voit ; un
pictogramme réutilisé ne se remarque pas. Un test vérifie que chaque repas hors carnet
pointe vers un pictogramme qui existe, faute de quoi la pastille sortirait vide.

## Point ouvert

**La branche `claude/new-session-u3clgb` n'est pas en ligne.** Le workflow de
publication ne se déclenche que sur `main` : tant que la branche n'est pas fusionnée,
`https://guillaumez88.github.io/Cahier-de-recette/` sert encore la version précédente,
sans « Miam miam ! » ni aucun des dix changements.

**Aucune republication de `firestore.rules` n'est nécessaire.** La clé passe de 18 à
35 caractères, la borne de la règle est de 100. Conclusion tirée de la lecture des
règles ; le contrôle qui la prouve contre le vrai projet est
`tests/verifier-firebase.js --reel`, à jouer par le propriétaire du projet.
