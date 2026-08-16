# Partager le carnet en lecture seule, 16 août 2026

Le carnet peut désormais se partager : l'adresse suffit à tout lire, et rien de ce qui
s'y trouve ne peut être modifié depuis un appareil qui n'est pas de la maison.

## Le point de départ, qui n'était pas confortable

Le site est public depuis toujours, et jusqu'ici **tout visiteur pouvait aussi
écrire** : les règles Firestore acceptaient l'écriture de n'importe quelle session
authentifiée, et l'application en ouvre une, anonyme, à chaque ouverture de page.
Partager l'adresse revenait donc à partager les droits de modification, et masquer les
boutons n'y aurait rien changé : la console du navigateur reste ouverte à tous.

## Ce qui a été décidé

**Deux verrous, dont un seul compte.**

| Verrou | Où | Ce qu'il fait |
|---|---|---|
| Règles Firestore | `firestore.rules` | Refuse l'écriture à tout appareil non inscrit. C'est le verrou réel. |
| Interface | `js/acces.js` | Retire les commandes de modification et bloque l'envoi. C'est du confort. |

L'interface seule aurait été un décor ; les règles seules auraient laissé des boutons
qui échouent. Les deux ensemble donnent un site qui se lit sans rien demander et ne se
modifie que depuis la maison.

**Un appareil, un document.** La collection `appareils` porte un document par appareil,
nommé par son identifiant anonyme Firebase. Les règles n'autorisent l'écriture qu'aux
appareils qui ont le leur, et n'acceptent la création d'un tel document que si la
requête présente le code de la maison.

**Le code ne se lit pas.** Il vit dans `menage/secret`, dont la lecture est refusée à
tout le monde, y compris à vos propres appareils. Seules les règles le consultent, avec
`get()`. Il n'apparaît donc ni dans le site, ni dans la base lisible.

**Le déverrouillage est local, et rien n'est demandé au serveur au chargement.** Un
appareil retient qu'il est de la maison, et cet état suffit à décider de ce qui
s'affiche : les règles décident du reste. Vérifier auprès du serveur à chaque
chargement aurait coûté une lecture Firestore par visite de chaque lecteur, sur un
carnet fait pour être partagé. La vérification existe, mais **à la demande**, par un
bouton de l'écran `#/acces` : elle sert à l'appareil de la maison qui a effacé son
stockage et voudrait éviter de ressaisir le code.

Conséquence assumée : un appareil retiré de la collection continue d'afficher ses
boutons jusqu'à ce qu'il essaie d'écrire, où il reçoit un refus explicite.

**Un refus n'est pas une panne.** La liste de courses est optimiste : elle applique en
local, met en file, et envoie. Un `403` ne se réessaie pas, il est donc **retiré de la
file** au lieu d'y rester : sans cela, un visiteur qui aurait forcé une écriture
traînerait une bannière « hors ligne » perpétuelle sur un appareil parfaitement en
ligne.

## À faire une fois, dans la console Firebase

1. **Poser le code.** Firestore Database → Démarrer une collection `menage` → document
   d'identifiant `secret` → champ `code`, type *string*, valeur : le code de la maison.
   En choisir un long, douze caractères au moins : rien ne limite le nombre de
   tentatives d'inscription, un code court se devinerait à force d'essais.
2. **Publier les règles**, c'est-à-dire le contenu de `firestore.rules`.
3. **Déverrouiller vos appareils** : ouvrir `#/acces` sur chacun, saisir le code. Une
   fois par appareil.

L'ordre compte : publier les règles avant d'avoir posé le code verrouillerait tout le
monde, vous compris, jusqu'à ce que le document existe.

## Ce que voit un visiteur

Tout, sauf les commandes. Les recettes et leurs illustrations, la liste de courses et
le semainier en lecture, la bibliothèque et ses livres, le partage d'une recette par
message, le PDF du menu de la semaine. Une ligne discrète en bas de l'accueil dit
« Carnet en lecture seule », avec un lien vers `#/acces` : sans elle, un appareil de la
maison qui a effacé son stockage croirait à une panne.

Ce qu'il ne voit pas : ajouter ou modifier une recette, importer depuis un site, cocher
la liste de courses, planifier un repas, créer un livre, tenir le placard.

## Limites assumées

- **Le nombre de tentatives n'est pas limité.** Un code long est la seule protection
  contre l'essai systématique. Le changer dans `menage/secret` invalide toute nouvelle
  inscription, sans déloger les appareils déjà inscrits.
- **Effacer les données du site fait perdre l'identité anonyme** de l'appareil, donc son
  inscription : il faut ressaisir le code. C'est le prix d'une authentification sans
  compte.
- **Retirer un appareil se fait dans la console**, en supprimant son document. L'écran
  d'accès ne propose que de verrouiller l'appareil courant : aucun appareil ne doit
  pouvoir en exclure un autre.
- **Les outils en ligne de commande** (`tools/poser-photo.js`,
  `tools/ajouter-recette-au-livre.js`) écrivent avec une session anonyme, comme un
  appareil : ils seront refusés tant que leur identifiant n'est pas inscrit. Le plus
  simple est de leur faire présenter le code une fois, ou d'ajouter leur identifiant
  dans la console.
- **Le quota Firestore reste partagé.** Un lien qui circule consomme les lectures du
  compte gratuit : environ trente par visite, sur 50 000 par jour.

## Corrections du 16 août, après mise en service

**Les cartes de l'accueil étaient déformées.** L'écran de déverrouillage avait été
nommé `.acces`, classe déjà portée depuis toujours par les deux cartes de l'accueil :
elles ont hérité de sa largeur maximale, de son centrage et de ses marges, ce qui les
rétrécissait et les séparait d'un grand vide sur téléphone. L'écran s'appelle
désormais `.ecran-acces`. Le parcours général vérifie maintenant que les deux cartes
ont la même largeur et restent jointives : c'est le genre de régression qu'un écran
large ne montre pas.

**Une lecture Firestore par visite avait été introduite.** La vérification de
l'inscription au chargement coûtait une lecture à chaque ouverture, y compris aux
lecteurs d'un lien partagé. Le test qui surveille l'absence de sondage l'a vue tout de
suite. Elle est désormais à la demande, sur l'écran d'accès.

**Vider la liste est devenu un vrai bouton.** C'était un petit lien discret, à côté de
« Retirer les cochés », donc cliquable par erreur pour une action qui efface le travail
de toute la maisonnée. Il demande maintenant confirmation : premier appui, le bouton
demande « Confirmer : tout vider ? » et l'annonce aux lecteurs d'écran ; second appui
dans les cinq secondes, la liste est vidée. Passé ce délai, il redevient inoffensif.
