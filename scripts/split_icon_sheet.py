#!/usr/bin/env python3
"""Split a 3x3 icon sheet into transparent PNG icons.

The source sheet layout is fixed to:
1st row: itch, pain, feel
2nd row: head, body, hand
3rd row: leg, hot, cold
"""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path
from typing import Iterable

from PIL import Image


OUTPUT_BASE_NAMES = [
    "symptom-itch",
    "symptom-pain",
    "symptom-feel",
    "body-head",
    "body-body",
    "body-hand",
    "body-leg",
    "symptom-hot",
    "symptom-cold",
]


def build_output_names(style_suffix: str) -> list[str]:
    """Build output file names with the provided icon style suffix."""
    suffix = style_suffix.strip()
    return [f"{base}-{suffix}.png" for base in OUTPUT_BASE_NAMES]


def is_background_like(r: int, g: int, b: int) -> bool:
    """Return True when a pixel is likely background color.

    The source sheet has neutral light backgrounds and white halos.
    We treat bright, low-saturation pixels as removable background.
    """
    brightness = (r + g + b) // 3
    saturation = max(r, g, b) - min(r, g, b)
    return brightness >= 170 and saturation <= 45


def connected_edge_background_mask(image: Image.Image) -> bytearray:
    """Build a mask for edge-connected background-like pixels.

    Flood fill from all edges to avoid deleting bright details inside icons.
    """
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()

    visited = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def enqueue_if_background(x: int, y: int) -> None:
        idx = y * width + x
        if visited[idx]:
            return
        r, g, b, _ = pixels[x, y]
        if is_background_like(r, g, b):
            visited[idx] = 1
            queue.append((x, y))

    for x in range(width):
        enqueue_if_background(x, 0)
        enqueue_if_background(x, height - 1)
    for y in range(height):
        enqueue_if_background(0, y)
        enqueue_if_background(width - 1, y)

    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if nx < 0 or ny < 0 or nx >= width or ny >= height:
                continue
            idx = ny * width + nx
            if visited[idx]:
                continue
            r, g, b, _ = pixels[nx, ny]
            if is_background_like(r, g, b):
                visited[idx] = 1
                queue.append((nx, ny))

    return visited


def soften_transparency_edges(image: Image.Image, mask: bytearray) -> Image.Image:
    """Apply alpha to masked pixels with soft transition near the boundary."""
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()

    for y in range(height):
        for x in range(width):
            idx = y * width + x
            r, g, b, a = pixels[x, y]
            if not mask[idx]:
                pixels[x, y] = (r, g, b, a)
                continue

            near_foreground = False
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if nx < 0 or ny < 0 or nx >= width or ny >= height:
                    continue
                n_idx = ny * width + nx
                if not mask[n_idx]:
                    near_foreground = True
                    break

            # Keep anti-aliased edges cleaner by fading border background.
            alpha = 0 if not near_foreground else 25
            pixels[x, y] = (r, g, b, alpha)

    return rgba


def split_sheet(
    image_path: Path,
    output_dir: Path,
    style_suffix: str,
) -> Iterable[Path]:
    """Split an icon sheet into 9 tiles and save transparent PNGs."""
    image = Image.open(image_path).convert("RGBA")
    width, height = image.size
    output_names = build_output_names(style_suffix)

    # Support non-divisible sheet sizes by using rounded split points.
    x_bounds = [round(i * width / 3) for i in range(4)]
    y_bounds = [round(i * height / 3) for i in range(4)]

    output_paths: list[Path] = []
    idx = 0
    for row in range(3):
        for col in range(3):
            tile = image.crop((
                x_bounds[col],
                y_bounds[row],
                x_bounds[col + 1],
                y_bounds[row + 1],
            ))
            mask = connected_edge_background_mask(tile)
            transparent_tile = soften_transparency_edges(tile, mask)

            out_path = output_dir / output_names[idx]
            transparent_tile.save(out_path, format="PNG")
            output_paths.append(out_path)
            idx += 1

    return output_paths


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments for source image and style suffix."""
    parser = argparse.ArgumentParser(
        description="Split a 3x3 icon sheet and save transparent icon files."
    )
    parser.add_argument(
        "--source",
        default="Gemini_Generated_Image_ufq59rufq59rufq5.png",
        help="Source image file name under dist/media",
    )
    parser.add_argument(
        "--suffix",
        default="comic",
        help="Output style suffix (example: comic2)",
    )
    return parser.parse_args()


def main() -> None:
    """Run sheet splitting using the source/suffix arguments."""
    args = parse_args()
    root = Path(__file__).resolve().parent.parent
    media_dir = root / "dist" / "media"

    source = media_dir / args.source
    if not source.exists():
        raise FileNotFoundError(f"Source image not found: {source}")

    output_files = split_sheet(source, media_dir, args.suffix)
    print(f"Created {len(output_files)} icons:")
    for output_file in output_files:
        print(f"- {output_file.name}")


if __name__ == "__main__":
    main()
