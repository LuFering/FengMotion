"""
图标生成脚本：从品牌 mark 合成「白色圆角方块 + logo」的应用图标，输出全部尺寸。

为什么要生成而不是直接用 public/assets/brand/fengmotion-mark.png：
那张是**透明底**的纯 logo，直接做成 dock 图标在深色/浅色桌面上会缺边界、
与相邻图标视觉重量不一致。产品设计里定的应用图标形态是白底圆角（squircle）。

为什么用 PIL 而不是 ImageMagick：
ImageMagick 在合成带 alpha 的 PNG 时会把结果降成灰度（已实际踩过：
`magick identify` 报 `Grayscale Gray`，颜色全丢），PIL 的 RGBA 合成稳定。

用法：
  python3 scripts/make-icons.py            # 输出到 build/icons/
  python3 scripts/make-icons.py --preview  # 额外输出一张对照图便于目检
"""

from PIL import Image, ImageDraw
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '..', 'frontend', 'public', 'assets', 'brand', 'fengmotion-mark.png')
OUT_DIR = os.path.join(ROOT, 'build', 'icons')

SIZES = [16, 32, 48, 64, 128, 256, 512]
# 圆角半径占边长比例：22.6% ≈ macOS squircle 观感
RADIUS_RATIO = 0.226
# logo 内容区占边长比例：留出足够白边，dock 小尺寸下也认得出
CONTENT_RATIO = 0.664


# 视觉居中系数：0=包围盒居中，1=重心居中。
# 三角播放图标左边缘是实心直边、右侧收成尖角，包围盒居中时视觉上偏左
# （实测重心比几何中心左偏 23.4/226 ≈ 10.4%）。取 0.6 让左右留白接近均衡，
# 1.0 会让右尖角贴边，反而更失衡。
OPTICAL_CENTER = 0.6


def _centroid(img: Image.Image) -> tuple[float, float]:
    """按 alpha 加权的重心，用于视觉居中。"""
    import numpy as np

    a = np.array(img).astype(float)
    w = a[:, :, 3]
    total = w.sum()
    cx = (w * np.arange(w.shape[1])[None, :]).sum() / total
    cy = (w * np.arange(w.shape[0])[:, None]).sum() / total
    return cx, cy


def build(size: int) -> Image.Image:
    src = Image.open(SRC).convert('RGBA')
    bbox = src.split()[3].getbbox()
    if bbox is None:
        raise SystemExit(f'源图没有不透明区域：{SRC}')
    mark = src.crop(bbox)

    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle(
        [0, 0, size - 1, size - 1],
        radius=int(size * RADIUS_RATIO),
        fill=(255, 255, 255, 255),
    )

    target = int(size * CONTENT_RATIO)
    ratio = min(target / mark.width, target / mark.height)
    w, h = max(1, int(mark.width * ratio)), max(1, int(mark.height * ratio))
    resized = mark.resize((w, h), Image.LANCZOS)

    # 视觉居中：在「包围盒居中」与「重心居中」之间插值
    cx, cy = _centroid(mark)
    cx, cy = cx * ratio, cy * ratio
    base_x, base_y = (size - w) / 2, (size - h) / 2
    x = base_x + (size / 2 - cx - base_x) * OPTICAL_CENTER
    y = base_y + (size / 2 - cy - base_y) * OPTICAL_CENTER
    canvas.alpha_composite(resized, (int(round(x)), int(round(y))))
    return canvas


def build_plain(size: int) -> Image.Image:
    """透明底：只放 logo，四周留少量边距。用于需要自己贴底色的场合。"""
    src = Image.open(SRC).convert('RGBA')
    mark = src.crop(src.split()[3].getbbox())
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    target = int(size * 0.92)
    ratio = min(target / mark.width, target / mark.height)
    w, h = max(1, int(mark.width * ratio)), max(1, int(mark.height * ratio))
    canvas.alpha_composite(
        mark.resize((w, h), Image.LANCZOS), ((size - w) // 2, (size - h) // 2)
    )
    return canvas


def build_mono(size: int) -> Image.Image:
    """单色版：用 logo 的 alpha 做形状遮罩填纯白，丢弃渐变。

    用途：深色/彩色背景上需要纯白剪影时（例如 dock 高亮态、打印、贴图）。
    注意这不是「灰度版」—— 灰度指的是保留渐变但去饱和，见 build_grayscale。
    """
    src = Image.open(SRC).convert('RGBA')
    mark = src.crop(src.split()[3].getbbox())
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    target = int(size * 0.92)
    ratio = min(target / mark.width, target / mark.height)
    w, h = max(1, int(mark.width * ratio)), max(1, int(mark.height * ratio))
    resized = mark.resize((w, h), Image.LANCZOS)
    solid = Image.new('RGBA', (w, h), (255, 255, 255, 255))
    solid.putalpha(resized.split()[3])
    canvas.alpha_composite(solid, ((size - w) // 2, (size - h) // 2))
    return canvas


def build_grayscale(size: int) -> Image.Image:
    """灰度版：保留 logo 的形状与明暗层次，只去掉色相。

    用途：需要「不抢眼」的场合，如禁用态、单色主题、印刷。
    """
    src = Image.open(SRC).convert('RGBA')
    mark = src.crop(src.split()[3].getbbox())
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    target = int(size * 0.92)
    ratio = min(target / mark.width, target / mark.height)
    w, h = max(1, int(mark.width * ratio)), max(1, int(mark.height * ratio))
    resized = mark.resize((w, h), Image.LANCZOS)
    # 用亮度转灰度，再贴回原 alpha，避免透明区域变黑
    gray = resized.convert('L').convert('RGBA')
    gray.putalpha(resized.split()[3])
    canvas.alpha_composite(gray, ((size - w) // 2, (size - h) // 2))
    return canvas


# 三种可复用形态：应用图标（白底圆角）/ 透明底 / 单色 / 灰度
VARIANTS = {
    'white-rounded': build,
    'transparent': build_plain,
    'mono': build_mono,
    'grayscale': build_grayscale,
}
VARIANTS_DIR = os.path.join(ROOT, 'build', 'icons-variants')


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        img = build(size)
        path = os.path.join(OUT_DIR, f'{size}x{size}.png')
        img.save(path)
        print(f'  {path.replace(ROOT, ".")}')

    # 同时保留所有形态，供以后换图标/做物料时直接取用
    for name, factory in VARIANTS.items():
        vdir = os.path.join(VARIANTS_DIR, name)
        os.makedirs(vdir, exist_ok=True)
        for size in SIZES:
            factory(size).save(os.path.join(vdir, f'{size}x{size}.png'))
        print(f'  变体 {name}: {len(SIZES)} 个尺寸')

    if '--preview' in sys.argv:
        sizes = [48, 64, 128, 256]
        pad = 40
        sheet = Image.new(
            'RGBA',
            (sum(sizes) + pad * len(sizes), max(sizes) + pad // 2),
            (40, 40, 46, 255),
        )
        x = pad // 2
        for size in sizes:
            icon = Image.open(os.path.join(OUT_DIR, f'{size}x{size}.png'))
            sheet.alpha_composite(icon, (x, (max(sizes) - size) // 2 + pad // 4))
            x += size + pad
        out = '/tmp/fengmotion-icons-preview.png'
        sheet.save(out)
        print(f'对照图：{out}')

    print(f'完成：{len(SIZES)} 个尺寸 → {OUT_DIR.replace(ROOT, ".")}/')


if __name__ == '__main__':
    main()
