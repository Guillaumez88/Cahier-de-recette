# « Ma bibliothèque » : ce qui est tranché, ce qui reste à trancher

> **Révision du 12 août, après lecture de l'écran 06.** La proposition de design a
> changé le modèle, et ce document conserve les deux états : ce qui suit la présente
> note décrit la conception **retenue et implémentée** ; les sections 2 à 4 et 6.1,
> écrites avant d'avoir vu l'écran, décrivent un modèle **abandonné** et sont
> conservées pour la trace du raisonnement.
>
> Ce que l'écran a changé : un livre n'est pas un recueil importé en bloc, c'est une
> **étagère**, créée depuis l'application (« Créer un livre »), à laquelle on rattache
> des recettes au fil de leur saisie. La proposition affiche « 12 recettes importées »,
> « 0 recette importée pour l'instant » : on parle de dizaines de recettes qui arrivent
> une par une, pas de cent cinquante d'un coup.
>
> Conséquences, toutes des simplifications :
>
> - **Pas de fichier statique par livre.** Les volumes en jeu ne justifient plus le
>   chargement paresseux ni l'index réduit. Le calcul de poids du point 2 reste juste,
>   il ne s'applique simplement plus à ce cas d'usage.
> - **Un livre est un document Firestore** dans une collection `livres` : un titre, un
>   thème, un auteur. Minuscule, et quelques lectures par chargement.
> - **Le livre ne porte pas ses recettes.** C'est chaque recette qui nomme son livre,
>   dans son propre document. Deux appareils qui rattachent chacun une recette au même
>   livre modifient donc deux documents distincts, sans s'écraser. C'est la même raison
>   qui a fait choisir un document par article dans la liste de courses.
> - **Remonter une recette est un drapeau, pas une copie** (`auLivre`). Le point 4
>   choisissait la copie faute de pouvoir garder les chemins synchrones ; comme la
>   recette est désormais toujours en cache, un drapeau suffit et rien ne se duplique.
> - **`firestore.rules` doit être republié** : une collection de plus. C'était l'étape
>   manuelle que le modèle statique évitait ; elle revient.
>
> Un défaut réel a été trouvé et corrigé au passage : `lireRecettesModifiees()` lisait
> une seule page de 300 documents, sans pagination. Avec des recettes de livres dans la
> même collection, la 301e aurait disparu de l'application sans le moindre message.
>
> Les décisions retenues sont détaillées dans `docs/DECISIONS-BIBLIOTHEQUE-2026-08-12.md`.

Spécification de la fonctionnalité demandée le 12 août 2026 : une page donnant accès à
des livres de cuisine spécialisés, chacun portant son propre groupe de recettes, sans
que ces recettes n'alimentent le planning de la semaine, sauf celles qu'on remonte
explicitement dans « Le livre de cuisine ».

Ce document n'est pas un plan de travail : c'est le modèle de données et les arbitrages
qui le précèdent. Rien n'a encore été écrit.

---

## 1. Ce qui est demandé, reformulé

| | |
|---|---|
| Nouvel écran | « Ma bibliothèque », liste de livres, filtrable par thème (Pâtisserie, Boisson, Plats, …) |
| Un livre | un titre, un thème, et son groupe de recettes, consultable |
| « Le livre de cuisine » | les recettes actuelles, seule source du planning de la semaine |
| Une recette de livre | toutes les fonctions d'une recette actuelle : fiche, mode Cuisiner, courses, photo, partage, mise à l'échelle, modification |
| Une recette de livre | **absente du planning et de la réserve de plats**, par défaut |
| Remonter une recette | la rendre visible dans « Le livre de cuisine », ce qui la rend planifiable |

Deux axes de classement coexistent alors, et il faut les nommer différemment sous peine
de confusion permanente : la **catégorie** d'une recette (Entrée, Plat, Dessert), qui
existe déjà, et le **thème** d'un livre (Pâtisserie, Boisson, …), qui est nouveau. Le
thème porte sur l'ouvrage, jamais sur la recette.

---

## 2. Le poids, mesuré, qui décide du reste

Mesuré sur `data/recipes.json` : 166 836 octets bruts et 19 460 octets compressés pour
21 recettes, soit **7 945 octets bruts et 927 octets compressés par recette**. Un index
réduit à l'identifiant, au titre et à la catégorie coûte 98 octets bruts et environ
32 octets compressés par recette.

| Taille d'un livre | Fichier complet | Index réduit |
|---|---|---|
| 60 recettes | 0,45 Mo bruts, 54 Ko compressés | 2 Ko compressés |
| 150 recettes | 1,14 Mo bruts, 136 Ko compressés | 5 Ko compressés |
| 450 recettes (trois livres) | 3,41 Mo bruts, 407 Ko compressés | 14 Ko compressés |

Le site entier pèse aujourd'hui 182 Ko compressés. **Charger les livres au démarrage est
donc exclu** : trois livres tripleraient le poids du premier chargement, sur un
téléphone, en cuisine. Deux conséquences directes :

1. le contenu d'un livre est chargé **quand on ouvre ce livre**, pas avant ;
2. un **index réduit** de toute la bibliothèque est chargé au démarrage, parce que
   plusieurs choses en dépendent sans avoir besoin du contenu : afficher la liste des
   livres avec leur nombre de recettes, chercher un titre dans toute la bibliothèque, et
   surtout distinguer une recette de livre d'une recette ajoutée à la main (voir 4).

### Pourquoi pas Firestore

Une recette de livre ne change jamais : c'est une page imprimée. La mettre dans
Firestore la ferait relire à chaque chargement de page et facturer à chaque lecture.
450 recettes lues 22 fois par jour font **9 900 lectures quotidiennes** sur un palier
gratuit de 50 000, pour une donnée figée, et cela s'ajouterait au semainier qui pose
déjà le problème A1 (échéance à deux ans). Un fichier statique coûte zéro lecture, est
mis en cache par le service worker, et fonctionne hors ligne.

---

## 3. Le modèle retenu

```
data/livres.json                 manifeste : les livres, leur thème, et l'index réduit
data/livres/<id-du-livre>.json   les recettes complètes d'un livre, chargé à l'ouverture
```

Le manifeste, un livre :

```json
{
  "id": "patisserie-conticini",
  "titre": "Sensations",
  "auteur": "Philippe Conticini",
  "theme": "Pâtisserie",
  "fichier": "data/livres/patisserie-conticini.json",
  "recettes": [{ "id": "…", "titre": "…", "categorie": "Dessert" }]
}
```

Les thèmes ne sont pas une liste figée dans le code : les puces de filtre de l'écran
sont déduites des livres présents, comme `optionsDisponibles()` le fait déjà pour les
filtres du livre de cuisine. Ajouter un livre de boissons fait apparaître le filtre
« Boisson », sans toucher au code.

---

## 4. Remonter une recette : une copie, pas un drapeau

**Décidé.** Remonter une recette dans « Le livre de cuisine » la **copie** dans la
collection Firestore `recettes`, avec un champ `livre` qui garde son origine. La
redescendre supprime cette copie ; la recette reste dans son livre.

**Contre quoi.** Une simple liste d'identifiants « mis en avant », dans une nouvelle
collection Firestore. C'est plus élégant sur le papier et c'est un piège : une recette
seulement pointée n'a pas son contenu sous la main. Or tout le chemin du planning est
**synchrone** aujourd'hui, du premier caractère au dernier : la réserve de plats, la
boîte de choix d'un créneau, « Ajouter aux courses » qui lit les ingrédients de chaque
plat de la semaine, le PDF du menu. Un pointeur imposerait de charger un livre au milieu
de chacun de ces chemins, donc de les rendre asynchrones, donc de rouvrir six écrans qui
fonctionnent.

La copie, elle, fait d'une recette remontée une recette du livre comme une autre : rien
à changer dans le planning, les courses, le compteur de réalisations, le partage ou le
PDF. Et elle ne coûte rien de plus : le mécanisme est celui qui existe déjà pour les
recettes ajoutées à la main (`Rc.creer`), une poignée de documents lus au chargement.

**Aucune republication de `firestore.rules` n'est nécessaire** : la collection `recettes`
existe et ses règles couvrent déjà le cas. C'est une étape manuelle en moins, et c'est
la seule qui a déjà été oubliée par le passé.

**Le prix de la copie, dit clairement.** Si le fichier du livre est corrigé plus tard, la
copie remontée ne suit pas. Elle porte son origine, donc la fiche peut le dire, et la
redescendre puis la remonter la remet à jour. C'est une divergence possible, pas une
divergence silencieuse.

**Un effet de bord à traiter à l'écran.** `Rc.estAjoutee()` répond « oui » pour une
recette remontée, puisqu'elle n'est pas dans `data/recipes.json`. La fiche proposerait
donc « Supprimer la recette », ce qui est faux : elle survit dans son livre. Le champ
`livre` permet d'écrire le bon libellé, « Retirer du livre de cuisine », et de dire où
elle retourne.

---

## 5. Découpage prévu

| Fichier | Rôle |
|---|---|
| `js/bibliotheque.js` | manifeste, index par identifiant, chargement d'un livre et cache mémoire, remontée et redescente |
| `js/vue-bibliotheque.js` | les deux écrans, sur le modèle de `js/vue-magasin.js` : reçoit ses outils, rend un fragment |
| `js/app.js` | deux routes, `#/bibliotheque` et `#/bibliotheque/<id>`, et l'entrée de navigation |
| `data/livres.json`, `data/livres/` | les données |

Routes : `#/bibliotheque` et `#/bibliotheque/<id>`. La fiche reste `#/recette/<id>`, et
le retour ramène au livre d'où l'on vient.

---

## 6. Ce qui reste à trancher, et qui n'est pas à moi

### 6.1 Comment un livre arrive

Un fichier statique ne peut pas être écrit depuis l'application : il est déployé avec le
site. Concrètement, importer un livre veut dire me donner la source (photos des pages,
PDF, extraction) et je produis le fichier, comme pour le couscous venu d'une page
photographiée. C'est ce que suppose tout ce document.

L'autre option est de créer un livre depuis l'application et d'y ranger des recettes une
par une, ce qui impose de mettre les livres dans Firestore, avec le coût de lecture du
point 2. **Recommandation : les fichiers statiques**, et une exception si vous voulez
pouvoir ranger dans un livre une recette importée depuis un site.

### 6.2 La recherche du livre de cuisine porte-t-elle sur la bibliothèque

Non, par défaut : c'est le sens de la demande. Reste à savoir si vous voulez, en plus,
une recherche qui traverse toute la bibliothèque depuis l'écran « Ma bibliothèque »
(l'index réduit la rend possible, sur les titres seulement, pas sur les ingrédients).
**Recommandation : oui, sur les titres**, c'est 20 lignes et cela évite d'ouvrir cinq
livres pour retrouver une tarte.

### 6.3 Une recette ajoutée à la main, désormais, va où

Aujourd'hui « Ajouter une recette » écrit dans le livre de cuisine. Avec des livres
statiques, une recette saisie dans l'application ne peut pas rejoindre un livre.
**Recommandation : ne rien changer** : les ajouts vont au livre de cuisine, la
bibliothèque est faite d'ouvrages, pas de collections personnelles.

---

## 7. Un angle mort, à savoir avant d'importer

Le dépôt est public et le site l'est aussi : l'authentification est anonyme, donc
n'importe qui ouvrant l'adresse lit ce qu'il y a dedans. Importer un livre de cuisine du
commerce, c'est en reproduire le contenu, et le placer dans un fichier statique le rend
téléchargeable par quiconque trouve l'adresse du dépôt.

Techniquement, rien ne l'empêche, et l'usage à la maison relève de la copie privée. Ce
n'est plus tout à fait le cas d'une reproduction intégrale publiée sur internet. Aucune
des options techniques ne referme complètement cette porte tant que le site est public :
mettre les livres dans Firestore ne change rien, ses règles autorisant toute session
anonyme.

C'est votre décision, elle est hors de mon champ, et elle est plus facile à prendre
maintenant qu'après avoir saisi deux cents pages.

---

## 8. Écran 06, à fournir

La proposition de Claude Design ne peut pas être lue depuis cette session :
l'autorisation du connecteur design demande un terminal interactif, dont cet
environnement ne dispose pas. Deux façons de la faire arriver : « Send to Claude Code
Web » depuis Claude Design, qui dépose le projet dans l'espace de travail, ou le fichier
`Carnet de recettes - Design final.dc.html` joint directement.

En attendant, la version du 3 août est dans `docs/refonte-2026-08-03/design-final.html`
et ne contient que les plans 00 à 05 : l'écran 06 n'y est pas.
