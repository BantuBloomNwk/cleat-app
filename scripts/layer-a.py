#!/usr/bin/env python3
"""Layer A: deterministic Unicode cleaning.

Strips the invisible carriers and lookalike characters that AI provenance marks
ride on, and reports the visible tells that need a human decision rather than a
blanket replace. Reporting instead of replacing matters for dashes: a global
dash substitution is how you end up with the ",word" bug, a comma with no space
after it, which is worse than the dash was.

Usage:
  layer-a.py FILE [FILE ...]        report only, exit 1 if anything found
  layer-a.py --fix FILE [FILE ...]  strip the invisible classes in place
"""
import sys, unicodedata

# Invisible carriers. Safe to delete outright.
ZERO_WIDTH = {0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF}
SOFT_HYPHEN = {0x00AD}                      # the "unnecessary hyphen" that never prints
BIDI        = set(range(0x202A, 0x202F)) | set(range(0x2066, 0x206A))
TAGS        = set(range(0xE0000, 0xE0080))
IGNORABLE   = {0x2065} | set(range(0xFFF0, 0xFFF9)) \
              | set(range(0xE0000, 0xE0100)) | set(range(0xE01F0, 0xE1000))
NONCHAR     = set(range(0xFDD0, 0xFDF0)) | {c for p in range(17) for c in (p*0x10000+0xFFFE, p*0x10000+0xFFFF)}
DELETE = ZERO_WIDTH | SOFT_HYPHEN | BIDI | TAGS | IGNORABLE | NONCHAR

# Exotic spaces. Normalised to a plain space.
SPACES = {0x00A0, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
          0x2007, 0x2008, 0x2009, 0x200A, 0x202F, 0x205F, 0x3000}

# Cyrillic and Greek characters that render as Latin. Mapped back to Latin.
HOMOGLYPH = {
    0x0410:'A',0x0412:'B',0x0415:'E',0x041A:'K',0x041C:'M',0x041D:'H',0x041E:'O',
    0x0420:'P',0x0421:'C',0x0422:'T',0x0425:'X',0x0430:'a',0x0435:'e',0x043E:'o',
    0x0440:'p',0x0441:'c',0x0443:'y',0x0445:'x',0x0456:'i',
    0x0391:'A',0x0392:'B',0x0395:'E',0x0397:'H',0x0399:'I',0x039A:'K',0x039C:'M',
    0x039D:'N',0x039F:'O',0x03A1:'P',0x03A4:'T',0x03A5:'Y',0x03A7:'X',
    0x03B1:'a',0x03B5:'e',0x03BF:'o',0x03C1:'p',
}

# Visible tells. Reported, never auto-changed.
REPORT = {0x2014:'em dash', 0x2013:'en dash', 0x2212:'minus sign',
          0x2018:'left single quote', 0x2019:'right single quote',
          0x201C:'left double quote', 0x201D:'right double quote',
          0x2026:'ellipsis character'}

def scan(text):
    found, visible = {}, {}
    for ch in text:
        cp = ord(ch)
        if cp in DELETE:
            found.setdefault('invisible carrier', {}).setdefault(cp, 0)
            found['invisible carrier'][cp] += 1
        elif cp in SPACES:
            found.setdefault('exotic space', {}).setdefault(cp, 0)
            found['exotic space'][cp] += 1
        elif cp in HOMOGLYPH:
            found.setdefault('homoglyph', {}).setdefault(cp, 0)
            found['homoglyph'][cp] += 1
        elif cp in REPORT:
            visible.setdefault(cp, 0)
            visible[cp] += 1
    return found, visible

def clean(text):
    out = []
    for ch in text:
        cp = ord(ch)
        if cp in DELETE:      continue
        if cp in SPACES:      out.append(' '); continue
        if cp in HOMOGLYPH:   out.append(HOMOGLYPH[cp]); continue
        out.append(ch)
    return unicodedata.normalize('NFC', ''.join(out))

def name(cp):
    try: return unicodedata.name(chr(cp))
    except ValueError: return 'unnamed'

def main():
    args = sys.argv[1:]
    fix = '--fix' in args
    paths = [a for a in args if not a.startswith('--')]
    if not paths:
        print(__doc__.strip()); return 2
    dirty = 0
    for p in paths:
        text = open(p, encoding='utf-8').read()
        found, visible = scan(text)
        if not found and not visible:
            print('clean   %s' % p); continue
        dirty = 1
        print('FLAGGED %s' % p)
        for kind, counts in found.items():
            for cp, n in sorted(counts.items()):
                print('   %-18s U+%04X %-34s x%d' % (kind, cp, name(cp), n))
        for cp, n in sorted(visible.items()):
            print('   %-18s U+%04X %-34s x%d  (decide by hand)' % ('visible tell', cp, REPORT[cp], n))
        if fix and found:
            open(p, 'w', encoding='utf-8').write(clean(text))
            print('   stripped the invisible classes, visible tells left for you')
    return dirty

if __name__ == '__main__':
    sys.exit(main())
