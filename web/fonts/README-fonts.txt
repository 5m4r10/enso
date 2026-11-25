TeX Gyre Heros — modified (subset) version
==========================================

These files are a DERIVED WORK of TeX Gyre Heros (c) GUST e-foundry,
distributed under the GUST Font License (LPPL 1.3c), see GUST-FONT-LICENSE.txt.

Original: CTAN package tex-gyre (opentype/texgyreheros-regular.otf, texgyreheros-bold.otf)
          https://ctan.org/pkg/tex-gyre   http://www.gust.org.pl/projects/e-foundry/tex-gyre

Changes (2026-11-23): glyph subset + WOFF2 compression with fontTools 4.68.0 pyftsubset.
Font naming tables are kept intact (original copyright/license notices preserved).

  pyftsubset texgyreheros-<weight>.otf --flavor=woff2 --name-IDs='*' --name-languages='*' \
    --unicodes=U+0020-007E,U+00A0-00FF,U+0100-017F,U+2010-2027,U+2030-203A,U+20AC,U+2190-2193,U+2212

Coverage: Basic Latin, Latin-1, Latin Extended-A (incl. ō), general punctuation (· — …),
euro sign, arrows (←↑→↓), minus. Default OpenType features (kern, liga, locl).
Glyphs outside this range fall back to the next font in the CSS stack.
