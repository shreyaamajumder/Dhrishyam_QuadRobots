"""Image intake for creative review: validate, clean and measure an uploaded image.

Layer 1 of image review (no AI needed). The checks here are measurements, not opinions:
the vision step (harness/vision.py) gets them as facts, and the interface shows them as
"Image checks". Needs Pillow and numpy.
"""

from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass
from typing import Any

import numpy as np
from PIL import Image, ImageOps

MAX_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 25_000_000          # decompression-bomb guard
MAX_LONG_EDGE = 2048             # downscale before storing and before sending to the model
ALLOWED = {"JPEG": ("image/jpeg", "jpg"), "PNG": ("image/png", "png"), "WEBP": ("image/webp", "webp")}

# platform key -> (label, recommended width, height)
PLATFORM_SPECS: dict[str, tuple[str, int, int]] = {
    "instagram_post": ("Instagram post", 1080, 1350),
    "instagram_story": ("Instagram story", 1080, 1920),
    "linkedin_post": ("LinkedIn post", 1200, 627),
    "linkedin_banner": ("LinkedIn banner", 1584, 396),
    "x_post": ("X post", 1600, 900),
    "youtube_thumbnail": ("YouTube thumbnail", 1280, 720),
    "web_banner": ("Web banner", 1200, 628),
}


class ImageRejected(ValueError):
    """The upload cannot be used. The message is safe to show to the creator."""


@dataclass
class CleanImage:
    data: bytes
    mime: str
    width: int
    height: int
    sha256: str


def clean_image(raw: bytes) -> CleanImage:
    """Decode with Pillow (never trust the extension), cap the size, strip EXIF, re-encode."""
    if not raw:
        raise ImageRejected("The file is empty.")
    if len(raw) > MAX_BYTES:
        raise ImageRejected("Image size exceeds the 5 MB limit. Please upload a smaller file.")
    try:
        probe = Image.open(io.BytesIO(raw))
        fmt = probe.format
        if fmt not in ALLOWED:
            raise ImageRejected("Unsupported image type. Please upload a JPEG, PNG or WebP file.")
        if probe.width * probe.height > MAX_PIXELS:
            raise ImageRejected("This image has too many pixels. Please upload a smaller one.")
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))
        img.load()
    except ImageRejected:
        raise
    except Exception as exc:  # corrupt or hostile file
        raise ImageRejected("This file could not be read as an image.") from exc

    if max(img.size) > MAX_LONG_EDGE:
        img.thumbnail((MAX_LONG_EDGE, MAX_LONG_EDGE))
    has_alpha = img.mode in ("RGBA", "LA", "P") and fmt in ("PNG", "WEBP")
    img = img.convert("RGBA" if has_alpha else "RGB")
    out_fmt = fmt if fmt != "JPEG" or not has_alpha else "PNG"
    buf = io.BytesIO()
    img.save(buf, format=out_fmt, **({"quality": 90} if out_fmt in ("JPEG", "WEBP") else {}))
    data = buf.getvalue()  # re-encoding drops EXIF/GPS and any appended payload
    return CleanImage(data, ALLOWED[out_fmt][0], img.width, img.height, hashlib.sha256(data).hexdigest())


def _luminance(rgb: np.ndarray) -> np.ndarray:
    c = rgb.astype(np.float64) / 255.0
    c = np.where(c <= 0.03928, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]


def region_contrast(img: Image.Image, x: float, y: float, w: float, h: float) -> float | None:
    """Approximate WCAG contrast inside a normalised box: light end vs dark end of its pixels."""
    W, H = img.size
    box = (int(x * W), int(y * H), int(min(1.0, x + w) * W), int(min(1.0, y + h) * H))
    if box[2] - box[0] < 2 or box[3] - box[1] < 2:
        return None
    lum = _luminance(np.asarray(img.convert("RGB").crop(box))).ravel()
    hi, lo = np.percentile(lum, 95), np.percentile(lum, 5)
    return float((hi + 0.05) / (lo + 0.05))


def technical_metrics(img: Image.Image, platform: str | None, size_bytes: int) -> dict[str, Any]:
    """Facts about the image. Each flag is True when something looks wrong."""
    rgb = img.convert("RGB")
    gray = np.asarray(rgb.convert("L"), dtype=np.float64)
    # Variance of a 4-neighbour Laplacian: low values mean few sharp edges (blur).
    lap = (-4 * gray[1:-1, 1:-1] + gray[:-2, 1:-1] + gray[2:, 1:-1] + gray[1:-1, :-2] + gray[1:-1, 2:])
    blur = float(lap.var()) if lap.size else 0.0
    small = rgb.copy()
    small.thumbnail((64, 64))
    quant = small.quantize(colors=5).convert("RGB")
    colours = sorted(quant.getcolors(), reverse=True)
    palette = ["#%02x%02x%02x" % c for _, c in colours]

    spec = PLATFORM_SPECS.get(platform or "")
    w, h = img.size
    metrics: dict[str, Any] = {
        "width": w, "height": h, "size_kb": round(size_bytes / 1024),
        "aspect_ratio": round(w / h, 3), "blur_score": round(blur, 1),
        "brightness": round(float(gray.mean()), 1), "contrast": round(float(gray.std()), 1),
        "dominant_colours": palette, "platform": platform,
        "platform_label": spec[0] if spec else None,
        "recommended_size": [spec[1], spec[2]] if spec else None,
    }
    metrics["flags"] = {
        "below_recommended_size": bool(spec and (w < spec[1] * 0.9 or h < spec[2] * 0.9)),
        "wrong_aspect_ratio": bool(spec and abs(w / h - spec[1] / spec[2]) > 0.03),
        "looks_blurry": blur < 40.0,
        "too_dark": float(gray.mean()) < 50.0,
        "too_bright": float(gray.mean()) > 215.0,
        "low_overall_contrast": float(gray.std()) < 25.0,
    }
    return metrics
