// Pixel-art comparison renderer.
// Each scene fits the same logical viewport showing: sky/cave bg, wall, floor,
// a rocket pointed up with thrust flame, and a bullet streaking right.
// Style differs in palette, shading, anti-aliasing and post effects.

/** @param {CanvasRenderingContext2D} ctx */
function px(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

/** @param {CanvasRenderingContext2D} ctx */
function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Render a sprite from a string-grid using a palette map. Skips '.' (transparent). */
function blit(ctx, ox, oy, grid, palette) {
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === "." || ch === " ") continue;
      const color = palette[ch];
      if (!color) continue;
      px(ctx, ox + x, oy + y, color);
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// STYLE 1 — Amiga-faithful, 16-color, no anti-aliasing
// ───────────────────────────────────────────────────────────────────────────

function drawStyle1() {
  const cv = document.getElementById("c1");
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const W = cv.width, H = cv.height;

  // Sky / cave background — flat dark blue.
  rect(ctx, 0, 0, W, H, "#0c103a");

  // Star specks (1-pixel sparse).
  ctx.fillStyle = "#3050a0";
  const seed = [[18,12],[44,8],[62,22],[88,16],[103,30],[12,38],[120,42]];
  for (const [x, y] of seed) ctx.fillRect(x, y, 1, 1);
  ctx.fillStyle = "#80a0d8";
  for (const [x, y] of [[35,20],[75,6],[110,12]]) ctx.fillRect(x, y, 1, 1);

  // Cave wall on the right side, hard-edged with single highlight.
  for (let y = 0; y < H; y++) {
    for (let x = W - 22; x < W; x++) {
      // Jagged silhouette via a coarse noise function.
      const edge = W - 22 + ((y * 3 + Math.sin(y * 0.6) * 2) % 6);
      if (x >= edge) {
        const c = x === Math.floor(edge) ? "#a06840" : x > edge + 1 ? "#603020" : "#805030";
        px(ctx, x, y, c);
      }
    }
  }

  // Floor — top highlight, dark face.
  rect(ctx, 0, H - 14, W, 14, "#3a1e10");
  rect(ctx, 0, H - 14, W, 2, "#a06038");
  rect(ctx, 0, H - 12, W, 1, "#603020");
  // Floor surface pebbles.
  for (let i = 0; i < W; i += 7) {
    px(ctx, i + 2, H - 13, "#c08050");
    px(ctx, i + 5, H - 11, "#502010");
  }

  // Ship — rocket pointing up. 14x18.
  const ship1 = [
    "......55......",
    ".....5555.....",
    "....533335....",
    "....333333....",
    "...33344333...",
    "...33444333...",
    "..3334444333..",
    "..3334444333..",
    "..3334444333..",
    "..3333333333..",
    ".333322223333.",
    ".333322223333.",
    "3331111111333",  // wings
    "3311111111133",
    ".11.111111.11.",
    "...666.666....",
    "...676.676....",
    "....6...6.....",
  ];
  const shipPalette1 = {
    "1": "#a09080", // wing mid
    "2": "#605040", // wing shadow
    "3": "#4060c0", // hull base
    "4": "#80a0e0", // hull light
    "5": "#d04040", // nose tip
    "6": "#ff6020", // engine outer
    "7": "#ffd040", // engine inner
  };
  blit(ctx, 32, 30, ship1, shipPalette1);

  // Bullet — 2x2 yellow zipping right.
  rect(ctx, 78, 52, 3, 2, "#ffe040");
  rect(ctx, 75, 52, 2, 1, "#806020");
  rect(ctx, 75, 53, 2, 1, "#806020");
}

// ───────────────────────────────────────────────────────────────────────────
// STYLE 2 — Modern indie pixel, 32+ colors, in-grid shading + dither
// ───────────────────────────────────────────────────────────────────────────

function drawStyle2() {
  const cv = document.getElementById("c2");
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const W = cv.width, H = cv.height;

  // Atmospheric vertical gradient: dim purple → near-black.
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const r = Math.round(0x18 + (0x05 - 0x18) * t);
    const g = Math.round(0x14 + (0x06 - 0x14) * t);
    const b = Math.round(0x28 + (0x12 - 0x28) * t);
    rect(ctx, 0, y, W, 1, `rgb(${r},${g},${b})`);
  }

  // Stars + soft mist (dithered dots).
  ctx.fillStyle = "#3a3458";
  const dust = [[14,18],[27,9],[41,32],[58,12],[78,28],[95,18],[112,9],[8,52],[122,40]];
  for (const [x, y] of dust) ctx.fillRect(x, y, 1, 1);
  ctx.fillStyle = "#5a5078";
  for (const [x, y] of [[31,15],[68,22],[103,11]]) ctx.fillRect(x, y, 1, 1);

  // Cave wall on right — sculpted with three rock tones + lit top edges.
  const wallPal = { D: "#241830", M: "#3a2a4a", L: "#5a4868", H: "#8e7eaa" };
  for (let y = 0; y < H; y++) {
    const w = 18 + Math.round(Math.sin(y * 0.18) * 3) + (y % 6 === 0 ? 1 : 0);
    for (let i = 0; i < w; i++) {
      const x = W - w + i;
      let tone = "M";
      if (i === 0) tone = "L";
      else if (i === 1) tone = "L";
      else if (i > w - 4) tone = "D";
      // Highlight ledges where rock juts.
      if (y > 0 && Math.sin((y - 1) * 0.18) < Math.sin(y * 0.18) && i < 2) tone = "H";
      px(ctx, x, y, wallPal[tone]);
    }
  }

  // Floor with grass-of-rock highlight + ambient occlusion shadow.
  rect(ctx, 0, H - 16, W, 16, "#1d1530");
  for (let x = 0; x < W; x++) {
    const h = 2 + ((Math.sin(x * 0.3) + Math.sin(x * 0.71)) > 0.4 ? 1 : 0);
    rect(ctx, x, H - 16, 1, h, "#5a4868");
    px(ctx, x, H - 16 + h, "#3a2a4a");
  }
  // Scattered crystals on floor.
  for (const [x, y, c] of [[10, H-9, "#7eb0ff"], [40, H-7, "#a0e0ff"], [88, H-10, "#7eb0ff"], [108, H-8, "#a0e0ff"]]) {
    px(ctx, x, y, c);
    px(ctx, x, y - 1, "#e0f0ff");
  }

  // Ship — same silhouette but with smoother shading and a soft outline.
  const ship2 = [
    "......XX......",
    ".....XRRX.....",
    "....XRRRRX....",
    "....RRrrRR....",  // r = darker red
    "...RRrrrrRR...",
    "...BoooooB...",   // o = outline-dark, B = darkest hull
    "..BHHHCCHHHB..",  // H = hull mid, C = canopy
    "..BHHCCCCHHB..",
    "..BHHCCCCHHB..",
    "..BHHHHHHHHB..",
    ".BMMHHHHHHMMB.",  // M = wing mid
    ".BMMMMHHMMMMB.",
    "MMmmMMHHMMmmMM",  // m = wing dark
    "MMmm.MMMM.mmMM",
    "m..M.MMMM.M..m",
    "....OOO.OOO...",  // O = outer flame
    "....IOO.OOI...",  // I = inner flame
    ".....I...I....",
    ".....F...F....",  // F = flame core
  ];
  const palette2 = {
    "X": "#ffe16e", // tip light
    "R": "#ff8e3e", // tip
    "r": "#c44820", // tip shadow
    "B": "#171028", // outline
    "o": "#3a2a4a", // wing outline soft
    "H": "#4fa0d0", // hull mid
    "C": "#a8e6ff", // canopy
    "M": "#7ec0e8", // wing light
    "m": "#2a6090", // wing shadow
    "O": "#ff8030", // flame outer
    "I": "#ffd66e", // flame inner
    "F": "#ffffff", // flame core
  };
  blit(ctx, 31, 28, ship2, palette2);

  // Bullet with motion trail (3 fading pixels behind).
  rect(ctx, 80, 50, 3, 2, "#fff5b0");
  px(ctx, 79, 50, "#ffd66e");
  px(ctx, 79, 51, "#ffd66e");
  px(ctx, 78, 51, "#c47a30");
  px(ctx, 77, 51, "#6a4018");
}

// ───────────────────────────────────────────────────────────────────────────
// STYLE 3 — HD pixel art + glow (192x144, additive bloom)
// ───────────────────────────────────────────────────────────────────────────

function drawStyle3() {
  const cv = document.getElementById("c3");
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const W = cv.width, H = cv.height;

  // Layered atmospheric gradient with subtle horizon line.
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const r = Math.round(0x10 + 0x18 * Math.sin(t * 1.4) * (1 - t));
    const g = Math.round(0x14 + 0x10 * (1 - t));
    const b = Math.round(0x2e + 0x16 * Math.sin(t * 2.1));
    rect(ctx, 0, y, W, 1, `rgb(${Math.max(8,r)},${Math.max(10,g)},${Math.max(20,b)})`);
  }

  // Distant nebula wash (low-saturation pink-purple blobs).
  ctx.globalCompositeOperation = "lighter";
  for (const [cx, cy, rad, col] of [
    [40, 30, 28, "rgba(120,60,140,0.10)"],
    [130, 25, 36, "rgba(80,100,180,0.09)"],
    [90, 60, 22, "rgba(200,90,140,0.06)"],
  ]) {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grad.addColorStop(0, col);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
  ctx.globalCompositeOperation = "source-over";

  // Star field.
  const stars = [];
  for (let i = 0; i < 60; i++) stars.push([Math.floor(Math.random()*W), Math.floor(Math.random()*(H-30)), Math.random()]);
  // deterministic-ish: regenerate with seeded positions
  const fixedStars = [
    [12,8,1],[34,14,0.4],[48,6,0.7],[68,11,0.3],[88,18,0.9],[102,6,0.5],[124,12,0.6],
    [140,8,0.8],[166,14,0.4],[180,9,0.5],[20,32,0.3],[55,42,0.7],[112,38,0.4],
    [78,28,1.0],[160,32,0.6],[24,50,0.3],[154,52,0.5]
  ];
  for (const [x, y, b] of fixedStars) {
    const v = Math.round(120 + b * 135);
    px(ctx, x, y, `rgb(${v},${v},${Math.min(255,v+20)})`);
    if (b > 0.8) {
      // Cross-shaped sparkle.
      px(ctx, x - 1, y, `rgba(${v},${v},${v},0.5)`);
      px(ctx, x + 1, y, `rgba(${v},${v},${v},0.5)`);
      px(ctx, x, y - 1, `rgba(${v},${v},${v},0.5)`);
      px(ctx, x, y + 1, `rgba(${v},${v},${v},0.5)`);
    }
  }

  // Cave wall on right — multi-tone rock with rim light.
  const wallPal3 = { d: "#1a0e26", D: "#241834", M: "#3a2848", L: "#5e4670", H: "#9e88be", X: "#dec4ff" };
  for (let y = 0; y < H; y++) {
    const w = 28 + Math.round(Math.sin(y * 0.15) * 5 + Math.cos(y * 0.41) * 3);
    for (let i = 0; i < w; i++) {
      const x = W - w + i;
      let tone = "M";
      if (i === 0) tone = "X";
      else if (i === 1) tone = "H";
      else if (i === 2) tone = "L";
      else if (i > w - 5) tone = "D";
      else if (i > w - 2) tone = "d";
      // Crack details
      if ((y + i) % 17 === 0 && i > 5 && i < w - 5) tone = "D";
      px(ctx, x, y, wallPal3[tone]);
    }
  }

  // Floor with sculpted top, rocks, and AO.
  rect(ctx, 0, H - 22, W, 22, "#180f24");
  for (let x = 0; x < W; x++) {
    const peak = 3 + Math.round(Math.sin(x * 0.18) * 1.5 + Math.sin(x * 0.62) * 1);
    rect(ctx, x, H - 22, 1, peak, "#5e4670");
    px(ctx, x, H - 22 + peak, "#9e88be");
    px(ctx, x, H - 22 + peak + 1, "#3a2848");
  }
  // Crystal formations on floor.
  for (const [x, y] of [[26, H-14], [88, H-16], [148, H-14], [170, H-13]]) {
    px(ctx, x, y, "#82d8ff"); px(ctx, x, y - 1, "#c8edff"); px(ctx, x, y - 2, "#ffffff");
    px(ctx, x + 1, y, "#5ab0e0"); px(ctx, x + 1, y - 1, "#82d8ff");
    px(ctx, x - 1, y, "#3a7eb0");
  }

  // Ship — bigger sprite (20x26) with extensive shading.
  const ship3 = [
    ".........XX.........",
    "........XYYX........",
    ".......XYRRYX.......",
    "......XYRRRRYX......",
    "......YRRrrRRY......",
    "......YRrr..rRY.....",
    ".....KKHHCCHHKK.....",
    "....KKHHCCCCHHKK....",
    "....KKHCCccccHK.....",  // c = canopy dark
    "....KHHCccccCHK.....",
    "....KHHHHCCHHHK.....",
    "...KHHHHhhhhHHHK....",  // h = hull deepest shadow
    "...KhhHHHHhhHHhK....",
    "..KMMMHHHHHHMMMK....",
    ".KMnnMMHHhhMMnnMK...",  // n = wing seam
    "MmmnnMMMHHMMMnnmmM..",
    "MmmM..MMMMMMmM.mmM..",
    "Mm....MMMMMM....mM..",
    ".....mMMMMMMm.......",
    ".....mMMMMMMm.......",
    "......OOOOOO........",  // engine outer flame
    "......IIYYII........",
    ".......IFFI.........",
    "........FF..........",
    "........F...........",
  ];
  const palette3 = {
    "X": "#ffd166", "Y": "#ff8e3e", "R": "#e85a1c", "r": "#a13510",
    "K": "#0a0414", // outline darkest
    "H": "#4fa0d0", "h": "#1f5078",
    "C": "#aef0ff", "c": "#5cb6e6",
    "M": "#7ec0e8", "m": "#2a6090", "n": "#0e2e4e",
    "O": "#ff8030", "I": "#ffd66e", "Y": "#ffe199", "F": "#ffffff",
  };
  const shipX = 38, shipY = 50;
  blit(ctx, shipX, shipY, ship3, palette3);

  // Additive bloom passes for engines, bullet, crystals.
  ctx.globalCompositeOperation = "lighter";
  const glow = (x, y, r, color) => {
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, color);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  // Engine bloom (under the flame).
  glow(shipX + 9, shipY + 22, 10, "rgba(255,200,90,0.7)");
  glow(shipX + 9, shipY + 24, 6, "rgba(255,255,255,0.5)");

  // Nose-light bloom (subtle).
  glow(shipX + 10, shipY + 3, 6, "rgba(255,140,80,0.35)");

  // Crystal bloom.
  for (const [x, y] of [[26, H-15], [88, H-17], [148, H-15], [170, H-14]]) {
    glow(x, y, 5, "rgba(120,200,255,0.45)");
  }

  ctx.globalCompositeOperation = "source-over";

  // Bullet streak + glow.
  rect(ctx, 110, 70, 4, 2, "#ffffff");
  px(ctx, 109, 70, "#ffe199");
  px(ctx, 109, 71, "#ffe199");
  px(ctx, 108, 71, "#ff8030");
  px(ctx, 107, 71, "#a04018");
  ctx.globalCompositeOperation = "lighter";
  glow(112, 71, 8, "rgba(255,200,80,0.55)");
  ctx.globalCompositeOperation = "source-over";

  // Subtle vignette to push contrast.
  const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
}

drawStyle1();
drawStyle2();
drawStyle3();
