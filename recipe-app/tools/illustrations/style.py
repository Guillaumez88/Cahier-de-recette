"""Le style commun des illustrations de plats : décor, assiette, ombres, couleurs.

Trois principes, tenus par toutes les recettes :

1. **Aucun filtre SVG.** MuPDF, qui rasterise, ne les rend pas. Les ombres sont donc des
   ellipses translucides empilées, pas des flous : c'est ce qui donne le rendu « flat ».
2. **Deux tons par volume.** Une face éclairée, une face à l'ombre du même ton assombri :
   c'est tout ce qu'il faut pour lire le relief sans dégradé compliqué.
3. **Palette de l'application.** Les fonds sortent des jetons CSS du carnet, pour que la
   vignette d'une recette ne jure pas avec la carte qui la porte.

Cadre 900 x 600 (3:2), sujet centré : les vignettes des listes sont carrées et rognent
sur les côtés, la fiche est large. Rien d'important ne doit toucher les bords.
"""

L, H = 900, 600

# Jetons repris de css/style.css
FOND = '#f5ead8'
SURFACE = '#fffdf9'
CREUX = '#ebddc5'
ACCENT_100 = '#fff2eb'
ACCENT_200 = '#ffe1d0'
ACCENT_300 = '#ffc6a5'
NEUTRE_300 = '#dcd3c4'
NEUTRE_400 = '#c0b6a5'
ENCRE = '#201e1d'


def sombre(hexa, facteur=0.82):
    """Le même ton, plus sombre : la face à l'ombre d'un volume."""
    h = hexa.lstrip('#')
    r, v, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return '#%02x%02x%02x' % tuple(max(0, min(255, int(c * facteur))) for c in (r, v, b))


def clair(hexa, facteur=0.35):
    """Le même ton, éclairci vers le blanc : la face au soleil."""
    h = hexa.lstrip('#')
    r, v, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return '#%02x%02x%02x' % tuple(int(c + (255 - c) * facteur) for c in (r, v, b))


def entete(fond_tache=ACCENT_200):
    """Le fond : aplat chaud et une tache ronde derrière le plat, pour le détacher."""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{L}" height="{H}" '
        f'viewBox="0 0 {L} {H}">'
        f'<rect width="{L}" height="{H}" fill="{FOND}"/>'
        f'<circle cx="450" cy="285" r="235" fill="{fond_tache}"/>'
    )


def pied():
    return '</svg>'


def ombre_portee(cx, cy, rx, ry):
    """Une ombre douce sans filtre : trois ellipses translucides emboîtées."""
    return ''.join(
        f'<ellipse cx="{cx}" cy="{cy}" rx="{rx * f:.0f}" ry="{ry * f:.0f}" '
        f'fill="{ENCRE}" opacity="{o}"/>'
        for f, o in ((1.0, 0.05), (0.82, 0.05), (0.6, 0.05))
    )


def assiette(cx=450, cy=395, rx=250, ry=92, creuse=False):
    """Une assiette vue de trois quarts : tranche, aile, puis fond.

    La tranche est l'ellipse du dessous décalée : c'est elle qui donne l'épaisseur, et
    c'est le seul endroit où le volume se joue.
    """
    epaisseur = 16
    aile = 0.80 if not creuse else 0.72
    return (
        ombre_portee(cx + 8, cy + 34, rx * 0.96, ry * 0.42)
        + f'<ellipse cx="{cx}" cy="{cy + epaisseur}" rx="{rx}" ry="{ry}" fill="{NEUTRE_400}"/>'
        + f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{SURFACE}"/>'
        + f'<ellipse cx="{cx}" cy="{cy + 3}" rx="{rx * aile:.0f}" ry="{ry * aile:.0f}" '
          f'fill="{CREUX}" opacity="0.55"/>'
        + f'<ellipse cx="{cx}" cy="{cy}" rx="{rx * aile:.0f}" ry="{ry * aile:.0f}" fill="{SURFACE}"/>'
    )


def feuille_basilic(x, y, taille=1.0, angle=0):
    """Une feuille de basilic : deux arcs et une nervure. Sert de garniture partout."""
    t = taille
    return (
        f'<g transform="translate({x},{y}) rotate({angle}) scale({t})">'
        f'<path d="M0 0 C 14 -18, 40 -18, 52 0 C 40 18, 14 18, 0 0 Z" fill="#6f8f4a"/>'
        f'<path d="M0 0 C 14 -18, 40 -18, 52 0 C 40 4, 14 4, 0 0 Z" fill="#87a95c"/>'
        f'<path d="M4 0 L 48 0" stroke="#4f6a33" stroke-width="2" fill="none"/>'
        f'</g>'
    )


def graines(points, couleur, r=4):
    return ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{couleur}"/>' for x, y in points)
