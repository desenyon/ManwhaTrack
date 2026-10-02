# Violet / Folio — design study 02

The revised [interactive prototype](ui-direction.html) replaces the first visual study. The audit findings and extension implementation are unchanged.

The supplied references guide the visual vocabulary: violet and ivory duotone illustration, detailed stipple and engraving, serif editorial type, small utility typography, thin rules, and artwork that anchors the composition. The hands are the primary identity; the landscape provides a quieter colophon.

The wide library uses an illustrated Continue section and a four-column shelf. The side-panel preview puts the hands above the reading position and switches to compact rows. Paper and Night themes, grid/list, sorting, search, filters, favorites, series details, and sample history are implemented in the prototype. Continue displays its fictional destination. Export downloads fictional demo records. No production library is accessed or modified.

Covers are original illustrative editions made from these assets, not scraped covers of real series. Production would retain each series' locally cached cover.

## Artwork

Generated with the built-in imagegen tool. No external image URLs or remote fonts are used by the prototype. Images are decorative; the relevant reading information is HTML text.

- [Violet hands](assets/violet-hands.png)
- [Violet landscape](assets/violet-landscape.png)

### Hands — final prompt

Create a finished website illustration asset, NOT a UI mockup, NO TEXT. Wide panoramic composition about 3:2 ratio. Two beautifully modeled classical sculptural human hands reaching toward one another with fingertips nearly touching in the center, the left hand reaching diagonally down from left and the right hand extending from right, cropped forearms. Inspired by a Renaissance engraving and the Creation of Adam hands, but original composition. Soft voluminous clouds surround and underpin the hands. Strict two-ink risograph aesthetic in vibrant deep ultramarine-violet (#3921c9 / #3c22d8) and warm pale ivory (#f4f0df), with occasional intermediate violet tones formed entirely through tiny densely packed stippled dots and intricate engraved hatch marks. A richly detailed, pixelated halftone rendering, not smooth vector shapes, no gradients. High contrast violet ground, ivory dot-rendered hands and clouds. Hands are the main subject, expertly drawn anatomy and elegant long fingers. Contemporary art-book visual identity. The lower quarter is a violet field with sparse dotted cloud edges so it can blend into a violet UI. Edges bleed fully to the frame. No border, no signature, no typography, no watermark. It must look like a highly crafted detailed duotone print rather than generic digital art.

### Landscape — final prompt

Create a refined original engraved landscape illustration asset, no UI and NO TEXT. Panoramic wide landscape. Strict violet (#4025cc) and warm ivory (#f4f0df) duotone. Inspired by antique copperplate engraving, toile de Jouy, and contemporary dithered risograph websites. A deep wooded valley, rows of slender cypress trees, distant pale mountains and a single elegant old stone arched bridge spanning a reflective river in the lower center. Small classical architecture nested in hills, incredibly detailed foliage, rock contours and water reflections. Atmospheric depth through microscopic stippling, clustered pixels, dense engraving hatch lines, visible sophisticated ordered halftone texture. Keep the top 35 percent pure ivory empty sky. The mountains and trees fade into delicate ivory stipple along their skyline, lower half richly detailed in violet ink, edge to edge full bleed. Strong elegant composition readable at small scale, quiet and atmospheric, not a smooth vector illustration. No people, no horse, no words, no frame, no logos, no watermark. A premium printed-book landscape footer asset.

## Verification

JavaScript syntax parses and both local illustration files resolve. Computed foreground/background contrast: Paper body text 13.04:1, secondary 4.58:1, accent 7.77:1; Night body text 13.99:1, secondary 8.28:1, accent 8.86:1; violet Continue section secondary text 6.51:1. These calculations do not establish complete accessibility or rendered visual quality.

Rendered browser verification was not completed. Direct file navigation is blocked by browser policy; the sandbox denied the localhost server, and the elevated server request did not complete during the session. No screenshot or browser interaction pass is claimed.
