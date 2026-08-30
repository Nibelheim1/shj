"""Build a compact reference/actual contact sheet for the 32 UI v14 states."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
DESIGN = ROOT / "design" / "山海·栖霞_UI运行基线_390x844@3"
ACTUAL = ROOT / "output" / "ui-v14" / "actual"
OUT = ROOT / "output" / "ui-v14" / "contact" / "all_compare.jpg"


def fit(path: Path, size: tuple[int, int]) -> Image.Image:
    with Image.open(path) as source:
        image = source.convert("RGB")
    image.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, (24, 35, 39))
    canvas.paste(image, ((size[0] - image.width) // 2, (size[1] - image.height) // 2))
    return canvas


def main() -> None:
    refs = {path.name[:2]: path for path in DESIGN.glob("[0-9][0-9]_*.png")}
    cell = (195, 422)
    label_h = 30
    cols = 8
    rows = 8
    sheet = Image.new("RGB", (cols * cell[0], rows * (cell[1] + label_h)), (13, 24, 28))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index in range(32):
        number = f"{index + 1:02d}"
        row = index // 4
        pair = index % 4
        for side, path in enumerate((refs[number], ACTUAL / f"{number}.png")):
            col = pair * 2 + side
            x = col * cell[0]
            y = row * (cell[1] + label_h)
            sheet.paste(fit(path, cell), (x, y))
            draw.text((x + 6, y + cell[1] + 7), f"{number} {'REF' if side == 0 else 'ACT'}", fill=(240, 225, 190), font=font)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT, "JPEG", quality=88, optimize=True)
    print(OUT)


if __name__ == "__main__":
    main()
