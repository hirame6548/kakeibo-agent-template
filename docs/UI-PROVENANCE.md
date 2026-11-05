# Public-preview UI drawing provenance

The earlier inline icon path strings had no verified source attribution. They were removed from this candidate rather than slightly modified or assigned a guessed third-party license.

On 2026-11-05, this candidate defined new simple SVG compositions directly from lines, rectangles, circles and polylines. No external assets, icon library, downloaded references or image generator were used. This covers all 13 named icons: left, right, down, check, food, goods, home, transport, hobby, work, medical, other and pending. Their roles, 24×24 coordinate space and decorative accessibility attributes remain unchanged. The four static brand/overview/review/assets drawings were also replaced with newly defined primitive compositions. These are original contributions to this candidate under the owner-approved MIT policy, with the confirmed copyright-holder display hirame6548.

The other inline SVGs are mini-chart and asset-chart rendering code. They compute stacked bars, grid lines and labels from ledger data, not an imported illustration or icon asset. This update leaves those algorithms unchanged. The asset chart retains its accessible text label and per-bar titles.

Structural regression checks cover the icon inventory, allowed primitive types, absence of old SVG paths, wrapper accessibility and the labeled asset chart. Source-level and packaging checks are not a claim of fresh-account browser/mobile validation or a complete historical provenance audit of every line of application code.
