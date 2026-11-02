"""Recreate the original geometric wallet icons using only Python's standard library."""
from pathlib import Path
import struct
import zlib

root = Path(__file__).resolve().parents[1] / 'public'
for size in (192, 512):
    rows = bytearray()
    for py in range(size):
        rows.append(0)
        for px in range(size):
            x, y = (px + .5) * 128 / size, (py + .5) * 128 / size
            color = (12, 99, 86)
            if (35 <= x <= 93 and 45 <= y <= 89 and not (40 <= x <= 88 and 50 <= y <= 84)) or (35 <= x <= 40 and 34 <= y <= 47) or (35 <= x <= 80 and 34 <= y <= 39):
                color = (255, 255, 255)
            if 77 <= x <= 95 and 58 <= y <= 77 or (x-77)**2 + (y-67.5)**2 <= 9.5**2:
                color = (188, 233, 174)
            if (x-80.5)**2 + (y-67.5)**2 <= 2.5**2:
                color = (12, 99, 86)
            rows.extend(color)
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b'')
    (root / f'icon-{size}.png').write_bytes(png)
