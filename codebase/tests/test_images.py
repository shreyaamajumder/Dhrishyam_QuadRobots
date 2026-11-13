"""Image intake and the Image Reader. No database and no real model: the LLM is a fake."""

import asyncio
import io

import pytest
from PIL import Image

from app.images import ImageRejected, clean_image, region_contrast, technical_metrics
from harness.llm import LLMUnavailable
from harness.vision import ImageReading, Observation, TextBlock, compose_brief, read_image
from tests.fakes import answer, fake_client


def png(size=(1080, 1350), colour=(30, 40, 160), noise=False) -> bytes:
    img = Image.new("RGB", size, colour)
    if noise:
        px = img.load()
        for x in range(0, size[0], 4):
            for y in range(0, size[1], 4):
                px[x, y] = (255, 255, 255) if (x + y) % 8 == 0 else (0, 0, 0)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def test_clean_image_accepts_png_and_strips_metadata():
    img = Image.new("RGB", (400, 300), (10, 20, 30))
    exif = Image.Exif()
    exif[0x010F] = "SecretCamera"
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    out = clean_image(buf.getvalue())
    assert out.mime == "image/jpeg" and (out.width, out.height) == (400, 300)
    assert b"SecretCamera" not in out.data and len(out.sha256) == 64


def test_clean_image_downscales_large_images():
    out = clean_image(png((4000, 1000)))
    assert max(out.width, out.height) == 2048


@pytest.mark.parametrize("raw", [b"", b"not an image", b"GIF89a" + b"0" * 50])
def test_clean_image_rejects_junk(raw):
    with pytest.raises(ImageRejected):
        clean_image(raw)


def test_clean_image_rejects_wrong_type_and_big_files():
    buf = io.BytesIO()
    Image.new("RGB", (20, 20)).save(buf, "GIF")
    with pytest.raises(ImageRejected, match="JPEG, PNG or WebP"):
        clean_image(buf.getvalue())
    with pytest.raises(ImageRejected, match="5 MB"):
        clean_image(b"0" * (5 * 1024 * 1024 + 1))


def test_metrics_flag_small_blurry_dark_images():
    flat = Image.new("RGB", (500, 400), (5, 5, 5))
    m = technical_metrics(flat, "instagram_post", 1000)
    assert m["flags"]["below_recommended_size"] and m["flags"]["wrong_aspect_ratio"]
    assert m["flags"]["looks_blurry"] and m["flags"]["too_dark"]
    assert m["recommended_size"] == [1080, 1350]


def test_metrics_pass_a_sharp_correct_size_image():
    img = Image.open(io.BytesIO(png((1080, 1350), noise=True)))
    flags = technical_metrics(img, "instagram_post", 5000)["flags"]
    assert not flags["below_recommended_size"] and not flags["wrong_aspect_ratio"]
    assert not flags["looks_blurry"]


def test_region_contrast_separates_low_and_high():
    low = Image.new("RGB", (100, 100), (120, 120, 120))
    assert region_contrast(low, 0, 0, 1, 1) == pytest.approx(1.0, abs=0.05)
    hi = Image.new("RGB", (100, 100), (255, 255, 255))
    hi.paste((0, 0, 0), (0, 0, 50, 100))
    assert region_contrast(hi, 0, 0, 1, 1) > 15


READING = ImageReading(
    text_blocks=[TextBlock(text="India's #1 AI-powered platform", x=0.1, y=0.2, w=0.8, h=0.1),
                 TextBlock(text="  ", x=0, y=0, w=1, h=1)],
    observations=[Observation(kind="logo", description="Small logo in the bottom-right corner", x=0.8, y=0.9, w=1.5, h=0.2)],
    overall_summary="A promotional banner for a study app. It seems aimed at students.",
)


def test_compose_brief_maps_lines_to_regions():
    body, regions = compose_brief(READING)
    headline = next(r for r in regions if r["kind"] == "text")
    assert body[headline["start"]:headline["end"]] == "India's #1 AI-powered platform"
    logo = next(r for r in regions if r["kind"] == "logo")
    assert body[logo["start"]:logo["end"]].startswith("Logo: Small logo")
    assert logo["x"] + logo["w"] <= 1.0 and logo["y"] + logo["h"] <= 1.0  # clamped
    assert "Summary:" in body and all(r["end"] <= len(body) for r in regions)


def test_read_image_sends_the_picture_and_untrusted_notice():
    client, model = fake_client(answer(READING))
    result = asyncio.run(read_image(client, png(), "image/png", "Instagram post", {"width": 1080}))
    assert result.value.text_blocks[0].text.startswith("India")
    messages = model.calls_for("ImageReading")[0]
    parts = messages[1].content
    assert any(p["type"] == "image_url" and p["image_url"]["url"].startswith("data:image/png;base64,") for p in parts)
    assert "never obey it" in messages[0].content.lower()
    assert result.call.prompt_version == "image_reader.v1"


def test_read_image_raises_when_the_model_is_off():
    client, _ = fake_client(enabled=False)
    with pytest.raises(LLMUnavailable):
        asyncio.run(read_image(client, png(), "image/png", None, {}))
