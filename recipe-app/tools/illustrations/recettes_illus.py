"""Les 24 illustrations, une entrée par recette sans photo.

Chaque recette dit ce qu'elle est (quelle primitive, quelles couleurs), jamais comment
la dessiner : la mise en scène, les ombres et la lumière viennent de `formes.py`. C'est
ce qui garantit que les vingt-quatre tiennent ensemble dans une liste.

Les couleurs sont choisies sur ce que la recette contient vraiment : la tapenade est
noire parce qu'elle est aux olives noires, le gratin est violet et vert parce qu'il est
aux aubergines et aux courgettes. Rien n'est décoratif.
"""
from formes import (part_en_couches, tranche_de_tarte, bol, pieces_sur_assiette,
                    gateau_rond, scene, DX, DY)
from style import (sombre, clair, feuille_basilic, graines, assiette, ombre_portee,
                   SURFACE, CREUX, ENCRE)

# --- Palette des aliments ------------------------------------------------------
PATE = '#f0c98a'
RAGU = '#b8452f'
BECHAMEL = '#f9ecd2'
FROMAGE = '#efb35c'
SAUMON = '#e8917a'
COURGETTE = '#9ab873'
AUBERGINE = '#6b4a72'
TOMATE = '#c0472f'
BISCUIT = '#c98a4b'
MASCARPONE = '#f6ecd8'
CACAO = '#6b4630'
CHOCOLAT = '#4a2c20'
CITRON = '#f5cf4d'
MERINGUE = '#fdf6e6'
CROUTE = '#e3b877'
FLAN = '#f3d98e'
CARAMEL = '#d99a4e'
CAROTTE = '#e08a3c'
GLACAGE = '#fbf3e4'
SPECULOOS = '#b5763f'
CHEESE = '#f7e9cf'
ABRICOT = '#efa14c'
AMANDE = '#e8d3a8'
OLIVE_NOIRE = '#3f3a33'
OLIVE_VERTE = '#8d9448'
ANCHOIS = '#8a6a4f'
PAIN = '#e8c489'
COMTE = '#e9c96a'
SEMOULE = '#f0dba8'
MERGUEZ = '#a53c2c'
POULET = '#e6c68d'
RIZ = '#f7f1e2'
SAUMON_CRU = '#f08a6a'
AVOCAT = '#8bb46a'
EDAMAME = '#7fa855'
CHOU_ROUGE = '#8c4a72'
BRIOCHE = '#e9b96a'
CREME = '#fbf0d8'
SUCRE = '#fdfaf2'
FONDUE = '#f2d99a'
ROMARIN = '#6f8f4a'


def lasagnes():
    garn = feuille_basilic(432, 236, 0.78, -12) + feuille_basilic(486, 250, 0.6, 18)
    return part_en_couches(
        [(PATE, 22), (RAGU, 26), (BECHAMEL, 16), (PATE, 22), (RAGU, 26), (BECHAMEL, 14)],
        FROMAGE, garn, coulee=sombre(RAGU, 1.05))


def lasagnes_saumon():
    garn = feuille_basilic(438, 240, 0.62, -18) + feuille_basilic(492, 250, 0.5, 16)
    return part_en_couches(
        [(PATE, 22), (SAUMON, 24), (COURGETTE, 18), (BECHAMEL, 18), (PATE, 22), (SAUMON, 20)],
        '#f6dfae', garn)


def gratin():
    garn = feuille_basilic(430, 242, 0.7, -10)
    return part_en_couches(
        [(COURGETTE, 22), (AUBERGINE, 24), (TOMATE, 20), (COURGETTE, 22), (AUBERGINE, 22)],
        FROMAGE, garn, coulee=TOMATE)


def cake_olives():
    """Le cake entamé, et sa tranche couchée devant : les olives se voient en coupe."""
    mie, croute_cake = '#f3dca6', '#dfb877'
    bas = 442
    s = [assiette(450, bas + 12, 250, 92)]
    # Le pain de cake, en retrait, entamé sur la gauche
    xg, xd, haut = 356, 640, bas - 118
    s.append(f'<path d="M{xd} {bas} L{xd + DX} {bas + DY} L{xd + DX} {haut + DY} L{xd} {haut} Z" '
             f'fill="{sombre(croute_cake, 0.78)}"/>')
    s.append(f'<rect x="{xg}" y="{haut}" width="{xd - xg}" height="{bas - haut}" rx="10" fill="{mie}"/>')
    s.append(f'<rect x="{xg}" y="{haut}" width="{xd - xg}" height="26" rx="10" fill="{croute_cake}"/>')
    s.append(f'<path d="M{xg} {haut} L{xd} {haut} L{xd + DX} {haut + DY} L{xg + DX} {haut + DY} Z" '
             f'fill="{clair(croute_cake, 0.16)}"/>')
    s.append(graines([(400, 384), (452, 410), (508, 378), (566, 404), (610, 372)], OLIVE_NOIRE, 10))
    s.append(graines([(430, 356), (540, 350)], OLIVE_VERTE, 9))
    # La tranche, couchée devant, face coupée vers nous
    s.append(f'<path d="M236 {bas} L236 {bas - 118} L344 {bas - 118} L344 {bas} Z" fill="{mie}"/>')
    s.append(f'<rect x="236" y="{bas - 118}" width="108" height="24" rx="8" fill="{croute_cake}"/>')
    s.append(f'<path d="M344 {bas - 118} L{344 + 26} {bas - 118 - 24} L{344 + 26} {bas - 24} L344 {bas} Z" '
             f'fill="{sombre(mie, 0.84)}"/>')
    s.append(graines([(268, 374), (312, 400), (286, 420)], OLIVE_NOIRE, 9))
    s.append(graines([(310, 366)], OLIVE_VERTE, 8))
    return ''.join(s)


def _batonnet(x, y, h, couleur, angle):
    """Un bâtonnet de légume planté dans un bol, pointe en bas."""
    return (f'<g transform="translate({x},{y}) rotate({angle})">'
            f'<rect x="0" y="0" width="20" height="{h}" rx="9" fill="{couleur}"/>'
            f'<rect x="4" y="6" width="7" height="{h - 24}" rx="4" fill="{clair(couleur, 0.3)}"/></g>')


def anchoiade():
    contenu = (f'<ellipse cx="450" cy="352" rx="178" ry="52" fill="{ANCHOIS}"/>'
               f'<ellipse cx="408" cy="342" rx="84" ry="22" fill="{clair(ANCHOIS, 0.22)}"/>')
    batons = (_batonnet(486, 208, 150, CAROTTE, 10) + _batonnet(524, 226, 136, CAROTTE, 20)
              + _batonnet(386, 214, 146, COURGETTE, -12) + _batonnet(348, 236, 128, COURGETTE, -22))
    return bol(sombre(ANCHOIS, 0.9), contenu, couleur_bol='#cf9f6e', derriere=batons)


def tapenade():
    contenu = (f'<ellipse cx="450" cy="352" rx="178" ry="52" fill="{OLIVE_NOIRE}"/>'
               f'<ellipse cx="410" cy="342" rx="80" ry="22" fill="{clair(OLIVE_NOIRE, 0.2)}"/>'
               + graines([(400, 340), (476, 352), (508, 336)], OLIVE_VERTE, 8)
               + feuille_basilic(492, 312, 0.5, -22))
    # Deux tartines posées devant le bol, décalées : elles se lisent comme des tranches,
    # pas comme des anses. Dessinées après le bol, donc devant.
    tartine = ('<g transform="translate(268,436) rotate(-5)">'
               f'<rect x="0" y="14" width="300" height="44" rx="20" fill="{sombre(PAIN, 0.78)}"/>'
               f'<rect x="0" y="0" width="300" height="44" rx="20" fill="{PAIN}"/>'
               f'<rect x="18" y="5" width="264" height="24" rx="12" fill="{OLIVE_NOIRE}"/></g>')
    olives = ''.join(
        f'<ellipse cx="{x}" cy="{y + 6}" rx="20" ry="14" fill="{sombre(OLIVE_NOIRE, 0.7)}"/>'
        f'<ellipse cx="{x}" cy="{y}" rx="20" ry="16" fill="{OLIVE_NOIRE}"/>'
        f'<ellipse cx="{x - 6}" cy="{y - 5}" rx="7" ry="5" fill="{clair(OLIVE_NOIRE, 0.35)}"/>'
        for x, y in ((648, 438), (690, 458))
    )
    return bol(sombre(OLIVE_NOIRE, 0.8), contenu, couleur_bol='#cf9f6e') + tartine + olives


def fondue():
    """Le caquelon, sa fondue, et deux piques de pain plantées dedans."""
    contenu = (f'<ellipse cx="450" cy="352" rx="180" ry="52" fill="{FONDUE}"/>'
               f'<ellipse cx="404" cy="340" rx="86" ry="24" fill="{clair(FONDUE, 0.3)}"/>')
    piques = ''.join(
        f'<g transform="translate({x},{y}) rotate({a})">'
        f'<rect x="0" y="0" width="10" height="176" rx="5" fill="#b4926a"/>'
        f'<rect x="-22" y="-34" width="54" height="48" rx="12" fill="{PAIN}"/>'
        f'<rect x="-22" y="-34" width="54" height="16" rx="8" fill="{clair(PAIN, 0.28)}"/></g>'
        for x, y, a in ((376, 196, -14), (520, 208, 13))
    )
    return bol(sombre(FONDUE, 0.88), contenu, couleur_bol='#d98f56', derriere=piques)


def tarte_citron():
    # Trois pointes de meringue, plutôt qu'un nuage blanc : la meringue d'une tarte au
    # citron se lit à ses vagues.
    garn = ''.join(
        f'<path d="M{x} {y} C {x + 6} {y - 34}, {x + 34} {y - 34}, {x + 40} {y} Z" fill="{MERINGUE}"/>'
        f'<path d="M{x + 6} {y - 4} C {x + 12} {y - 26}, {x + 22} {y - 26}, {x + 26} {y - 6} Z" '
        f'fill="{sombre(MERINGUE, 0.94)}"/>'
        for x, y in ((336, 300), (392, 286), (448, 292))
    )
    return tranche_de_tarte(CROUTE, CITRON, garn)


def tarte_abricots():
    garn = ''.join(
        f'<ellipse cx="{x}" cy="{y}" rx="{r}" ry="{r * 0.78:.0f}" fill="{ABRICOT}"/>'
        f'<ellipse cx="{x - r * 0.2:.0f}" cy="{y - r * 0.2:.0f}" rx="{r * 0.5:.0f}" '
        f'ry="{r * 0.36:.0f}" fill="{clair(ABRICOT, 0.3)}"/>'
        for x, y, r in ((380, 300, 32), (462, 278, 28), (520, 306, 24))
    ) + graines([(410, 330), (492, 320), (350, 322)], AMANDE, 7)
    return tranche_de_tarte(CROUTE, '#f2c98a', garn)


def flan():
    """Le flan pâtissier : la pâte se voit sur toute la tranche, c'est ce qui le
    distingue de la version sans pâte."""
    pate = (f'<path d="M430 430 L240 280 L240 300 L430 450 Z" fill="{sombre(CROUTE, 0.7)}"/>')
    dessus = (f'<ellipse cx="428" cy="286" rx="92" ry="26" fill="{sombre(FLAN, 0.9)}"/>'
              f'<ellipse cx="410" cy="282" rx="52" ry="15" fill="{clair(FLAN, 0.26)}"/>')
    return tranche_de_tarte(CROUTE, FLAN, pate + dessus, croute='#d9a463')


def flan_sans_pate():
    """Sans pâte : pas de croûte, un flanc lisse et un dessus plus caramélisé."""
    dessus = (f'<ellipse cx="428" cy="288" rx="96" ry="28" fill="{CARAMEL}" opacity="0.55"/>'
              f'<ellipse cx="408" cy="282" rx="54" ry="16" fill="{clair(FLAN, 0.3)}"/>')
    return tranche_de_tarte('#eccb84', FLAN, dessus, croute='#eccb84')


def galette():
    """La galette entière : épaisse, dorée, rayée en rosace, avec sa fève."""
    # Le dessus est posé à `bas - hauteur`, soit 370 : la rosace se dessine autour.
    disque = f'<ellipse cx="450" cy="370" rx="182" ry="58" fill="{clair("#eec48a", 0.14)}"/>'
    rayures = ''.join(
        f'<path d="M450 {370 + dy} Q {450 + o // 2} {352 + dy}, {450 + o} {374 + dy}" '
        f'stroke="{sombre("#eec48a", 0.84)}" stroke-width="5" fill="none" stroke-linecap="round"/>'
        for o, dy in ((170, 8), (-170, 8), (120, -14), (-120, -14), (60, -28), (-60, -28))
    )
    feve = f'<circle cx="450" cy="366" r="9" fill="{sombre("#eec48a", 0.7)}"/>'
    return gateau_rond([('#e2ab6c', 72)], '#eec48a', disque + rayures + feve, rx=208, ry=68, bas=442)


def tiramisu():
    garn = graines([(400, 250), (470, 240), (520, 258), (436, 236)], CACAO, 8)
    return part_en_couches(
        [(BISCUIT, 24), (MASCARPONE, 28), (BISCUIT, 24), (MASCARPONE, 30)],
        CACAO, garn, cloques=False)


def carrot_cake():
    """Deux étages orangés, le glaçage bien blanc, une carotte en pâte d'amande dessus."""
    carotte = ('<g transform="translate(452,236) rotate(12)">'
               f'<path d="M0 0 L26 0 L14 74 Z" fill="{CAROTTE}"/>'
               f'<path d="M4 8 L20 8 L16 34 L8 34 Z" fill="{clair(CAROTTE, 0.28)}"/>'
               '</g>' + feuille_basilic(448, 230, 0.42, -78) + feuille_basilic(462, 232, 0.36, -46))
    eclats = graines([(372, 250), (516, 252), (556, 262)], CAROTTE, 7)
    return part_en_couches(
        [('#cf8a44', 38), (GLACAGE, 18), ('#cf8a44', 38), (GLACAGE, 22)],
        GLACAGE, carotte + eclats, cloques=False)


def cheesecake():
    """Le socle de spéculoos, bien plus foncé que l'appareil : c'est ce contraste qui
    fait reconnaître un cheesecake plutôt qu'un simple carré de fromage blanc."""
    garn = graines([(398, 244), (462, 234), (516, 250), (430, 258)], sombre(SPECULOOS, 0.8), 9)
    return part_en_couches(
        [(sombre(SPECULOOS, 0.86), 38), (CHEESE, 70)], clair(CHEESE, 0.22), garn, cloques=False)


def brownie():
    garn = graines([(404, 252), (466, 240), (520, 256), (438, 264)], '#2f1c14', 8)
    return part_en_couches([(CHOCOLAT, 34), ('#5a3626', 30)], '#3b2318', garn,
                           largeur=250, cloques=False)


def brookies():
    """Moitié brownie, moitié cookie : la tranche le dit, le dessus aussi."""
    s = part_en_couches([(CHOCOLAT, 32), ('#e0b070', 30)], '#d9a561', '', largeur=260,
                        cloques=False)
    # La moitié chocolat du dessus, en fuite
    xg, xd, haut = 320, 450, 444 - 62
    s += (f'<path d="M{xg} {haut} L{xd} {haut} L{xd + DX} {haut + DY} L{xg + DX} {haut + DY} Z" '
          f'fill="{CHOCOLAT}"/>')
    s += graines([(500, 252), (546, 262), (520, 240)], '#4a2c20', 8)
    return s


def gougeres():
    return pieces_sur_assiette([
        (-110, 6, 42, COMTE), (-16, -22, 46, clair(COMTE, 0.12)), (84, 2, 44, COMTE),
        (-62, 46, 40, clair(COMTE, 0.08)), (44, 52, 38, COMTE),
    ])


def mini_cakes():
    """Des petits cakes : des blocs, pas des dômes, avec leur caissette."""
    s = [assiette(450, 420, 250, 92)]
    for x, y, l, h in ((326, 372, 108, 62), (452, 352, 108, 62), (572, 380, 104, 60)):
        s.append(f'<path d="M{x + l} {y + h} L{x + l + 38} {y + h - 34} L{x + l + 38} {y - 34} '
                 f'L{x + l} {y} Z" fill="{sombre("#efd79e", 0.78)}"/>')
        s.append(f'<rect x="{x}" y="{y}" width="{l}" height="{h}" rx="6" fill="#efd79e"/>')
        s.append(f'<path d="M{x} {y} L{x + l} {y} L{x + l + 38} {y - 34} L{x + 38} {y - 34} Z" '
                 f'fill="{clair("#efd79e", 0.22)}"/>')
        s.append(f'<rect x="{x}" y="{y + h - 22}" width="{l}" height="22" rx="4" fill="{sombre(COURGETTE, 1.0)}" '
                 f'opacity="0.35"/>')
        s.append(graines([(x + 26, y + 24), (x + 74, y + 40)], TOMATE, 8))
    return ''.join(s)


def focaccia():
    """Une focaccia entière, épaisse, avec ses creux et son romarin."""
    creux = ''.join(f'<ellipse cx="{x}" cy="{y}" rx="13" ry="9" fill="{sombre("#f0cf95", 0.86)}"/>'
                    for x, y in ((372, 356), (430, 338), (492, 352), (546, 336),
                                 (400, 380), (466, 376), (520, 384)))
    romarin = feuille_basilic(408, 330, 0.45, -22) + feuille_basilic(496, 322, 0.4, 14)
    tomates = graines([(452, 360), (520, 350)], TOMATE, 10)
    return gateau_rond([('#f0cf95', 52)], '#f4d9a4', creux + tomates + romarin, rx=204, ry=64)


def couscous():
    """Un dôme de semoule, les merguez et le poulet posés dessus."""
    s = [assiette(450, 418, 252, 94)]
    s.append(f'<path d="M280 400 C 300 296, 600 296, 620 400 Z" fill="{SEMOULE}"/>')
    s.append(f'<ellipse cx="450" cy="400" rx="170" ry="34" fill="{sombre(SEMOULE, 0.92)}"/>')
    s.append(f'<path d="M320 372 C 350 320, 520 316, 560 358 C 500 330, 380 336, 320 372 Z" '
             f'fill="{clair(SEMOULE, 0.3)}"/>')
    for x, y, a in ((360, 330, -18), (452, 306, 4), (536, 330, 16)):
        s.append(f'<rect x="{x}" y="{y}" width="96" height="26" rx="13" fill="{MERGUEZ}" '
                 f'transform="rotate({a} {x + 48} {y + 13})"/>')
        s.append(f'<rect x="{x + 10}" y="{y + 4}" width="70" height="8" rx="4" '
                 f'fill="{clair(MERGUEZ, 0.22)}" transform="rotate({a} {x + 48} {y + 13})"/>')
    s.append(graines([(388, 374), (520, 372), (452, 386)], CAROTTE, 12))
    s.append(graines([(340, 386), (566, 384)], POULET, 14))
    return ''.join(s)


def club_sandwich():
    """Deux triangles superposés : le club se reconnaît à sa coupe en diagonale."""
    s = [assiette(450, 452, 250, 92)]
    couches = [(PAIN, 20), ('#f5e3c2', 14), ('#e07f6a', 16), ('#9ab873', 12),
               (PAIN, 20), ('#f7e7c8', 14), ('#e8c48a', 16), (PAIN, 20)]
    bas = 444
    xg, xd = 316, 584
    y = bas
    for couleur, h in couches:
        s.append(f'<path d="M{xd} {y} L{xd + DX} {y + DY} L{xd + DX} {y + DY - h} L{xd} {y - h} Z" '
                 f'fill="{sombre(couleur, 0.78)}"/>')
        y -= h
    y = bas
    for couleur, h in couches:
        s.append(f'<rect x="{xg}" y="{y - h}" width="{xd - xg}" height="{h}" fill="{couleur}"/>')
        y -= h
    haut = y
    s.append(f'<path d="M{xg} {haut} L{xd} {haut} L{xd + DX} {haut + DY} L{xg + DX} {haut + DY} Z" '
             f'fill="{clair(PAIN, 0.18)}"/>')
    # Le pic à cocktail, signe distinctif
    s.append(f'<rect x="446" y="{haut - 92}" width="8" height="104" rx="4" fill="#b4926a"/>')
    s.append(f'<circle cx="450" cy="{haut - 96}" r="14" fill="{TOMATE}"/>')
    return ''.join(s)


def poke():
    """Le bol de riz, et les garnitures posées dessus en tas distincts.

    Des quartiers de camembert donnaient une roue de couleurs, illisible en vignette :
    ce sont des tas, comme dans un vrai poke.
    """
    tas = ''.join(
        f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" fill="{sombre(c, 0.84)}"/>'
        f'<ellipse cx="{x}" cy="{y - 5}" rx="{rx}" ry="{ry}" fill="{c}"/>'
        f'<ellipse cx="{x - rx * 0.3:.0f}" cy="{y - 10}" rx="{rx * 0.4:.0f}" ry="{ry * 0.4:.0f}" '
        f'fill="{clair(c, 0.28)}"/>'
        for x, y, rx, ry, c in ((368, 348, 52, 24, SAUMON_CRU), (474, 336, 48, 22, AVOCAT),
                                (546, 352, 40, 20, CHOU_ROUGE), (424, 366, 44, 20, EDAMAME))
    )
    sesame = graines([(500, 366), (330, 366), (452, 322), (516, 322)], '#efe6cf', 5)
    return bol(sombre(RIZ, 0.94), tas + sesame, couleur_bol='#cf9f6e')


def tropezienne():
    """Une part de brioche fourrée : deux étages et la crème au milieu."""
    garn = graines([(392, 244), (446, 232), (504, 246), (540, 258)], SUCRE, 9)
    return part_en_couches(
        [(BRIOCHE, 34), (CREME, 34), (BRIOCHE, 32)], clair(BRIOCHE, 0.2), garn, coulee=CREME)


PLATS = {
    'lasagnes-bolognaise-la-meilleure-recette': ('Plat', lasagnes),
    'lasagnes-au-saumon-et-aux-courgettes': ('Plat', lasagnes_saumon),
    'gratin-de-courgettes-et-daubergines': ('Plat', gratin),
    'cake-aux-olives': ('Entrée', cake_olives),
    'anchoiade': ('Entrée', anchoiade),
    'tapenade-maison': ('Entrée', tapenade),
    'veritable-fondue-savoyarde': ('Plat', fondue),
    'tarte-au-citron-recette-cap-patissier': ('Dessert', tarte_citron),
    'tiramisu-classique': ('Dessert', tiramisu),
    'galette-des-rois-frangipane-amande-traditionnelle': ('Dessert', galette),
    'tarte-aux-abricots-et-aux-amandes': ('Dessert', tarte_abricots),
    'flan-patissier': ('Dessert', flan),
    'carrot-cake-moelleux': ('Dessert', carrot_cake),
    'cheesecake-aux-speculoos': ('Dessert', cheesecake),
    'veritable-brownie-americain': ('Dessert', brownie),
    'flan-patissier-sans-pate-cremeux': ('Dessert', flan_sans_pate),
    'brookies': ('Dessert', brookies),
    'gougeres-de-courgettes-et-comte': ('Entrée', gougeres),
    'mini-cakes-de-courgettes-au-fromage-et-tomates-confites': ('Entrée', mini_cakes),
    'focaccia-maison-moelleuse': ('Entrée', focaccia),
    'couscous-poulet-merguez': ('Plat', couscous),
    'club-sandwich-d-adrien': ('Plat', club_sandwich),
    'poke-bowl': ('Plat', poke),
    'tropezienne': ('Dessert', tropezienne),
}


def svg_de(identifiant):
    categorie, fabrique = PLATS[identifiant]
    return scene(categorie, fabrique())
