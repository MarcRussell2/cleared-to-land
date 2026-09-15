# Credits

## Aircraft models

Downloaded from [Poly Pizza](https://poly.pizza), all under the
[Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/) license.
They are bundled into `CTL.html`; the originals are in `assets/models/`.

Since 2026-09-14 the aircraft you fly are drawn in code (`src/art/airframes/`, the art
department's work) and these models are the FALLBACK, selectable per aircraft in
`src/aircraft/models.js` (`SHIPS`) and used if a procedural airframe is switched off.
The files stay in the repository and in the build, so the credits stay too.

| In game | Model | Author | Source |
|---------|-------|--------|--------|
| Skylark 172 (trainer) | Small Airplane | Vojtěch Balák | https://poly.pizza/m/7cvx6ex-xfL |
| Trailblazer (bush) | Biplane | (author on the model page) | https://poly.pizza/m/5zd26VYRL2U |
| Condor 700 (airliner) | Airplane 3268 | Remy Tauziac | https://poly.pizza/m/bjlICuVX1Sg |
| Sea Hornet (fighter) | Fighter jet | (author on the model page) | https://poly.pizza/m/100p3RNw-5Q |

Everything else (terrain, airports, carrier, trees, textures, sounds) is generated
procedurally by the game.

## Libraries

- [three.js](https://threejs.org) (MIT)
- [esbuild](https://esbuild.github.io) (MIT)

## Fonts

Barlow, Barlow Condensed and Share Tech Mono via Google Fonts (SIL Open Font License).

The models in `assets/models/` are not covered by the repository's MIT license: they stay
Creative Commons Attribution 3.0 works by the authors above.
