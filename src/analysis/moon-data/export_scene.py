"""Export data for the 3D scene (prototype/moon/):
  height.bin  Int16 2048x2048, metres above the 1737.4 km sphere, 300 m grid over +-307.2 km around the south pole
              grid axes: col i -> wx = +Y_me (lon 90E), row j -> wz = -X_me (lon 0 is -wz)
  ephem.json  Sun and Earth unit vectors in the scene frame (wx,wy,wz) = (Y_me, -Z_me, -X_me), 6 h steps for one year
"""
import sys, os, json, datetime as dt
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from horizons import query
import terrain as T; T.YS = -1
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "prototype", "moon"); os.makedirs(OUT, exist_ok=True)
R = 1737.4; N = 2048; L = 614.4
c = (np.arange(N) + 0.5) / N * L - L / 2
wx, wz = np.meshgrid(c, c)                      # row j -> wz, col i -> wx
rho = np.hypot(wx, wz)
lat = -np.degrees(np.arccos(np.clip(rho / R, 0, 1)))
lon = np.degrees(np.arctan2(wx, -wz))
h = T.height(lat, lon)
np.clip(np.round(h), -32000, 32000).astype('<i2').tofile(os.path.join(OUT, "height.bin"))
print("height", h.min(), h.max(), os.path.getsize(os.path.join(OUT, "height.bin")))

def vec(lat, lon, az, el):
    p, l, a, e = map(np.radians, (lat, lon, az, el))
    E = np.array([-np.sin(l), np.cos(l), 0.0]); Nn = np.array([-np.sin(p)*np.cos(l), -np.sin(p)*np.sin(l), np.cos(p)])
    U = np.array([np.cos(p)*np.cos(l), np.cos(p)*np.sin(l), np.sin(p)])
    v = np.cos(e)[:, None]*(np.sin(a)[:, None]*E + np.cos(a)[:, None]*Nn) + np.sin(e)[:, None]*U
    return np.stack([v[:, 1], -v[:, 2], -v[:, 0]], 1)   # scene frame

YEAR = ("2026-11-14 00:00", "2027-11-14 00:00", "6h")
def site_vecs(lat, lon):
    alt = round(float(T.height(np.array(lat), np.array(lon))) / 1000, 3); out = {}
    for body, key in (("10", "sun"), ("399", "earth")):
        rows, _ = query(body, lon, lat, alt, *YEAR)
        out[key] = vec(lat, lon, np.array([r[1] for r in rows]), np.array([r[2] for r in rows]))
        out["t0"] = dt.datetime.strptime(rows[0][0], "%Y-%b-%d %H:%M").isoformat() + "Z"
    return out
a = site_vecs(-85.99, 2.9); b = site_vecs(-89.45, 222.69)
for k in ("sun", "earth"):
    d = np.degrees(np.arccos(np.clip((a[k]*b[k]).sum(1), -1, 1)))
    print(k, "max angle between two sites' vectors (deg):", d.max().round(4), "| pole elevation range (deg):", np.degrees(np.arcsin(a[k][:, 1])).min().round(2), np.degrees(np.arcsin(a[k][:, 1])).max().round(2))
json.dump({"t0": a["t0"], "stepH": 6, "n": len(a["sun"]), "sun": np.round(a["sun"], 5).ravel().tolist(), "earth": np.round(a["earth"], 5).ravel().tolist()},
          open(os.path.join(OUT, "ephem.json"), "w"), separators=(",", ":"))
print("ephem", os.path.getsize(os.path.join(OUT, "ephem.json")))
