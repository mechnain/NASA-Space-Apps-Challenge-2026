# Moon data export

Scripts that build the data files for `src/frontend/moon-navigator/`.

- `terrain.py`: reads the NASA LOLA south-pole elevation model, and computes heights and terrain horizons.
- `horizons.py`: queries NASA/JPL Horizons for Sun and Earth positions, and caches the responses.
- `export_scene.py`: writes the terrain heights and `ephem.json` (Sun and Earth directions every 6 h for one year).

Needs Python 3 and numpy. `export_scene.py` writes `height.bin`. The app loads it as `height.png`: the same 16-bit values stored as R = high byte and G = low byte, with a +32768 offset.
