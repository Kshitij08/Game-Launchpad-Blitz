/*
 * Proof-of-Play game core (runs inside <iframe sandbox="allow-scripts">).
 * See web/src/lib/games/TEMPLATE_API.md for the template contract.
 *
 * Owns: boot, postMessage protocol, validation, assets -> textures, sfx (WebAudio:
 * uploaded or synthesized), vfx (Phaser particle presets), background/decor/ground,
 * HUD, title / ready / game-over screens. Templates (templates/*.js) only build the
 * world and run the per-frame logic via POP.registerTemplate(id, template).
 *
 * Protocol (all messages carry source: "pop"):
 *   parent -> game: load {config, assets?} | start | reset | mute {muted}
 *   game -> parent: ready | loaded | score {score} | gameOver {score, durationMs} | error {message}
 */
(function () {
  "use strict";

  var W = 480;
  var H = 720;
  var DEFAULT_GROUND_Y = 610;
  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  var embedded = window.parent && window.parent !== window;
  var TEMPLATE_IDS = ["flappy", "runner", "shooter", "dodge"];
  var SFX_SLOTS = ["jump", "score", "collect", "hit", "shoot", "music"];
  var VFX_SLOTS = ["trail", "collect", "hit", "score", "shoot"];
  var VFX_STYLES = ["none", "sparkle", "confetti", "smoke", "explosion", "bubbles", "pixels", "fire"];
  var DEFAULT_VFX = { trail: "sparkle", collect: "sparkle", hit: "explosion", score: "confetti", shoot: "pixels" };

  function post(msg) {
    msg.source = "pop";
    if (embedded) {
      try {
        window.parent.postMessage(msg, "*");
      } catch (e) {
        /* ignore */
      }
    } else {
      console.log("[pop]", msg);
    }
  }

  // ---------------------------------------------------------------------------
  // Template registry
  // ---------------------------------------------------------------------------
  var templates = {};
  var POP = (window.POP = {
    W: W,
    H: H,
    templates: templates,
    registerTemplate: function (id, t) {
      if (!id || !t || typeof t.create !== "function") {
        console.error("[pop] bad template registration", id);
        return;
      }
      templates[id] = t;
    },
  });

  // ---------------------------------------------------------------------------
  // Validation. Mirrors gameConfigSchema in src/lib/game-config.ts (the parent
  // also validates with zod; this is the in-sandbox safety net).
  // ---------------------------------------------------------------------------
  var HEX = /^#[0-9a-fA-F]{6}$/;
  var ASSET = /^asset:0x[0-9a-f]{64}$/;
  function isAssetRef(v) {
    return typeof v === "string" && ASSET.test(v);
  }
  function isSvg(v) {
    return typeof v === "string" && v.length <= 12000 && v.trim().indexOf("<svg") === 0 && v.indexOf("</svg>") !== -1;
  }

  function validate(c) {
    var errs = [];
    function isObj(v) {
      return !!v && typeof v === "object" && !Array.isArray(v);
    }
    function need(cond, msg) {
      if (!cond) errs.push(msg);
    }
    function str(o, k, p, min, max) {
      var v = o[k];
      if (typeof v !== "string") return need(false, p + k + ": expected string");
      need(v.length >= min && v.length <= max, p + k + ": length must be " + min + "-" + max);
    }
    function num(o, k, p, min, max, int, optional) {
      var v = o[k];
      if (v === undefined && optional) return;
      if (typeof v !== "number" || !isFinite(v)) return need(false, p + k + ": expected number");
      need(v >= min && v <= max, p + k + ": must be between " + min + " and " + max);
      if (int) need(Math.floor(v) === v, p + k + ": must be an integer");
    }
    function hex(o, k, p) {
      need(typeof o[k] === "string" && HEX.test(o[k]), p + k + ": expected 6-digit hex colour like #12ab34");
    }
    function sprite(o, k, p, optional) {
      var v = o[k];
      if (v === undefined && optional) return;
      need(isSvg(v) || isAssetRef(v), p + k + ": must be a complete <svg>...</svg> (max 12000 chars) or asset:0x<64 hex>");
    }
    function section(k, optional) {
      if (c[k] === undefined && optional) return null;
      if (!isObj(c[k])) {
        errs.push(k + ": expected object");
        return null;
      }
      return c[k];
    }

    if (!isObj(c)) return ["config: expected object"];
    need(c.version === 1, "version: must be 1");
    need(TEMPLATE_IDS.indexOf(c.template) !== -1, "template: must be one of " + TEMPLATE_IDS.join(", "));
    str(c, "title", "", 2, 40);
    str(c, "tagline", "", 0, 90);
    str(c, "scoreLabel", "", 0, 16);
    var s;
    if ((s = section("palette")))
      ["sky", "skyBottom", "ground", "accent", "text"].forEach(function (k) {
        hex(s, k, "palette.");
      });
    if ((s = section("sprites"))) {
      sprite(s, "player", "sprites.");
      sprite(s, "obstacle", "sprites.");
      sprite(s, "collectible", "sprites.", true);
      sprite(s, "decor", "sprites.", true);
      sprite(s, "projectile", "sprites.", true);
    }
    if ((s = section("physics"))) {
      num(s, "gravity", "physics.", 300, 2500);
      num(s, "jumpVelocity", "physics.", 250, 1000);
      num(s, "scrollSpeed", "physics.", 120, 600);
      num(s, "speedRampPerSec", "physics.", 0, 15);
    }
    if ((s = section("obstacles"))) {
      num(s, "spawnIntervalMs", "obstacles.", 300, 2600);
      num(s, "gapSize", "obstacles.", 110, 280);
      num(s, "variance", "obstacles.", 0, 1);
    }
    if ((s = section("scoring"))) {
      num(s, "pointsPerObstacle", "scoring.", 1, 10, true);
      num(s, "collectibleChance", "scoring.", 0, 1);
      num(s, "pointsPerCollectible", "scoring.", 0, 25, true);
    }
    if ((s = section("tuning", true))) {
      num(s, "playerSpeed", "tuning.", 200, 900, false, true);
      num(s, "fireRateMs", "tuning.", 120, 800, false, true);
      num(s, "enemyHp", "tuning.", 1, 5, true, true);
    }
    if ((s = section("sfx", true))) {
      SFX_SLOTS.forEach(function (k) {
        var v = s[k];
        if (v !== undefined) need(v === "none" || isAssetRef(v), "sfx." + k + ': must be asset:0x<64 hex> or "none"');
      });
    }
    if ((s = section("vfx", true))) {
      VFX_SLOTS.forEach(function (k) {
        var v = s[k];
        if (v === undefined) return;
        if (!isObj(v)) return need(false, "vfx." + k + ": expected object");
        need(VFX_STYLES.indexOf(v.style) !== -1, "vfx." + k + ".style: must be one of " + VFX_STYLES.join(", "));
        if (v.colors !== undefined) {
          need(
            Array.isArray(v.colors) &&
              v.colors.length >= 1 &&
              v.colors.length <= 4 &&
              v.colors.every(function (x) {
                return typeof x === "string" && HEX.test(x);
              }),
            "vfx." + k + ".colors: 1-4 hex colours"
          );
        }
        if (v.texture !== undefined) need(isAssetRef(v.texture), "vfx." + k + ".texture: must be asset:0x<64 hex>");
      });
    }
    return errs;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function rgb(h) {
    var n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function hexToInt(h) {
    return parseInt(h.slice(1), 16);
  }
  /** amt in [-1, 1]: negative darkens, positive lightens. */
  function shade(h, amt) {
    var c = rgb(h);
    function f(v) {
      return clamp(Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt), 0, 255);
    }
    return "#" + ((1 << 24) | (f(c[0]) << 16) | (f(c[1]) << 8) | f(c[2])).toString(16).slice(1);
  }
  function luminance(h) {
    var c = rgb(h);
    return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  }
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  POP.util = { clamp: clamp, shade: shade, hexToInt: hexToInt, luminance: luminance };

  // ---------------------------------------------------------------------------
  // Images: inline SVG or data: URL -> canvas at the slot's nominal size
  // ---------------------------------------------------------------------------
  function stripWH(tag) {
    return tag.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g, "");
  }

  /** Normalise the root <svg> tag so it has xmlns and explicit numeric width/height. */
  function prepareSvg(src) {
    var s = String(src).trim();
    var m = s.match(/^<svg\b[^>]*>/i);
    if (!m) return s;
    var tag = m[0];
    var vw = 0;
    var vh = 0;
    var vb = tag.match(/viewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([\d.eE]+)[\s,]+([\d.eE]+)/);
    if (vb) {
      vw = parseFloat(vb[3]);
      vh = parseFloat(vb[4]);
    }
    var newTag = tag;
    if (!/\sxmlns\s*=/.test(newTag)) newTag = newTag.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    if (!(vw > 0 && vh > 0)) {
      var wm = tag.match(/\swidth\s*=\s*["']?\s*([\d.]+)\s*(px)?["'\s>/]/);
      var hm = tag.match(/\sheight\s*=\s*["']?\s*([\d.]+)\s*(px)?["'\s>/]/);
      vw = wm ? parseFloat(wm[1]) : 64;
      vh = hm ? parseFloat(hm[1]) : 64;
      if (!(vw > 0)) vw = 64;
      if (!(vh > 0)) vh = 64;
      newTag = stripWH(newTag).replace(/^<svg/i, '<svg viewBox="0 0 ' + vw + " " + vh + '"');
    }
    newTag = stripWH(newTag).replace(/^<svg/i, '<svg width="' + vw + '" height="' + vh + '"');
    return newTag + s.slice(tag.length);
  }

  function fallbackCanvas(w, h, color) {
    var cv = document.createElement("canvas");
    cv.width = Math.max(2, Math.round(w));
    cv.height = Math.max(2, Math.round(h));
    var ctx = cv.getContext("2d");
    ctx.fillStyle = color;
    var r = Math.min(cv.width, cv.height) * 0.2;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(cv.width, 0, cv.width, cv.height, r);
    ctx.arcTo(cv.width, cv.height, 0, cv.height, r);
    ctx.arcTo(0, cv.height, 0, 0, r);
    ctx.arcTo(0, 0, cv.width, 0, r);
    ctx.fill();
    return cv;
  }

  /**
   * Resolve a sprite value (inline SVG or asset ref) to an image URL.
   * Returns null when an asset ref has no data in the asset map.
   */
  function spriteUrl(value, assets) {
    if (isAssetRef(value)) {
      var d = assets[value];
      return typeof d === "string" && d.indexOf("data:image/") === 0 ? d : null;
    }
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(prepareSvg(value));
  }

  /**
   * size: { w, h, mode } — mode "fit" (default): fit inside w x h keeping aspect;
   * mode "width": width = w, height follows aspect, clamped to [w, h].
   * Resolves to { canvas, w, h } (canvas pixel size == display size).
   */
  function rasterise(url, size, fallbackColor) {
    return new Promise(function (resolve) {
      var done = false;
      function finish(cv, w, h) {
        if (done) return;
        done = true;
        resolve({ canvas: cv, w: w, h: h });
      }
      function fallback() {
        var w = size.w;
        var h = size.mode === "width" ? Math.max(size.w * 6, 400) : size.h;
        finish(fallbackCanvas(w, h, fallbackColor), w, h);
      }
      if (!url) return fallback();
      var img = new Image();
      img.onload = function () {
        try {
          var nw = img.naturalWidth || img.width || size.w;
          var nh = img.naturalHeight || img.height || size.h;
          var w;
          var h;
          if (size.mode === "width") {
            w = size.w;
            h = clamp((size.w * nh) / nw, size.w, size.h);
          } else {
            var sc = Math.min(size.w / nw, size.h / nh);
            w = nw * sc;
            h = nh * sc;
          }
          w = Math.max(2, Math.round(w));
          h = Math.max(2, Math.round(h));
          var cv = document.createElement("canvas");
          cv.width = w;
          cv.height = h;
          var cx = cv.getContext("2d");
          cx.imageSmoothingQuality = "high";
          cx.drawImage(img, 0, 0, w, h);
          finish(cv, w, h);
        } catch (e) {
          fallback();
        }
      };
      img.onerror = function () {
        console.warn("[pop] could not decode image, using fallback");
        fallback();
      };
      setTimeout(fallback, 5000);
      img.src = url;
    });
  }

  function gradientCanvas(top, bottom) {
    var cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    var ctx = cv.getContext("2d");
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    return cv;
  }

  function groundCanvas(color, height) {
    var cv = document.createElement("canvas");
    cv.width = 96;
    cv.height = Math.max(16, height);
    var ctx = cv.getContext("2d");
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 96, cv.height);
    ctx.fillStyle = shade(color, 0.22);
    ctx.fillRect(0, 0, 96, 10);
    ctx.fillStyle = shade(color, -0.25);
    ctx.fillRect(0, 10, 96, 3);
    ctx.fillStyle = shade(color, -0.14);
    ctx.fillRect(8, 26, 34, 6);
    ctx.fillRect(56, 44, 22, 6);
    ctx.fillRect(20, 62, 14, 5);
    ctx.fillStyle = shade(color, 0.08);
    ctx.fillRect(62, 22, 10, 4);
    ctx.fillRect(4, 48, 8, 4);
    return cv;
  }

  function particleCanvases() {
    var dot = document.createElement("canvas");
    dot.width = dot.height = 16;
    var c = dot.getContext("2d");
    var g = c.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.45, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 16, 16);

    var px = document.createElement("canvas");
    px.width = px.height = 6;
    c = px.getContext("2d");
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, 6, 6);

    var ring = document.createElement("canvas");
    ring.width = ring.height = 16;
    c = ring.getContext("2d");
    c.strokeStyle = "rgba(255,255,255,0.95)";
    c.lineWidth = 1.6;
    c.beginPath();
    c.arc(8, 8, 6.5, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = "rgba(255,255,255,0.8)";
    c.fillRect(4.5, 4.5, 2, 2);
    return { pop_dot: dot, pop_px: px, pop_ring: ring };
  }

  /** Nominal slot sizes. Templates may override with `sizes` on the template object. */
  var BASE_SIZES = {
    player: { w: 48, h: 48 },
    obstacle: { w: 48, h: 48 },
    collectible: { w: 32, h: 32 },
    decor: { w: 128, h: 64 },
    projectile: { w: 8, h: 20 },
  };
  var TEMPLATE_OBSTACLE = {
    flappy: { w: 72, h: 620, mode: "width" },
    runner: { w: 52, h: 68 },
    shooter: { w: 48, h: 48 },
    dodge: { w: 40, h: 40 },
  };

  function slotSize(templateId, slot) {
    var t = templates[templateId];
    if (t && t.sizes && t.sizes[slot]) return t.sizes[slot];
    if (slot === "obstacle" && TEMPLATE_OBSTACLE[templateId]) return TEMPLATE_OBSTACLE[templateId];
    return BASE_SIZES[slot];
  }

  /** Build every texture a config needs. Resolves to { slot: {key, canvas, w, h} }. */
  function buildTextures(cfg, assets, gen) {
    var pal = cfg.palette;
    var sp = cfg.sprites;
    var jobs = {};
    ["player", "obstacle", "collectible", "decor", "projectile"].forEach(function (slot) {
      if (sp[slot] === undefined) return;
      var url = spriteUrl(sp[slot], assets);
      if (!url && isAssetRef(sp[slot])) console.warn("[pop] missing asset data for sprites." + slot);
      var color = slot === "player" || slot === "collectible" || slot === "projectile" ? pal.accent : shade(pal.ground, 0.2);
      jobs[slot] = rasterise(url, slotSize(cfg.template, slot), color);
    });
    if (cfg.vfx) {
      VFX_SLOTS.forEach(function (slot) {
        var p = cfg.vfx[slot];
        if (p && p.texture) {
          var url = spriteUrl(p.texture, assets);
          if (url) jobs["vfx_" + slot] = rasterise(url, { w: 24, h: 24 }, pal.accent);
        }
      });
    }
    var names = Object.keys(jobs);
    return Promise.all(
      names.map(function (n) {
        return jobs[n];
      })
    ).then(function (results) {
      var tex = {};
      names.forEach(function (n, i) {
        tex[n] = { key: "g" + gen + "_" + n, canvas: results[i].canvas, w: results[i].w, h: results[i].h };
      });
      tex.bg = { key: "g" + gen + "_bg", canvas: gradientCanvas(pal.sky, pal.skyBottom), w: W, h: H };
      return tex;
    });
  }

  // ---------------------------------------------------------------------------
  // Audio: uploaded clips via WebAudio, synthesized defaults, music, mute
  // ---------------------------------------------------------------------------
  var Sound = { ctx: null, master: null, muted: false, slots: {}, music: null, last: {} };

  function audioCtx() {
    if (!Sound.ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        Sound.ctx = new AC();
        Sound.master = Sound.ctx.createGain();
        Sound.master.gain.value = Sound.muted ? 0 : 0.5;
        Sound.master.connect(Sound.ctx.destination);
      } catch (e) {
        return null;
      }
    }
    return Sound.ctx;
  }

  function unlockAudio() {
    var a = audioCtx();
    if (a && a.state === "suspended") a.resume().catch(function () {});
  }

  function setMuted(m) {
    Sound.muted = !!m;
    if (Sound.master) Sound.master.gain.value = Sound.muted ? 0 : 0.5;
  }

  function dataUrlToBuffer(u) {
    var i = u.indexOf(",");
    var meta = u.slice(5, i);
    var data = u.slice(i + 1);
    if (/;base64/i.test(meta)) {
      var bin = atob(data);
      var arr = new Uint8Array(bin.length);
      for (var j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
      return arr.buffer;
    }
    return new TextEncoder().encode(decodeURIComponent(data)).buffer;
  }

  /** Resolves when all uploaded clips are decoded. Slot values: AudioBuffer | "none" | undefined (synth). */
  function loadSounds(cfg, assets) {
    var sfx = cfg.sfx || {};
    var slots = {};
    var a = audioCtx();
    var jobs = SFX_SLOTS.map(function (slot) {
      var v = sfx[slot];
      if (v === "none") {
        slots[slot] = "none";
        return null;
      }
      if (!isAssetRef(v) || !a) return null;
      var d = assets[v];
      if (typeof d !== "string" || d.indexOf("data:") !== 0) {
        console.warn("[pop] missing asset data for sfx." + slot);
        return null;
      }
      return new Promise(function (res) {
        try {
          a.decodeAudioData(
            dataUrlToBuffer(d),
            function (buf) {
              slots[slot] = buf;
              res();
            },
            function () {
              console.warn("[pop] could not decode sfx." + slot + ", using synth");
              res();
            }
          );
        } catch (e) {
          res();
        }
      });
    });
    return Promise.all(jobs).then(function () {
      return slots;
    });
  }

  function tone(a, type, f0, f1, dur, vol, delay) {
    var t = a.currentTime + (delay || 0);
    var o = a.createOscillator();
    var g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(Sound.master);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  function noise(a, dur, vol, cutoff) {
    var len = Math.floor(a.sampleRate * dur);
    var buf = a.createBuffer(1, len, a.sampleRate);
    var ch = buf.getChannelData(0);
    for (var i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = a.createBufferSource();
    src.buffer = buf;
    var f = a.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    var g = a.createGain();
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(Sound.master);
    src.start();
  }

  var SYNTH = {
    jump: function (a) {
      tone(a, "square", 320, 760, 0.12, 0.12);
    },
    score: function (a) {
      tone(a, "sine", 880, 0, 0.12, 0.22);
      tone(a, "sine", 1320, 0, 0.2, 0.2, 0.07);
    },
    collect: function (a) {
      tone(a, "triangle", 1046, 0, 0.08, 0.25);
      tone(a, "triangle", 1568, 0, 0.16, 0.25, 0.06);
    },
    hit: function (a) {
      noise(a, 0.35, 0.6, 1400);
      tone(a, "sine", 150, 45, 0.3, 0.45);
    },
    shoot: function (a) {
      tone(a, "square", 1300, 220, 0.09, 0.07);
    },
  };

  function playSfx(slot) {
    if (Sound.muted) return;
    var a = audioCtx();
    if (!a || a.state !== "running") return;
    var now = a.currentTime;
    if (Sound.last[slot] && now - Sound.last[slot] < 0.045) return; // de-spam
    Sound.last[slot] = now;
    var v = Sound.slots[slot];
    if (v === "none") return;
    try {
      if (v && typeof v === "object") {
        var src = a.createBufferSource();
        src.buffer = v;
        src.connect(Sound.master);
        src.start();
      } else if (SYNTH[slot]) {
        SYNTH[slot](a);
      }
    } catch (e) {
      /* ignore */
    }
  }

  function startMusic() {
    stopMusic();
    var buf = Sound.slots.music;
    var a = audioCtx();
    if (!a || !buf || typeof buf !== "object") return;
    try {
      var src = a.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      var g = a.createGain();
      g.gain.value = 0.35;
      src.connect(g);
      g.connect(Sound.master);
      src.start();
      Sound.music = src;
    } catch (e) {
      /* ignore */
    }
  }

  function stopMusic() {
    if (Sound.music) {
      try {
        Sound.music.stop();
      } catch (e) {
        /* ignore */
      }
      Sound.music = null;
    }
  }

  // ---------------------------------------------------------------------------
  // VFX presets -> Phaser particle emitter configs
  // ---------------------------------------------------------------------------
  function presetFor(cfg, slot) {
    var p = cfg.vfx && cfg.vfx[slot];
    return p || { style: DEFAULT_VFX[slot] || "sparkle" };
  }

  function defaultColors(style, pal) {
    switch (style) {
      case "smoke":
        return ["#d0d0d0", "#9a9a9a", "#707070"];
      case "fire":
        return ["#ffd23f", "#ff7b00", "#ff3b00"];
      case "explosion":
        return [pal.accent, "#ffd23f", "#ff6b35"];
      case "confetti":
        return [pal.accent, pal.text, shade(pal.accent, 0.45), shade(pal.sky, 0.5)];
      default:
        return [pal.accent, shade(pal.accent, 0.5), pal.text];
    }
  }

  function styleTexture(style) {
    if (style === "confetti" || style === "pixels") return "pop_px";
    if (style === "bubbles") return "pop_ring";
    return "pop_dot";
  }

  function emitterConfig(style, colors) {
    // Phaser tints are numbers; an array means "pick one at random per particle".
    var tints = colors.map(function (h) {
      return hexToInt(h);
    });
    var c = { tint: tints, emitting: false };
    switch (style) {
      case "confetti":
        c.speed = { min: 140, max: 340 };
        c.angle = { min: 200, max: 340 };
        c.gravityY = 520;
        c.rotate = { start: 0, end: 540 };
        c.scale = { start: 1.3, end: 0.8 };
        c.alpha = { start: 1, end: 0 };
        c.lifespan = { min: 700, max: 1100 };
        c.quantity = 22;
        break;
      case "smoke":
        c.speed = { min: 15, max: 60 };
        c.scale = { start: 0.8, end: 2.6 };
        c.alpha = { start: 0.55, end: 0 };
        c.lifespan = { min: 600, max: 1000 };
        c.gravityY = -40;
        c.quantity = 10;
        break;
      case "explosion":
        c.speed = { min: 90, max: 340 };
        c.scale = { start: 1.6, end: 0 };
        c.alpha = { start: 1, end: 0 };
        c.lifespan = { min: 350, max: 700 };
        c.blendMode = "ADD";
        c.quantity = 30;
        break;
      case "bubbles":
        c.speed = { min: 20, max: 90 };
        c.gravityY = -140;
        c.scale = { start: 0.6, end: 1.4 };
        c.alpha = { start: 0.9, end: 0 };
        c.lifespan = { min: 600, max: 1000 };
        c.quantity = 12;
        break;
      case "pixels":
        c.speed = { min: 70, max: 220 };
        c.gravityY = 300;
        c.scale = { start: 1, end: 0.6 };
        c.alpha = { start: 1, end: 0 };
        c.lifespan = { min: 350, max: 650 };
        c.quantity = 16;
        break;
      case "fire":
        c.speed = { min: 50, max: 150 };
        c.angle = { min: 240, max: 300 };
        c.scale = { start: 1.3, end: 0 };
        c.alpha = { start: 1, end: 0 };
        c.lifespan = { min: 300, max: 600 };
        c.blendMode = "ADD";
        c.quantity = 18;
        break;
      default: // sparkle
        c.speed = { min: 60, max: 210 };
        c.scale = { start: 0.9, end: 0 };
        c.alpha = { start: 1, end: 0 };
        c.lifespan = { min: 350, max: 650 };
        c.blendMode = "ADD";
        c.quantity = 16;
    }
    return c;
  }

  /** Turn a burst config into a continuous trail drifting by (dx, dy) px/s. */
  function trailConfig(c, drift) {
    var t = {};
    for (var k in c) t[k] = c[k];
    delete t.speed;
    delete t.angle;
    t.emitting = true;
    t.frequency = 40;
    t.quantity = 1;
    t.speedX = { min: drift.x - 25, max: drift.x + 25 };
    t.speedY = { min: drift.y - 25, max: drift.y + 25 };
    t.lifespan = { min: 300, max: 480 };
    if (t.gravityY && Math.abs(t.gravityY) > 200) t.gravityY = t.gravityY / 3;
    if (t.scale && t.scale.start) t.scale = { start: t.scale.start * 0.7, end: 0 };
    t.alpha = { start: 0.7, end: 0 };
    return t;
  }

  // ---------------------------------------------------------------------------
  // The scene. One scene, restarted for every run; the template does the game.
  // ---------------------------------------------------------------------------
  class MainScene extends Phaser.Scene {
    constructor() {
      super({ key: "main" });
    }

    init(data) {
      this.d = data;
    }

    create() {
      try {
        this.build();
      } catch (e) {
        console.error(e);
        post({ type: "error", message: "Game failed to start: " + (e && e.message ? e.message : String(e)) });
        this.broken = true;
        return;
      }
      if (this.d.onReady) {
        var cb = this.d.onReady;
        this.d.onReady = null;
        cb(this);
      }
    }

    build() {
      var self = this;
      var d = this.d;
      var cfg = d.config;
      var pal = cfg.palette;
      var tpl = templates[cfg.template];
      this.tpl = tpl;
      this.cfg = cfg;

      // Textures: drop the previous config's (once), register this one's.
      (d.oldKeys || []).forEach(function (k) {
        if (self.textures.exists(k)) self.textures.remove(k);
      });
      d.oldKeys = [];
      Object.keys(d.tex).forEach(function (n) {
        if (!self.textures.exists(d.tex[n].key)) self.textures.addCanvas(d.tex[n].key, d.tex[n].canvas);
      });
      var pc = particleCanvases();
      Object.keys(pc).forEach(function (k) {
        if (!self.textures.exists(k)) self.textures.addCanvas(k, pc[k]);
      });

      this.phase = d.mode === "armed" ? "armed" : "title";
      this.t = 0;
      this.decor = [];
      this.ground = null;
      this.ended = false;
      this.emitters = {};

      var lightText = luminance(pal.text) > 0.5;
      this.strokeColor = lightText ? shade(pal.sky, -0.7) : "#ffffff";
      this.panelColor = lightText ? 0x000000 : 0xffffff;
      this.panelAlpha = lightText ? 0.35 : 0.55;

      var vertical = tpl.decorDirection === "down";
      var drift = tpl.trailDrift || (vertical ? { x: 0, y: 160 } : { x: -180, y: 0 });

      // ---- ctx
      var ctx = (this.ctx = {
        scene: this,
        config: cfg,
        W: W,
        H: H,
        groundY: typeof tpl.groundY === "number" ? tpl.groundY : DEFAULT_GROUND_Y,
        tex: { particle: "pop_dot" },
        size: {},
        palette: pal,
        rng: mulberry32((Date.now() ^ (Math.random() * 1e9)) >>> 0),
        elapsedMs: 0,
        phase: this.phase,
        score: 0,
        speed: function () {
          return Math.min(cfg.physics.scrollSpeed + (cfg.physics.speedRampPerSec * ctx.elapsedMs) / 1000, 1200);
        },
        addScore: function (n, x, y) {
          if (self.ended || !(n > 0)) return;
          ctx.score += n;
          self.scoreText.setText(String(ctx.score));
          self.scoreText.setScale(1.25);
          self.tweens.add({ targets: self.scoreText, scale: 1, duration: 160, ease: "Quad.easeOut" });
          post({ type: "score", score: ctx.score });
          // Rate-limit the score sound (dodge scores ~2x/s); vfx follows the preset.
          if (self.t - (self.lastScoreSfx || -1) >= 0.25) {
            self.lastScoreSfx = self.t;
            playSfx("score");
          }
          ctx.vfx("score", x === undefined ? W / 2 : x, y === undefined ? 70 : y);
        },
        collect: function (x, y) {
          if (self.ended) return;
          var pts = cfg.scoring.pointsPerCollectible;
          playSfx("collect");
          ctx.vfx("collect", x, y);
          if (pts > 0) {
            self.floatText(x, y, "+" + pts);
            ctx.score += pts;
            self.scoreText.setText(String(ctx.score));
            self.scoreText.setScale(1.25);
            self.tweens.add({ targets: self.scoreText, scale: 1, duration: 160, ease: "Quad.easeOut" });
            post({ type: "score", score: ctx.score });
          }
        },
        gameOver: function (x, y) {
          self.endRun(x, y);
        },
        sfx: function (slot) {
          playSfx(slot);
        },
        vfx: function (slot, x, y) {
          var em = self.burstEmitter(slot);
          if (em) em.explode(em.__qty, x, y);
        },
        trail: function (go) {
          var p = presetFor(cfg, "trail");
          if (!go || p.style === "none") return null;
          var c = trailConfig(emitterConfig(p.style, p.colors || defaultColors(p.style, pal)), drift);
          var key = d.tex.vfx_trail ? d.tex.vfx_trail.key : styleTexture(p.style);
          var em = self.add.particles(0, 0, key, c);
          em.setDepth((go.depth || 5) - 0.1);
          em.startFollow(go);
          return em;
        },
        input: { pointerX: W / 2, pointerY: H / 2, pointerDown: false, left: false, right: false, up: false, action: false },
        drawGround: function () {
          if (!self.ground) {
            var gh = H - ctx.groundY;
            var key = "pop_ground_" + pal.ground.slice(1) + "_" + gh;
            if (!self.textures.exists(key)) self.textures.addCanvas(key, groundCanvas(pal.ground, gh));
            self.ground = self.add.tileSprite(0, ctx.groundY, W, gh, key).setOrigin(0, 0).setDepth(3);
          }
          return ctx.groundY;
        },
      });
      ["player", "obstacle", "collectible", "decor", "projectile"].forEach(function (slot) {
        if (d.tex[slot]) {
          ctx.tex[slot] = d.tex[slot].key;
          ctx.size[slot] = { w: d.tex[slot].w, h: d.tex[slot].h };
        }
      });

      // ---- background + decor
      if (tpl.background !== false) {
        this.add.image(0, 0, d.tex.bg.key).setOrigin(0, 0).setDisplaySize(W, H).setDepth(0);
        if (ctx.tex.decor) {
          for (var i = 0; i < 5; i++) {
            var far = i < 3;
            var im = this.add.image(0, 0, ctx.tex.decor);
            var sc = far ? 0.6 : 1;
            im.setScale(sc).setAlpha(far ? 0.5 : 0.9).setDepth(far ? 1 : 1.5);
            im.factor = far ? 0.15 : 0.38;
            im.far = far;
            if (vertical) {
              im.x = Math.random() * W;
              im.y = (i / 5) * H + Math.random() * 80;
            } else {
              im.x = (i % 3) * (W / 3) + Math.random() * (W / 3);
              this.placeDecor(im, false);
            }
            this.decor.push(im);
          }
        }
      }
      this.vertical = vertical;

      // ---- HUD
      this.scoreText = this.add
        .text(W / 2, 64, "0", {
          fontFamily: FONT,
          fontSize: "64px",
          fontStyle: "bold",
          color: pal.text,
          stroke: this.strokeColor,
          strokeThickness: 8,
          resolution: 2,
        })
        .setOrigin(0.5)
        .setDepth(40);
      this.labelText = this.add
        .text(W / 2, 108, cfg.scoreLabel || "", {
          fontFamily: FONT,
          fontSize: "20px",
          fontStyle: "bold",
          color: pal.text,
          stroke: this.strokeColor,
          strokeThickness: 4,
          resolution: 2,
        })
        .setOrigin(0.5)
        .setDepth(40);

      // ---- template world
      tpl.create(ctx);

      // ---- overlays
      this.titleBox = this.makePanel([
        { text: cfg.title, size: 46, bold: true, color: pal.text, wrap: 400 },
        { text: cfg.tagline, size: 20, color: pal.text, wrap: 380, gap: 14 },
        { text: embedded ? "Press Play to start" : "Tap to play", size: 18, bold: true, color: pal.accent, gap: 26 },
      ]);
      this.armHint = this.add
        .text(W / 2, H * 0.6, tpl.titleHint || "TAP TO START", {
          fontFamily: FONT,
          fontSize: "34px",
          fontStyle: "bold",
          color: pal.text,
          stroke: this.strokeColor,
          strokeThickness: 6,
          align: "center",
          resolution: 2,
        })
        .setOrigin(0.5)
        .setDepth(50);
      this.armSub = this.add
        .text(W / 2, H * 0.6 + 38, "click, tap or press space", {
          fontFamily: FONT,
          fontSize: "16px",
          color: pal.text,
          stroke: this.strokeColor,
          strokeThickness: 3,
          resolution: 2,
        })
        .setOrigin(0.5)
        .setDepth(50);
      this.tweens.add({ targets: this.armHint, scale: 1.08, duration: 520, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      this.overBox = this.makePanel([
        { text: "GAME OVER", size: 44, bold: true, color: pal.accent },
        { text: "0", size: 30, bold: true, color: pal.text, gap: 12, ref: "overScore" },
        { text: embedded ? "" : "Tap to retry", size: 18, color: pal.text, gap: 18 },
      ]);
      this.overBox.setVisible(false);

      // ---- input
      var kb = this.input.keyboard;
      if (kb) {
        kb.addCapture("SPACE,UP,DOWN,LEFT,RIGHT,W,A,S,D");
        this.keys = kb.addKeys({
          left: "LEFT",
          right: "RIGHT",
          up: "UP",
          a: "A",
          d: "D",
          w: "W",
          space: "SPACE",
        });
      }
      var onPointer = function (p) {
        unlockAudio();
        self.handleInput({ x: p.worldX, y: p.worldY, keyboard: false });
      };
      var onKey = function (e) {
        if (e && e.repeat) return;
        unlockAudio();
        self.handleInput({ x: ctx.input.pointerX, y: ctx.input.pointerY, keyboard: true });
      };
      // Left/right only start the run (move-based templates); they are not "action" input.
      var onMoveKey = function (e) {
        if (e && e.repeat) return;
        if (self.phase !== "armed") return;
        unlockAudio();
        self.handleInput({ x: ctx.input.pointerX, y: ctx.input.pointerY, keyboard: true, move: true });
      };
      var MOVE_KEYS = ["keydown-LEFT", "keydown-RIGHT", "keydown-A", "keydown-D"];
      this.input.on("pointerdown", onPointer);
      if (kb) {
        kb.on("keydown-SPACE", onKey);
        kb.on("keydown-UP", onKey);
        kb.on("keydown-W", onKey);
        MOVE_KEYS.forEach(function (k) {
          kb.on(k, onMoveKey);
        });
      }
      this.events.once("shutdown", function () {
        self.input.off("pointerdown", onPointer);
        if (kb) {
          kb.off("keydown-SPACE", onKey);
          kb.off("keydown-UP", onKey);
          kb.off("keydown-W", onKey);
          MOVE_KEYS.forEach(function (k) {
            kb.off(k, onMoveKey);
          });
        }
      });

      this.applyPhase();
    }

    applyPhase() {
      var ph = this.phase;
      this.ctx.phase = ph;
      this.titleBox.setVisible(ph === "title");
      this.armHint.setVisible(ph === "armed");
      this.armSub.setVisible(ph === "armed");
      var hud = ph !== "title";
      this.scoreText.setVisible(hud);
      this.labelText.setVisible(hud && !!this.cfg.scoreLabel);
    }

    makePanel(lines) {
      var self = this;
      var objs = [];
      var y = 0;
      lines.forEach(function (l) {
        if (!l.text) return;
        y += l.gap || 0;
        var tx = self.add
          .text(W / 2, y, l.text, {
            fontFamily: FONT,
            fontSize: l.size + "px",
            fontStyle: l.bold ? "bold" : "normal",
            color: l.color,
            align: "center",
            stroke: self.strokeColor,
            strokeThickness: l.bold ? 5 : 2,
            wordWrap: l.wrap ? { width: l.wrap, useAdvancedWrap: true } : undefined,
            resolution: 2,
          })
          .setOrigin(0.5, 0);
        if (l.ref) self[l.ref] = tx;
        objs.push(tx);
        y += tx.height;
      });
      var padY = 34;
      var boxH = y + padY * 2;
      var top = Math.round(H * 0.36 - boxH / 2);
      var gfx = this.add.graphics();
      gfx.fillStyle(this.panelColor, this.panelAlpha);
      gfx.fillRoundedRect(28, top, W - 56, boxH, 26);
      objs.forEach(function (o) {
        o.y += top + padY;
      });
      return this.add.container(0, 0, [gfx].concat(objs)).setDepth(60);
    }

    placeDecor(im, offscreen) {
      var gy = this.ctx.groundY;
      var maxY = gy - (im.far ? 260 : 150);
      im.y = im.far ? 40 + Math.random() * Math.max(20, maxY - 40) : 90 + Math.random() * Math.max(20, maxY - 90);
      if (offscreen) im.x = W + im.displayWidth / 2 + Math.random() * 160;
    }

    floatText(x, y, label) {
      var tx = this.add
        .text(x, y - 10, label, {
          fontFamily: FONT,
          fontSize: "24px",
          fontStyle: "bold",
          color: this.cfg.palette.accent,
          stroke: this.strokeColor,
          strokeThickness: 4,
          resolution: 2,
        })
        .setOrigin(0.5)
        .setDepth(45);
      this.tweens.add({
        targets: tx,
        y: y - 60,
        alpha: 0,
        duration: 700,
        ease: "Quad.easeOut",
        onComplete: function () {
          tx.destroy();
        },
      });
    }

    burstEmitter(slot) {
      if (this.emitters[slot] !== undefined) return this.emitters[slot];
      var p = presetFor(this.cfg, slot);
      if (p.style === "none") return (this.emitters[slot] = null);
      var c = emitterConfig(p.style, p.colors || defaultColors(p.style, this.cfg.palette));
      var vt = this.d.tex["vfx_" + slot];
      var em = this.add.particles(0, 0, vt ? vt.key : styleTexture(p.style), c);
      em.setDepth(44);
      em.__qty = c.quantity;
      return (this.emitters[slot] = em);
    }

    // ---- phases --------------------------------------------------------------
    handleInput(inp) {
      if (this.broken) return;
      var ctx = this.ctx;
      switch (this.phase) {
        case "title":
          if (!embedded) rt.arm();
          break;
        case "armed":
          this.phase = "live";
          this.applyPhase();
          ctx.elapsedMs = 0;
          startMusic();
          if (this.tpl.onInput && !inp.move) this.tpl.onInput(ctx, inp);
          break;
        case "live":
          if (this.tpl.onInput) this.tpl.onInput(ctx, inp);
          break;
        case "over":
          if (!embedded && this.t - this.overAt > 0.6) rt.arm();
          break;
      }
    }

    endRun(x, y) {
      if (this.ended || this.phase !== "live") return;
      this.ended = true;
      this.phase = "over";
      this.ctx.phase = "over";
      this.overAt = this.t;
      stopMusic();
      playSfx("hit");
      this.ctx.vfx("hit", x === undefined ? W / 2 : x, y === undefined ? H / 2 : y);
      this.cameras.main.shake(240, 0.014);
      var cfg = this.cfg;
      this.overScore.setText(this.ctx.score + (cfg.scoreLabel ? " " + cfg.scoreLabel : ""));
      this.overBox.setVisible(true).setAlpha(0);
      this.tweens.add({ targets: this.overBox, alpha: 1, duration: 300, delay: 350 });
      post({ type: "gameOver", score: this.ctx.score, durationMs: Math.round(this.ctx.elapsedMs) });
    }

    update(time, deltaMs) {
      if (this.broken || !this.ctx) return;
      var dtMs = Math.min(deltaMs, 50);
      var dt = dtMs / 1000;
      this.t += dt;
      var ctx = this.ctx;

      // live input state
      var p = this.input.activePointer;
      var inp = ctx.input;
      inp.pointerX = p.worldX;
      inp.pointerY = p.worldY;
      inp.pointerDown = p.isDown;
      var k = this.keys;
      if (k) {
        inp.left = k.left.isDown || k.a.isDown;
        inp.right = k.right.isDown || k.d.isDown;
        inp.up = k.up.isDown || k.w.isDown;
        inp.action = k.space.isDown;
      }

      var live = this.phase === "live";
      if (live) ctx.elapsedMs += dtMs;
      var moving = live ? ctx.speed() : this.phase === "over" ? 0 : this.cfg.physics.scrollSpeed * 0.35;

      if (this.ground && !this.vertical) this.ground.tilePositionX += moving * dt;
      var self = this;
      this.decor.forEach(function (im) {
        if (self.vertical) {
          im.y += moving * im.factor * dt;
          if (im.y > H + im.displayHeight / 2) {
            im.y = -im.displayHeight / 2 - Math.random() * 120;
            im.x = Math.random() * W;
          }
        } else {
          im.x -= moving * im.factor * dt;
          if (im.x < -im.displayWidth / 2) self.placeDecor(im, true);
        }
      });

      try {
        if (live) this.tpl.update(ctx, dtMs);
        else if (this.phase !== "over" && this.tpl.idle) this.tpl.idle(ctx, dtMs);
      } catch (e) {
        console.error(e);
        this.broken = true;
        post({ type: "error", message: "Game crashed: " + (e && e.message ? e.message : String(e)) });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Runtime: one Phaser.Game; the scene is restarted for every load and run
  // ---------------------------------------------------------------------------
  var rt = {
    game: null,
    booted: false,
    bootQueue: [],
    scene: null,
    ready: false,
    key: null,
    gen: 0,
    keys: [],
    data: null,
    pendingStart: false,
    arm: function () {
      if (!rt.ready || !rt.data) {
        rt.pendingStart = true;
        return;
      }
      stopMusic();
      rt.data.mode = "armed";
      rt.game.scene.start("main", rt.data);
      post({ type: "score", score: 0 });
    },
    toTitle: function () {
      if (!rt.ready || !rt.data) return;
      stopMusic();
      rt.data.mode = "title";
      rt.game.scene.start("main", rt.data);
    },
  };

  function ensureGame(cb) {
    if (rt.game) {
      if (rt.booted) cb();
      else rt.bootQueue.push(cb);
      return;
    }
    rt.bootQueue.push(cb);
    rt.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: "game",
      width: W,
      height: H,
      backgroundColor: "#000000",
      banner: false,
      audio: { noAudio: true },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      render: { antialias: true },
      physics: { default: "arcade", arcade: { gravity: { x: 0, y: 0 } } },
      callbacks: {
        postBoot: function (game) {
          game.scene.add("main", MainScene, false);
          rt.booted = true;
          var q = rt.bootQueue;
          rt.bootQueue = [];
          q.forEach(function (f) {
            f();
          });
        },
      },
    });
  }

  function handleLoad(cfg, assets) {
    assets = assets && typeof assets === "object" ? assets : {};
    var errs = validate(cfg);
    if (errs.length) {
      post({ type: "error", message: "Invalid game config: " + errs.slice(0, 6).join("; ") });
      return;
    }
    if (!templates[cfg.template]) {
      post({ type: "error", message: 'Template "' + cfg.template + '" is not available' });
      return;
    }
    var key = JSON.stringify(cfg) + "|" + Object.keys(assets).sort().join(",");
    if (key === rt.key && rt.ready) {
      post({ type: "loaded" });
      return;
    }
    rt.key = key;
    rt.ready = false;
    var gen = ++rt.gen;
    document.body.style.background = cfg.palette.skyBottom;
    Promise.all([buildTextures(cfg, assets, gen), loadSounds(cfg, assets)])
      .then(function (res) {
        if (gen !== rt.gen) return;
        var tex = res[0];
        Sound.slots = res[1];
        ensureGame(function () {
          if (gen !== rt.gen) return;
          var old = rt.keys;
          rt.keys = Object.keys(tex).map(function (n) {
            return tex[n].key;
          });
          stopMusic();
          rt.data = {
            config: cfg,
            tex: tex,
            oldKeys: old,
            mode: "title",
            onReady: function (scene) {
              if (gen !== rt.gen) return;
              rt.scene = scene;
              rt.ready = true;
              post({ type: "loaded" });
              if (rt.pendingStart) {
                rt.pendingStart = false;
                rt.arm();
              }
            },
          };
          rt.game.scene.start("main", rt.data);
        });
      })
      .catch(function (e) {
        post({ type: "error", message: "Failed to build game: " + (e && e.message ? e.message : String(e)) });
      });
  }

  window.addEventListener("message", function (e) {
    if (embedded && e.source !== window.parent) return;
    var d = e.data;
    if (!d || d.source !== "pop") return;
    if (d.type === "load") handleLoad(d.config, d.assets);
    else if (d.type === "start") rt.arm();
    else if (d.type === "reset") {
      rt.pendingStart = false;
      rt.toTitle();
    } else if (d.type === "mute") setMuted(d.muted);
  });

  // Report uncaught errors only after boot, so a broken template file that
  // fails to parse does not take down the others.
  var booted = false;
  var reportedError = false;
  window.addEventListener("error", function (ev) {
    if (!booted || reportedError) return;
    reportedError = true;
    post({ type: "error", message: "Runtime error: " + (ev && ev.message ? ev.message : "unknown") });
  });

  function boot() {
    if (booted) return;
    booted = true;
    if (!embedded) {
      window.__pop = rt;
      // Standalone debugging: /games/engine.html#<url-encoded config JSON>
      if (location.hash.length > 1) {
        try {
          handleLoad(JSON.parse(decodeURIComponent(location.hash.slice(1))), window.__popAssets || {});
        } catch (e) {
          console.error("[pop] bad config in hash", e);
        }
      }
    }
    console.log("[pop] templates:", Object.keys(templates).join(", "));
    post({ type: "ready" });
  }

  POP._debug = { rt: rt, validate: validate, Sound: Sound, handleLoad: handleLoad };

  if (typeof Phaser === "undefined") {
    post({ type: "error", message: "Phaser failed to load" });
  } else if (document.readyState === "loading") {
    // Template scripts after core.js are parser-blocking, so they have all run
    // (or failed) by DOMContentLoaded.
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    setTimeout(boot, 0);
  }
})();
