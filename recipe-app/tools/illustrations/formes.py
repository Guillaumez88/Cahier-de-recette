"""Les formes du style « trois quarts » : cinq primitives, une palette, aucun filtre.

Le style a été arrêté sur les lasagnes : un volume vu de trois quarts, deux tons par
face (éclairée, à l'ombre), posé sur une assiette dont l'aile reste visible devant, et
une tache ronde derrière le sujet, teintée selon la catégorie de la recette.

Cinq primitives suffisent aux 24 recettes :

| Primitive | Ce qu'elle dessine | Exemples |
|---|---|---|
| `part_en_couches` | un bloc rectangulaire dont la tranche montre les couches | lasagnes, tiramisu, brownie |
| `tranche_de_tarte` | une part triangulaire à croûte, pointe vers l'avant | tarte au citron, flan, galette |
| `bol` | un bol vu de trois quarts, contenu bombé | tapenade, poke bowl, fondue |
| `pieces_sur_assiette` | plusieurs petites pièces posées | gougères, mini-cakes, couscous |
| `gateau_rond` | un cylindre : gâteau ou brioche entière | tropézienne, focaccia, carrot cake |

Elles partagent le décor de `style.py` : mêmes ombres, même assiette, même lumière
venant de la gauche. C'est cette contrainte, et non un réglage par recette, qui fait
tenir les vingt-quatre images ensemble.
"""
from style import (L, H, FOND, SURFACE, CREUX, ACCENT_100, ACCENT_200, NEUTRE_300,
                   NEUTRE_400, ENCRE, sombre, clair, entete, pied, ombre_portee,
                   assiette, feuille_basilic, graines)

# Teinte du fond par catégorie : les listes mélangent les trois, un plat et un dessert
# ne doivent pas se confondre au coup d'œil.
TACHE = {'Plat': '#ffe1d0', 'Entrée': '#e1eecc', 'Dessert': '#fdeedd'}

# Fuite commune à tous les volumes : la profondeur se lit toujours pareil.
DX, DY = 62, -58


def _face_droite(x, y_bas, couleurs, dx=DX, dy=DY):
    """La face à l'ombre d'un empilement, du bas vers le haut."""
    out, y = [], y_bas
    for couleur, hauteur in couleurs:
        out.append(
            f'<path d="M{x} {y} L{x + dx} {y + dy} L{x + dx} {y + dy - hauteur} '
            f'L{x} {y - hauteur} Z" fill="{sombre(couleur, 0.78)}"/>'
        )
        y -= hauteur
    return ''.join(out)


def part_en_couches(couches, dessus, garniture='', largeur=300, cx=450, bas=444,
                    cloques=True, coulee=None):
    """Un bloc posé sur l'assiette, dont la tranche montre les couches.

    `couches` va du bas vers le haut : [(couleur, hauteur), …]. `dessus` est la couleur
    de la surface, celle qu'on voit en fuite.
    """
    xg, xd = cx - largeur // 2, cx + largeur // 2
    haut = bas - sum(h for _, h in couches)
    s = [assiette(cx, bas + 12, 250, 92)]
    s.append(_face_droite(xd, bas, couches))
    y = bas
    for couleur, hauteur in couches:
        s.append(f'<rect x="{xg}" y="{y - hauteur}" width="{xd - xg}" height="{hauteur}" fill="{couleur}"/>')
        y -= hauteur
    s.append(f'<path d="M{xg} {haut} L{xd} {haut} L{xd + DX} {haut + DY} L{xg + DX} {haut + DY} Z" '
             f'fill="{dessus}"/>')
    if cloques:
        for i, (px, py, r) in enumerate(((0.24, 0.6, 26), (0.5, 0.35, 20), (0.74, 0.62, 23), (0.9, 0.3, 16))):
            x = xg + (xd - xg) * px + DX * py
            yy = haut + DY * py
            s.append(f'<ellipse cx="{x:.0f}" cy="{yy:.0f}" rx="{r}" ry="{r * 0.6:.0f}" '
                     f'fill="{clair(dessus, 0.28)}"/>')
    if coulee:
        x0 = xg + 34
        s.append(f'<path d="M{x0} {haut} C {x0 + 8} {haut + 30}, {x0 - 6} {haut + 46}, {x0 + 4} {haut + 70} '
                 f'C {x0 + 14} {haut + 84}, {x0 + 30} {haut + 78}, {x0 + 30} {haut + 62} '
                 f'C {x0 + 30} {haut + 40}, {x0 + 26} {haut + 22}, {x0 + 28} {haut} Z" fill="{coulee}"/>')
    s.append(garniture)
    return ''.join(s)


def tranche_de_tarte(fond, garniture_couleur, garniture='', cx=450, bas=430, croute='#e3b877'):
    """Une part de tarte, pointe vers l'avant, croûte visible sur l'arc arrière."""
    haut_pate = 46
    s = [assiette(cx, bas + 16, 250, 92)]
    pointe = (cx - 20, bas)
    g = (cx - 210, bas - 150)
    d = (cx + 190, bas - 120)
    # Tranche de pâte : la face avant gauche et la face avant droite
    s.append(f'<path d="M{pointe[0]} {pointe[1]} L{g[0]} {g[1]} L{g[0]} {g[1] + haut_pate} '
             f'L{pointe[0]} {pointe[1] + haut_pate} Z" fill="{sombre(croute, 0.82)}"/>')
    s.append(f'<path d="M{pointe[0]} {pointe[1]} L{d[0]} {d[1]} L{d[0]} {d[1] + haut_pate} '
             f'L{pointe[0]} {pointe[1] + haut_pate} Z" fill="{sombre(croute, 0.7)}"/>')
    # Dessus : le triangle bombé de la garniture
    s.append(f'<path d="M{pointe[0]} {pointe[1]} L{g[0]} {g[1]} '
             f'Q {cx} {bas - 210}, {d[0]} {d[1]} Z" fill="{garniture_couleur}"/>')
    # Le bord de croûte, le long de l'arc
    s.append(f'<path d="M{g[0]} {g[1]} Q {cx} {bas - 210}, {d[0]} {d[1]} '
             f'Q {cx} {bas - 178}, {g[0] + 16} {g[1] + 14} Z" fill="{croute}"/>')
    s.append(f'<path d="M{pointe[0]} {pointe[1]} L{g[0]} {g[1]} '
             f'Q {cx} {bas - 210}, {d[0]} {d[1]} Z" fill="{clair(garniture_couleur, 0.16)}" opacity="0.5"/>')
    s.append(garniture)
    return ''.join(s)


def bol(interieur, contenu='', couleur_bol='#f1e7d6', cx=450, cy=350, rx=210, ry=72,
        derriere='', profondeur=150):
    """Un bol de trois quarts : la panse, le pied, le bord, puis le contenu.

    La panse est une seule silhouette, et l'ombre du côté droit une ellipse translucide
    posée par-dessus : une deuxième forme découpée donnait un bol à deux bosses.
    `derriere` sert à ce qui dépasse du bol (bâtonnets, piques), dessiné avant lui.
    """
    bas = cy + profondeur
    s = [ombre_portee(cx + 10, bas + 18, rx * 0.86, 26), derriere]
    s.append(f'<path d="M{cx - rx} {cy} C {cx - rx + 6} {bas}, {cx + rx - 6} {bas}, {cx + rx} {cy} '
             f'A {rx} {ry} 0 0 1 {cx - rx} {cy} Z" fill="{couleur_bol}"/>')
    s.append(f'<ellipse cx="{cx + rx * 0.46:.0f}" cy="{cy + profondeur * 0.42:.0f}" '
             f'rx="{rx * 0.46:.0f}" ry="{profondeur * 0.40:.0f}" fill="{ENCRE}" opacity="0.07"/>')
    # Bord : l'anneau du dessus, puis le creux
    s.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{clair(couleur_bol, 0.22)}"/>')
    s.append(f'<ellipse cx="{cx}" cy="{cy + 6}" rx="{rx - 18}" ry="{ry - 13}" fill="{sombre(interieur, 0.86)}"/>')
    s.append(f'<ellipse cx="{cx}" cy="{cy + 2}" rx="{rx - 22}" ry="{ry - 17}" fill="{interieur}"/>')
    s.append(contenu)
    return ''.join(s)


def pieces_sur_assiette(pieces, cx=450, cy=380):
    """Des petites pièces posées : chacune est un dôme à deux tons.

    `pieces` = [(dx, dy, r, couleur), …], décalages relatifs au centre de l'assiette.
    """
    s = [assiette(cx, cy + 30, 250, 92)]
    for dx, dy, r, couleur in sorted(pieces, key=lambda p: p[1]):
        x, y = cx + dx, cy + dy
        s.append(f'<ellipse cx="{x}" cy="{y + r * 0.34:.0f}" rx="{r}" ry="{r * 0.62:.0f}" '
                 f'fill="{sombre(couleur, 0.78)}"/>')
        s.append(f'<ellipse cx="{x}" cy="{y}" rx="{r}" ry="{r * 0.72:.0f}" fill="{couleur}"/>')
        s.append(f'<ellipse cx="{x - r * 0.24:.0f}" cy="{y - r * 0.26:.0f}" rx="{r * 0.42:.0f}" '
                 f'ry="{r * 0.28:.0f}" fill="{clair(couleur, 0.3)}"/>')
    return ''.join(s)


def gateau_rond(couches, dessus, garniture='', cx=450, bas=430, rx=200, ry=62, part=False):
    """Un cylindre : gâteau, brioche ou galette entière, éventuellement entamé."""
    hauteur = sum(h for _, h in couches)
    haut = bas - hauteur
    s = [assiette(cx, bas + 18, 252, 92)]
    # Flanc : chaque couche est une bande, refermée par l'arc du bas
    y = haut
    for couleur, h in couches:
        s.append(f'<path d="M{cx - rx} {y} L{cx - rx} {y + h} '
                 f'A {rx} {ry} 0 0 0 {cx + rx} {y + h} L{cx + rx} {y} Z" fill="{couleur}"/>')
        s.append(f'<path d="M{cx + rx * 0.2:.0f} {y} L{cx + rx * 0.2:.0f} {y + h} '
                 f'A {rx} {ry} 0 0 0 {cx + rx} {y + h} L{cx + rx} {y} Z" '
                 f'fill="{sombre(couleur, 0.88)}"/>')
        y += h
    s.append(f'<ellipse cx="{cx}" cy="{haut}" rx="{rx}" ry="{ry}" fill="{dessus}"/>')
    if part:
        # Une part prélevée : un secteur creusé qui montre l'intérieur
        s.append(f'<path d="M{cx} {haut} L{cx - 6} {haut - ry} A {rx} {ry} 0 0 1 {cx + rx * 0.62:.0f} '
                 f'{haut - ry * 0.62:.0f} Z" fill="{sombre(dessus, 0.6)}"/>')
    s.append(garniture)
    return ''.join(s)


def scene(categorie, contenu, echelle=1.16):
    """Le décor, puis le sujet agrandi autour du centre optique.

    L'agrandissement est fait ici, une fois, plutôt que dans chaque recette : les
    vignettes des listes sont carrées et rognent les côtés, un sujet dessiné « à
    l'échelle du cadre » s'y retrouvait minuscule.
    """
    return (entete(TACHE.get(categorie, ACCENT_200))
            + f'<g transform="translate(450,320) scale({echelle}) translate(-450,-320)">'
            + contenu + '</g>' + pied())
