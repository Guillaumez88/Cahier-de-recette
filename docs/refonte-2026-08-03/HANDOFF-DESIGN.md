# Handoff : Refonte UX — Mon carnet de recettes

## Aperçu
Refonte de l'écran d'accueil (semainier), de la liste de courses, du livre de cuisine, de la fiche recette et de l'éditeur, pour l'appli familiale « Cahier de recette » (dépôt : https://github.com/Guillaumez88/Cahier-de-recette). Système visuel : **Organic** (crème/terracotta/sauge, Caprasimo + Figtree, formes très arrondies).

## À propos des fichiers de design
`design-final.html` est une **référence de design en HTML** — un prototype qui montre l'apparence et le comportement visés, ce n'est pas du code à copier tel quel (il inclut un petit moteur de rendu de prototypage et un lien vers un design system qui n'ont pas leur place dans le dépôt cible). Le travail attendu : **recréer ces designs dans l'environnement existant du dépôt**, en respectant ses contraintes techniques réelles ci-dessous — elles priment sur tout ce que le prototype utilise pour aller vite (police Google, bundle CSS externe, etc.). Ouvrez `design-final.html` dans un navigateur pour l'aperçu (fichiers `support.js` et `_ds/` fournis à côté, nécessaires seulement à l'affichage du prototype).

### Contraintes techniques du dépôt cible (non négociables)
- Aucune dépendance, aucune étape de build : HTML/CSS/JS écrits à la main, servis tels quels.
- Aucune ressource externe : pas de CDN, pas de Google Fonts, pas de bibliothèque d'icônes. Remplacer Caprasimo/Figtree par les polices système déjà utilisées dans le dépôt (une serif système + une sans-serif système), et les icônes Lucide du prototype par les pictogrammes SVG maison du dépôt (grille 24, épaisseur 1,7, sans remplissage) — dessiner les manquants sur ce modèle.
- Rendu par création de nœuds DOM (pas de gabarits de chaînes, pas de JSX).
- Site statique sur GitHub Pages, navigation par ancre (`#/...`).
- Fonctionnement hors ligne obligatoire ; état de synchronisation toujours visible.
- Documents Firestore ≤ 1 Mio ; photos réduites à 320 px / 1200 px, jamais de pleine résolution.
- Fiche recette imprimable proprement en noir sur blanc.
- Accessibilité : navigation clavier complète, cibles tactiles ≥ 44 px, tout glisser-déposer doublé d'un équivalent sans glissement (déjà prévu dans le design : clic sur une case vide).

## Fidélité
**Haute fidélité** pour la mise en page, la hiérarchie, les états et les interactions. Les couleurs/polices exactes du prototype (Organic) sont une direction de référence à adapter aux contraintes ci-dessus (polices système, pas de dégradés/ombres coûteux) — mais l'esprit chaleureux, les rayons très arrondis et la palette crème/terracotta/sauge doivent être conservés.

## Écrans

### 1. Accueil — le semainier
- **But** : voir et décider les repas de la semaine ; retrouver le repas du jour en priorité sur mobile.
- **Layout web** : en-tête (marque + boutons Le livre / Liste de courses), pastille de partage compacte (détail au clic : nb de personnes, heure de dernière synchro, bouton Rafraîchir), réserve de plats filtrable (texte seul, sans photo) glissable sur ordinateur, grille 7 jours × 3 créneaux (Matin/Midi/Soir) pour la semaine en cours, semaine suivante repliée par défaut (bandeau « rien de prévu » + bouton Déplier).
- **Layout mobile** : barre compacte (icônes Livre/Liste), pastille de partage, bloc « Aujourd'hui » en grand (3 lignes avec icône crayon 44×44 px pour modifier), bande de 7 jours (pilules), semaine suivante repliée.
- **Case de créneau** : vide → bordure pointillée + icône « + » (ouvre le choix de plat) ; remplie → fond teinté accent clair, titre, icônes crayon/corbeille au survol/focus, clic sur la case ouvre la fiche.
- **Comportement** : glisser un plat de la réserve (ordinateur) OU cliquer une case vide (tous appareils) ouvre la même boîte de choix — carnet cherchable + 5 raccourcis hors-carnet (Restaurant, Pizzas, Japonais, Restes, Chacun pour soi) + champ libre.

### 2. Liste de courses commune
- **But** : cocher les articles en magasin, une main occupée.
- **Layout** : bandeau de synchronisation avec Rafraîchir, formulaire d'ajout libre (nom + quantité), compteur de lignes, sections par rayon (ordre du magasin). À l'intérieur d'un rayon, les lignes qui partagent le même mot de tête (« Beurre », « Farine », « Sucre »…) sont regroupées dans une pastille teintée avec un en-tête « N lignes proches » — **chaque ligne reste distincte et cochable séparément, aucune fusion de données**.
- **Cibles** : cases à cocher ≥ 44 px sur mobile, fonctionnent hors ligne.
- **État vide** : icône + « Rien à acheter pour l'instant » + rappel du formulaire d'ajout.

### 3. Le livre de cuisine
- **But** : trouver une recette par recherche ou filtre.
- **Layout** : recherche, filtres en pilules (catégorie/origine/difficulté/temps), compteur + « Tout effacer », grille de cartes.
- **Carte** : pastille de catégorie colorée (Plat = terracotta, Entrée = sauge, Dessert = contour), titre (doit rester lisible avec un titre de 54 caractères — voir « Mini cakes de courgettes au fromage et tomates confites »), méta courte (origine · difficulté · personnes, puis ingrédients · temps). Pas de photo obligatoire : la carte doit être belle en texte seul.
- **État recherche vide** : message + bouton « Effacer les filtres ».

### 4. La fiche recette
- **But** : consulter (contexte) ou cuisiner (exécution) une recette — deux usages distincts, résolu par un sélecteur **Consulter / Cuisiner** (contrôle segmenté).
- **Mode Consulter** (repère web) : étiquettes, titre, actions principales, Ingrédients et Préparation toujours visibles en premier ; le reste (Origine, Astuces, Variantes, Recettes associées, Ce que la source ne donne pas, Source) est replié sous « Pour aller plus loin » — visible en un clic, jamais supprimé.
- **Mode Cuisiner** (repère mobile) : une étape à la fois, gros caractères (~19 px, lisible à 60 cm), astuce de l'étape en évidence, navigation Précédente/Suivante, barre de progression, lien pour revoir tous les ingrédients. Il faut pouvoir retrouver l'étape en cours après avoir reposé l'appareil (mémoriser l'étape courante, ex. `localStorage`).
- **Ne jamais casser** : mentions « ce que la source ne donne pas » toujours affichées ; aucune quantité inventée ou convertie ; les durées/températures ne changent jamais avec le nombre de parts ; la source et son lien sont toujours cités.

### 5. L'éditeur de recette
- **But** : corriger un seul champ à la fois, pas remplir un formulaire du début.
- **Layout** : barre du haut fixe (Annuler / titre / Enregistrer), raccourcis en pilules vers les sections (Photo, Parts, Fiche, Temps, Ingrédients, Instructions), sections en accordéon — une seule ouverte à la fois, les autres réduites à un résumé d'une ligne.
- **Nombre de parts** : +/- et champ numérique, recalcul proportionnel des quantités, rapport affiché avant d'enregistrer (« Facteur 2 — 6 quantités ajustées dans les instructions. Les durées et températures ne changent jamais »).
- **Échec d'enregistrement** : l'éditeur doit rester ouvert et afficher l'erreur, jamais laisser croire que c'est enregistré.

## Interactions & comportements clés
- Clic sur une case de créneau déjà remplie → ouvre la fiche ; icône crayon dédiée (séparée) → modifier/retirer.
- Glisser-déposer (ordinateur) toujours doublé d'un clic (tous appareils) pour le même résultat.
- Pastille de partage : repos = compact (« Partagé · HH:MM ») ; clic = détail (nb de personnes, bouton Rafraîchir).
- Semaine suivante : repliée par défaut si vide ; un clic la déplie.
- Recherche/filtres : mise à jour du compteur de résultats, état vide dédié.
- Étapes de la fiche (mode Cuisiner) : navigation par boutons uniquement (pas de swipe requis), état courant persistant.

## États à couvrir
Hors ligne / quota Firestore épuisé (à distinguer : pas de réseau, service indisponible, configuration incorrecte — voir brief section 9.4), liste ou recherche vide, créneau vide, recette sans photo, titre de recette très long, échec d'enregistrement dans l'éditeur.

## Design tokens (système Organic, à adapter aux polices/icônes système)
- Fond : #f5ead8 · Surface : #ebddc5 · Texte : #201e1d
- Accent (terracotta) : #c67139, rampe 100→900 de #fff2eb à #402310
- Accent 2 (sauge) : #7a8a5e, rampe 100→900 de #f0fae1 à #272e1b
- Titres : Caprasimo (→ remplacer par la serif système du dépôt) ; corps : Figtree (→ sans-serif système)
- Rayons : 8 / 16 / 28 px, boutons et champs en pilule (999px)
- Ombres : sm/md/lg déjà tunées, à recréer en CSS simple (pas de dépendance externe)
- Espacements : échelle ×1,10 à partir de ~4,4 px

## Assets
Aucune image bitmap utilisée — tout est en HTML/CSS/SVG. Les icônes du prototype sont des Lucide (stroke-width 2,75) ; à remplacer par le jeu de pictogrammes SVG existant du dépôt (26 dessins, grille 24, épaisseur 1,7, sans remplissage), en dessinant les manquants dans le même style.

## Fichiers du bundle
- `design-final.html` (+ `support.js`, `_ds/`) — les 5 écrans, version web (1280 px) et mobile (390 px), avec les états notables listés ci-dessus. Ouvrir `design-final.html` dans un navigateur pour l'aperçu ; ces fichiers de support ne font pas partie du livrable de code.
- `BRIEFUX20260803.md` — le brief UX d'origine (contexte produit complet, modèle de données, contraintes, problèmes constatés avec leurs preuves).
