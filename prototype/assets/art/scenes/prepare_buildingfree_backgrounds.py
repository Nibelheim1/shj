import argparse
from pathlib import Path
from PIL import Image

def main():
    parser = argparse.ArgumentParser(description="Crop generated courtyard art to the H5 4:5 release format.")
    parser.add_argument("--morning", type=Path, required=True)
    parser.add_argument("--sunset", type=Path, required=True)
    parser.add_argument("--moonlit", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    sources = {
        "bg_courtyard_buildingfree.webp": args.morning,
        "bg_courtyard_buildingfree_sunset.webp": args.sunset,
        "bg_courtyard_buildingfree_moonlit.webp": args.moonlit,
    }
    output_directory = args.output.resolve()
    output_directory.mkdir(parents=True, exist_ok=True)
    for name, source in sources.items():
        image = Image.open(source).convert("RGB")
        target_height = round(image.width / (4 / 5))
        top = max(0, (image.height - target_height) // 2)
        cropped = image.crop((0, top, image.width, top + target_height))
        resized = cropped.resize((800, 1000), Image.Resampling.LANCZOS)
        destination = output_directory / name
        resized.save(destination, "WEBP", quality=84, method=6)
        print(name, destination.stat().st_size, resized.size, "crop", (0, top, image.width, top + target_height))


if __name__ == "__main__":
    main()
