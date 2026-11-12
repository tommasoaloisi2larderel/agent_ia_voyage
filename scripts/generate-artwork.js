import { mkdir, writeFile } from 'node:fs/promises';
const dir = new URL('../public/assets/', import.meta.url);
await mkdir(dir, { recursive: true });
await writeFile(new URL('compass.svg', dir), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="none" stroke="#728656" stroke-width="1.1"/><circle cx="20" cy="20" r="12" fill="none" stroke="#a5b28a" stroke-width=".65"/><path d="M20 3v5m0 24v5M3 20h5m24 0h5" stroke="#728656"/><path d="m26 12-3.5 12L14 28l3.5-12Z" fill="#315e47"/><path d="m26 12-6 8-6 8 3.5-12Z" fill="#c7d6ac"/><circle cx="20" cy="20" r="1.7" fill="#f8f8f2"/></svg>`);
const palettes = {
  med: ['#d5e6e5','#f4f0da','#79b7bb','#abc8bb','#e7debd','#f9f5e7','#9eb499'],
  green: ['#dce5d7','#eee9cb','#86b4aa','#7f9d82','#c9c8a5','#f3efdc','#6e916d'],
  sun: ['#f0e5ca','#f8db9d','#88b9b5','#bbbd95','#e3bd8c','#f9edd5','#9aab7a'],
  volcan: ['#dce4e6','#ecdfb5','#7fadb5','#9fa89e','#b4b0a1','#f6f0df','#7d957a'],
  tropical: ['#d4e9e4','#f6e8b6','#6aafa5','#93b5a0','#e2d7ab','#fff5da','#618a70'],
  desert: ['#efe0ce','#efd1a0','#85b7af','#c7a980','#d9b28e','#f4dfbf','#9aab7b'],
};
for (const [name, [sky,sun,water,hill,sand,wall,green]] of Object.entries(palettes)) {
  const desert = name === 'desert';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
  <defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${sky}"/><stop offset="1" stop-color="${wall}"/></linearGradient><linearGradient id="sea" x2="0" y2="1"><stop stop-color="${water}"/><stop offset="1" stop-color="${sky}"/></linearGradient><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".045"/></feComponentTransfer><feBlend in="SourceGraphic" mode="multiply"/></filter></defs>
  <g filter="url(#grain)"><path fill="url(#sky)" d="M0 0h640v400H0z"/><circle cx="107" cy="75" r="30" fill="${sun}"/>
  <path d="M0 182Q70 140 137 162T298 154T470 171T640 135V290H0Z" fill="${hill}" opacity=".65"/>
  ${desert ? `<path d="M0 188Q130 130 260 200T640 163V400H0Z" fill="${sand}"/>` : `<path fill="url(#sea)" d="M0 193h640v207H0z"/><path d="M0 245q100 6 178-8m-80 44q85 8 164-2M2 321q110-10 182-2" stroke="#fff" stroke-opacity=".25" fill="none"/>`}
  <path d="M640 202Q543 172 455 228T255 279T0 350v50h640Z" fill="${sand}"/>
  <path d="M640 219Q543 189 455 245T255 296T0 368" stroke="${wall}" stroke-width="7" fill="none" opacity=".7"/>
  <path d="M332 150h198v126H332Z" fill="${wall}"/><path d="M530 150l57 23v112l-57-9Z" fill="${sand}"/><path d="M321 145h218v10H321z" fill="#fff7e4"/>
  <path d="M371 107h127v46H371Z" fill="${wall}"/><path d="M361 102h146v8H361Z" fill="#fff7e4"/>
  <path d="M350 184a14 14 0 0128 0v35h-28Zm54 0a14 14 0 0128 0v35h-28Zm54 0a14 14 0 0128 0v35h-28Z" fill="${hill}"/>
  <path d="M390 123h19v18h-19m49-18h19v18h-19" fill="${hill}"/>
  <path d="M325 236h220v11H325z" fill="${wall}"/><path d="M338 247h9v42h-9m90-42h9v42h-9m90-42h9v42h-9" fill="${wall}"/>
  <path d="M296 302h259l43 44H272Z" fill="${wall}"/><path d="M305 309h240l29 29H287Z" fill="${water}"/><path d="M320 321h182" stroke="${sky}" stroke-width="2" opacity=".6"/>
  <path d="M232 278v-84" stroke="${sand}" stroke-width="7"/><path d="M232 197q-52-54-84-17 49-5 84 17m0 0q-8-76 37-77-23 28-37 77m0 0q50-57 77-22-45-3-77 22m0 0q-30-24-49 13 31-17 49-13m0 0q37-11 51 25-28-21-51-25" fill="${green}"/>
  <path d="M601 336v-64" stroke="${sand}" stroke-width="5"/><path d="M601 275q-42-39-60-14 36-2 60 14m0 0q-6-56 27-57-17 21-27 57m0 0q34-38 39-18-22 0-39 18" fill="${green}"/>
  <ellipse cx="366" cy="285" rx="21" ry="6" fill="${sand}"/><path d="M366 284v-37" stroke="#9a9271" stroke-width="2"/><path d="M341 248q25-26 50 0Z" fill="${sun}"/>
  <path d="M0 390q72-87 136 10H0m515 0q48-54 125-25v25" fill="${green}"/>
  <path d="M30 72q8-8 16 0 8-8 16 0m175 17q6-6 12 0 6-6 12 0" fill="none" stroke="${hill}" stroke-width="2"/>
  </g></svg>`;
  await writeFile(new URL(`${name}.svg`, dir), svg);
}
console.log('Illustrations locales générées.');
