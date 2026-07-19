#!/usr/bin/env python3
"""Generate SanGuide PWA icons: a rounded red medical plus on a warm yellow field.

Pure stdlib (zlib) PNG encoder so no external image libraries are needed.
The mark is a rounded 'plus' (medical cross), deliberately NOT the Geneva-cross
emblem, to stay clear of the protected Red Cross / DLRG trademarks while keeping
the red-cross-on-yellow motif the user asked for.
"""
import struct
import zlib
import os

# Palette (original, trademark-safe; inspired by rescue-service yellow/red)
YELLOW = (0xFF, 0xCE, 0x3A)   # warm field
RED    = (0xD7, 0x2A, 0x2A)   # medical red
WHITE  = (0xFF, 0xFF, 0xFF)   # thin keyline around the plus for contrast

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT_DIR, exist_ok=True)


def rounded_rect_contains(px, py, cx, cy, half_w, half_h, radius):
    """True if point (px,py) is inside an axis-aligned rounded rect."""
    dx = abs(px - cx)
    dy = abs(py - cy)
    if dx > half_w or dy > half_h:
        return False
    # inside the straight (non-corner) regions
    if dx <= half_w - radius or dy <= half_h - radius:
        return True
    # corner region: distance to corner centre
    corner_x = half_w - radius
    corner_y = half_h - radius
    ddx = dx - corner_x
    ddy = dy - corner_y
    return ddx * ddx + ddy * ddy <= radius * radius


def make_icon(size, maskable_pad=0.0):
    """Return raw RGBA bytes for one icon of given size.

    maskable_pad shrinks the mark toward the centre so it survives the
    maskable safe-zone crop; the yellow field is always full-bleed.
    """
    cx = cy = size / 2.0
    # plus geometry, relative to size
    scale = 1.0 - maskable_pad
    arm_len = size * 0.30 * scale     # half length of each arm from centre
    arm_half_w = size * 0.105 * scale  # half thickness of the bar
    radius = arm_half_w * 0.75         # rounding of the plus tips
    key = size * 0.018                 # white keyline thickness

    buf = bytearray()
    for y in range(size):
        buf.append(0)  # PNG filter type 0 for this scanline
        for x in range(size):
            px = x + 0.5
            py = y + 0.5
            # horizontal and vertical bars of the plus
            in_h = rounded_rect_contains(px, py, cx, cy, arm_len, arm_half_w, radius)
            in_v = rounded_rect_contains(px, py, cx, cy, arm_half_w, arm_len, radius)
            in_plus = in_h or in_v
            # keyline: slightly larger plus, used only where not in the red plus
            in_h_k = rounded_rect_contains(px, py, cx, cy, arm_len + key, arm_half_w + key, radius + key)
            in_v_k = rounded_rect_contains(px, py, cx, cy, arm_half_w + key, arm_len + key, radius + key)
            in_key = in_h_k or in_v_k
            if in_plus:
                r, g, b = RED
            elif in_key:
                r, g, b = WHITE
            else:
                r, g, b = YELLOW
            buf.extend((r, g, b, 255))
    return bytes(buf)


def write_png(path, size, rgba_scanlines):
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(rgba_scanlines, 9)
    with open(path, "wb") as f:
        f.write(sig)
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", idat))
        f.write(chunk(b"IEND", b""))


targets = [
    ("icon-192.png", 192, 0.0),
    ("icon-512.png", 512, 0.0),
    ("icon-192-maskable.png", 192, 0.18),
    ("icon-512-maskable.png", 512, 0.18),
    ("apple-touch-icon.png", 180, 0.06),
    ("favicon-32.png", 32, 0.0),
]
for name, size, pad in targets:
    data = make_icon(size, pad)
    write_png(os.path.join(OUT_DIR, name), size, data)
    print("wrote", name, size)
print("done ->", OUT_DIR)
