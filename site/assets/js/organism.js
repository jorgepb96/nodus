/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

The organism: the living field of nodes and synapses behind every page.

No libraries. Two WebGL passes on one canvas:
  1. a nebula rendered at half resolution and upscaled, so the fragment shader
     costs a quarter of what it looks like it costs;
  2. the node field itself — physics on the CPU in typed arrays, drawn as
     additive GL_LINES for the synapses and GL_POINTS for the nodes.

The field reacts to the pointer, to scroll velocity, to clicks, and to whichever
section of the page is currently on screen (each one retunes its colour).
It degrades to a static CSS gradient when WebGL is missing or the visitor asked
for reduced motion.
*/
(function () {
  'use strict';

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  /* ------------------------------------------------------------ shaders */

  const NEBULA_VS = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = aPos * 0.5 + 0.5;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }`;

  const NEBULA_FS = `
    precision mediump float;
    varying vec2 vUv;
    uniform vec2 uRes;
    uniform float uTime;
    uniform vec2 uPointer;
    uniform vec3 uAccent;
    uniform vec3 uSecond;
    uniform float uEnergy;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y);
    }

    float fbm(vec2 p) {
      float total = 0.0;
      float amp = 0.5;
      for (int i = 0; i < 4; i++) {
        total += noise(p) * amp;
        p *= 2.02;
        amp *= 0.5;
      }
      return total;
    }

    void main() {
      vec2 uv = vUv;
      float aspect = uRes.x / max(uRes.y, 1.0);
      vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

      float t = uTime * 0.036;

      // one domain warp is enough to stop the noise reading as noise
      vec2 warp = vec2(fbm(p * 1.7 + vec2(t, -t * 0.7)), fbm(p * 1.7 + vec2(4.3 - t, t * 0.5)));
      float density = fbm(p * 2.3 + warp * 1.25 + vec2(0.0, t * 0.4));

      // deep plasma folds
      float folds = smoothstep(0.34, 0.86, density);
      float veins = pow(1.0 - abs(density - 0.5) * 2.0, 3.5);

      vec3 col = vec3(0.024, 0.02, 0.043);
      col += uAccent * folds * (0.16 + uEnergy * 0.20);
      col += uSecond * veins * (0.10 + uEnergy * 0.13);

      // the pointer carries a soft light with it
      vec2 ptr = vec2((uPointer.x - 0.5) * aspect, uPointer.y - 0.5);
      float halo = exp(-dot(p - ptr, p - ptr) * 11.0);
      col += uAccent * halo * 0.16;

      // vignette, so the middle of the page stays readable
      float vig = 1.0 - smoothstep(0.24, 0.96, length(p * vec2(0.86, 1.12)));
      col *= 0.42 + vig * 0.72;

      gl_FragColor = vec4(col, 1.0);
    }`;

  const BLIT_VS = NEBULA_VS;
  const BLIT_FS = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uTex;
    void main() { gl_FragColor = texture2D(uTex, vUv); }`;

  const LINE_VS = `
    attribute vec2 aPos;
    attribute float aAlpha;
    uniform vec2 uRes;
    varying float vAlpha;
    void main() {
      vAlpha = aAlpha;
      vec2 clip = vec2(aPos.x / uRes.x * 2.0 - 1.0, 1.0 - aPos.y / uRes.y * 2.0);
      gl_Position = vec4(clip, 0.0, 1.0);
    }`;

  const LINE_FS = `
    precision mediump float;
    varying float vAlpha;
    uniform vec3 uColor;
    void main() { gl_FragColor = vec4(uColor * vAlpha, vAlpha); }`;

  const NODE_VS = `
    attribute vec2 aPos;
    attribute float aSize;
    attribute float aAlpha;
    attribute float aTint;
    uniform vec2 uRes;
    uniform float uDpr;
    varying float vAlpha;
    varying float vTint;
    void main() {
      vAlpha = aAlpha;
      vTint = aTint;
      vec2 clip = vec2(aPos.x / uRes.x * 2.0 - 1.0, 1.0 - aPos.y / uRes.y * 2.0);
      gl_Position = vec4(clip, 0.0, 1.0);
      gl_PointSize = aSize * uDpr;
    }`;

  const NODE_FS = `
    precision mediump float;
    varying float vAlpha;
    varying float vTint;
    uniform vec3 uColor;
    uniform vec3 uHot;
    void main() {
      vec2 d = gl_PointCoord - vec2(0.5);
      float r = length(d) * 2.0;
      if (r > 1.0) discard;
      // a bright core inside a soft corona
      float core = smoothstep(1.0, 0.12, r);
      float corona = pow(1.0 - r, 2.2) * 0.7;
      vec3 col = mix(uColor, uHot, vTint);
      float a = (core * 0.75 + corona) * vAlpha;
      gl_FragColor = vec4(col * a, a);
    }`;

  /* ------------------------------------------------------------ gl helpers */

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`shader: ${log}`);
    }
    return shader;
  }

  function program(gl, vsSource, fsSource, attributes) {
    const p = gl.createProgram();
    const vs = compile(gl, gl.VERTEX_SHADER, vsSource);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource);
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`link: ${gl.getProgramInfoLog(p)}`);
    }
    const handles = { program: p, a: {}, u: {} };
    for (const name of attributes) handles.a[name] = gl.getAttribLocation(p, name);
    const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(p, i);
      handles.u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return handles;
  }

  function hexToRgb(hex) {
    const value = hex.trim().replace('#', '');
    const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
    const n = parseInt(full, 16);
    if (Number.isNaN(n)) return [0.55, 0.42, 0.92];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  /* ------------------------------------------------------------ the glyphs */
  /* Sample the Nodus mark (or another app's letter) so the field can assemble into it.

     The mark is not just an N: it is four nodes joined by three strokes, and the
     four discs are what makes it read as the logo rather than as a letter. Each
     corner therefore gets a tight cluster of nodes that renders as one bright
     disc, and every point carries the tint it has in the real logo, which runs
     from near-white at the top left to deep violet at the bottom right.

     Point format: [x, y, hub, tint], with x and y normalised to -0.5..0.5. */
  const STROKE_HALF = 3.25;  // the logo draws its strokes at width 6.5 in a 64 box
  const DISC_R = 6.5;        // and its terminal nodes at radius 6.5

  /* The logo's gradient runs top-left to bottom-right; give every point the tint
     it would have under that gradient. */
  function gradientTint(nx, ny) {
    const along = ((nx + 0.22) / 0.44) * 0.45 + ((ny + 0.25) / 0.5) * 0.55;
    return Math.max(0, Math.min(1, 0.95 - along * 0.9));
  }

  /* Points along a circular arc, in the 64 box, for the round letters. */
  function arc(cx, cy, r, from, to, steps = 12) {
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const angle = ((from + (to - from) * (i / steps)) * Math.PI) / 180;
      points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
    }
    return points;
  }

  /* Each app of the family forms its own letter in the logo's language: strokes
     of the logo's width ending in its discs, inside the same 18–46 × 16–48 area
     the N uses, so every letter is laid out and sized exactly like the N. A page
     picks its letter with <body data-glyph="…">; the default is the Nodus N.
     `strokes` are polylines; `discs` are [x, y, tint], tint null = the gradient. */
  const GLYPHS = {
    n: { // the logo path: M18 48 V16 L46 48 V16
      strokes: [[[18, 48], [18, 16], [46, 48], [46, 16]]],
      discs: [[18, 16, 0.95], [18, 48, 0.6], [46, 48, 0.34], [46, 16, 0.1]], // #ddd6fe · #a78bfa · #8b5cf6 · #7c3aed
    },
    i: { // Imago: a capital I with its bar ends as nodes
      strokes: [[[22, 16], [42, 16]], [[32, 16], [32, 48]], [[22, 48], [42, 48]]],
      discs: [[22, 16, 0.95], [42, 16, 0.6], [22, 48, 0.34], [42, 48, 0.1]],
    },
    l: { // Link
      strokes: [[[22, 16], [22, 48], [44, 48]]],
      discs: [[22, 16, 0.95], [22, 48, 0.5], [44, 48, 0.1]],
    },
    r: { // Reader
      strokes: [[[20, 48], [20, 16], [30, 16], ...arc(30, 25, 9, -90, 90, 10).slice(1), [20, 34]], [[29, 34], [44, 48]]],
      discs: [[20, 16, 0.95], [20, 48, 0.5], [44, 48, 0.1]],
    },
    p: { // Presenter
      strokes: [[[20, 48], [20, 16], [31, 16], ...arc(31, 26, 10, -90, 90, 10).slice(1), [20, 36]]],
      discs: [[20, 16, 0.95], [20, 48, 0.3]],
    },
    d: { // Drift
      strokes: [[[20, 48], [20, 16], [28, 16], ...arc(28, 32, 16, -90, 90, 16).slice(1), [20, 48]]],
      discs: [[20, 16, 0.95], [20, 48, 0.3]],
    },
  };

  function glyphPoints(count, name = 'n') {
    const glyph = GLYPHS[name] || GLYPHS.n;
    const segments = [];
    for (const line of glyph.strokes) {
      for (let k = 1; k < line.length; k++) segments.push([...line[k - 1], ...line[k]]);
    }
    const lengths = segments.map(([x1, y1, x2, y2]) => Math.hypot(x2 - x1, y2 - y1));
    const strokeLength = lengths.reduce((a, b) => a + b, 0);

    // Share the nodes between the strokes and the four discs by area, then pick
    // the pitch that fills that area evenly. This is what gives the mark a real
    // stroke width instead of a single-file chain of beads.
    const strokeArea = strokeLength * STROKE_HALF * 2;
    const discArea = glyph.discs.length * Math.PI * DISC_R * DISC_R;
    const strokeShare = Math.max(24, Math.round(count * strokeArea / (strokeArea + discArea)));
    const pitch = Math.max(0.6, Math.sqrt(strokeArea / strokeShare));
    const rows = Math.max(3, Math.round((STROKE_HALF * 2) / pitch) + 1);

    const points = [];
    const push = (x, y, isHub, tint) => {
      const nx = x / 64 - 0.5;
      const ny = y / 64 - 0.5;
      points.push([nx, ny, isHub, tint === null ? gradientTint(nx, ny) : tint]);
    };

    for (let s = 0; s < segments.length; s++) {
      const [x1, y1, x2, y2] = segments[s];
      const length = lengths[s];
      const dx = (x2 - x1) / length;
      const dy = (y2 - y1) / length;
      const px = -dy;                       // across the stroke
      const py = dx;
      const steps = Math.max(2, Math.round(length / pitch));
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        const bx = x1 + (x2 - x1) * t;
        const by = y1 + (y2 - y1) * t;
        for (let row = 0; row < rows; row++) {
          const across = (row / (rows - 1) - 0.5) * 2 * STROKE_HALF;
          push(bx + px * across, by + py * across, 0, null);
        }
      }
    }

    // the terminal nodes, filled to the logo's radius so they read as discs
    glyph.discs.forEach(([cx, cy, discTint]) => {
      const tint = discTint;
      push(cx, cy, 1, tint);
      for (let r = pitch; r <= DISC_R; r += pitch) {
        const around = Math.max(6, Math.round((2 * Math.PI * r) / pitch));
        for (let i = 0; i < around; i++) {
          const angle = (i / around) * Math.PI * 2 + r;
          push(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, 1, tint);
        }
      }
    });

    return points;
  }

  /* ------------------------------------------------------------ the organism */

  /* A machine with no usable GPU still answers "yes" to WebGL: Chrome quietly
     falls back to a software rasteriser (SwiftShader here, llvmpipe on a Linux
     box with no drivers, Microsoft's basic renderer on Windows). Every frame
     then costs tens of milliseconds on the main thread instead of two or three,
     which is far worse than showing no field at all. The renderer name is only
     advisory and some browsers mask it, so anything we cannot read is trusted
     to be real hardware and left to the frame governor below. */
  function isSoftwareRenderer(gl) {
    try {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const unmasked = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
      const name = String(unmasked || '') + ' ' + String(gl.getParameter(gl.RENDERER) || '');
      return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
    } catch (error) {
      return false;
    }
  }

  function create(canvas) {
    let gl = null;
    try {
      const options = { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' };
      gl = canvas.getContext('webgl2', options) || canvas.getContext('webgl', options);
    } catch (error) { gl = null; }
    if (!gl) return null;
    if (isSoftwareRenderer(gl)) return null;

    const nebula = program(gl, NEBULA_VS, NEBULA_FS, ['aPos']);
    const blit = program(gl, BLIT_VS, BLIT_FS, ['aPos']);
    const lines = program(gl, LINE_VS, LINE_FS, ['aPos', 'aAlpha']);
    const nodes = program(gl, NODE_VS, NODE_FS, ['aPos', 'aSize', 'aAlpha', 'aTint']);

    // one fullscreen triangle, reused by the nebula and the upscale blit
    const quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    /* --- offscreen half-resolution target for the nebula --- */
    const nebulaTexture = gl.createTexture();
    const nebulaFbo = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, nebulaTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, nebulaFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, nebulaTexture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    /* --- population --- */
    const coarse = matchMedia('(pointer: coarse)').matches;
    let count = coarse ? 96 : 210;
    const MAX = 260;
    const LINK = coarse ? 118 : 146;
    const MAX_EDGES = MAX * 10;

    const px = new Float32Array(MAX);
    const py = new Float32Array(MAX);
    const vx = new Float32Array(MAX);
    const vy = new Float32Array(MAX);
    const hx = new Float32Array(MAX);   // drift anchor
    const hy = new Float32Array(MAX);
    const fx = new Float32Array(MAX);   // formation target
    const fy = new Float32Array(MAX);
    const seed = new Float32Array(MAX);
    const mass = new Float32Array(MAX);
    const tint = new Float32Array(MAX);
    const hub = new Float32Array(MAX);      // 1 for the four discs of the mark
    const hubTint = new Float32Array(MAX);  // the colour that point has in the logo

    const nodeData = new Float32Array(MAX * 5);       // x, y, size, alpha, tint
    const lineData = new Float32Array(MAX_EDGES * 6); // 2 verts * (x, y, alpha)
    const nodeBuffer = gl.createBuffer();
    const lineBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nodeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, nodeData.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, lineData.byteLength, gl.DYNAMIC_DRAW);

    /* --- state --- */
    const state = {
      width: 1, height: 1, dpr: 1,
      pointer: { x: -9999, y: -9999, tx: -9999, ty: -9999, active: false },
      accent: hexToRgb('#a78bfa'),
      accentTarget: hexToRgb('#a78bfa'),
      second: hexToRgb('#22d3ee'),
      secondTarget: hexToRgb('#22d3ee'),
      energy: 0.25,
      energyTarget: 0.25,
      scrollBoost: 0,
      formation: 0,        // 0 = free drift, 1 = assembled into the N
      markScale: 1,        // how large the assembled mark is, relative to a phone
      formationTarget: 0,
      formationSettledFrames: 0,
      formationAnnounced: false,
      waves: [],           // click shockwaves
      time: 0,
      running: false,
      quality: 1,          // dropped to 0 if the machine cannot keep up
      lastScrollY: 0,
    };

    function seedPopulation() {
      for (let i = 0; i < MAX; i++) {
        hx[i] = Math.random() * state.width;
        hy[i] = Math.random() * state.height;
        px[i] = hx[i];
        py[i] = hy[i];
        vx[i] = 0;
        vy[i] = 0;
        seed[i] = Math.random() * Math.PI * 2;
        mass[i] = 0.6 + Math.random() * 0.9;
        tint[i] = Math.random() < 0.16 ? 1 : 0;
      }
      layoutFormation();
    }

    function layoutFormation() {
      // The N is drawn centred, sized to the viewport. Sample one glyph point per
      // active node and walk them in order: wrapping with `i % glyph.length`
      // instead piles the surplus nodes onto the first stroke, which then reads as
      // a bright bar with two faint strokes beside it rather than as a letter.
      const glyph = glyphPoints(Math.max(60, count), (document.body && document.body.dataset.glyph) || 'n');
      // The glyph occupies 0.44 of `size` across and 0.5 of it down, so fit the
      // letter itself rather than its box: without this the N is comfortable on a
      // desktop and a postage stamp on a phone, where width is the tight axis.
      const size = Math.min(state.width * 0.72 / 0.44, state.height * 0.42 / 0.5, 900);
      // Points are spaced proportionally to the mark, so their size has to scale
      // with it too. Fixed sizes made the big desktop N read as a dotted outline
      // while the small phone one read as a drawn stroke.
      state.markScale = size / 660;
      const cx = state.width * 0.5;
      const cy = state.height * 0.46;
      for (let i = 0; i < MAX; i++) {
        const point = glyph[Math.min(glyph.length - 1, Math.floor((i / Math.max(1, count)) * glyph.length))];
        hub[i] = point[2];
        hubTint[i] = point[3];
        // the discs sit exactly on the corner; only the strokes get any scatter
        const jitter = point[2] ? size * 0.004 : 3.2;
        fx[i] = cx + point[0] * size + Math.cos(seed[i] * 3.1) * jitter;
        fy[i] = cy + point[1] * size + Math.sin(seed[i] * 3.1) * jitter;
      }
    }

    function resize() {
      const cap = coarse ? 1.4 : 1.75;
      const dpr = Math.min(devicePixelRatio || 1, cap);
      const width = canvas.clientWidth || innerWidth;
      const height = canvas.clientHeight || innerHeight;
      state.width = width;
      state.height = height;
      state.dpr = dpr;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));

      const half = Math.max(1, Math.round(canvas.width * 0.5));
      const halfH = Math.max(1, Math.round(canvas.height * 0.5));
      gl.bindTexture(gl.TEXTURE_2D, nebulaTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, half, halfH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      state.nebulaW = half;
      state.nebulaH = halfH;
      layoutFormation();
    }

    /* --- neighbour lookup on a uniform grid --- */
    const cellSize = LINK;
    let grid = new Int32Array(0);
    let gridNext = new Int32Array(MAX);
    let cols = 0;
    let rows = 0;

    function buildGrid() {
      cols = Math.max(1, Math.ceil(state.width / cellSize));
      rows = Math.max(1, Math.ceil(state.height / cellSize));
      const cells = cols * rows;
      if (grid.length !== cells) grid = new Int32Array(cells);
      grid.fill(-1);
      for (let i = 0; i < count; i++) {
        const cx = Math.min(cols - 1, Math.max(0, (px[i] / cellSize) | 0));
        const cy = Math.min(rows - 1, Math.max(0, (py[i] / cellSize) | 0));
        const cell = cy * cols + cx;
        gridNext[i] = grid[cell];
        grid[cell] = i;
      }
    }

    /* --- one physics step --- */
    function step(dt) {
      const t = state.time;
      const pointer = state.pointer;

      // the pointer position eases toward the real one, so the field never twitches
      pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 9);
      pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 9);

      state.formation += (state.formationTarget - state.formation) * Math.min(1, dt * 4.2);
      state.energy += (state.energyTarget + state.scrollBoost - state.energy) * Math.min(1, dt * 2.2);
      state.scrollBoost *= Math.pow(0.06, dt);

      for (let i = 0; i < 3; i++) {
        state.accent[i] += (state.accentTarget[i] - state.accent[i]) * Math.min(1, dt * 1.7);
        state.second[i] += (state.secondTarget[i] - state.second[i]) * Math.min(1, dt * 1.7);
      }

      // shockwaves expand and fade
      for (let w = state.waves.length - 1; w >= 0; w--) {
        const wave = state.waves[w];
        wave.r += dt * 900;
        wave.life -= dt * 1.35;
        if (wave.life <= 0) state.waves.splice(w, 1);
      }

      const form = state.formation;
      const energy = state.energy;

      let formationError = 0;
      for (let i = 0; i < count; i++) {
        const s = seed[i];
        const m = mass[i];

        // a slow curl-ish drift keeps the field alive with no input at all
        const driftX = Math.sin(t * 0.21 + s * 1.7) * 12 + Math.cos(t * 0.13 + s * 2.9) * 8;
        const driftY = Math.cos(t * 0.18 + s * 2.3) * 11 + Math.sin(t * 0.11 + s * 1.3) * 7;

        let targetX = hx[i] + driftX;
        let targetY = hy[i] + driftY;

        if (form > 0.001) {
          targetX += (fx[i] - targetX) * form;
          targetY += (fy[i] - targetY) * form;
        }

        // spring toward the target
        const stiffness = 0.9 + form * 11;
        vx[i] += (targetX - px[i]) * stiffness * dt;
        vy[i] += (targetY - py[i]) * stiffness * dt;

        // the pointer pushes the field aside, harder the closer it gets
        if (pointer.active) {
          const dx = px[i] - pointer.x;
          const dy = py[i] - pointer.y;
          const distanceSquared = dx * dx + dy * dy;
          if (distanceSquared < 62500) { // 250px
            const distance = Math.sqrt(distanceSquared) + 0.001;
            const force = (1 - distance / 250);
            const push = force * force * 1350 / m;
            vx[i] += (dx / distance) * push * dt;
            vy[i] += (dy / distance) * push * dt;
          }
        }

        // shockwaves from clicks
        for (let w = 0; w < state.waves.length; w++) {
          const wave = state.waves[w];
          const dx = px[i] - wave.x;
          const dy = py[i] - wave.y;
          const distance = Math.hypot(dx, dy) + 0.001;
          const band = Math.abs(distance - wave.r);
          if (band < 130) {
            const force = (1 - band / 130) * wave.life * wave.strength * 2600 / m;
            vx[i] += (dx / distance) * force * dt;
            vy[i] += (dy / distance) * force * dt;
          }
        }

        // damping, then integrate
        const damp = Math.pow(0.0016, dt);
        vx[i] *= damp;
        vy[i] *= damp;
        px[i] += vx[i] * dt * (1 + energy * 0.5);
        py[i] += vy[i] * dt * (1 + energy * 0.5);

        if (state.formationTarget === 1) {
          formationError += Math.hypot(px[i] - fx[i], py[i] - fy[i]);
        }

        // wrap the drift anchors so the field never drains off one edge
        if (hx[i] < -80) hx[i] += state.width + 160;
        else if (hx[i] > state.width + 80) hx[i] -= state.width + 160;
        if (hy[i] < -80) hy[i] += state.height + 160;
        else if (hy[i] > state.height + 80) hy[i] -= state.height + 160;
      }

      /* Do not time the title shot from DOMContentLoaded: on a large viewport
         the nodes need longer to travel than on a small one. Announce the mark
         only after the formation blend is effectively complete and the nodes
         themselves have settled close to their targets for several frames. */
      if (state.formationTarget === 1 && !state.formationAnnounced) {
        const averageError = formationError / Math.max(1, count);
        const settledDistance = Math.max(9, 14 * state.markScale);
        if (state.formation >= 0.985 && averageError <= settledDistance) {
          state.formationSettledFrames++;
          if (state.formationSettledFrames >= 6) {
            state.formationAnnounced = true;
            canvas.dataset.organismAssembled = 'true';
            canvas.dispatchEvent(new CustomEvent('organism-assembled'));
          }
        } else {
          state.formationSettledFrames = 0;
        }
      }
    }

    /* --- turn the state into vertex data --- */
    function pack() {
      const pointer = state.pointer;
      const t = state.time;
      let nodeCursor = 0;
      for (let i = 0; i < count; i++) {
        const twinkle = 0.62 + Math.sin(t * 1.5 + seed[i] * 4.1) * 0.24;
        const near = pointer.active
          ? Math.max(0, 1 - Math.hypot(px[i] - pointer.x, py[i] - pointer.y) / 260)
          : 0;
        nodeData[nodeCursor++] = px[i];
        nodeData[nodeCursor++] = py[i];
        // while the mark is assembled the strokes thicken and the four corner
        // discs grow into the solid nodes the logo is built from
        const formed = state.formation;
        const disc = hub[i] * formed;
        nodeData[nodeCursor++] = (3.1 + mass[i] * 3.3 + near * 4.6 + (formed * 8.5 + disc * 11) * state.markScale);
        nodeData[nodeCursor++] = Math.min(1, twinkle * (0.72 + state.energy * 0.5) + near * 0.5 + formed * 0.34 + disc * 0.5);
        nodeData[nodeCursor++] = Math.min(1, (tint[i] + near * 0.7) * (1 - formed) + hubTint[i] * formed);
      }

      buildGrid();
      let edges = 0;
      let lineCursor = 0;
      // While the field is assembled into the mark its nodes sit a few pixels
      // apart, so the drifting link radius would wire every node on a stroke to
      // every other one — a bright web that eats the edge budget before the later
      // strokes are reached, leaving the letter with one solid bar and two faint
      // dotted lines. Tighten the radius as the formation closes so each stroke
      // reads as a clean chain of beads.
      const link = LINK * (1 - state.formation * 0.8);
      const linkSquared = link * link;
      for (let i = 0; i < count && edges < MAX_EDGES; i++) {
        const cx = Math.min(cols - 1, Math.max(0, (px[i] / cellSize) | 0));
        const cy = Math.min(rows - 1, Math.max(0, (py[i] / cellSize) | 0));
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          if (gy < 0 || gy >= rows) continue;
          for (let gx = cx - 1; gx <= cx + 1; gx++) {
            if (gx < 0 || gx >= cols) continue;
            for (let j = grid[gy * cols + gx]; j !== -1; j = gridNext[j]) {
              if (j <= i) continue;
              const dx = px[j] - px[i];
              const dy = py[j] - py[i];
              const distanceSquared = dx * dx + dy * dy;
              if (distanceSquared > linkSquared) continue;
              if (edges >= MAX_EDGES) break;
              const strength = 1 - Math.sqrt(distanceSquared) / link;
              // synapses near the pointer fire brighter
              const mid = pointer.active
                ? Math.max(0, 1 - Math.hypot((px[i] + px[j]) * 0.5 - pointer.x, (py[i] + py[j]) * 0.5 - pointer.y) / 300)
                : 0;
              const alpha = strength * strength * (0.42 + state.energy * 0.34 + state.formation * 0.55) + mid * 0.45 * strength;
              lineData[lineCursor++] = px[i];
              lineData[lineCursor++] = py[i];
              lineData[lineCursor++] = alpha;
              lineData[lineCursor++] = px[j];
              lineData[lineCursor++] = py[j];
              lineData[lineCursor++] = alpha;
              edges++;
            }
          }
        }
      }
      return { nodeCount: count, edgeCount: edges, lineFloats: lineCursor };
    }

    /* --- draw --- */
    function draw(packed) {
      const width = canvas.width;
      const height = canvas.height;

      // 1 · the nebula, at half resolution
      if (state.quality > 0) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, nebulaFbo);
        gl.viewport(0, 0, state.nebulaW, state.nebulaH);
        gl.disable(gl.BLEND);
        gl.useProgram(nebula.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.enableVertexAttribArray(nebula.a.aPos);
        gl.vertexAttribPointer(nebula.a.aPos, 2, gl.FLOAT, false, 0, 0);
        gl.uniform2f(nebula.u.uRes, state.nebulaW, state.nebulaH);
        gl.uniform1f(nebula.u.uTime, state.time);
        gl.uniform2f(nebula.u.uPointer,
          state.pointer.x / Math.max(1, state.width),
          1 - state.pointer.y / Math.max(1, state.height));
        gl.uniform3fv(nebula.u.uAccent, state.accent);
        gl.uniform3fv(nebula.u.uSecond, state.second);
        gl.uniform1f(nebula.u.uEnergy, state.energy);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // upscale it onto the canvas
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
        gl.useProgram(blit.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.enableVertexAttribArray(blit.a.aPos);
        gl.vertexAttribPointer(blit.a.aPos, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, nebulaTexture);
        gl.uniform1i(blit.u.uTex, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
        gl.clearColor(0.024, 0.02, 0.043, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }

      // 2 · synapses and nodes, added on top
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      if (packed.edgeCount > 0) {
        gl.useProgram(lines.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, lineData.subarray(0, packed.lineFloats));
        gl.enableVertexAttribArray(lines.a.aPos);
        gl.vertexAttribPointer(lines.a.aPos, 2, gl.FLOAT, false, 12, 0);
        gl.enableVertexAttribArray(lines.a.aAlpha);
        gl.vertexAttribPointer(lines.a.aAlpha, 1, gl.FLOAT, false, 12, 8);
        gl.uniform2f(lines.u.uRes, state.width, state.height);
        gl.uniform3fv(lines.u.uColor, state.accent);
        gl.drawArrays(gl.LINES, 0, packed.edgeCount * 2);
      }

      gl.useProgram(nodes.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, nodeBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, nodeData.subarray(0, packed.nodeCount * 5));
      gl.enableVertexAttribArray(nodes.a.aPos);
      gl.vertexAttribPointer(nodes.a.aPos, 2, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(nodes.a.aSize);
      gl.vertexAttribPointer(nodes.a.aSize, 1, gl.FLOAT, false, 20, 8);
      gl.enableVertexAttribArray(nodes.a.aAlpha);
      gl.vertexAttribPointer(nodes.a.aAlpha, 1, gl.FLOAT, false, 20, 12);
      gl.enableVertexAttribArray(nodes.a.aTint);
      gl.vertexAttribPointer(nodes.a.aTint, 1, gl.FLOAT, false, 20, 16);
      gl.uniform2f(nodes.u.uRes, state.width, state.height);
      gl.uniform1f(nodes.u.uDpr, state.dpr);
      gl.uniform3fv(nodes.u.uColor, state.accent);
      gl.uniform3f(nodes.u.uHot, 1.0, 0.98, 1.0);
      gl.drawArrays(gl.POINTS, 0, packed.nodeCount);
    }

    /* --- the loop, with a governor that gives up gracefully --- */
    const FRAME_MS = 1000 / 60;
    let previous = 0;
    let slowFrames = 0;
    let frames = 0;
    let costly = 0;
    let frame = 0;

    function tick(now) {
      if (!state.running) return;
      frame = requestAnimationFrame(tick);

      // Hold to 60 fps. A 120 Hz display gains nothing visible from a drifting
      // field and pays twice the CPU and battery for it.
      if (previous && now - previous < FRAME_MS - 1) return;

      const elapsed = previous ? Math.min(0.05, (now - previous) / 1000) : 0.016;
      previous = now;
      state.time += elapsed;

      const started = performance.now();
      step(elapsed);
      draw(pack());
      const cost = performance.now() - started;
      frames++;

      /* Warm-up aside, real hardware draws this field in two or three
         milliseconds. If the first second says otherwise we are on a renderer
         that did not admit to being software, and the field is not worth the
         main thread it is eating: stand down and let the page have it back. */
      if (frames > 10 && cost > 16) costly++;
      if (frames === 40 && costly >= 15) {
        stop();
        canvas.dispatchEvent(new CustomEvent('organism-standdown'));
        return;
      }

      // if we are consistently over budget, shed load rather than stutter
      if (cost > 12) {
        slowFrames++;
        if (slowFrames === 45) {
          count = Math.max(60, Math.round(count * 0.65));
          layoutFormation(); // fewer nodes means a different sampling of the glyph
        } else if (slowFrames === 120 && state.quality > 0) {
          state.quality = 0;
        } else if (slowFrames === 240) {
          // shedding load was not enough either; give the machine its thread back
          stop();
          canvas.dispatchEvent(new CustomEvent('organism-standdown'));
        }
      } else if (slowFrames > 0) {
        slowFrames--;
      }
    }

    function start() {
      if (state.running) return;
      state.running = true;
      previous = 0;
      frame = requestAnimationFrame(tick);
    }

    function stop() {
      state.running = false;
      cancelAnimationFrame(frame);
    }

    resize();
    seedPopulation();

    return {
      start,
      stop,
      resize,
      get running() { return state.running; },
      pointer(x, y) {
        state.pointer.tx = x;
        state.pointer.ty = y;
        if (!state.pointer.active) {
          state.pointer.x = x;
          state.pointer.y = y;
          state.pointer.active = true;
        }
      },
      pointerOut() { state.pointer.active = false; },
      pulse(x, y, strength) {
        if (state.waves.length > 5) state.waves.shift();
        state.waves.push({ x, y, r: 0, life: 1, strength: strength || 1 });
        state.scrollBoost = Math.min(0.7, state.scrollBoost + 0.24);
      },
      tune(accent, second, energy) {
        if (accent) state.accentTarget = hexToRgb(accent);
        if (second) state.secondTarget = hexToRgb(second);
        if (typeof energy === 'number') state.energyTarget = energy;
      },
      scrolled(velocity) {
        state.scrollBoost = Math.min(0.8, state.scrollBoost + Math.min(0.34, Math.abs(velocity) * 0.0016));
      },
      assemble(on) {
        state.formationTarget = on ? 1 : 0;
        if (on) {
          state.formationSettledFrames = 0;
          state.formationAnnounced = false;
          delete canvas.dataset.organismAssembled;
        }
      },
    };
  }

  /* The trusted in-app Research Atlas and Nodus Bookmarks pages reuse this
     exact renderer. They own their React lifecycle, so expose only the field
     constructor; no Nodus API, IPC or page data crosses this boundary. */
  window.NodusOrganismFactory = Object.freeze({ create });

  /* ------------------------------------------------------------ boot */

  /* The opening sequence on the home page is a title shot for the field: the
     nodes gather into the Nodus N, then flow back as the page arrives. With no
     field there is no N, and holding a blank page for five seconds shows the
     visitor nothing at all. So every path that stands the field down also hands
     the page straight back, and home.js finds the sequence already over. */
  function releaseOpening() {
    const root = document.documentElement;
    if (!root.classList.contains('intro-armed') && !root.classList.contains('intro-run')) return;
    root.classList.remove('intro-armed', 'intro-run');
    root.classList.add('intro-done');
  }

  function standDown(canvas) {
    canvas.replaceWith(Object.assign(document.createElement('div'), { className: 'organism-fallback' }));
    window.NodusOrganism = null;
    releaseOpening();
  }

  function boot() {
    const canvas = document.getElementById('organism');
    if (!canvas) return;

    // A host with its own lifecycle (the trusted Nodus renderer) mounts the
    // same engine itself so its listeners can be removed when the page closes.
    if (canvas.dataset.organismManaged === 'host') return;

    if (reduceMotion.matches) {
      standDown(canvas);
      return;
    }

    // the governor can decide mid-flight that this machine cannot afford us
    canvas.addEventListener('organism-standdown', () => standDown(canvas), { once: true });

    const organism = create(canvas);
    if (!organism) {
      standDown(canvas);
      return;
    }

    window.NodusOrganism = organism;
    organism.start();
    requestAnimationFrame(() => canvas.classList.add('awake'));

    // The field draws the Nodus N on arrival: on the home page that is the whole
    // opening shot, with the rest of the page still hidden. The sequence in
    // home.js releases it into the normal flow as soon as the mark is complete.
    const openingIsArmed = document.documentElement.classList.contains('intro-armed');
    if (document.body.dataset.formation === 'on' && openingIsArmed) {
      organism.assemble(true);
      // home.js drives the actual release; this only stops the field being stuck
      // in the mark if that script never runs.
      setTimeout(() => organism.assemble(false), 6000);
    }

    let resizeTimer = 0;
    addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => organism.resize(), 140);
    }, { passive: true });

    addEventListener('pointermove', (event) => organism.pointer(event.clientX, event.clientY), { passive: true });
    addEventListener('pointerleave', () => organism.pointerOut(), { passive: true });
    addEventListener('pointerdown', (event) => organism.pulse(event.clientX, event.clientY, 1), { passive: true });

    let lastY = scrollY;
    let ticking = false;
    addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        organism.scrolled(scrollY - lastY);
        lastY = scrollY;
        ticking = false;
      });
    }, { passive: true });

    // never burn a frame on a tab nobody is looking at
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) organism.stop();
      else organism.start();
    });

    // if the visitor turns reduced motion on mid-visit, respect it immediately
    const onPreference = () => {
      if (reduceMotion.matches) {
        organism.stop();
        standDown(canvas);
      }
    };
    if (reduceMotion.addEventListener) reduceMotion.addEventListener('change', onPreference);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
