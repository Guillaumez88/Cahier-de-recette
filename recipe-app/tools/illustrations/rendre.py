"""Rasterise les 24 illustrations et assemble la planche de contrôle.

    PYTHONPATH=../pylibs python3 rendre.py

Écrit svg/<id>.svg, png/<id>.png, planche.png, et images/<id>.json (les data URLs aux
tailles de photos.js, prêtes pour l'outil d'import).
"""
import base64, json, os
import pymupdf
from recettes_illus import PLATS, svg_de

COTE_VIGNETTE = 320
COTE_GRANDE = 1200
BUDGET_VIGNETTE = 60000
BUDGET_GRANDE = 600000
QUALITES = [88, 80, 72, 62, 52]

for d in ('svg', 'png', 'images'):
    os.makedirs(d, exist_ok=True)


def encoder(chemin_svg, cote, budget):
    doc = pymupdf.open(chemin_svg)
    page = doc[0]
    r = page.rect
    echelle = cote / max(r.width, r.height)
    pm = page.get_pixmap(matrix=pymupdf.Matrix(echelle, echelle))
    for q in QUALITES:
        url = 'data:image/jpeg;base64,' + base64.b64encode(pm.tobytes('jpeg', jpg_quality=q)).decode()
        if len(url) <= budget:
            return url, pm
    raise SystemExit(f'{chemin_svg} : trop lourd même à la qualité {QUALITES[-1]}')


def main():
    apercus = []
    for identifiant in PLATS:
        chemin = f'svg/{identifiant}.svg'
        open(chemin, 'w').write(svg_de(identifiant))
        vignette, pmv = encoder(chemin, COTE_VIGNETTE, BUDGET_VIGNETTE)
        grande, _ = encoder(chemin, COTE_GRANDE, BUDGET_GRANDE)
        json.dump({'plat': {'vignette': vignette, 'grande': grande}, 'etapes': {}},
                  open(f'images/{identifiant}.json', 'w'))
        doc = pymupdf.open(chemin)
        pm = doc[0].get_pixmap(matrix=pymupdf.Matrix(0.42, 0.42))
        pm.save(f'png/{identifiant}.png')
        apercus.append((identifiant, pm, len(vignette), len(grande)))
        print(f'{identifiant:<52} vignette {len(vignette):>6} car., grande {len(grande):>7} car.')

    colonnes = 4
    l, h = apercus[0][1].width, apercus[0][1].height
    lignes = (len(apercus) + colonnes - 1) // colonnes
    out = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, l * colonnes, h * lignes))
    out.set_rect(out.irect, (255, 255, 255))
    for i, (_, pm, _, _) in enumerate(apercus):
        pm.set_origin((i % colonnes) * l, (i // colonnes) * h)
        out.copy(pm, pm.irect)
    out.save('planche.png')
    print('planche.png', out.width, out.height)


if __name__ == '__main__':
    main()
