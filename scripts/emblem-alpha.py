# How the dark emblem got its transparency, kept so it is repeatable.
#
# The mark is a dark squircle with a bright silver bezel, delivered as a
# jpeg on a white field. On a dark page that bezel reads as white around
# the logo, and three approaches failed before this one:
#
#   flooding white in from the corners   cleared the field, left the bezel
#   eroding the alpha inwards            cleared the sides, left a flat bar
#                                        across the top and bottom, because
#                                        the crop had cut the artwork flush
#                                        there
#   flooding bright in from every edge   left the bezel's gradient tail, a
#                                        thin light rim at about luminance
#                                        40 against a page at 23
#
# What works is to grow the mark outward from its own dark field instead of
# cutting inward from the frame, fill the neon back in as enclosed holes,
# then erode by a measured amount rather than a guessed one. The erosion
# was chosen by measuring the perimeter ring: at 5 the median sits at 40 and
# is visible, at 13 it sits at 12 and is not.
#
# Usage: python3 scripts/emblem-alpha.py <erode> [save] [source.jpg]
#
# The source used to be a hardcoded absolute path into a scratch directory
# on one machine, which meant the script only ran for the person who wrote
# it and leaked where they wrote it. It takes an argument now and falls back
# to a path inside the repo.
from PIL import Image, ImageFilter
from collections import deque
import sys, os

SRC = sys.argv[3] if len(sys.argv) > 3 else os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'app', 'public', 'orig-dark.jpg',
)
lum = lambda p: (p[0] + p[1] + p[2]) // 3
ERODE = int(sys.argv[1])

im = Image.open(SRC).convert('RGBA')
w, h = im.size; px = im.load(); DARK = 130

seeds = []
for walk in ([(x, h//2) for x in range(w)], [(x, h//2) for x in range(w-1,-1,-1)],
             [(w//2, y) for y in range(h)], [(w//2, y) for y in range(h-1,-1,-1)]):
    bright = False
    for c in walk:
        L = lum(px[c])
        if L >= 150: bright = True
        elif bright and L < DARK: seeds.append(c); break

inside = [[False]*w for _ in range(h)]; q = deque()
for s in seeds:
    if not inside[s[1]][s[0]]: inside[s[1]][s[0]] = True; q.append(s)
while q:
    x, y = q.popleft()
    for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
        nx, ny = x+dx, y+dy
        if 0<=nx<w and 0<=ny<h and not inside[ny][nx] and lum(px[nx,ny]) < DARK:
            inside[ny][nx] = True; q.append((nx,ny))

outside = [[False]*w for _ in range(h)]; q = deque()
for x in range(w):
    for y in (0, h-1):
        if not inside[y][x]: outside[y][x] = True; q.append((x,y))
for y in range(h):
    for x in (0, w-1):
        if not inside[y][x] and not outside[y][x]: outside[y][x] = True; q.append((x,y))
while q:
    x, y = q.popleft()
    for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
        nx, ny = x+dx, y+dy
        if 0<=nx<w and 0<=ny<h and not outside[ny][nx] and not inside[ny][nx]:
            outside[ny][nx] = True; q.append((nx,ny))

mask = Image.new('L',(w,h),0); mp = mask.load()
for y in range(h):
    for x in range(w):
        if inside[y][x] or not outside[y][x]: mp[x,y] = 255
if ERODE > 1: mask = mask.filter(ImageFilter.MinFilter(ERODE))
mask = mask.filter(ImageFilter.GaussianBlur(0.6)).point(lambda v: 0 if v < 150 else 255)

box = mask.getbbox()
im.putalpha(mask)
out = im.crop(box).resize((320,320), Image.LANCZOS)

p = out.load(); ring = []
for y in range(320):
    for x in range(320):
        if p[x,y][3] == 0: continue
        if any(not (0<=x+dx<320 and 0<=y+dy<320) or p[x+dx,y+dy][3]==0
               for dx,dy in ((1,0),(-1,0),(0,1),(0,-1))):
            ring.append(lum(p[x,y]))
ring.sort()
print(f'erode={ERODE:>2}  ring n={len(ring):>4}  median={ring[len(ring)//2]:>3}  p95={ring[int(len(ring)*0.95)]:>3}  max={ring[-1]:>3}')
if len(sys.argv) > 2:
    out.save('emblem-dark.png','PNG',optimize=True)
    print('saved', f'{os.path.getsize("emblem-dark.png")/1024:.0f} KB')
