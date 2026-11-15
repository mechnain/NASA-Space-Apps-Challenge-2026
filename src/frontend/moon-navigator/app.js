// Lunar Landing Navigator — one real terrain, one real Sun, three cameras.
// Terrain: LOLA 240 m south-pole DEM resampled to 300 m. Sun/Earth: JPL Horizons. Units: km.
// Scene frame: +y is "up" at the south pole, lon 0 points to -z, lon 90E to +x. Curvature is real (1:1).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const R = 1737.4, NTEX = 2048, L = 614.4, CAP = 300, M = 1024, DEG = 180 / Math.PI;
let MISSION = 14 * 24, DRAIN = 2; const PLAY_S = 50, BAND = { S: 0, X: 0, Ka: 0 };   // a link needs line of sight to Earth; no invented per-band margins
const $ = id => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const MD = () => MISSION / 24, mdTxt = () => { const n = MD(); return ({ 7: 'seven', 14: 'fourteen', 28: 'twenty-eight' })[n] || String(n); };
const SITES0 = [['Connecting Ridge', -89.45, 222.69], ['Peak near Cabeus B', -84.2, 295.0], ['Haworth', -86.9, 336.0], ['Malapert Massif', -85.99, 2.9],
  ['Mons Mouton', -84.79, 29.19], ['Nobile Rim 1', -85.4, 37.0], ['de Gerlache Rim 2', -88.6, 292.0]];

// ───────────────────────── data ─────────────────────────
// heights travel as a lossless PNG (red = high byte, green = low byte, +32768 offset) so any static host can serve them
async function loadHeights(url) { const bmp = await createImageBitmap(await (await fetch(url)).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data, out = new Int16Array(c.width * c.height); for (let i = 0, k = 0; i < out.length; i++, k += 4) out[i] = ((d[k] << 8) | d[k + 1]) - 32768; return out; }
const [hi0, eph] = await Promise.all([loadHeights('height.png'), fetch('ephem.json').then(r => r.json())]);
window.__hsum = () => hi0.reduce((a, b) => a + b, 0);
const hi = hi0, H = new Float32Array(NTEX * NTEX);
for (let j = 0, k = 0; j < NTEX; j++) { const z = (j + .5) / NTEX * L - L / 2;
  for (let i = 0; i < NTEX; i++, k++) { const x = (i + .5) / NTEX * L - L / 2; H[k] = (R + hi[k] / 1000) * Math.sqrt(Math.max(0, 1 - (x * x + z * z) / (R * R))) - R; } }
function groundY(x, z) { // bilinear sample of the data surface
  const u = clamp((x + L / 2) / L * NTEX - .5, 0, NTEX - 1.001), v = clamp((z + L / 2) / L * NTEX - .5, 0, NTEX - 1.001), i = u | 0, j = v | 0, fu = u - i, fv = v - j, k = j * NTEX + i;
  return (H[k] * (1 - fu) + H[k + 1] * fu) * (1 - fv) + (H[k + NTEX] * (1 - fu) + H[k + NTEX + 1] * fu) * fv;
}
const T0 = Date.parse(eph.t0), NE = eph.n, FMAX = 350 * 4;
function vecAt(arr, f, out) { const i = clamp(Math.floor(f), 0, NE - 2), k = clamp(f - i, 0, 1), a = i * 3;
  return out.set(arr[a] + (arr[a + 3] - arr[a]) * k, arr[a + 1] + (arr[a + 4] - arr[a + 1]) * k, arr[a + 2] + (arr[a + 5] - arr[a + 2]) * k).normalize(); }
const dateAt = (f, o) => new Date(T0 + f * 6 * 36e5).toLocaleDateString('en-GB', { timeZone: 'UTC', ...o });

// ───────────────────────── site analysis (same terrain the eye sees) ─────────────────────────
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
function makeSite(name, lat, lon, x, z) {
  if (x === undefined) { const rho = R * Math.cos(lat / DEG); x = rho * Math.sin(lon / DEG); z = -rho * Math.cos(lon / DEG); }
  else { const rho = Math.hypot(x, z); lat = -Math.acos(rho / R) * DEG; lon = (Math.atan2(x, -z) * DEG + 360) % 360; }
  const P = new THREE.Vector3(x, groundY(x, z), z), U = P.clone().add(new THREE.Vector3(0, R, 0)).normalize();
  const rho = Math.hypot(x, z) || 1e-6, E = new THREE.Vector3(-z / rho, 0, x / rho), Nn = new THREE.Vector3().crossVectors(U, E).normalize(); // north = away from the pole
  if (Nn.x * x + Nn.z * z < 0) Nn.negate();
  const hz = new Float32Array(360), eye = P.clone().addScaledVector(U, 0.002);
  for (let a = 0; a < 360; a++) { const s = Math.sin(a / DEG), c = Math.cos(a / DEG), dx = s * E.x + c * Nn.x, dy = s * E.y + c * Nn.y, dz = s * E.z + c * Nn.z; let best = -90;
    for (let d = 0.3; d < 280; d += Math.max(0.15, d * 0.012)) { const gx = eye.x + dx * d, gz = eye.z + dz * d; if (Math.abs(gx) > L / 2 - 1 || Math.abs(gz) > L / 2 - 1) break;
      tmp.set(gx - eye.x, groundY(gx, gz) - eye.y, gz - eye.z); const el = Math.asin(clamp(tmp.dot(U) / tmp.length(), -1, 1)) * DEG; if (el > best) best = el; }
    hz[a] = best; }
  return { name, lat, lon, P, U, E, Nn, hz, year: null };
}
function margin(s, v) { // degrees the body's centre clears the terrain horizon
  const el = Math.asin(clamp(v.dot(s.U), -1, 1)) * DEG, az = (Math.atan2(v.dot(s.E), v.dot(s.Nn)) * DEG + 360) % 360, a = az | 0, k = az - a;
  return el - (s.hz[a % 360] * (1 - k) + s.hz[(a + 1) % 360] * k);
}
const sunFrac = m => { const x = clamp(m / 0.267, -1, 1); return clamp(0.5 + (x * Math.sqrt(1 - x * x) + Math.asin(x)) / Math.PI, 0, 1); };   // exact visible area of the 0.534° solar disc above a straight horizon
const charge = m => m > -0.267 ? 3 * sunFrac(m) - (m > 0 ? 0 : DRAIN * (1 - sunFrac(m))) : -DRAIN;   // %/h: +3 in full Sun, -DRAIN in the dark (100/DRAIN hours of battery)
const vs = new THREE.Vector3(), ve = new THREE.Vector3();
function judge(s, f0) {
  let sun = 0, link = 0, both = 0, bat = 100, deadDay = 0, firstDark = -1, lit0 = false;
  for (let h = 0; h < MISSION; h++) { const f = f0 + h / 6, ms = margin(s, vecAt(eph.sun, f, vs)), me = margin(s, vecAt(eph.earth, f, ve)), Lt = ms > 0, Et = me > 0;
    if (h === 0) lit0 = Lt; const fr = sunFrac(ms); sun += fr; link += Et; both += Et ? fr : 0; if (!Lt && firstDark < 0) firstDark = h;
    bat = clamp(bat + charge(ms), 0, 100); if (bat <= 0 && !deadDay) deadDay = (h / 24 | 0) + 1; }
  return { sun: sun / MISSION, link: link / MISSION, both: both / MISSION, deadDay, firstDark, lit0, score: deadDay ? -1 : both / MISSION };
}
function yearOf(s) { if (!s.year) { s.year = []; for (let d = 0; d <= 350; d++) s.year.push(judge(s, d * 4)); } return s.year; }
function bestDay(s, day) { const y = yearOf(s); let b = day;
  for (let d = 0; d <= 350; d++) if (y[d].score > y[b].score + 0.08 || (b !== day && y[d].score >= y[b].score - 0.001 && Math.abs(d - day) < Math.abs(b - day))) b = d;
  return b === day ? null : b; }
const sites = SITES0.map(a => makeSite(a[0], a[1], a[2]));
const ABOUT = {
  'Connecting Ridge': ['A ridge joining Shackleton and de Gerlache craters, among the best-lit ground at the pole. On NASA\'s 2022 list of Artemis III regions (not on the 2024 list of nine).', 'Approximate point: NASA names regions, not points'],
  'Peak near Cabeus B': ['A peak beside Cabeus B crater, on NASA\'s list of Artemis III candidate regions.', 'Approximate point: NASA names regions, not points'],
  'Haworth': ['High ground next to Haworth crater, whose floor never sees the Sun. An Artemis III candidate region.', 'Approximate point: NASA names regions, not points'],
  'Malapert Massif': ['A tall mountain whose slopes face Earth, which keeps radio contact unusually steady. An Artemis III candidate region.', 'Approximate point: NASA names regions, not points'],
  'Mons Mouton': ['A flat-topped mountain. Intuitive Machines\' Athena (IM-2) came down here on 6 March 2025, on its side in a cold, shadowed crater. The mission ended the next day.', 'Exact landing point (IM-2)'],
  'Nobile Rim 1': ['The rim of Nobile crater, an Artemis III candidate region. Its ridges often hide Earth.', 'Approximate point: NASA names regions, not points'],
  'de Gerlache Rim 2': ['The rim of de Gerlache crater, an Artemis III candidate region with long stretches of sunlight.', 'Approximate point: NASA names regions, not points'] };
sites.forEach(s => { [s.desc, s.exact] = ABOUT[s.name]; });
window.__validate = () => sites.map(s => { let lit = 0, up = 0; for (let i = 0; i < NE; i++) { lit += margin(s, vecAt(eph.sun, i, vs)) > 0; up += margin(s, vecAt(eph.earth, i, ve)) > 0; } return `${s.name}: sun ${(lit / NE * 100).toFixed(1)}% earth ${(up / NE * 100).toFixed(1)}%`; });

// ───────────────────────── renderer & scene ─────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.0002, 2e5);
const htex = new THREE.DataTexture(H, NTEX, NTEX, THREE.RedFormat, THREE.FloatType); htex.magFilter = htex.minFilter = THREE.LinearFilter; htex.needsUpdate = true;

// terrain mesh (CPU-displaced so the camera and lander can stand exactly on it)
const VY = new Float32Array((M + 1) * (M + 1)), pos = new Float32Array((M + 1) * (M + 1) * 3), idx = new Uint32Array(M * M * 6);
for (let j = 0, k = 0; j <= M; j++) for (let i = 0; i <= M; i++, k++) { const x = -L / 2 + i * L / M, z = -L / 2 + j * L / M, y = groundY(x, z); VY[k] = y; pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z; }
for (let j = 0, q = 0; j < M; j++) for (let i = 0; i < M; i++) { const a = j * (M + 1) + i, b = a + M + 1, c = b + 1, d = a + 1; idx[q++] = a; idx[q++] = b; idx[q++] = d; idx[q++] = b; idx[q++] = c; idx[q++] = d; }
function meshY(x, z) { const gx = clamp((x + L / 2) / L * M, 0, M - 1e-4), gz = clamp((z + L / 2) / L * M, 0, M - 1e-4), i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j, a = j * (M + 1) + i, ya = VY[a], yd = VY[a + 1], yb = VY[a + M + 1], yc = VY[a + M + 2];
  return fx + fz <= 1 ? ya + (yd - ya) * fx + (yb - ya) * fz : yc + (yb - yc) * (1 - fx) + (yd - yc) * (1 - fz); }
const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(new THREE.BufferAttribute(idx, 1));

const NOISE = `
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x), mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x), f.y); }
float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*vn(p); p=p*2.03+17.1; a*=.5; } return s; }`;
const VERT = `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vW; varying vec3 vN;
void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; vN=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*viewMatrix*w;
#include <logdepthbuf_vertex>
}`;
const U = { uH: { value: htex }, uSun: { value: new THREE.Vector3(0, .02, 1) }, uL: { value: L }, uExp: { value: 3.2 }, uAmb: { value: 0.016 }, uTexel: { value: L / NTEX },
  uLander: { value: new THREE.Vector3() }, uLanderLen: { value: 0 }, uPix: { value: 0.001 }, uOrig: { value: new THREE.Vector2() }, uEarthV: { value: new THREE.Vector3(0, .1, -1) }, uEarthI: { value: 0 } };
const terrain = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uH; uniform vec3 uSun, uLander, uEarthV; uniform float uL, uExp, uAmb, uTexel, uLanderLen, uPix, uEarthI; uniform vec2 uOrig; varying vec3 vW;
${NOISE}
float hgt(vec2 p){ return texture2D(uH, p/uL+.5).r; }
vec3 h3(vec2 p){ vec3 q=fract(vec3(p.xyx)*vec3(.1031,.103,.0973)); q+=dot(q,q.yxz+33.33); return fract((q.xxy+q.yxx)*q.zyx); }
// one octave of a crater field: bowl-shaped craters with raised rims, sizes drawn from a steep power law like real crater counts
vec3 craters(vec2 p, float S){
  vec2 q=p/S, ip=floor(q); float h=0., fresh=0.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 c=ip+vec2(x,y); vec3 r=h3(c+S*17.); if(r.z<.42) continue;
    float rad=.12+.5*pow(fract(r.z*7.13),3.); vec2 ctr=c+.2+.6*r.xy; float d=length(q-ctr)/rad;
    if(d<1.6){ float age=fract(r.x*13.7); float depth=.36*rad*mix(.35,1.,age);
      h+= d<1. ? (d*d-1.)*depth : 0.; h+=.11*rad*mix(.4,1.,age)*exp(-pow((d-1.)/.22,2.)); fresh=max(fresh, age*(1.-smoothstep(.6,1.5,d))); } }
  return vec3(h*S, fresh, 0.);
}
void main(){
  #include <logdepthbuf_fragment>
  vec2 p=vW.xz; if(length(p)>${CAP}.) discard;
  float e=uTexel; vec3 n=normalize(vec3(hgt(p-vec2(e,0.))-hgt(p+vec2(e,0.)), 2.*e, hgt(p-vec2(0.,e))-hgt(p+vec2(0.,e))));
  vec3 v0=normalize(cameraPosition-vW); float dist=distance(cameraPosition,vW), fp=dist*uPix/max(dot(n,v0),.06);   // footprint stretches at grazing angles                         // ground size of one screen pixel, km
  // detail the data cannot hold (it has one point per 300 m): six crater octaves from 6 km down to 2 m, each shown only once it spans several pixels
  vec2 g=vec2(0.); float fresh=0.; float S=6.;
  for(int k=0;k<7;k++){ float w=smoothstep(fp*3.,fp*12.,S*.3); if(w>0.){ float ee=S*.03;
      vec2 pl=S<1.5?p-uOrig:p;                                                  // small craters use a nearby origin so float precision holds
      vec3 c0=craters(pl,S); float hx=craters(pl+vec2(ee,0.),S).x, hz=craters(pl+vec2(0.,ee),S).x;
      g+=w*vec2(hx-c0.x,hz-c0.x)/ee; fresh=max(fresh,w*c0.y); }
    S*=.33; }
  float rw=smoothstep(fp*6.,fp*24.,.004);                                       // centimetre-to-metre regolith roughness
  if(rw>0.){ vec2 m=(p-uOrig)*1500.; float b0=fbm(m), bx=fbm(m+vec2(.35,0.)), bz=fbm(m+vec2(0.,.35)); g+=rw*.45*vec2(bx-b0,bz-b0)/.35; }
  n=normalize(n+vec3(-g.x,0.,-g.y));
  // march toward the real Sun through the real terrain; the penumbra width is the Sun's true angular size
  vec3 sp=vec3(p.x,hgt(p)+.004,p.y); float sh=1., t=.45;
  for(int i=0;i<52;i++){ vec3 q=sp+uSun*t; if(abs(q.x)>uL*.5||abs(q.z)>uL*.5) break; float c=q.y-hgt(q.xz); sh=min(sh,.5+.5*c/(t*.00466)); if(sh<=0.) break; t*=1.13; }
  sh=clamp(sh,0.,1.);
  if(uLanderLen>0.){ vec2 sd=normalize(uSun.xz), dl=p-uLander.xz; float al=dot(dl,-sd), pe=abs(dl.x*sd.y-dl.y*sd.x);
    sh*=1.-smoothstep(.0026,.0012,pe)*step(0.,al)*smoothstep(uLanderLen,uLanderLen*.6,al); }
  // albedo: highland patches, darker old ground, bright fresh-crater ejecta
  float alb=.72+.2*fbm(p*.03)+.1*fbm((p-uOrig)*.4)+.28*fresh*fresh;
  // Lommel-Seeliger: how lunar regolith actually scatters light (why the full Moon looks like a flat disc, not a ball)
  vec3 v=normalize(cameraPosition-vW); float mu0=max(dot(n,uSun),0.), mu=max(dot(n,v),.04);
  float ls=mu0/(mu0+mu)*2.;
  float c=alb*(ls*sh*uExp + uEarthI*max(dot(n,uEarthV),0.)*uExp*9. + uAmb*.25*(.5+.5*n.y));
  vec3 col=vec3(c)*mix(vec3(1.,.985,.955), vec3(.86,.92,1.06), clamp(uEarthI*9.*(1.-sh),0.,1.));  // earthshine is faintly blue
  col=1.-exp(-col); col=pow(col,vec3(1./2.2));
  gl_FragColor=vec4(col, smoothstep(${CAP}.,${CAP - 150}.,length(p)));
}` }));
terrain.material.transparent = true; terrain.renderOrder = 1; terrain.frustumCulled = false; scene.add(terrain);

// the rest of the Moon, so the cap has a world under it
const moonTex = new THREE.TextureLoader().load('tex/moon_lroc_4k.jpg'); moonTex.anisotropy = 8;   // NASA LRO camera colour mosaic (CGI Moon Kit)
const moon = new THREE.Mesh(new THREE.SphereGeometry(R - 6, 256, 128), new THREE.ShaderMaterial({ uniforms: { uSun: U.uSun, uExp: U.uExp, uMap: { value: moonTex } }, vertexShader: VERT, fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSun; uniform float uExp; uniform sampler2D uMap; varying vec3 vW; varying vec3 vN;
void main(){
  #include <logdepthbuf_fragment>
  if(vW.y>-60. && length(vW.xz)<${CAP - 150}.) discard;                       // the real 3D terrain takes over here
  vec3 n=normalize(vN), me=vec3(-n.z, n.x, -n.y);                              // scene frame -> Moon mean-Earth frame
  vec2 uv=vec2(atan(me.y, me.x)/6.2831853+.5, asin(clamp(me.z,-1.,1.))/3.1415927+.5);
  vec3 alb=pow(texture2D(uMap, uv).rgb, vec3(2.2))*4.2;
  vec3 v=normalize(cameraPosition-vW); float mu0=max(dot(n,uSun),0.), mu=max(dot(n,v),.04);
  float rough=smoothstep(.0,.45,mu0)*mix(.45,1.,smoothstep(300.,1100.,length(vW.xz)));   // and the pole region is darker on average, which hides the seam                                           // under a low Sun, real rough ground is mostly shadow
  vec3 col=alb*(mu0/(mu0+mu))*2.*uExp*rough; col=1.-exp(-col); gl_FragColor=vec4(pow(col,vec3(1./2.2)),1.);
}` }));
moon.position.set(0, -R, 0); scene.add(moon);

// sky: stars, Sun (true 0.27° radius), Earth (true 0.95° radius), all kept at the camera so they sit at infinity
const SKY = 2e4, sky = new THREE.Group(); scene.add(sky);
const starMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uVis: { value: 1 }, uDpr: { value: 1 } },
  vertexShader: `attribute float b; varying float vb; uniform float uDpr; void main(){ vb=b; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); gl_PointSize=(1.1+2.4*b*b)*uDpr; }`,
  fragmentShader: `varying float vb; uniform float uVis; void main(){ float d=length(gl_PointCoord-.5)*2.; float a=exp(-d*d*4.); gl_FragColor=vec4(vec3(1.,.98,.95)*a*(.12+.9*vb)*uVis,1.); }` });
{ const n = 4200, p = new Float32Array(n * 3), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { tmp.randomDirection(); const band = Math.exp(-Math.pow(tmp.dot(new THREE.Vector3(.48, .2, .85)), 2) * 9); // a faint Milky Way band
    if (Math.random() > .35 + .65 * band) { i--; continue; } p.set([tmp.x * SKY * 2, tmp.y * SKY * 2, tmp.z * SKY * 2], i * 3); b[i] = Math.pow(Math.random(), 9); }   // few bright stars, many faint
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('b', new THREE.BufferAttribute(b, 1)); sky.add(new THREE.Points(g, starMat)); }
// The Sun: a 0.53° disc far brighter than anything else, seen through a camera lens. In vacuum there is no sky glow,
// only the optics: a tight halo, a soft bloom and a faint horizontal streak.
const sprite = (draw, w = 256, h = 256) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return tx; };
const radial = stops => sprite((g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); stops.forEach(([o, c]) => r.addColorStop(o, c)); g.fillStyle = r; g.fillRect(0, 0, w, h); });
const flareMat = map => new THREE.SpriteMaterial({ map, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
const SUN_R = SKY * 0.00466;
// disc: true 0.53°, overexposed white core with a faint warm limb (limb darkening)
const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(SUN_R, 64), new THREE.ShaderMaterial({ toneMapped: false, vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vP; void main(){ vP=position.xy/${SUN_R.toFixed(3)}; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
#include <logdepthbuf_vertex>
}`, fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
varying vec2 vP; void main(){
  #include <logdepthbuf_fragment>
  float r=length(vP); vec3 c=mix(vec3(1.), vec3(1.,.9,.74), smoothstep(.72,1.,r)); gl_FragColor=vec4(c,1.);
}` })); sky.add(sunDisc);
// lens optics, sized in screen space so they behave like a camera, not like objects in the sky
const optic = (map, s, order) => { const m = flareMat(map); m.depthTest = false; m.sizeAttenuation = false; const o = new THREE.Sprite(m); o.scale.setScalar(s); o.renderOrder = order; sky.add(o); return o; };
// Every pixel of the glare is computed from how light actually spreads in a lens: a blown-out core, a smooth veiling falloff,
// six diffraction spikes from a six-blade aperture (thin, soft, longer in red than blue), and faint hair-like streaks.
const lensTex = (N, fn) => { const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), im = g.createImageData(N, N), d = im.data;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const dx = (x + .5) / N * 2 - 1, dy = (y + .5) / N * 2 - 1, rgb = fn(Math.hypot(dx, dy), Math.atan2(dy, dx)), k = (y * N + x) * 4;
    for (let ch = 0; ch < 3; ch++) d[k + ch] = Math.min(255, Math.pow(Math.max(0, rgb[ch]), 1 / 2.2) * 255); d[k + 3] = 255; }
  g.putImageData(im, 0, 0); const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return tx; };
const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
const hairN = Array.from({ length: 720 }, () => Math.pow(Math.random(), 7));
const glareFn = (r, a) => { const core = Math.exp(-r * r * 900) * 1.2 + Math.exp(-r * 26) * .32 + .035 / (1 + Math.pow(r * 22, 2)), edge = Math.max(0, 1 - r);
  const hair = hairN[Math.floor(((a + Math.PI) / (2 * Math.PI)) * 720) % 720] * .22 * Math.exp(-r * 7) * edge; const v = (core + hair) * edge * edge; return [v, v * .985, v * .95]; };
const spikeFn = (r, a) => { const out = [0, 0, 0], sc = [1.07, 1, .92];
  for (let ch = 0; ch < 3; ch++) { const rr = r / sc[ch]; if (rr >= 1) continue; let s = 0;
    for (let k = 0; k < 6; k++) { let da = a - (k * Math.PI / 3 + .26); da = Math.atan2(Math.sin(da), Math.cos(da)); const perp = rr * Math.abs(Math.sin(da)); if (Math.cos(da) < 0) continue;
      s += Math.exp(-Math.pow(perp / (.0035 + .006 * rr), 2)) * (1 - rr) * (1 - rr) / (1 + rr * 9); }
    out[ch] = s * 1.6; }
  return out; };
const halo = optic(lensTex(256, glareFn), 0.5, 7);
const glow = optic(radial([[0, 'rgba(255,248,236,.32)'], [.1, 'rgba(255,246,232,.12)'], [.35, 'rgba(255,242,226,.035)'], [1, 'rgba(255,240,220,0)']]), 1.7, 5);
const streak = optic(lensTex(512, spikeFn), 0.72, 6);
// lens ghosts: faint aperture-shaped reflections on the line from the Sun through the centre of the frame
const ghostTex = lensTex(128, (r, a) => { const x = Math.abs(r * Math.cos(a)), y = Math.abs(r * Math.sin(a)), e = Math.max(y, x * .866 + y * .5) / .8; const v = .45 * (.3 + .7 * Math.pow(Math.min(e, 1), 5)) * (1 - smooth(.86, 1, e)); return [v * .72, v * .92, v]; });
const ghosts = [[-.45, .06, .05], [-.9, .1, .028], [.35, .035, .04]].map(([k, s, o]) => { const g = optic(ghostTex, s, 8); g.userData = { k, o }; return g; });
const flares = [halo, glow, streak];

// Earth: NASA Blue Marble imagery (day, night lights, clouds, ocean specular), true 1.9° size, lit by the real Sun so its phase is right.
const texL = new THREE.TextureLoader(), etex = n => { const x = texL.load('tex/' + n); x.anisotropy = 8; return x; };
const EM = { day: etex('earth_atmos_2048.jpg'), night: etex('earth_lights_2048.png'), cloud: etex('earth_clouds_1024.png'), spec: etex('earth_specular_2048.jpg') };
const earth = new THREE.Mesh(new THREE.SphereGeometry(SKY * 0.0166, 96, 64), new THREE.ShaderMaterial({
  uniforms: { uSun: U.uSun, uDay: { value: EM.day }, uNight: { value: EM.night }, uCloud: { value: EM.cloud }, uSpec: { value: EM.spec }, uCloudShift: { value: 0 } },
  vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vW; varying vec3 vN; varying vec2 vUv;
void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; vN=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*viewMatrix*w;
#include <logdepthbuf_vertex>
}`,
  fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSun; uniform sampler2D uDay, uNight, uCloud, uSpec; uniform float uCloudShift; varying vec3 vW; varying vec3 vN; varying vec2 vUv;
vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
void main(){
  #include <logdepthbuf_fragment>
  vec3 n=normalize(vN), v=normalize(cameraPosition-vW); float ndl=dot(n,uSun), lit=smoothstep(-.06,.12,ndl);
  vec3 day=lin(texture2D(uDay,vUv).rgb); float cl=texture2D(uCloud,vUv+vec2(uCloudShift,0.)).a; float sp=texture2D(uSpec,vUv).r;
  vec3 surf=mix(day, vec3(1.), cl*.92);
  vec3 col=surf*max(ndl,0.)*2.1;
  vec3 h=normalize(uSun+v); col+=vec3(1.,.96,.88)*sp*(1.-cl)*pow(max(dot(n,h),0.),70.)*1.4*lit;
  col+=lin(texture2D(uNight,vUv).rgb)*vec3(1.,.82,.55)*(1.-lit)*(1.-cl*.8)*.55;
  float fr=pow(1.-max(dot(n,v),0.),2.6); col+=vec3(.28,.52,1.)*fr*smoothstep(-.25,.35,ndl)*1.1;
  col=1.-exp(-col*1.25); gl_FragColor=vec4(pow(col,vec3(1./2.2)),1.);
}` })); sky.add(earth);
const qFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI), qSpin = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);

// lander, built in metres and lit only by the Sun it can actually see
const lander = new THREE.Group(), LM = 0.001;
{ const foil = new THREE.MeshStandardMaterial({ color: 0xb9925a, metalness: .85, roughness: .42 }), dark = new THREE.MeshStandardMaterial({ color: 0x1b1d22, metalness: .3, roughness: .6 }), white = new THREE.MeshStandardMaterial({ color: 0xd8d8d4, roughness: .7 });
  const add = (g, m, x, y, z) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); lander.add(o); return o; };
  add(new THREE.CylinderGeometry(.85, .85, 3, 6), foil, 0, 2.6, 0); add(new THREE.CylinderGeometry(.5, .85, .5, 6), white, 0, 4.35, 0);
  for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3, leg = add(new THREE.CylinderGeometry(.045, .045, 2.3, 6), white, Math.sin(a) * 1.45, .95, Math.cos(a) * 1.45); leg.rotation.set(Math.cos(a) * .62, 0, -Math.sin(a) * .62);
    add(new THREE.CylinderGeometry(.24, .24, .06, 12), white, Math.sin(a) * 2.12, .03, Math.cos(a) * 2.12); }
  for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3 + .5, pnl = add(new THREE.BoxGeometry(1.25, 2.2, .04), dark, Math.sin(a) * .9, 2.7, Math.cos(a) * .9); pnl.rotation.y = a; }
  const dish = add(new THREE.SphereGeometry(.42, 20, 10, 0, Math.PI * 2, 0, 1.1), white, 0, 5.2, 0); dish.rotation.x = Math.PI; add(new THREE.CylinderGeometry(.03, .03, .7, 6), white, 0, 4.9, 0);
  lander.scale.setScalar(LM); lander.visible = false; scene.add(lander); }
// boulders around the lander: sizes follow a steep power law (many pebbles, few metre-scale rocks), lit only by the visible Sun
const ROCKS = 900, rockGeo = new THREE.IcosahedronGeometry(1, 2);
{ const pa = rockGeo.attributes.position; for (let i = 0; i < pa.count; i++) { tmp.fromBufferAttribute(pa, i); const k = 1 + .28 * Math.sin(tmp.x * 3.1 + tmp.y * 1.7) * Math.cos(tmp.z * 2.3) + .12 * Math.sin(tmp.y * 7.3 + tmp.x * 5.1); tmp.multiplyScalar(k); tmp.y *= .62; pa.setXYZ(i, tmp.x, tmp.y, tmp.z); } rockGeo.computeVertexNormals(); }
const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x8a867f, roughness: 1, metalness: 0, flatShading: true }), ROCKS); rocks.visible = false; scene.add(rocks);
function scatterRocks(s) { const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = s.U, rnd = (k => () => (k = (k * 16807) % 2147483647) / 2147483647)(Math.floor(Math.abs(s.P.x * 1e4 + s.P.z * 7e3)) + 11);
  for (let i = 0; i < ROCKS; i++) { const r = 0.006 + 0.16 * Math.pow(rnd(), .7), a = rnd() * Math.PI * 2, x = s.G.x + Math.cos(a) * r, z = s.G.z + Math.sin(a) * r;
    const size = 0.00007 * Math.pow(1 - rnd() * .985, -1.1); q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.3));
    sc.set(size * (.7 + .6 * rnd()), size * (.5 + .5 * rnd()), size * (.7 + .6 * rnd())); m.compose(new THREE.Vector3(x, meshY(x, z) - size * .25, z), q, sc); rocks.setMatrixAt(i, m); }
  rocks.instanceMatrix.needsUpdate = true; }
const sunLight = new THREE.DirectionalLight(0xfff6e8, 0), fill = new THREE.AmbientLight(0x8fa6c8, 0.02); scene.add(sunLight, sunLight.target, fill);

// table furniture: a rim, and pins with labels that live on the terrain
const rim = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 360 }, (_, i) => new THREE.Vector3(Math.sin(i / DEG) * 303, -26.2, Math.cos(i / DEG) * 303))), new THREE.LineBasicMaterial({ color: 0x8a8985, transparent: true, opacity: .55 })); rim.visible = false; scene.add(rim);
const labels = [], pinLines = new THREE.Group(); scene.add(pinLines);
function addLabel(el, getPos, visible) { $('labels').appendChild(el); labels.push({ el, getPos, visible }); return el; }
function pinFor(s, i) { const el = document.createElement('button'); el.className = 'pin'; el.innerHTML = `<span class="n"><i class="ps"></i><i class="pe"></i><b class="pn"></b></span>`; el.querySelector('.pn').textContent = s.name; el.title = 'Sun dot: white when sunlit. Earth dot: blue when Earth is visible.';
  el.onclick = () => select(sites.indexOf(s)); el.style.setProperty('--d', (i * 70 + 150) + 'ms'); s.el = el; s.top = s.P.clone().addScaledVector(s.U, 16);
  s.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([s.P, s.top]), new THREE.LineBasicMaterial({ color: 0xeceae5, transparent: true, opacity: .5 })); pinLines.add(s.line);
  addLabel(el, () => s.top, () => state.mode === 'table' && !state.far); }
sites.forEach(pinFor);
const tag = t => { const e = document.createElement('span'); e.className = 'tag'; e.textContent = t; return e; };
const poleRing = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 180 }, (_, i) => { const a = i / 180 * Math.PI * 2, r = 300; return new THREE.Vector3(Math.sin(a) * r, Math.sqrt(R * R - r * r) - R + 4, Math.cos(a) * r); })),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false })); poleRing.renderOrder = 9; scene.add(poleRing);
const poleTagPos = new THREE.Vector3(0, 520, 0), poleTag = tag('South pole'); poleTag.classList.add('poletag'); addLabel(poleTag, () => poleTagPos, () => (state.mode === 'intro' && state.p < 0.3) || (state.mode === 'table' && state.far));
const sunTagPos = new THREE.Vector3(), earthTagPos = new THREE.Vector3();
const sunTag = tag('Sun'), earthTag = tag('Earth'); sunTag.classList.add('bodytag', 'sun'); earthTag.classList.add('bodytag', 'earthb');
const bodyVis = () => false;   // replaced by the compass
addLabel(sunTag, () => sunTagPos, bodyVis); addLabel(earthTag, () => earthTagPos, bodyVis);

// compass: where the Sun and Earth are, seen from above, turned to match the camera
const cmp = document.getElementById('compass'), cg = cmp.getContext('2d');
function drawCompass(f) { const s = sites[state.sel], dpr = Math.min(2, devicePixelRatio), S = 132; if (cmp.width !== S * dpr) { cmp.width = cmp.height = S * dpr; }
  const fw = new THREE.Vector3().subVectors(controls.target, camera.position); fw.y = 0; fw.normalize(); const rt = new THREE.Vector3(-fw.z, 0, fw.x), c = S * dpr / 2, R0 = c - 16 * dpr;
  cg.clearRect(0, 0, cmp.width, cmp.height); cg.strokeStyle = 'rgba(236,234,229,.25)'; cg.lineWidth = dpr; cg.beginPath(); cg.arc(c, c, R0, 0, 7); cg.stroke();
  cg.fillStyle = '#eceae5'; cg.beginPath(); cg.arc(c, c, 3 * dpr, 0, 7); cg.fill();
  const one = (v, col, name, key) => { const h = new THREE.Vector3(v.x, 0, v.z).normalize(), x = h.dot(rt), y = h.dot(fw), m = margin(s, v), up = m > 0;
    const px = c + x * R0, py = c - y * R0; cg.globalAlpha = up ? 1 : .45; cg.strokeStyle = col; cg.setLineDash(up ? [] : [3 * dpr, 3 * dpr]); cg.beginPath(); cg.moveTo(c, c); cg.lineTo(px, py); cg.stroke(); cg.setLineDash([]);
    cg.fillStyle = col; cg.beginPath(); cg.arc(px, py, (key === 'sun' ? 6 : 5) * dpr, 0, 7); cg.fill();
    if (key === 'sun' && up) { cg.strokeStyle = 'rgba(236,234,229,.5)'; cg.beginPath(); cg.moveTo(c, c); cg.lineTo(c - x * R0 * .6, c + y * R0 * .6); cg.stroke(); }   // shadows fall the other way
    cg.globalAlpha = 1; const el = $(key === 'sun' ? 'kSun' : 'kEarth');   // the word is translated once; only the number (never translated) changes
    if (!el.firstChild) el.innerHTML = `<span>${name}</span> <span class="notranslate" translate="no"></span>`;
    const t = `${m > 0 ? '+' : ''}${m.toFixed(1)}°`, nv = el.lastChild; if (nv.textContent !== t) nv.textContent = t; const cl = up ? key : 'off'; if (el.className !== cl) el.className = cl; };
  one(vecAt(eph.sun, f, new THREE.Vector3()), '#fff4d6', 'Sun', 'sun'); one(vecAt(eph.earth, f, new THREE.Vector3()), '#86b6ea', 'Earth', 'earth'); }

// ───────────────────────── state & cameras ─────────────────────────
const state = { mode: 'intro', f: 17 * 4, sel: 3, playing: false, p: 0, pT: 0, t: 0, f0: 0, bat: 100, dead: false, deadDay: 0, yaw: 0, pitch: 0, tween: null };
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, -14, 0); controls.enableDamping = true; controls.minDistance = 140; controls.maxDistance = 7500; controls.maxPolarAngle = 1.25; controls.enablePan = false; controls.enabled = false;
const TABLE_POS = new THREE.Vector3(60, 520, 330), MM = sites[4].P;
const KEYS = [[new THREE.Vector3(3400, 1500, 8600), new THREE.Vector3(-900, -1450, 0)], [new THREE.Vector3(650, 1050, 1500), new THREE.Vector3(0, -60, 0)],
  [MM.clone().add(new THREE.Vector3(-60, 120, 240)), MM.clone()], [TABLE_POS.clone(), controls.target.clone()]];
{ const sv = vecAt(eph.sun, 8, new THREE.Vector3()), h = new THREE.Vector3(sv.x, 0, sv.z).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.75);
  const C = new THREE.Vector3(0, -R, 0), tilt = 1.0;                             // look down onto the pole so it sits clearly on the Moon's face
  KEYS[0][0].copy(C).addScaledVector(h, 9000 * Math.cos(tilt)).add(new THREE.Vector3(0, 9000 * Math.sin(tilt), 0)); const side = new THREE.Vector3().crossVectors(h, new THREE.Vector3(0, 1, 0)).normalize();
  KEYS[0][1].copy(C).add(new THREE.Vector3(0, 250, 0)).addScaledVector(side, 1100);
  // every later shot stays on this same sunlit side, so the flight never swings sideways
  const up = new THREE.Vector3(0, 1, 0);
  KEYS[1][0].copy(h).multiplyScalar(1500).addScaledVector(up, 1250); KEYS[1][1].set(0, -60, 0).addScaledVector(side, 120);
  KEYS[2][0].copy(MM).addScaledVector(h, 230).addScaledVector(up, 130); KEYS[2][1].copy(MM);
  TABLE_POS.copy(h).multiplyScalar(360).addScaledVector(up, 520); KEYS[3][0].copy(TABLE_POS); KEYS[3][1].copy(controls.target); }
const camPath = new THREE.CatmullRomCurve3(KEYS.map(k => k[0]), false, 'centripetal'), lookPath = new THREE.CatmullRomCurve3(KEYS.map(k => k[1]), false, 'centripetal');
const ease = x => x * x * (3 - 2 * x), look = new THREE.Vector3();
function introCamera(p) { const u = ease(clamp(p, 0, 1)); camPath.getPoint(u, camera.position); lookPath.getPoint(u, look); camera.up.set(0, 1, 0); camera.lookAt(look); }   // one continuous flight, eased once
function show(id, on) { $(id).classList.toggle('hidden', !on); }
function setMode(m) { state.mode = m; document.body.classList.toggle('ontable', m === 'table'); controls.enabled = m === 'table';
  show('intro', m === 'intro'); show('site', m === 'table'); show('modes', m === 'table'); show('zoom', m === 'table'); show('planp', m === 'table' && state.ui === 'plan'); show('why', m === 'table' && state.why); show('time', m === 'table'); show('hint', m === 'table'); show('hud', m === 'boots'); show('end', m === 'end');
  pinLines.visible = m === 'table'; rim.visible = false; lander.visible = rocks.visible = m === 'boots' || m === 'end' || m === 'fly';
  if (m === 'table') { camera.up.set(0, 1, 0); camera.fov = 38; camera.updateProjectionMatrix(); refreshSite(); } }
function tweenTo(posTo, quatTo, fovTo, dur, done) { state.tween = { p0: camera.position.clone(), q0: camera.quaternion.clone(), p1: posTo.clone(), q1: quatTo.clone(), f0: camera.fov, f1: fovTo, t: 0, dur, done }; }

// boots: stand 20 m from the lander, 3 m up, facing Earth
const dir = new THREE.Vector3(), eyeP = new THREE.Vector3(), probe = new THREE.Object3D();
function bootsDir(s, yaw, pitch, out) { return out.set(0, 0, 0).addScaledVector(s.E, Math.sin(yaw) * Math.cos(pitch)).addScaledVector(s.Nn, Math.cos(yaw) * Math.cos(pitch)).addScaledVector(s.U, Math.sin(pitch)); }
function placeLander(s) { const y = meshY(s.P.x, s.P.z); s.G = new THREE.Vector3(s.P.x, y, s.P.z); lander.position.copy(s.G); lander.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), s.U); U.uLander.value.copy(s.G); scatterRocks(s); }
function bootsEye(s, out) { bootsDir(s, state.yaw0, 0, dir); out.copy(s.G).addScaledVector(dir, -0.021).addScaledVector(tmp2.crossVectors(dir, s.U), -0.006); out.y = meshY(out.x, out.z); return out.addScaledVector(s.U, 0.0031); }
function standHere(f0) {
  const s = sites[state.sel]; setPlay(false);
  state.fovT = 52; state.f0 = clamp(Math.round(f0 * 6) / 6, 0, FMAX); state.f = state.f0; state.t = 0; state.bat = 100; state.dead = false; state.deadDay = 0; state.said = {}; state.endAt = 0;
  placeLander(s); const me = margin(s, vecAt(eph.earth, state.f0, ve)); const tv = me > -4 ? ve : vecAt(eph.sun, state.f0, vs);
  state.yaw0 = state.yaw = Math.atan2(tv.dot(s.E), tv.dot(s.Nn)); state.pitch = 0.035;
  bootsEye(s, eyeP); probe.position.copy(eyeP); probe.up.copy(s.U); probe.lookAt(tmp.copy(eyeP).add(bootsDir(s, state.yaw, state.pitch, dir))); // Object3D.lookAt points +z at the target; cameras look down -z
  probe.rotateY(Math.PI);
  buildEvents(s); setPause(false); controls.enabled = false; setMode('fly'); camera.up.copy(s.U);
  nav('surface'); tweenTo(eyeP, probe.quaternion, 52, 3.2, () => { setMode('boots'); startAudio(); const ms = margin(s, vecAt(eph.sun, state.f0, vs)); say(ms > 0 ? `Touchdown. The Sun is ${ms.toFixed(1)}° above the ridge.` : 'Touchdown, in shadow. There is no sunlight here.'); });
}
function backToTable() { stopAudio(); show('end', false); show('hud', false); state.mode = 'fly'; U.uLanderLen.value = 0; lander.visible = rocks.visible = false;
  probe.position.copy(TABLE_POS); probe.up.set(0, 1, 0); probe.lookAt(controls.target); probe.rotateY(Math.PI); tweenTo(TABLE_POS, probe.quaternion, 38, 2.2, () => { controls.update(); setMode('table'); }); }

// ───────────────────────── table UI ─────────────────────────
const days = h => { const d = Math.round(h / 24 * 10) / 10; return d + (d === 1 ? ' day' : ' days'); }, pc = x => Math.round(x * 100) + '%';
function verdictOf(r) {                                    // short enough for a ten-year-old
  if (!r.lit0) return r.deadDay ? ['warn', 'Lander lost.', `It lands in the dark and runs out of power on day ${r.deadDay}.`] : ['', 'Risky.', 'It lands in the dark, but the Sun comes back in time.'];
  if (r.deadDay) return ['warn', 'Lander lost.', `The Sun sets after ${days(r.firstDark)}. Out of power on day ${r.deadDay}.`];
  if (r.link < 0.6) return ['', 'Risky.', 'Power is fine, but Earth is often hidden.'];
  if (r.both > 0.85) return ['earth', 'Good spot.', 'Sun and Earth stay in view.'];
  return ['', 'Risky.', 'Long stretches without Sun or Earth.'];
}
let lastKey = '';
function refreshSite() { const s = sites[state.sel], f0 = clamp(state.f, 0, FMAX), key = state.sel + ':' + Math.round(f0 * 2); if (key === lastKey) return; lastKey = key;
  const r = judge(s, f0), v = verdictOf(r), b = bestDay(s, clamp(Math.round(f0 / 4), 0, 350));
  $('sdesc').textContent = s.desc || ''; $('sname').querySelector('span').textContent = s.name; $('coords').textContent = `${s.exact ? s.exact.replace('Approximate point: NASA names regions, not points', 'Approximate location') + ' · ' : ''}${Math.abs(s.lat).toFixed(2)}°S ${s.lon.toFixed(1)}°E`;
  state.best = b; $('verdict').innerHTML = `<b class="${v[0]}">${v[1]}</b> ${v[2]}` + (b !== null && v[1] !== 'Good spot.' ? ` <button class="bw" id="best">Try ${dateAt(b * 4, { day: 'numeric', month: 'short' })} &rarr;</button>` : ''); if ($('best')) $('best').onclick = useBest;
  $('mine').classList.toggle('hidden', !s.mine); sites.forEach((x, i) => x.el.classList.toggle('sel', i === state.sel)); updateInsights(); }
function select(i) { state.sel = i; lastKey = ''; refreshSite(); drawTimeline(); }
$('stand').onclick = () => standHere(state.f); function useBest() { if (state.best !== null) { state.f = state.best * 4; lastKey = ''; refreshSite(); drawTimeline(); } }
const setPlay = on => { state.playing = on; $('play').classList.toggle('on', on); $('play').querySelector('span').textContent = on ? 'Pause' : 'Play'; };
$('play').onclick = () => setPlay(!state.playing);
// ───────────────────────── navigation: every screen has a way back ─────────────────────────
function setPause(on) { state.paused = on; $('hpause').classList.toggle('on', on); $('hpause').querySelector('span').textContent = on ? 'Resume' : 'Pause'; $('hpause').setAttribute('aria-label', on ? 'Resume' : 'Pause'); if (ac) on ? ac.suspend() : ac.resume(); }
$('hpause').onclick = () => setPause(!state.paused);
function goHome() {                                         // back to the very first scene
  if (state.mode === 'intro') return; closeWhy(); closePicker(); setUI('explore'); stopAudio(); setPause(false); setPlay(false); state.zoomTo = null;
  ['site', 'time', 'hint', 'hud', 'end', 'modes', 'zoom', 'planp'].forEach(id => show(id, false));
  state.mode = 'fly'; controls.enabled = false; U.uLanderLen.value = 0; lander.visible = rocks.visible = false; pinLines.visible = false;
  const rewind = () => { state.p = state.pT = 1; state.auto = -1; introCamera(1); setMode('intro'); };          // fly the opening path backwards
  controls.target.set(0, -14, 0); if (camera.position.distanceTo(TABLE_POS) < 5) return rewind();
  probe.position.copy(TABLE_POS); probe.up.set(0, 1, 0); probe.lookAt(0, -14, 0); probe.rotateY(Math.PI);
  tweenTo(TABLE_POS, probe.quaternion, 38, clamp(camera.position.distanceTo(TABLE_POS) / 2500, .6, 1.6), rewind);
}
// the browser Back button walks back one screen instead of leaving the app
const nav = v => { if (!history.state || history.state.v !== v) history.pushState({ v }, ''); };
history.replaceState({ v: 'intro' }, '');
function goMap() { if (state.mode === 'boots' || state.mode === 'end') { if (history.state && history.state.v === 'surface') history.back(); else backToTable(); } }
function goStart() { if (history.state && history.state.v === 'map') history.back(); else { history.replaceState({ v: 'intro' }, ''); goHome(); } }
addEventListener('popstate', e => { const v = e.state && e.state.v;
  if (v === 'map' && (state.mode === 'boots' || state.mode === 'end')) backToTable();
  else if ((v === 'intro' || !v) && state.mode !== 'intro') goHome();
  else if (v === 'surface' && state.mode === 'table') history.back(); });
$('back').onclick = $('eback').onclick = $('hmap').onclick = goMap; $('home').onclick = goStart; $('pclose').onclick = () => setUI('explore');
// Esc closes whatever is on top, one layer at a time
{ const dp = $('dpick'), iso = t => new Date(t).toISOString().slice(0, 10); dp.min = iso(T0); dp.max = iso(T0 + FMAX * 6 * 36e5);
  dp.onclick = () => { try { dp.showPicker(); } catch (e) {} }; dp.onfocus = () => { dp.value = iso(T0 + state.f * 6 * 36e5); };
  dp.onchange = () => { if (!dp.value) return; setPlay(false); state.f = clamp((Date.parse(dp.value + 'T12:00:00Z') - T0) / (6 * 36e5), 0, FMAX); lastKey = ''; refreshSite(); drawTimeline(); }; }
function openCompare() { show('cmp', true); const f0 = clamp(state.f, 0, FMAX), rows = sites.map((x, i) => ({ x, i, r: judge(x, f0) })).sort((a, b) => b.r.score - a.r.score || b.r.both - a.r.both);
  const bar = (v, c) => `<span class="bar ${c}"><i style="width:${Math.round(v * 60)}px"></i>${Math.round(v * 100)}%</span>`;
  $('cmpDate').textContent = dateAt(f0, { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + MISSION / 24 + ' days';
  $('cmpRows').innerHTML = rows.map(({ x, i, r }) => { const v = verdictOf(r); return `<tr data-i="${i}" class="${i === state.sel ? 'on' : ''}"><td>${x.name.replace(/</g, '&lt;')}${x.mine ? '<small>Your site</small>' : ''}</td><td class="${v[0]}">${v[1].replace('.', '')}${r.deadDay ? `<small>Out of power day ${r.deadDay}</small>` : ''}</td><td>${bar(r.sun, '')}</td><td>${bar(r.link, 'earth')}</td><td>${bar(r.both, '')}</td></tr>`; }).join('');
  $('cmpRows').querySelectorAll('tr').forEach(tr => tr.onclick = () => { select(+tr.dataset.i); show('cmp', false); }); show('cmp', true);  retranslate(); }
$('cmpBtn').onclick = openCompare; $('cmpx').onclick = () => show('cmp', false); $('cmp').onclick = e => { if (e.target.id === 'cmp') show('cmp', false); };
function retranslate() { const c = document.querySelector('.goog-te-combo'), cur = c && c.value; if (!cur) return;   // Google ignores some text added after load: switch away and straight back
  setTimeout(() => { c.value = cur === 'af' ? 'sq' : 'af'; c.dispatchEvent(new Event('change')); c.value = cur; c.dispatchEvent(new Event('change')); }, 60); }
// language: any of Google Translate's languages, chosen from the picker; English stays the source text
{ const sel = $('lang'), m = document.cookie.match(/googtrans=\/en\/([\w-]+)/), cur = m ? m[1] : 'en';
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'en';
  const setCookie = v => { const d = location.hostname; for (const dom of ['', '; domain=' + d, '; domain=.' + d]) document.cookie = `googtrans=${v}; path=/${dom}${v ? '' : '; expires=Thu, 01 Jan 1970 00:00:00 GMT'}`; };
  sel.onchange = () => { if (sel.value === 'en') setCookie(''); else setCookie('/en/' + sel.value); location.reload(); };
  if (cur !== 'en') { window.__gti = () => new google.translate.TranslateElement({ pageLanguage: 'en', autoDisplay: false }, 'gt');
    const sc = document.createElement('script'); sc.src = 'https://translate.google.com/translate_a/element.js?cb=__gti'; document.head.appendChild(sc);
    document.documentElement.lang = cur; } }
$('srcBtn').onclick = () => show('src', true); $('srcx').onclick = () => show('src', false);
addEventListener('keydown', e => { if (e.key !== 'Escape') return;
  if (!$('cmp').classList.contains('hidden')) show('cmp', false); else if (!$('src').classList.contains('hidden')) show('src', false); else if ($('site').classList.contains('listopen')) closePicker(); else if (state.why) closeWhy(); else if (state.ui === 'plan' && state.mode === 'table') setUI('explore');
  else if (state.mode === 'boots' || state.mode === 'end') goMap(); });
setInterval(() => $('illus').classList.toggle('hidden', state.mode !== 'boots'), 400);
addEventListener('keydown', e => { if (e.key === ' ' && state.mode === 'boots' && e.target === document.body) { e.preventDefault(); setPause(!state.paused); } }); $('eretry').onclick = () => { show('end', false); const b = state.best; standHere(b !== null && state.dead ? b * 4 : state.f0); };

const tl = $('tl'), tg = tl.getContext('2d');
function drawTimeline() { const dpr = Math.min(2, devicePixelRatio), W = tl.clientWidth * dpr | 0, Hh = tl.clientHeight * dpr | 0; if (!W) return; if (tl.width !== W || tl.height !== Hh) { tl.width = W; tl.height = Hh; }
  const y = yearOf(sites[state.sel]), base = Hh - 18 * dpr, X = d => Math.round(d / 364 * (W - 2 * dpr)) + dpr; tg.clearRect(0, 0, W, Hh);
  for (let d = 0; d <= 350; d++) { const r = y[d], ok = r.score >= 0; tg.fillStyle = ok ? (r.both > 0.85 ? '#eceae5' : '#8b8a86') : '#3a3a39'; const h = (ok ? .18 + .82 * r.both : .1) * (base - 14 * dpr); tg.fillRect(X(d), base - h, Math.max(1, dpr), h); }
  tg.font = `${10 * dpr}px "Geist Mono", monospace`; tg.fillStyle = '#8b8a86'; tg.textBaseline = 'top';
  const every = W / dpr < 520 ? 2 : 1; for (let m = 0; m < 13; m++) { const dt = new Date(Date.UTC(2026, 11 + m, 1)), d = (dt - T0) / 864e5; if (d < 0 || d > 364 || m % every) continue; tg.fillRect(X(d), base, dpr, 4 * dpr); tg.fillText(dt.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }).toUpperCase(), X(d) + 4 * dpr, base + 6 * dpr); }
  const d0 = state.f / 4; tg.fillStyle = '#86b6ea'; tg.fillRect(X(d0), base + 1 * dpr, X(d0 + MD()) - X(d0), 2 * dpr); tg.fillRect(X(d0) - dpr, 0, 2 * dpr, base + 3 * dpr); }
const scrub = e => { const r = tl.getBoundingClientRect(); state.f = clamp((e.clientX - r.left) / r.width * 364 * 4, 0, FMAX); setPlay(false); refreshSite(); };
tl.onpointerdown = e => { tl.setPointerCapture(e.pointerId); scrub(e); }; tl.onpointermove = e => { if (e.buttons === 1) scrub(e); };

// ───────────────────────── "Why is contact blocked?" and "Delay a few days" ─────────────────────────
// Ideas from Raida and Shahmeen: explain the obstruction, not just the verdict, and show what a short delay changes.
const MASTS = Array.from({ length: 10 }, (_, i) => (i + 1) / 1000), mastTxt = k => Math.round(k * 1000) + ' m';   // 1 to 10 m, one metre at a time
Object.assign(state, { why: false, whyTab: 'los', whyBody: 'earth', mast: 1 });
function azEl(s, v) { return { az: (Math.atan2(v.dot(s.E), v.dot(s.Nn)) * DEG + 360) % 360, el: Math.asin(clamp(v.dot(s.U), -1, 1)) * DEG }; }
function profile(s, az, hAnt, dMax = 160) {               // terrain cross-section from the antenna toward a bearing, curvature included
  const a = az / DEG, dx = Math.sin(a) * s.E.x + Math.cos(a) * s.Nn.x, dy = Math.sin(a) * s.E.y + Math.cos(a) * s.Nn.y, dz = Math.sin(a) * s.E.z + Math.cos(a) * s.Nn.z;
  const eye = s.P.clone().addScaledVector(s.U, hAnt), out = []; let best = { el: -90 };
  for (let d = 0.15; d <= dMax; d += Math.max(0.15, d * 0.01)) { const gx = eye.x + dx * d, gz = eye.z + dz * d; if (Math.abs(gx) > L / 2 - 1 || Math.abs(gz) > L / 2 - 1) break;
    tmp.set(gx - eye.x, groundY(gx, gz) - eye.y, gz - eye.z); const up = tmp.dot(s.U), along = Math.sqrt(Math.max(0, tmp.lengthSq() - up * up)), el = Math.atan2(up, along) * DEG;
    out.push({ d: along, up, el }); if (el > best.el) best = { el, d: along, up }; }
  return { pts: out, best };
}
function clearanceWith(s, v, hAnt) { const { az, el } = azEl(s, v); return el - profile(s, az, hAnt, 280).best.el; }
function detail(s, f0) {                                   // one mission, hour by hour
  let lit = 0, link = 0, dark = 0, maxDark = 0, gap = 0, maxGap = 0, bat = 100, deadDay = 0;
  for (let h = 0; h < MISSION; h++) { const f = f0 + h / 6, ms = margin(s, vecAt(eph.sun, f, vs)), me = margin(s, vecAt(eph.earth, f, ve));
    if (ms > 0) { lit++; dark = 0; } else maxDark = Math.max(maxDark, ++dark); if (me > 0) { link++; gap = 0; } else maxGap = Math.max(maxGap, ++gap);
    bat = clamp(bat + charge(ms), 0, 100); if (bat <= 0 && !deadDay) deadDay = (h / 24 | 0) + 1; }
  return { sun: lit / MISSION, link: link / MISSION, maxDark, maxGap, deadDay };
}
function nextEvents(s, f0) {                               // countdown to the next change, up to 30 days ahead
  const out = []; let ps = margin(s, vecAt(eph.sun, f0, vs)) > 0, pe = margin(s, vecAt(eph.earth, f0, ve)) > 0, gs = false, ge = false;
  for (let h = 1; h <= 720 && !(gs && ge); h++) { const f = f0 + h / 6; if (f > NE - 2) break;
    const cs = margin(s, vecAt(eph.sun, f, vs)) > 0, ce = margin(s, vecAt(eph.earth, f, ve)) > 0;
    if (!gs && cs !== ps) { out.push([h, ps ? 'Sunset' : 'Sunrise']); gs = true; } if (!ge && ce !== pe) { out.push([h, pe ? 'Earthset' : 'Earthrise']); ge = true; } }
  if (!gs) out.push([null, ps ? 'Sun up for 30+ days' : 'Dark for 30+ days']); if (!ge) out.push([null, pe ? 'Earth up for 30+ days' : 'Earth hidden for 30+ days']);
  return out.map(([h, w]) => h === null ? w : `${w} in ${h < 48 ? h + ' h' : (h / 24).toFixed(1) + ' days'}`);
}
const xs = $('xs'), xg = xs.getContext('2d');
function drawSection() {
  const s = sites[state.sel], f = clamp(state.f, 0, FMAX), body = state.whyBody, v = vecAt(eph[body], f, body === 'sun' ? vs : ve).clone(), hAnt = MASTS[state.mast];
  const { az, el } = azEl(s, v), pr0 = profile(s, az, hAnt), pr = profile(s, az, hAnt, clamp(pr0.best.d * 2.6, 12, 160)), pts = pr.pts, b = pr0.best, clear = el - b.el, col = body === 'sun' ? '#f3efe6' : '#86b6ea', name = body === 'sun' ? 'The Sun' : 'Earth';
  const dpr = Math.min(2, devicePixelRatio), W = xs.clientWidth * dpr | 0, H = xs.clientHeight * dpr | 0; if (!W) return; if (xs.width !== W || xs.height !== H) { xs.width = W; xs.height = H; }
  const dMax = pts.length ? pts[pts.length - 1].d : 160, losEnd = dMax * Math.tan(el / DEG);
  let lo = Math.min(-hAnt, ...pts.map(p => p.up)), hi = Math.max(0.2, losEnd, ...pts.map(p => p.up)); const pad = (hi - lo) * .12; lo -= pad; hi += pad;
  const X = d => 14 * dpr + d / dMax * (W - 28 * dpr), Y = u => H - 22 * dpr - (u - lo) / (hi - lo) * (H - 40 * dpr);
  xg.clearRect(0, 0, W, H); xg.fillStyle = '#1b1b1a'; xg.beginPath(); xg.moveTo(X(0), H); xg.lineTo(X(0), Y(-hAnt)); pts.forEach(p => xg.lineTo(X(p.d), Y(p.up))); xg.lineTo(X(dMax), H); xg.closePath(); xg.fill();
  xg.strokeStyle = '#8b8a86'; xg.lineWidth = 1.2 * dpr; xg.beginPath(); pts.forEach((p, i) => i ? xg.lineTo(X(p.d), Y(p.up)) : xg.moveTo(X(p.d), Y(p.up))); xg.stroke();
  xg.setLineDash([2 * dpr, 6 * dpr]); xg.strokeStyle = '#4a4a48'; xg.beginPath(); xg.moveTo(X(0), Y(0)); xg.lineTo(X(dMax), Y(0)); xg.stroke();          // flat horizon
  xg.setLineDash([5 * dpr, 4 * dpr]); xg.strokeStyle = col; xg.beginPath(); xg.moveTo(X(0), Y(0)); xg.lineTo(X(dMax), Y(losEnd)); xg.stroke(); xg.setLineDash([]); // line of sight
  xg.fillStyle = '#eceae5'; xg.fillRect(X(0) - 1 * dpr, Y(0), 2 * dpr, Y(-hAnt) - Y(0) + 1); xg.beginPath(); xg.arc(X(0), Y(0), 3 * dpr, 0, 7); xg.fill();
  if (b.d) { xg.fillStyle = clear > 0 ? '#eceae5' : '#ea8a62'; xg.beginPath(); xg.arc(X(b.d), Y(b.up), 3.5 * dpr, 0, 7); xg.fill(); }
  xg.font = `${10 * dpr}px "Geist Mono", monospace`; xg.textBaseline = 'top'; xg.fillStyle = '#8b8a86';
  xg.fillText('YOU', X(0) + 6 * dpr, Y(-hAnt) + 6 * dpr); xg.textAlign = 'right'; xg.fillStyle = col; xg.fillText(`TO ${name.toUpperCase()} · ${Math.round(az)}°`, X(dMax), Y(losEnd) - 14 * dpr); xg.fillStyle = '#5c5b58'; xg.fillText(`${Math.round(dMax)} KM`, X(dMax), H - 14 * dpr);
  if (b.d) { xg.textAlign = b.d / dMax > .7 ? 'right' : 'left'; xg.fillStyle = clear > 0 ? '#a5a39d' : '#ea8a62'; xg.textBaseline = 'bottom'; xg.fillText(`RIDGE · ${b.d < 10 ? b.d.toFixed(1) : b.d.toFixed(0)} KM`, X(b.d) + (b.d / dMax > .7 ? -8 : 8) * dpr, Y(b.up) - 8 * dpr); xg.textBaseline = 'top'; } xg.textAlign = 'left';
  // plain-language explanation (also the accessible version of the picture)
  let txt; const ridge = `a ridge ${b.d < 10 ? b.d.toFixed(1) : b.d.toFixed(0)} km away rises to ${b.el.toFixed(1)}°`;
  if (clear > 0) txt = `<b class="${body === 'sun' ? 'ink' : 'earth'}">Clear.</b> ${name} is ${el.toFixed(1)}° above the flat horizon and clears the highest ridge in that direction (${b.d.toFixed(0)} km away) by ${clear.toFixed(1)}°.`;
  else if (el < 0) txt = `<b class="warn">Below the horizon.</b> ${name} is ${(-el).toFixed(1)}° under the flat horizon here, so no ridge is needed to hide it. A taller mast will not help.`;
  else { txt = `<b class="warn">Blocked by terrain.</b> ${name} is ${el.toFixed(1)}° above the flat horizon, but ${ridge}, ${(-clear).toFixed(1)}° too high.`;
    if (body === 'earth') { const k = MASTS.findIndex(m => clearanceWith(s, v, m) > 0); txt += k >= 0 ? ` A ${mastTxt(MASTS[k])} antenna mast would clear it.` : ' Even a 10 m mast would not clear it.'; } }
  $('losTxt').innerHTML = txt + ` <span class="mono">${dateAt(f, { day: 'numeric', month: 'short' })}, ${String(new Date(T0 + f * 6 * 36e5).getUTCHours()).padStart(2, '0')}:00 UTC. Vertical scale exaggerated.</span>`;
  $('antV').textContent = mastTxt(hAnt);
}
function drawDelay() {
  const s = sites[state.sel], f0 = clamp(state.f, 0, FMAX - 7 * 4), rows = [];
  for (let k = 0; k <= 7; k++) rows.push({ k, f: f0 + k * 4, ...detail(s, f0 + k * 4) });
  const grade = r => r.deadDay ? ['warn', 'No-go'] : r.maxDark === 0 && r.maxGap === 0 ? ['earth', 'Go'] : ['', 'Risky'];
  const score = r => (r.deadDay ? 1e6 : 0) + r.maxDark * 3 + r.maxGap;   // priority: survive, then shortest darkness, then shortest contact gap
  const best = rows.reduce((a, r) => score(r) < score(a) ? r : a, rows[0]), o = rows[0];
  $('dtab').innerHTML = `<thead><tr><th>Land</th><th>Sun</th><th>Longest dark</th><th>Longest no-contact</th><th>Result</th></tr></thead><tbody>` +
    rows.map(r => { const g = grade(r); return `<tr data-f="${r.f}" class="${r.k === 0 ? 'cur' : ''}${r === best && r.k && !r.deadDay ? ' best' : ''}"><td>${r.k ? '+' + r.k + ' d' : 'Planned'}<span>${dateAt(r.f, { day: 'numeric', month: 'short' })}</span></td><td>${pc(r.sun)}</td><td>${r.maxDark} h</td><td>${r.maxGap} h</td><td class="${g[0]}">${g[1]}</td></tr>`; }).join('') + '</tbody>';
  [...$('dtab').querySelectorAll('tbody tr')].forEach(tr => tr.onclick = () => { state.f = +tr.dataset.f; lastKey = ''; refreshSite(); drawTimeline(); });
  let txt;
  if (best.deadDay) { const bw = bestDay(s, clamp(Math.round(f0 / 4), 0, 350)); txt = `<b class="warn">No landing in the next week survives here.</b> ${bw !== null ? `The nearest good window starts ${dateAt(bw * 4, { day: 'numeric', month: 'short' })}, ${Math.round(bw - f0 / 4)} days later.` : 'Try another site.'}`; }
  else if (best === o) txt = o.deadDay ? 'No date in the next week survives. Try another site or a later window.' : `The planned date is already the best in the next week: ${o.maxDark} h of darkness at most, ${o.maxGap} h without Earth.`;
  else { const parts = []; if (best.maxDark < o.maxDark) parts.push(`shortens the longest darkness from ${o.maxDark} h to ${best.maxDark} h`); if (o.deadDay && !best.deadDay) parts.unshift('keeps the lander alive');
    const cost = best.maxGap > o.maxGap ? `, but the longest gap without Earth grows from ${o.maxGap} h to ${best.maxGap} h` : best.maxGap < o.maxGap ? ` and cuts the longest gap without Earth from ${o.maxGap} h to ${best.maxGap} h` : '';
    txt = `<b>Landing ${best.k} day${best.k > 1 ? 's' : ''} later</b> ${parts.join(' and ') || 'improves the mission'}${cost}.`; }
  $('delayTxt').innerHTML = txt;
}
let insightKey = '';
function updateInsights() { const s = sites[state.sel], f = clamp(state.f, 0, FMAX), ev = nextEvents(s, f), sUp = margin(s, vecAt(eph.sun, f, vs)) > 0, eUp = margin(s, vecAt(eph.earth, f, ve)) > 0;
  const sTxt = ev.find(x => /Sun/.test(x)), eTxt = ev.find(x => /Earth/.test(x));
  const say = (x, map) => { for (const [re, out] of map) if (re.test(x)) return x.replace(re, out); return x; };
  const when = x => { const m = x.match(/in ([\d.]+) (h|days)$/); if (!m) return '30+ d'; return m[2] === 'h' ? m[1] + ' h' : Math.round(parseFloat(m[1])) + ' d'; };
  $('cSun').classList.toggle('up', sUp); $('cSun').querySelector('span').textContent = (sUp ? 'Sun up · sets in ' : 'Sun down · back in ') + when(sTxt); $('cSun').title = sTxt;
  $('cEarth').classList.toggle('up', eUp); $('cEarth').querySelector('span').textContent = (eUp ? 'Earth in view · sets in ' : 'Earth hidden · back in ') + when(eTxt); $('cEarth').title = eTxt;
  { const e = 0.3, g = Math.hypot(groundY(s.P.x + e, s.P.z) - groundY(s.P.x - e, s.P.z), groundY(s.P.x, s.P.z + e) - groundY(s.P.x, s.P.z - e)) / (2 * e), sl = Math.atan(g) * DEG;
    $('slope').innerHTML = `Ground slope <b class="${sl < 5 ? 'earth' : sl < 10 ? 'ink' : 'warn'}">${sl.toFixed(1)}°</b> ${sl < 5 ? 'gentle, good for landing' : sl < 10 ? 'moderate' : 'steep, risky for landing'}<span>Averaged over 600 m; small rocks and craters can be steeper.</span>`; }
  if (!state.why) return; const key = state.sel + ':' + Math.round(state.f * 2) + ':' + state.whyTab + state.whyBody + state.mast; if (key === insightKey) return; insightKey = key; clearTimeout(state.rtT); state.rtT = setTimeout(retranslate, 600);
  $('pLos').hidden = state.whyTab !== 'los'; $('pDelay').hidden = state.whyTab !== 'delay'; document.querySelectorAll('#why [data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === state.whyTab));
  document.querySelectorAll('#why [data-b]').forEach(b => b.classList.toggle('on', b.dataset.b === state.whyBody));
  if (state.whyTab === 'los') drawSection(); else drawDelay(); }
const openWhy = tab => { document.body.classList.add('whyopen'); state.why = true; state.whyTab = tab; insightKey = ''; show('why', true); $('why').classList.add('open'); updateInsights(); };
$('whyBtn').onclick = () => state.why ? closeWhy() : openWhy('los');
function closeWhy() { document.body.classList.remove('whyopen'); state.why = false; show('why', false); $('why').classList.remove('open'); } $('whyx').onclick = closeWhy;
document.querySelectorAll('#why [data-t]').forEach(b => b.onclick = () => { state.whyTab = b.dataset.t; updateInsights(); });
document.querySelectorAll('#why [data-b]').forEach(b => b.onclick = () => { state.whyBody = b.dataset.b; updateInsights(); });
const setMast = d => { state.mast = clamp(state.mast + d, 0, MASTS.length - 1); $('antV').textContent = mastTxt(MASTS[state.mast]); updateInsights(); }; $('antM').onclick = () => setMast(-1); $('antP').onclick = () => setMast(1);

// ───────────────────────── Explore and Plan (Raida's two modes) ─────────────────────────
state.ui = 'explore'; state.auto = 0;
function setUI(m) { state.ui = m; document.body.classList.toggle('planmode', m === 'plan'); document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  show('planp', state.mode === 'table' && m === 'plan'); }
document.querySelectorAll('#modes button').forEach(b => b.onclick = () => setUI(b.dataset.m));
function fitPlan() { const pp = $('planp'); if (!document.body.classList.contains('planmode') || innerWidth <= 700) { pp.style.maxHeight = ''; return; }   // keep Plan above the site card
  const room = $('site').getBoundingClientRect().top - pp.getBoundingClientRect().top - 14; pp.style.maxHeight = Math.max(160, room) + 'px'; pp.style.overflowY = 'auto'; }
setInterval(fitPlan, 400); addEventListener('resize', fitPlan);
function renderList() { const q = $('q').value.trim().toLowerCase();
  $('list').innerHTML = sites.map((s, i) => [s, i]).filter(([s]) => !q || (s.name + ' ' + (s.desc || '')).toLowerCase().includes(q))
    .map(([s, i]) => `<li role="option" data-i="${i}" class="${i === state.sel ? 'on' : ''}"><b>${s.name}</b><em>${s.desc || ''}</em><span class="${/Exact/.test(s.exact) ? 'ex' : ''}">${/Exact/.test(s.exact || '') ? 'Real landing site' : s.mine ? 'Your site' : ''}</span>${s.mine ? `<div class="own"><button data-e="${i}">Rename</button><button data-d="${i}">Delete</button></div>` : ''}</li>`).join('') || '<li><span>No site matches</span></li>';
  $('list').querySelectorAll('li[data-i]').forEach(li => li.onpointerdown = e => { if (e.target.closest('.own,.edit')) return; e.preventDefault(); select(+li.dataset.i); closePicker(); });
  $('list').querySelectorAll('[data-d]').forEach(b => b.onpointerdown = e => { e.preventDefault(); removeSite(+b.dataset.d); renderList(); });
  $('list').querySelectorAll('[data-e]').forEach(b => b.onpointerdown = e => { e.preventDefault(); editSite(+b.dataset.e, b.closest('li')); }); }
function editSite(i, li) { const s = sites[i]; li.innerHTML = `<div class="edit"><input class="en" maxlength="32" aria-label="Site name"><textarea class="ed" maxlength="140" rows="2" placeholder="Add a note (optional)" aria-label="Note"></textarea><div class="own"><button class="sv">Save</button><button class="cx">Cancel</button></div></div>`;
  const n = li.querySelector('.en'), d = li.querySelector('.ed'); n.value = s.name; d.value = s.note || ''; n.focus(); n.select();
  const save = () => { s.name = n.value.trim() || s.name; s.note = d.value.trim(); s.desc = s.note || 'A spot you chose.'; s.el.querySelector('.pn').textContent = s.name; labels.forEach(l => { if (l.el === s.el) l.w = 0; }); lastKey = ''; refreshSite(); renderList(); };
  li.querySelector('.sv').onpointerdown = e => { e.preventDefault(); save(); }; li.querySelector('.cx').onpointerdown = e => { e.preventDefault(); renderList(); };
  li.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter' && e.target === n) save(); if (e.key === 'Escape') renderList(); }; }
function removeSite(i) { const s = sites[i]; if (!s || !s.mine) return; s.el.remove(); pinLines.remove(s.line); labels.splice(labels.findIndex(l => l.el === s.el), 1); sites.splice(i, 1);
  if (state.sel === i) state.sel = 3; else if (state.sel > i) state.sel--; select(state.sel); }
function closePicker() { $('site').classList.remove('listopen'); $('q').value = ''; }
$('sname').onclick = () => { if ($('site').classList.toggle('listopen')) { renderList(); $('q').focus(); } };
$('q').oninput = renderList;
addEventListener('pointerdown', e => { if (!e.target.closest('.namewrap')) closePicker(); });
$('q').onkeydown = e => { if (e.key === 'Enter') { const li = $('list').querySelector('li[data-i]'); if (li) { select(+li.dataset.i); closePicker(); } } if (e.key === 'Escape') closePicker(); };
const note = (cls, txt) => { $('pMsg').className = 'note ' + cls; $('pMsg').textContent = txt; };
$('pGo').onclick = () => { const la = -Math.abs(parseFloat($('pLat').value)), lo = ((parseFloat($('pLon').value) % 360) + 360) % 360;
  if (!isFinite(la) || !isFinite(lo)) return note('warn', 'Enter a latitude and a longitude.');
  if (la > coverLat) return note('warn', `Outside our terrain data. This prototype covers the pole down to ${Math.abs(coverLat).toFixed(1)}°S.`);
  const s = makeSite(`${Math.abs(la).toFixed(2)}°S ${lo.toFixed(1)}°E`, la, lo); addCustom(s); note('ok', 'Added to the map. The verdict below is for this spot.'); };
function setMissionParams() { sites.forEach(s => { s.year = null; }); lastKey = ''; insightKey = ''; refreshSite(); drawTimeline(); }
document.querySelectorAll('#pLen button').forEach(b => b.onclick = () => { document.querySelectorAll('#pLen button').forEach(x => x.classList.toggle('on', x === b)); MISSION = +b.dataset.v * 24; setMissionParams(); });
document.querySelectorAll('#pBat button').forEach(b => b.onclick = () => { document.querySelectorAll('#pBat button').forEach(x => x.classList.toggle('on', x === b)); DRAIN = 100 / +b.dataset.v; setMissionParams(); });

// click the terrain to test any spot
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let down = null;
renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; if (state.mode === 'table') setTimeout(() => $('hint').classList.add('gone'), 2500); });
renderer.domElement.addEventListener('pointerup', e => { if (state.mode !== 'table' || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); const o = ray.ray.origin, d = ray.ray.direction; let t = 0, hit = -1;
  for (; t < 4000; t += 0.4) { const x = o.x + d.x * t, z = o.z + d.z * t; if (Math.hypot(x, z) < CAP - 4 && o.y + d.y * t < groundY(x, z)) { hit = t; break; } }
  if (hit < 0) return; addCustom(makeSite('Your site', 0, 0, o.x + d.x * hit, o.z + d.z * hit)); });
const COVER = CAP - 25, coverLat = -Math.acos(COVER / R) * DEG;                 // terrain we trust: inside the table, away from its fading edge
let mineN = 0;
$('mDel').onclick = () => removeSite(state.sel);
$('mRen').onclick = () => { $('site').classList.add('listopen'); renderList(); const li = $('list').querySelector(`li[data-i="${state.sel}"]`); if (li) editSite(state.sel, li); };
function addCustom(s) { const mine = sites.filter(x => x.mine); if (mine.length >= 6) removeSite(sites.indexOf(mine[0]));        // keep the six newest
  s.mine = true; s.name = s.name === 'Your site' ? 'My site ' + (++mineN) : s.name; s.desc = 'A spot you chose. Open the list to rename it or add a note.'; s.exact = 'Your coordinates'; sites.push(s); pinFor(s, sites.length - 1); select(sites.length - 1); }

// boots: drag to look
let lookDrag = null;
renderer.domElement.addEventListener('pointermove', e => { if (state.mode !== 'boots' || e.buttons !== 1) { lookDrag = null; return; } if (lookDrag) { const k = 0.0022 * camera.fov / 52; state.yaw -= (e.clientX - lookDrag[0]) * k; state.pitch = clamp(state.pitch + (e.clientY - lookDrag[1]) * k, -0.5, 0.9); } lookDrag = [e.clientX, e.clientY]; });

// opening: scrolling is descent, and time
addEventListener('wheel', e => { if (state.mode === 'intro') { state.auto = 0; } if (state.mode === 'intro') state.pT = clamp(state.pT + e.deltaY * 0.00042, 0, 1.04); if (state.mode === 'boots') state.fovT = clamp((state.fovT || 52) * Math.exp(e.deltaY * 0.0015), 3, 60); }, { passive: true });
let ty = null; addEventListener('touchstart', e => { ty = e.touches[0].clientY; }, { passive: true }); addEventListener('touchmove', e => { if (state.mode === 'intro' && ty !== null) { state.pT = clamp(state.pT + (ty - e.touches[0].clientY) * 0.0016, 0, 1.04); ty = e.touches[0].clientY; } }, { passive: true });
addEventListener('keydown', e => { if (state.mode === 'intro' && (e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown')) state.pT = clamp(state.pT + 0.12, 0, 1.04); });
const zoomBy = k => { const d = camera.position.distanceTo(controls.target); state.zoomTo = clamp(d * k, controls.minDistance, controls.maxDistance); };
$('zin').onclick = () => zoomBy(0.6); $('zout').onclick = () => zoomBy(1.7);
$('zreset').onclick = () => { state.zoomTo = null; probe.position.copy(TABLE_POS); probe.up.set(0, 1, 0); probe.lookAt(0, -14, 0); probe.rotateY(Math.PI); state.mode = 'fly'; controls.enabled = false; tweenTo(TABLE_POS, probe.quaternion, 38, 1.2, () => { controls.target.set(0, -14, 0); controls.update(); setMode('table'); }); };
const arrive = () => { nav('map'); controls.update(); document.body.classList.remove('arrived'); void document.body.offsetWidth; document.body.classList.add('arrived'); clearTimeout(state.arrT); state.arrT = setTimeout(() => document.body.classList.remove('arrived'), 2600); setMode('table'); drawTimeline(); };
const enterTable = () => { if (state.mode !== 'intro') return; show('intro', false);
  const d = camera.position.distanceTo(TABLE_POS); if (d < 30) { state.mode = 'fly'; arrive(); return; }      // scrolled all the way: already there, no pause
  state.mode = 'fly'; probe.position.copy(TABLE_POS); probe.up.set(0, 1, 0); probe.lookAt(controls.target); probe.rotateY(Math.PI); tweenTo(TABLE_POS, probe.quaternion, 38, clamp(d / 2500, 0.9, 1.8), arrive); };
$('skip').onclick = () => { if (state.mode === 'intro') state.auto = 1; };
const beats = [...document.querySelectorAll('.beat')];

// ───────────────────────── the lander speaks; the radio fades ─────────────────────────
let voiceT; function say(t) { const v = $('voice'); v.style.opacity = 0; clearTimeout(voiceT); voiceT = setTimeout(() => { v.textContent = t; v.style.opacity = 1; voiceT = setTimeout(() => { v.style.opacity = .32; }, 6500); }, 220); }
function buildEvents(s) { const ev = state.events = [], push = (h, k, t) => ev.push({ h, k, t }); let a = null;
  for (let h = 0; h <= MISSION; h += 2) { const f = state.f0 + h / 6, b = { s: margin(s, vecAt(eph.sun, f, vs)), e: margin(s, vecAt(eph.earth, f, ve)) };
    if (a) { if (a.s > 0 && b.s <= 0) { push(h - 30, 'w' + h, 'Sunset in thirty hours. Charging everything I can.'); push(h, 's' + h, 'The Sun is behind the ridge. I am on battery now.'); }
      if (a.s <= 0 && b.s > 0) push(h, 'r' + h, 'Sunrise. The panels are waking up.');
      if (a.e > 0 && b.e <= 0) push(h, 'e' + h, 'Earth has set. I cannot hear you.');
      if (a.e <= 0 && b.e > 0) push(h, 'b' + h, 'Earth is back above the ridge. I can hear you again.'); }
    a = b; }
  ev.sort((p, q) => p.h - q.h); }
let ac, tone, toneG, noise, noiseG;
function startAudio() { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); stopAudio();
  tone = ac.createOscillator(); tone.frequency.value = 520; toneG = ac.createGain(); toneG.gain.value = 0; tone.connect(toneG).connect(ac.destination); tone.start();
  const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (Math.random() < .02 ? 1 : .22);
  noise = ac.createBufferSource(); noise.buffer = buf; noise.loop = true; const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = .8;
  noiseG = ac.createGain(); noiseG.gain.value = 0; noise.connect(bp).connect(noiseG).connect(ac.destination); noise.start(); } catch (e) { ac = null; } }
function stopAudio() { try { tone && tone.stop(); noise && noise.stop(); } catch (e) {} tone = noise = null; }
function setAudio(m) { if (!ac || !tone) return; const now = ac.currentTime, clean = clamp(m / 1.5, 0, 1), fade = m > 0 ? 1 - clean : 0; toneG.gain.setTargetAtTime(state.dead ? 0 : .03 * clean, now, .25); noiseG.gain.setTargetAtTime(state.dead ? 0 : .09 * fade, now, .25); }
function finish() { const s = sites[state.sel], r = judge(s, state.f0); stopAudio(); state.mode = 'end'; show('hud', false); show('end', true); state.best = bestDay(s, clamp(Math.round(state.f0 / 4), 0, 350));
  $('ekick').textContent = `${s.name} · landed ${dateAt(state.f0, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  if (state.dead) { $('etitle').textContent = `Lost on day ${state.deadDay}.`; $('esub').textContent = r.lit0 ? `The Sun slipped behind the ridge after ${days(r.firstDark)}. The battery could not last the dark.` : 'It landed in shadow and never saw the Sun.';
    $('eretry').textContent = state.best !== null ? `Land on ${dateAt(state.best * 4, { day: 'numeric', month: 'short' })} instead` : 'Watch again'; }
  else { $('etitle').textContent = (s => s[0].toUpperCase() + s.slice(1))(mdTxt()) + (r.link > 0.98 ? ' days. Still talking.' : ' days. Still alive.'); $('esub').textContent = `Sunlight ${pc(r.sun)} of the mission, Earth in view ${pc(r.link)}.`; $('eretry').textContent = 'Watch again'; } }

// ───────────────────────── frame ─────────────────────────
const sunV = new THREE.Vector3(), earthV = new THREE.Vector3(), v3 = new THREE.Vector3(); let last = performance.now(), hudT = 0, tlT = 0;
function frame(now) { requestAnimationFrame(frame); const dt = Math.min(.1, (now - last) / 1000); last = now; if (document.body.classList.contains('ontable') !== (state.mode === 'table')) document.body.classList.toggle('ontable', state.mode === 'table');
  let f = state.f;
  if (state.mode === 'intro') {
    if (state.auto) { state.p = state.pT = clamp(state.p + state.auto * dt * 0.42, 0, 1); if (state.auto < 0 && state.p <= 0) state.auto = 0; }
    else state.p += (state.pT - state.p) * Math.min(1, dt * 2.2);
    f = 8 + ease(state.p) * (state.f - 8);                                      // the opening's sunlight arrives exactly at the map's date: no jump
    introCamera(state.p); const p = state.p;
    beats.forEach(b => { const a = +b.dataset.from, z = +b.dataset.to; const o = clamp(Math.min((p - a) / .09 + (a === 0 ? 1 : 0), (z - p) / .09), 0, 1); b.style.opacity = o; b.style.transform = `translateY(${((1 - o) * (p < a + .1 ? 18 : -18)).toFixed(1)}px)`; });
    $('scrollhint').style.opacity = p < 0.04 ? 1 : 0.35; poleRing.material.opacity = clamp(1 - p / 0.25, 0, 1) * .85; poleTag.style.opacity = clamp(1 - p / 0.25, 0, 1); if (state.p >= 1 && state.auto >= 0) { state.auto = 0; enterTable(); } }
  if (state.tween) { const w = state.tween; w.t += dt / w.dur; const k = ease(clamp(w.t, 0, 1)); camera.position.lerpVectors(w.p0, w.p1, k); camera.quaternion.slerpQuaternions(w.q0, w.q1, k); camera.fov = w.f0 + (w.f1 - w.f0) * k; camera.updateProjectionMatrix(); if (w.t >= 1) { state.tween = null; w.done && w.done(); } }
  if (state.mode === 'table') { if (state.playing) { state.f = state.f + dt * 4 * 1.4; if (state.f >= FMAX) { state.f = FMAX; setPlay(false); } }
    f = state.f;
    { const off = tmp.copy(camera.position).sub(controls.target), d = off.length();                 // zoom buttons glide instead of jumping
      if (state.zoomTo) { const nd = d + (state.zoomTo - d) * Math.min(1, dt * 5); off.setLength(nd); camera.position.copy(controls.target).add(off); if (Math.abs(nd - state.zoomTo) < 2) state.zoomTo = null; }
      const far = clamp((d - 1100) / 700, 0, 1); state.far = far > .5; controls.target.set(0, -14 - far * 1200, 0);   // pulled far back, aim at the globe, not the pole
      pinLines.visible = !state.far; poleRing.material.opacity = far * .85; poleTag.style.opacity = far; poleTagPos.set(0, 520 + far * 300, 0); }
    controls.update(); refreshSite(); if (now - tlT > 60) { tlT = now; drawTimeline(); drawCompass(f); } }
  const s = sites[state.sel];
  if (state.mode === 'boots' || state.mode === 'end' || (state.mode === 'fly' && lander.visible)) f = state.f0 + state.t / 6;
  vecAt(eph.sun, f, sunV); vecAt(eph.earth, f, earthV); U.uSun.value.copy(sunV);
  if (state.mode === 'boots') { const dh = state.paused ? 0 : dt * MISSION / PLAY_S; state.t += dh; const ms = margin(s, sunV), me = margin(s, earthV);
    state.bat = clamp(state.bat + charge(ms) * dh, 0, 100); setAudio(me);
    if (!state.dead) for (const e of state.events) if (e.h > 0 && state.t >= e.h && !state.said[e.k]) { state.said[e.k] = 1; say(e.t); }
    if (!state.dead && state.bat <= 0) { state.dead = true; state.deadDay = (state.t / 24 | 0) + 1; state.endAt = state.t + 16; say('Battery empty.'); }
    camera.fov += ((state.fovT || 52) - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix(); bootsEye(s, eyeP); camera.position.copy(eyeP); camera.up.copy(s.U); camera.lookAt(v3.copy(eyeP).add(bootsDir(s, state.yaw, state.pitch, dir)));
    if (now - hudT > 120) { hudT = now; const dn = Math.min(MD(), (state.t / 24 | 0) + 1), dead = state.dead; $('cday').textContent = 'Day ' + dn; $('chour').textContent = `${String(state.t % 24 | 0).padStart(2, '0')}:00 · ${dateAt(f, { day: 'numeric', month: 'short' })}`;
      $('tsun').textContent = ms > 0 ? `Sun +${ms.toFixed(1)}°` : ms > -0.267 ? 'Sun setting' : 'Sun set'; $('tsun').className = 'mono ' + (dead ? 'off' : ms > 0 ? 'ink' : 'warn');
      $('tearth').textContent = me > 0 ? `Earth +${me.toFixed(1)}°` : 'Earth set'; $('tearth').className = 'mono ' + (dead ? 'off' : me > 0 ? 'earth' : 'warn');
      $('bs').className = !dead && me > BAND.S ? 'earth' : 'off'; $('bx').className = !dead && me > BAND.X ? 'earth' : 'off'; $('bka').className = !dead && me > BAND.Ka ? 'earth' : 'off';
      $('tbat').textContent = `Battery ${Math.round(state.bat)}%`; $('tbat').className = 'mono ' + (state.bat < 25 ? 'warn' : 'ink'); }
    if (state.t >= MISSION || (state.dead && state.t >= state.endAt)) finish(); }
  // light on the lander is exactly the fraction of the Sun's disc it can see
  if (lander.visible) { const ms = margin(s, sunV), fr = sunFrac(ms); sunLight.intensity = 3.2 * fr * (state.dead ? .5 : 1); sunLight.position.copy(lander.position).addScaledVector(sunV, 1); sunLight.target.position.copy(lander.position);
    fill.intensity = 0.03 + 0.1 * fr; U.uLanderLen.value = fr > 0.02 ? Math.min(0.4, 0.0052 / Math.max(0.004, Math.tan(Math.max(0.2, Math.asin(clamp(sunV.dot(s.U), -1, 1)) * DEG) / DEG))) : 0; }
  else { sunLight.intensity = 0; }
  U.uExp.value += ((state.mode === 'boots' || state.mode === 'end' ? 2.4 : 2.6) - U.uExp.value) * Math.min(1, dt * 2);
  U.uOrig.value.set(Math.round(camera.position.x / 24) * 24, Math.round(camera.position.z / 24) * 24); U.uPix.value = 2 * Math.tan(camera.fov * Math.PI / 360) / (innerHeight * renderer.getPixelRatio()); starMat.uniforms.uDpr.value = renderer.getPixelRatio();
  U.uEarthV.value.copy(earthV); U.uEarthI.value = 0.0035 * (1 - sunV.dot(earthV)) / 2;                       // earthshine, scaled by Earth's phase
  { const onGround = state.mode === 'boots' || state.mode === 'end' || (state.mode === 'fly' && lander.visible), fr = onGround ? sunFrac(margin(s, sunV)) : 1;
    starMat.uniforms.uVis.value += ((onGround ? 1 - .97 * fr : .32) - starMat.uniforms.uVis.value) * Math.min(1, dt * 3); }   // a camera exposed for sunlit ground cannot see stars
  sky.position.copy(camera.position); sunDisc.position.copy(sunV).multiplyScalar(SKY); sunDisc.lookAt(camera.position); glow.position.copy(sunDisc.position); earth.position.copy(earthV).multiplyScalar(SKY);
  { const vis = state.mode === 'boots' || state.mode === 'end' || (state.mode === 'fly' && lander.visible) ? sunFrac(margin(s, sunV)) : 1; halo.material.opacity = vis; glow.material.opacity = vis * .9; streak.material.opacity = vis * .85; streak.material.rotation = 0; const lens = Math.tan(camera.fov * Math.PI / 360) / Math.tan(26 * Math.PI / 180); halo.scale.setScalar(0.5 * lens); glow.scale.setScalar(1.7 * lens); streak.scale.setScalar(0.72 * lens);
    halo.material.opacity = vis; streak.material.opacity = vis * .9;
    const sn = sunDisc.position.clone().add(sky.position).project(camera), onScreen = sn.z < 1 && Math.abs(sn.x) < 1.2 && Math.abs(sn.y) < 1.2;
    for (const g of ghosts) { g.visible = onScreen && vis > 0 && state.mode !== 'table'; if (!g.visible) continue; tmp.set(sn.x * g.userData.k, sn.y * g.userData.k, .5).unproject(camera).sub(camera.position).normalize().multiplyScalar(SKY * .9);
      g.position.copy(tmp); g.scale.setScalar((.025 + Math.abs(g.userData.k) * .05) * lens); g.material.opacity = vis * g.userData.o * 2.2; }
    halo.position.copy(sunDisc.position); streak.position.copy(sunDisc.position);
    const hrs = f * 6; qSpin.setFromAxisAngle(yAxis, -hrs / 24.84 * Math.PI * 2 + 2.1); earth.quaternion.copy(qSpin).multiply(qFlip); earth.material.uniforms.uCloudShift.value = hrs * 0.0006; }
  // pinned labels
  v3.set(sunV.x, 0, sunV.z).normalize(); sunTagPos.set(v3.x * 322, -26, v3.z * 322); v3.set(earthV.x, 0, earthV.z).normalize(); earthTagPos.set(v3.x * 322, -26, v3.z * 322);
  if (bodyVis()) { const x = sites[state.sel], ms = margin(x, sunV), me = margin(x, earthV); sunTag.textContent = ms > 0 ? 'Sun · up' : 'Sun · hidden'; earthTag.textContent = me > 0 ? 'Earth · up' : 'Earth · hidden'; sunTag.classList.toggle('down', ms <= 0); earthTag.classList.toggle('down', me <= 0); }
  if (state.mode === 'table') for (const x of sites) { const a = margin(x, sunV) > 0, b = margin(x, earthV) > 0; if (x.a !== a) { x.a = a; x.el.querySelector('.ps').className = 'ps ' + (a ? 'ink' : 'off'); } if (x.b !== b) { x.b = b; x.el.querySelector('.pe').className = 'pe ' + (b ? 'earth' : 'off'); } }
  renderer.render(scene, camera);
  // pinned labels: project, then nudge overlapping pins upward on a dashed stem so names never collide
  const w = innerWidth, h = innerHeight, placed = [], pins = [];
  for (const l of labels) { const on = l.visible(); l.el.style.display = 'none'; if (!on) continue; v3.copy(l.getPos()).project(camera);
    if (v3.z >= 1 || Math.abs(v3.x) > 1.1 || Math.abs(v3.y) > 1.1) continue; const x = (v3.x + 1) / 2 * w, y = (1 - v3.y) / 2 * h; l.el.style.display = '';
    if (l.el.classList.contains('tag')) { l.el.style.transform = `translate(${clamp(x, 50, w - 50).toFixed(1)}px,${clamp(y, 84, h - 200).toFixed(1)}px) translate(-50%,-50%)`; continue; }
    if (!l.w) { l.w = l.el.offsetWidth + 10; l.h = l.el.offsetHeight + 6; } pins.push({ l, x, y }); }
  pins.sort((a, b) => b.y - a.y);
  for (const p of pins) { let dy = 0; const hit = () => placed.some(q => p.x < q.x + q.w && q.x < p.x + p.l.w && p.y - dy - p.l.h < q.y && q.y - q.h < p.y - dy);
    while (dy < 240 && hit()) dy += 4; placed.push({ x: p.x, y: p.y - dy, w: p.l.w, h: p.l.h });
    p.l.el.style.transform = `translate(${p.x.toFixed(1)}px,${(p.y - dy).toFixed(1)}px) translateY(-100%)`; p.l.el.style.setProperty('--stem', dy + 'px'); }
  { const fd = state.mode === 'intro' ? state.f : f;   // the opening's light slides in from an earlier date; the label shows the date you will land on
  const ut = dateAt(fd, { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + String(new Date(T0 + fd * 6 * 36e5).getUTCHours()).padStart(2, '0') + ':00 UTC'; if ($('utc').textContent !== ut) $('utc').textContent = ut; }
}
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); drawTimeline(); });
{ const c = document.createElement('canvas'); c.width = c.height = 180; const g = c.getContext('2d'), im = g.createImageData(180, 180);
  for (let i = 0; i < im.data.length; i += 4) { const v = 128 + (Math.random() + Math.random() + Math.random() - 1.5) * 90; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
  g.putImageData(im, 0, 0); $('grain').style.backgroundImage = `url(${c.toDataURL()})`; }
introCamera(0); renderer.render(scene, camera); requestAnimationFrame(() => show('load', false)); window.__state = state; window.__app = { jump: () => { const w = state.tween; if (!w) return; camera.position.copy(w.p1); camera.quaternion.copy(w.q1); camera.fov = w.f1; camera.updateProjectionMatrix(); state.tween = null; w.done && w.done(); }, setUI, standHere, enterTable, select, sites, aim: (obj, fov) => { const s = sites[state.sel], d = obj === "sun" ? sunDisc.position.clone().normalize() : earth.position.clone().normalize(); state.yaw = Math.atan2(d.dot(s.E), d.dot(s.Nn)); state.pitch = Math.asin(d.dot(s.U)); state.fovT = fov; } };
requestAnimationFrame(frame);
