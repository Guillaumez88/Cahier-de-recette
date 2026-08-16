# Étape 1 : les comptes

Première des cinq étapes de `docs/COMPTES-2026-08-16.md`. Elle est déployable seule et
ne change rien aux données : on se connecte, et c'est le compte, non l'appareil, qui a
le droit d'écrire.

## Ce qui change

| Avant | Après |
|---|---|
| Un appareil se déverrouille avec le code, une fois par appareil | Une personne se connecte, et son compte s'autorise avec le code, une fois par compte |
| Effacer les données du site fait perdre les droits | La connexion les rend, de n'importe où |
| `appareils/{uid anonyme}` donne le droit d'écrire | `comptes/{uid du compte}` le donne |
| `#/acces` | `#/compte` (`#/acces` reste acceptée) |

La lecture ne change pas : le carnet se lit sans compte, comme la veille.

## Les trois états de l'écran `#/compte`

1. **Personne de connecté** : adresse, mot de passe, « Se connecter » ou « Créer un
   compte », et « Mot de passe oublié » qui déclenche le courriel de réinitialisation.
2. **Connecté, pas encore autorisé** : le code de la maison est demandé. Un compte neuf
   ne peut rien, et l'écran le dit plutôt que de laisser croire à une panne.
3. **Connecté et autorisé** : ce que le compte peut faire, et le bouton de déconnexion.

## Ce que ça coûte en lectures

Une lecture Firestore par chargement, **et seulement pour un compte connecté** : celle
qui vérifie que le compte est toujours autorisé. Un lecteur de passage n'en déclenche
aucune, ce qui est la moitié de l'intérêt d'un carnet qu'on partage.

## Détails d'implémentation qui méritent d'être connus

**Deux sessions, pas une.** La session anonyme reste, pour lire. La session de compte
s'ajoute et, quand elle existe, c'est elle qui signe toutes les requêtes. Se déconnecter
rend donc le carnet lisible, pas inaccessible.

**Le jeton de compte se renouvelle comme l'autre**, avec son jeton de rafraîchissement.
Un renouvellement refusé (mot de passe changé ailleurs, compte supprimé) ferme la
session au lieu de boucler.

**Les messages d'erreur d'Identity Toolkit sont traduits.** `WEAK_PASSWORD` devient
« Mot de passe trop court : six caractères au minimum ». Personne n'a à lire des codes
en majuscules pour faire ses courses.

## Ce qu'il reste à faire, côté console Firebase

**Activer la connexion par e-mail et mot de passe** : Authentication → Sign-in method →
Email/Password → Activer. Sans cela, la création de compte répond
`OPERATION_NOT_ALLOWED`, et l'écran le dit mot pour mot.

Puis republier `firestore.rules` : la collection `comptes` remplace `appareils` comme
source du droit d'écrire. Les documents `appareils` existants ne donnent plus rien, et
la collection reste déclarée en lecture seule le temps de la transition.

**L'ordre compte** : republier avant d'avoir créé son compte et présenté le code
laisserait tout le monde en lecture seule, y compris vous, jusqu'à ce que ce soit fait.
Ce n'est pas grave, mais il vaut mieux le savoir avant de lancer les courses.

## Ce qui n'est pas encore fait

Les foyers, les rôles, l'annuaire et les partages : étapes 2 à 5 de la spécification.
Tant qu'elles ne sont pas là, tous les comptes autorisés voient et modifient les mêmes
données, exactement comme aujourd'hui.
