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
 *   parent -> game: load {config, assets?, best?, ticker?} | start | reset | mute {muted}
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
  var MEME_BACKDROPS = ["none", "chart", "matrix", "grid"];
  var MEME_FONTS = ["impact", "pixel", "clean"];
  // Mirrors DEFAULT_MEME in src/lib/game-config.ts.
  var DEFAULT_MEME = {
    good: ["LFG", "WAGMI", "GM", "BULLISH", "SER...", "FEW", "DIAMOND HANDS", "APE IN", "SEND IT", "BASED"],
    bad: ["REKT", "NGMI", "IT'S SO OVER", "RUGGED", "LIQUIDATED", "PAPER HANDS", "GN"],
    milestone: ["NUMBER GO UP", "WE'RE SO BACK", "TO THE MOON", "MONAD SPEED", "PARABOLIC", "ATH"],
  };
  // Used when config.meme.enabled === false.
  var PLAIN_MEME = {
    good: ["NICE!", "GREAT!", "AWESOME!", "SUPERB!"],
    bad: ["GAME OVER"],
    milestone: ["MILESTONE!", "KEEP GOING!", "ON FIRE!"],
  };
  var FONT_IMPACT = '"PopImpact", Impact, "Arial Black", "Helvetica Neue", sans-serif';
  var FONT_PIXEL = '"PopPixel", "Courier New", monospace';
  var MONAD = 0x836ef9;
  var PUMP = 0x22e07a;
  var DUMP = 0xff4d6d;
  var PUMP_CSS = "#22e07a";
  // Low-end hint: phones with few cores skip bloom. ?lowfx in the URL forces it.
  var LOW_FX = /[?&#]lowfx\b/.test(location.search) || ((navigator.hardwareConcurrency || 8) <= 4 && "ontouchstart" in window);

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
    if ((s = section("meme", true))) {
      need(typeof s.enabled === "boolean", "meme.enabled: expected boolean");
      ["good", "bad", "milestone"].forEach(function (k) {
        var v = s[k];
        if (v === undefined) return;
        need(
          Array.isArray(v) &&
            v.length <= 16 &&
            v.every(function (x) {
              return typeof x === "string" && x.length >= 1 && x.length <= 24;
            }),
          "meme." + k + ": up to 16 strings of 1-24 chars"
        );
      });
      if (s.backdrop !== undefined) need(MEME_BACKDROPS.indexOf(s.backdrop) !== -1, "meme.backdrop: must be one of " + MEME_BACKDROPS.join(", "));
      if (s.font !== undefined) need(MEME_FONTS.indexOf(s.font) !== -1, "meme.font: must be one of " + MEME_FONTS.join(", "));
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
    return { pop_dot: dot, pop_px: px, pop_ring: ring, pop_vignette: vignetteCanvas() };
  }

  function vignetteCanvas() {
    var cv = document.createElement("canvas");
    cv.width = W / 2;
    cv.height = H / 2;
    var c = cv.getContext("2d");
    var g = c.createRadialGradient(W / 4, H / 4, H * 0.16, W / 4, H / 4, H * 0.34);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.65, "rgba(0,0,0,0.18)");
    g.addColorStop(1, "rgba(0,0,0,0.55)");
    c.fillStyle = g;
    c.fillRect(0, 0, cv.width, cv.height);
    return cv;
  }

  // ---------------------------------------------------------------------------
  // Meme layer: phrases, fonts
  // ---------------------------------------------------------------------------
  function cleanTicker(t) {
    if (typeof t !== "string") return "";
    return t.replace(/^\$/, "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  }

  function resolveMeme(cfg, ticker) {
    var m = cfg.meme;
    var enabled = !m || m.enabled !== false;
    var base = enabled ? DEFAULT_MEME : PLAIN_MEME;
    var tk = cleanTicker(ticker);
    function list(k) {
      var v = m && Array.isArray(m[k]) && m[k].length ? m[k] : base[k];
      return v.map(function (s) {
        return String(s).replace(/\$\{ticker\}/g, tk || "MON");
      });
    }
    var out = {
      enabled: enabled,
      good: list("good"),
      bad: list("bad"),
      milestone: list("milestone"),
      backdrop: (m && m.backdrop) || (enabled ? "chart" : "none"),
      font: (m && m.font) || (enabled ? "impact" : "clean"),
      ticker: tk,
    };
    if (enabled && tk && !(m && m.milestone && m.milestone.length)) {
      out.milestone = out.milestone.concat(["$" + tk + " TO THE MOON", "$" + tk + " ATH", "BUY $" + tk]);
    }
    out.family = out.font === "pixel" ? FONT_PIXEL : out.font === "clean" ? FONT : FONT_IMPACT;
    out.weight = out.font === "clean" ? "bold" : "normal";
    out.scale = out.font === "pixel" ? 0.55 : 1; // Press Start 2P is very wide
    return out;
  }

  var fontsPromise = null;
  /** Load the bundled meme fonts once. Never rejects; gives up after 2.5 s. */
  function loadFonts() {
    if (fontsPromise) return fontsPromise;
    fontsPromise = new Promise(function (resolve) {
      if (!document.fonts || !document.fonts.load) return resolve();
      var done = false;
      function fin() {
        if (!done) {
          done = true;
          resolve();
        }
      }
      setTimeout(fin, 2500);
      Promise.all([document.fonts.load('40px "PopImpact"'), document.fonts.load('20px "PopPixel"')]).then(fin, fin);
    });
    return fontsPromise;
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
    score: function (a, p) {
      tone(a, "sine", 880 * p, 0, 0.12, 0.22);
      tone(a, "sine", 1320 * p, 0, 0.2, 0.2, 0.07);
    },
    // Core-only juice sounds (not config slots).
    blip: function (a, p) {
      tone(a, "triangle", 900 * p, 1900 * p, 0.09, 0.16);
    },
    milestone: function (a) {
      tone(a, "square", 523, 0, 0.1, 0.09);
      tone(a, "square", 659, 0, 0.1, 0.09, 0.08);
      tone(a, "square", 784, 0, 0.1, 0.09, 0.16);
      tone(a, "square", 1046, 0, 0.22, 0.1, 0.24);
    },
    stamp: function (a) {
      noise(a, 0.18, 0.35, 700);
      tone(a, "sine", 110, 40, 0.25, 0.4);
    },
    best: function (a) {
      tone(a, "triangle", 784, 0, 0.12, 0.18);
      tone(a, "triangle", 988, 0, 0.12, 0.18, 0.1);
      tone(a, "triangle", 1318, 0, 0.3, 0.2, 0.2);
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

  /** pitch: playback-rate multiplier (1 = normal), used for combo pitch-up. */
  function playSfx(slot, pitch) {
    if (Sound.muted) return;
    var a = audioCtx();
    if (!a || a.state !== "running") return;
    var now = a.currentTime;
    if (Sound.last[slot] && now - Sound.last[slot] < 0.045) return; // de-spam
    Sound.last[slot] = now;
    var v = Sound.slots[slot];
    if (v === "none") return;
    var p = pitch > 0 ? clamp(pitch, 0.5, 2.5) : 1;
    try {
      if (v && typeof v === "object") {
        var src = a.createBufferSource();
        src.buffer = v;
        if (p !== 1) src.playbackRate.value = p;
        src.connect(Sound.master);
        src.start();
      } else if (SYNTH[slot]) {
        SYNTH[slot](a, p);
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
  // Meme backdrops: drawn at depth 0.5 (above the sky gradient, below decor).
  // Each returns { update(dt, s), pump(n, combo), dump() } where
  // s = { phase, speed (px/s), combo }.
  // ---------------------------------------------------------------------------
  function gauss() {
    return (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
  }

  function chartBackdrop(scene, pal, meme) {
    var lightSky = luminance(pal.sky) > 0.62;
    var A = lightSky ? 0.34 : 0.3; // candle alpha: visible but never louder than gameplay
    var gridCol = lightSky ? 0x000000 : 0xffffff;
    var maCol = hexToInt(pal.accent);
    var g = scene.add.graphics().setDepth(0.5);
    var SP = 18; // candle spacing
    var CW = 10; // body width
    var RIGHT = W - 64; // x of the live candle
    var N = Math.ceil(RIGHT / SP) + 2;
    var candles = [];
    var p = 0;
    for (var i = 0; i < N; i++) {
      var o = p;
      p += 0.35 + gauss() * 1.1;
      candles.push({ o: o, c: p, h: Math.max(o, p) + Math.random() * 0.6, l: Math.min(o, p) - Math.random() * 0.6 });
    }
    var p0 = candles[0].o - 15; // start a bit "up" so the tag reads green
    var off = 0;
    var pumpV = 0;
    var dumpT = 0;
    var vMin = null;
    var vMax = null;
    var tagT = 0;
    var label = scene.add
      .text(W - 6, 0, "", {
        fontFamily: meme.family,
        fontStyle: meme.weight,
        fontSize: Math.round(12 * meme.scale) + "px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 3,
        align: "right",
        resolution: 2,
      })
      .setOrigin(1, 0.5)
      .setDepth(0.6)
      .setAlpha(0.75);
    var name = "$" + (meme.ticker || "MON");

    return {
      pump: function (n, combo) {
        pumpV += 2.2 + Math.min(n, 10) * 0.6 + Math.min(combo || 0, 15) * 0.45;
      },
      dump: function () {
        dumpT = 1.3;
        pumpV = 0;
      },
      update: function (dt, s) {
        var drift;
        if (dumpT > 0) {
          dumpT -= dt;
          drift = -26;
        } else if (s.phase === "over") drift = -0.6;
        else if (s.phase === "live") drift = 1.6 + Math.min(s.combo, 12) * 0.35;
        else drift = 0.7;
        pumpV *= Math.exp(-2.6 * dt);
        p += (drift + pumpV) * dt + gauss() * 2.6 * Math.sqrt(dt);
        var cur = candles[N - 1];
        cur.c = p;
        if (p > cur.h) cur.h = p;
        if (p < cur.l) cur.l = p;
        var pxs = s.phase === "live" ? 34 + s.speed * 0.1 : s.phase === "over" ? 22 : 26;
        if (dumpT > 0) pxs *= 2.2;
        off += pxs * dt;
        while (off >= SP) {
          off -= SP;
          candles.shift();
          candles.push({ o: p, c: p, h: p, l: p });
        }
        // auto-scale the view, smoothed
        var lo = Infinity;
        var hi = -Infinity;
        for (var i = 0; i < N; i++) {
          if (candles[i].l < lo) lo = candles[i].l;
          if (candles[i].h > hi) hi = candles[i].h;
        }
        if (hi - lo < 8) {
          var mid = (hi + lo) / 2;
          lo = mid - 4;
          hi = mid + 4;
        }
        if (vMin === null) {
          vMin = lo;
          vMax = hi;
        }
        var k = 1 - Math.exp(-(dumpT > 0 ? 9 : 3.5) * dt);
        vMin += (lo - vMin) * k;
        vMax += (hi - vMax) * k;
        var top = H * 0.17;
        var bot = H * 0.8;
        var span = vMax - vMin || 1;
        function Y(v) {
          return bot - ((v - vMin) / span) * (bot - top);
        }

        g.clear();
        // grid
        g.lineStyle(1, gridCol, 0.06);
        for (var r = 0; r < 5; r++) {
          var gy = top + ((bot - top) * r) / 4;
          g.lineBetween(0, gy, W, gy);
        }
        // candles
        var ma = [];
        for (var j = 0; j < N; j++) {
          var cd = candles[j];
          var x = RIGHT - (N - 1 - j) * SP - off;
          if (x < -SP) continue;
          var up = cd.c >= cd.o;
          var col = up ? PUMP : DUMP;
          var yo = Y(cd.o);
          var yc = Y(cd.c);
          g.lineStyle(2, col, A * 0.8);
          g.lineBetween(x, Y(cd.h), x, Y(cd.l));
          g.fillStyle(col, j === N - 1 ? A + 0.15 : A);
          var bt = Math.min(yo, yc);
          g.fillRect(x - CW / 2, bt, CW, Math.max(2, Math.abs(yo - yc)));
          // moving average of closes
          var sum = 0;
          var cnt = 0;
          for (var q = Math.max(0, j - 4); q <= j; q++) {
            sum += candles[q].c;
            cnt++;
          }
          ma.push(x, Y(sum / cnt));
        }
        if (ma.length >= 4) {
          g.lineStyle(2, maCol, A + 0.1);
          g.beginPath();
          g.moveTo(ma[0], ma[1]);
          for (var m = 2; m < ma.length; m += 2) g.lineTo(ma[m], ma[m + 1]);
          g.strokePath();
        }
        // last-price line + tag
        var py = Y(p);
        var upNow = p >= candles[N - 1].o;
        var pc = upNow ? PUMP : DUMP;
        g.lineStyle(1, pc, A * 0.9);
        for (var dx = 0; dx < W - 60; dx += 12) g.lineBetween(dx, py, dx + 6, py);
        g.fillStyle(pc, 0.55);
        g.fillRoundedRect(W - 62, py - 16, 60, 32, 5);
        label.y = py;
        tagT -= dt;
        if (tagT <= 0) {
          tagT = 0.2;
          var pct = (Math.exp((p - p0) * 0.012) - 1) * 100;
          label.setText(name + "\n" + (pct >= 0 ? "+" : "") + pct.toFixed(pct > 999 || pct < -99 ? 0 : 1) + "%");
        }
      },
    };
  }

  function matrixBackdrop(scene, pal, meme) {
    var HEXC = "0123456789ABCDEF";
    var lightSky = luminance(pal.sky) > 0.62;
    var col = lightSky ? "#5b3fd6" : "#a48bff";
    var cols = [];
    var n = 16;
    function chars() {
      var s = [];
      var len = 8 + Math.floor(Math.random() * 8);
      for (var i = 0; i < len; i++) s.push(Math.random() < 0.12 ? "x" : HEXC[(Math.random() * 16) | 0]);
      return s.join("\n");
    }
    for (var i = 0; i < n; i++) {
      var t = scene.add
        .text((i + 0.5) * (W / n), Math.random() * H, chars(), {
          fontFamily: FONT_PIXEL,
          fontSize: "13px",
          color: col,
          align: "center",
          lineSpacing: 4,
        })
        .setOrigin(0.5, 1)
        .setDepth(0.5)
        .setAlpha(0.12 + Math.random() * 0.2);
      t.v = 40 + Math.random() * 90;
      cols.push(t);
    }
    var mult = 1;
    var red = false;
    return {
      pump: function () {
        mult = Math.min(mult + 0.5, 3.5);
      },
      dump: function () {
        red = true;
        cols.forEach(function (t) {
          t.setColor("#ff4d6d");
        });
        mult = 0.35;
      },
      update: function (dt, s) {
        mult += ((red ? 0.3 : 1) - mult) * (1 - Math.exp(-1.5 * dt));
        var sp = (s.phase === "live" ? 1 + s.speed / 500 : 0.7) * mult;
        for (var i = 0; i < n; i++) {
          var t = cols[i];
          t.y += t.v * sp * dt;
          if (t.y - t.height > H) {
            t.y = -10 - Math.random() * 120;
            t.v = 40 + Math.random() * 90;
            t.setText(chars());
          }
        }
      },
    };
  }

  function gridBackdrop(scene, pal) {
    var g = scene.add.graphics().setDepth(0.5);
    var lightSky = luminance(pal.sky) > 0.62;
    var lineCol = lightSky ? 0x6a4fe0 : MONAD;
    var sunCol = hexToInt(pal.accent);
    var HZ = H * 0.4;
    var z = 0;
    var flash = 0;
    var red = false;
    return {
      pump: function () {
        flash = Math.min(flash + 0.35, 1);
      },
      dump: function () {
        red = true;
        flash = 1;
      },
      update: function (dt, s) {
        var sp = s.phase === "live" ? 0.9 + s.speed / 260 : s.phase === "over" ? 0.15 : 0.6;
        z = (z + sp * dt) % 1;
        flash = Math.max(0, flash - dt * 1.8);
        var a = 0.22 + flash * 0.2;
        var lc = red ? DUMP : lineCol;
        g.clear();
        // sun with scanline gaps
        var R = 74;
        var cy = HZ - 18;
        g.fillStyle(red ? DUMP : sunCol, 0.22 + flash * 0.1);
        for (var y = -R; y < 0; y += 4) {
          var band = (y + R) / R; // 0 top -> 1 horizon
          if (band > 0.45 && ((y + R) >> 2) % 3 === 0) continue;
          var hw = Math.sqrt(R * R - y * y);
          g.fillRect(W / 2 - hw, cy + y, hw * 2, 3);
        }
        // horizon
        g.lineStyle(2, lc, a + 0.15);
        g.lineBetween(0, HZ, W, HZ);
        // receding horizontal lines
        g.lineStyle(1.5, lc, a);
        for (var k = 0; k < 14; k++) {
          var d = k + 1 - z;
          var yy = HZ + 260 / d;
          if (yy > H) continue;
          g.lineBetween(0, yy, W, yy);
        }
        // converging verticals
        for (var v = -9; v <= 9; v++) g.lineBetween(W / 2 + v * 10, HZ, W / 2 + v * 120, H);
      },
    };
  }

  function makeBackdrop(scene, kind, pal, meme) {
    if (kind === "chart") return chartBackdrop(scene, pal, meme);
    if (kind === "matrix") return matrixBackdrop(scene, pal, meme);
    if (kind === "grid") return gridBackdrop(scene, pal, meme);
    return null;
  }

  // ---------------------------------------------------------------------------
  // The scene. One scene, restarted for every run; the template does the game.
  // ---------------------------------------------------------------------------
  var POPUP_MAX = 14;
  var MILESTONES = [10, 25, 50, 100];
  function nextMilestone(v) {
    for (var i = 0; i < MILESTONES.length; i++) if (MILESTONES[i] > v) return MILESTONES[i];
    return (Math.floor(v / 100) + 1) * 100;
  }
  function colorRgb(c, dflt) {
    if (typeof c === "number" && isFinite(c)) return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    if (typeof c === "string" && HEX.test(c)) return rgb(c);
    return dflt;
  }

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
      if (!this.textures.exists("pop_dot")) {
        var pc = particleCanvases();
        Object.keys(pc).forEach(function (k) {
          if (!self.textures.exists(k)) self.textures.addCanvas(k, pc[k]);
        });
      }

      this.phase = d.mode === "armed" ? "armed" : "title";
      this.t = 0;
      this.decor = [];
      this.ground = null;
      this.ended = false;
      this.dying = false;
      this.emitters = {};
      this.trails = [];
      this.popups = [];
      this.meme = resolveMeme(cfg, rt.ticker);
      this.best = typeof rt.best === "number" && isFinite(rt.best) ? rt.best : null;
      this.combo = 0;
      this.lastScoreAt = -9;
      this.lastNear = -9;
      this.lastBigAt = -9;
      this.lastBigY = 0;
      this.msNext = MILESTONES[0];
      this.bestCalled = false;
      this.stopUntil = 0;
      this.slowScale = 1;
      this.slowUntil = 0;
      this.timeScale = 1;
      this.appliedTs = 1;
      this.shakeUntil = 0;
      this.shakeI = 0;
      this.realMs = 0;
      this.slowFrames = 0;
      this.lowPerf = !!rt.lowPerf;
      this.overAt = Infinity;
      this.tweens.timeScale = 1;
      var cam = this.cameras.main;
      cam.setZoom(1);

      var lightText = luminance(pal.text) > 0.5;
      this.lightSky = luminance(pal.sky) > 0.62;
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
        meme: this.meme,
        speed: function () {
          return Math.min(cfg.physics.scrollSpeed + (cfg.physics.speedRampPerSec * ctx.elapsedMs) / 1000, 1200);
        },
        addScore: function (n, x, y) {
          self.scoreAdd(n, x, y, {});
        },
        collect: function (x, y) {
          if (self.ended) return;
          var pts = cfg.scoring.pointsPerCollectible;
          playSfx("collect");
          ctx.vfx("collect", x, y);
          if (pts > 0) self.scoreAdd(pts, x, y, { sfx: false, vfx: false });
        },
        gameOver: function (x, y) {
          self.endRun(x, y);
        },
        sfx: function (slot, pitch) {
          playSfx(slot, pitch);
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
          self.trails.push(em);
          return em;
        },
        // ---- juice helpers (see TEMPLATE_API.md)
        popup: function (text, x, y, opts) {
          return self.popup(text, x, y, opts);
        },
        hitstop: function (ms) {
          self.hitstop(ms);
        },
        shake: function (intensity) {
          self.shake(intensity);
        },
        flash: function (color, ms) {
          self.flash(color, ms);
        },
        slowmo: function (scale, ms) {
          self.slowmo(scale, ms);
        },
        nearMiss: function (x, y) {
          return self.nearMiss(x, y);
        },
        combo: function () {
          return self.combo;
        },
        squash: function (go, sx, sy, ms) {
          self.squash(go, sx, sy, ms);
        },
        phrase: function (kind) {
          return self.phrase(kind);
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

      // ---- background, meme backdrop, decor
      this.backdrop = null;
      if (tpl.background !== false) {
        this.add.image(0, 0, d.tex.bg.key).setOrigin(0, 0).setDisplaySize(W, H).setDepth(0);
        try {
          this.backdrop = makeBackdrop(this, this.meme.backdrop, pal, this.meme);
        } catch (e) {
          console.warn("[pop] backdrop failed", e);
        }
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

      // speed lines (depth 1.8: above decor, below the world)
      this.speedG = this.add.graphics().setDepth(1.8);
      this.lines = [];
      for (var li = 0; li < 18; li++) {
        this.lines.push({ x: Math.random() * W, y: Math.random() * H, len: 40 + Math.random() * 90, v: 0.8 + Math.random() * 0.8 });
      }

      // vignette (all renderers); glow on the score HUD is added below (WebGL only, dropped if fps suffers)
      this.add
        .image(0, 0, "pop_vignette")
        .setOrigin(0, 0)
        .setDisplaySize(W, H)
        .setDepth(39)
        .setAlpha(this.lightSky ? 0.5 : 0.85);
      this.bloom = null;

      // ---- HUD
      var m = this.meme;
      this.scoreText = this.add
        .text(W / 2, 64, "0", {
          fontFamily: m.family,
          fontStyle: m.weight,
          fontSize: Math.round(66 * m.scale) + "px",
          color: pal.text,
          stroke: "#000000",
          strokeThickness: 9,
          resolution: 2,
        })
        .setOrigin(0.5)
        .setDepth(40)
        .setShadow(0, 4, "rgba(0,0,0,0.45)", 0, true, true);
      // Full-screen bloom washes the art out; a glow on the score only is cheap and reads as "neon".
      if (!LOW_FX && !rt.noBloom && this.renderer && this.renderer.type === Phaser.WEBGL && this.scoreText.preFX) {
        try {
          this.bloom = this.scoreText.preFX.addGlow(hexToInt(pal.accent), 3, 0, false, 0.1, 10);
          this.bloomOwner = this.scoreText;
        } catch (e) {
          this.bloom = null;
        }
      }
      this.labelText = this.add
        .text(W / 2, 108, (cfg.scoreLabel || "").toUpperCase(), {
          fontFamily: m.family,
          fontStyle: m.weight,
          fontSize: Math.round(20 * m.scale) + "px",
          color: pal.text,
          stroke: "#000000",
          strokeThickness: 4,
          resolution: 2,
        })
        .setOrigin(0.5)
        .setDepth(40);
      this.comboText = this.add
        .text(W / 2, 140, "", {
          fontFamily: m.family,
          fontStyle: m.weight,
          fontSize: Math.round(24 * m.scale) + "px",
          color: pal.accent,
          stroke: "#000000",
          strokeThickness: 5,
          resolution: 2,
        })
        .setOrigin(0.5)
        .setDepth(40)
        .setVisible(false);

      // ---- template world
      tpl.create(ctx);

      // ---- overlays
      this.buildTitle();
      this.armHint = this.memeText(tpl.titleHint || "TAP TO START", 40, "#ffffff", { stroke: 8 })
        .setPosition(W / 2, H * 0.6)
        .setDepth(50);
      this.armSub = this.add
        .text(W / 2, H * 0.6 + 40, "click, tap or press space", {
          fontFamily: FONT,
          fontSize: "16px",
          color: pal.text,
          stroke: this.strokeColor,
          strokeThickness: 3,
          resolution: 2,
        })
        .setOrigin(0.5)
        .setDepth(50);
      this.tweens.add({ targets: this.armHint, scale: 1.1, duration: 480, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

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
      if (this.phase === "armed" && m.enabled) {
        this.time.delayedCall(60, function () {
          if (self.phase === "armed") self.bigCallout("GM", "#ffe14d", 80);
        });
      }
    }

    /** Meme-style text: meme font, black stroke, drop shadow, origin 0.5. */
    memeText(str, size, color, o) {
      o = o || {};
      var m = this.meme;
      var fs = Math.round(size * m.scale);
      return this.add
        .text(0, 0, m.enabled || o.forceCaps ? String(str).toUpperCase() : String(str), {
          fontFamily: m.family,
          fontStyle: m.weight,
          fontSize: fs + "px",
          color: color,
          stroke: "#000000",
          strokeThickness: o.stroke || Math.max(4, Math.round(fs * 0.14)),
          align: "center",
          wordWrap: o.wrap ? { width: o.wrap, useAdvancedWrap: true } : undefined,
          resolution: 2,
        })
        .setOrigin(0.5)
        .setShadow(0, Math.max(3, Math.round(fs * 0.07)), "rgba(0,0,0,0.5)", 0, true, true);
    }

    buildTitle() {
      var cfg = this.cfg;
      var pal = cfg.palette;
      var m = this.meme;
      var objs = [];
      var chip = null;
      var chipBg = null;
      if (m.enabled) {
        chip = this.add
          .text(W / 2, 0, (m.ticker ? "$" + m.ticker + "  ·  " : "") + "LIVE ON MONAD", {
            fontFamily: m.family,
            fontStyle: m.weight,
            fontSize: Math.round(16 * m.scale) + "px",
            color: "#ffffff",
            resolution: 2,
          })
          .setOrigin(0.5);
      }
      var title = this.memeText(cfg.title, 62, m.enabled ? "#ffffff" : pal.text, { wrap: 420 });
      if (title.height > 230) title.setFontSize(Math.round(44 * m.scale));
      var tag = cfg.tagline
        ? this.add
            .text(W / 2, 0, cfg.tagline, {
              fontFamily: FONT,
              fontSize: "19px",
              fontStyle: "bold",
              color: pal.text,
              align: "center",
              stroke: this.strokeColor,
              strokeThickness: 3,
              wordWrap: { width: 380, useAdvancedWrap: true },
              resolution: 2,
            })
            .setOrigin(0.5, 0)
        : null;
      var hintStr = m.enabled ? (embedded ? "PRESS PLAY TO APE IN" : "TAP TO APE IN") : embedded ? "Press Play to start" : "Tap to play";
      var hint = this.memeText(hintStr, 30, pal.accent, { stroke: 6 });

      // vertical layout around H * 0.34
      var hTotal = (chip ? chip.height + 22 : 0) + title.height + (tag ? 16 + tag.height : 0) + 34 + hint.height;
      var y = Math.round(H * 0.34 - hTotal / 2);
      if (chip) {
        chip.y = y + chip.height / 2;
        var cw = chip.width + 26;
        chipBg = this.add.graphics();
        chipBg.fillStyle(MONAD, 0.9);
        chipBg.fillRoundedRect(W / 2 - cw / 2, y - 5, cw, chip.height + 10, (chip.height + 10) / 2);
        y += chip.height + 22;
      }
      title.setPosition(W / 2, y + title.height / 2);
      y += title.height;
      if (tag) {
        tag.y = y + 16;
        y += 16 + tag.height;
      }
      hint.setPosition(W / 2, y + 34 + hint.height / 2);
      var top = Math.round(H * 0.34 - hTotal / 2) - 30;
      var boxH = hTotal + 60;
      var gfx = this.add.graphics();
      gfx.fillStyle(0x000000, this.lightSky ? 0.22 : 0.32);
      gfx.fillRoundedRect(22, top, W - 44, boxH, 26);
      objs.push(gfx);
      if (chipBg) objs.push(chipBg, chip);
      objs.push(title);
      if (tag) objs.push(tag);
      objs.push(hint);
      title.setAngle(-3);
      this.tweens.add({ targets: title, angle: 2, scale: 1.04, duration: 1300, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      this.tweens.add({ targets: hint, scale: 1.12, alpha: 0.75, duration: 520, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      this.titleBox = this.add.container(0, 0, objs).setDepth(60);
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

    placeDecor(im, offscreen) {
      var gy = this.ctx.groundY;
      var maxY = gy - (im.far ? 260 : 150);
      im.y = im.far ? 40 + Math.random() * Math.max(20, maxY - 40) : 90 + Math.random() * Math.max(20, maxY - 90);
      if (offscreen) im.x = W + im.displayWidth / 2 + Math.random() * 160;
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

    // ---- juice ---------------------------------------------------------------
    phrase(kind) {
      var list = (this.meme && this.meme[kind]) || DEFAULT_MEME.good;
      if (!list.length) return "";
      var i = Math.floor(Math.random() * list.length);
      if (list.length > 1 && i === this["last_" + kind]) i = (i + 1) % list.length;
      this["last_" + kind] = i;
      return list[i];
    }

    popup(text, x, y, opts) {
      if (!this.popups) return null;
      opts = opts || {};
      var kind = opts.kind === "meme" || opts.kind === "big" ? opts.kind : "score";
      var m = this.meme;
      var str = String(text == null ? "" : text).slice(0, 40);
      if (kind !== "score" && m.enabled) str = str.toUpperCase();
      if (!str) return null;
      var size = clamp(+opts.size || (kind === "big" ? 56 : kind === "meme" ? 32 : 26), 10, 120);
      var color = typeof opts.color === "string" ? opts.color : kind === "score" ? this.cfg.palette.accent : "#ffffff";
      var t = null;
      var i;
      for (i = 0; i < this.popups.length; i++) {
        if (!this.popups[i].busy) {
          t = this.popups[i];
          break;
        }
      }
      if (!t) {
        if (this.popups.length < POPUP_MAX) {
          t = this.add.text(0, 0, "", { resolution: 2, align: "center" }).setOrigin(0.5).setDepth(46);
          t.setShadow(0, 3, "rgba(0,0,0,0.5)", 0, true, true);
          this.popups.push(t);
        } else {
          t = this.popups[0];
          for (i = 1; i < this.popups.length; i++) if (this.popups[i].bornAt < t.bornAt) t = this.popups[i];
          this.tweens.killTweensOf(t);
        }
      }
      t.busy = true;
      t.bornAt = this.t;
      var fs = Math.round(size * m.scale);
      t.setStyle({
        fontFamily: m.family,
        fontStyle: m.weight,
        fontSize: fs + "px",
        color: color,
        stroke: "#000000",
        strokeThickness: Math.max(3, Math.round(fs * 0.15)),
        wordWrap: { width: 440, useAdvancedWrap: true },
      });
      t.setText(str);
      var half = Math.min(t.width / 2, W / 2 - 6);
      var px = clamp(typeof x === "number" ? x : W / 2, half + 6, W - half - 6);
      var py = clamp(typeof y === "number" ? y : H * 0.35, 40 + t.height / 2, H - 30 - t.height / 2);
      var rot = typeof opts.rotate === "number" ? opts.rotate : kind === "score" ? 0 : (Math.random() * 2 - 1) * (kind === "big" ? 6 : 10);
      t.setPosition(px, py).setAngle(rot).setAlpha(1).setVisible(true).setScale(kind === "big" ? 0.25 : 0.45);
      var spec = kind === "big" ? [280, 30, 700, 380] : kind === "meme" ? [200, 56, 420, 420] : [150, 44, 230, 380];
      this.tweens.add({ targets: t, scale: 1, duration: spec[0], ease: "Back.easeOut", easeParams: [2.4] });
      this.tweens.add({
        targets: t,
        y: py - spec[1],
        alpha: 0,
        delay: spec[2],
        duration: spec[3],
        ease: "Cubic.easeIn",
        onComplete: function () {
          t.busy = false;
          t.setVisible(false);
        },
      });
      return t;
    }

    bigCallout(text, color, size) {
      var y = H * 0.3;
      if (this.t - this.lastBigAt < 0.9) y = this.lastBigY === y ? y + 86 : y;
      this.lastBigAt = this.t;
      this.lastBigY = y;
      return this.popup(text, W / 2, y, { kind: "big", color: color || "#ffffff", size: size });
    }

    hitstop(ms) {
      var s = clamp(+ms || 60, 0, 200) / 1000;
      this.stopUntil = Math.max(this.stopUntil, this.t + s);
    }

    slowmo(scale, ms) {
      this.slowScale = clamp(+scale || 0.5, 0.05, 1);
      this.slowUntil = Math.max(this.slowUntil, this.t + clamp(+ms || 200, 0, 2000) / 1000);
    }

    shake(intensity) {
      var i = clamp(intensity == null ? 0.4 : +intensity || 0, 0, 1);
      if (i <= 0) return;
      if (this.t < this.shakeUntil && i < this.shakeI) return; // a bigger shake is running
      var dur = 70 + 230 * i;
      this.shakeUntil = this.t + dur / 1000;
      this.shakeI = i;
      this.cameras.main.shake(dur, 0.003 + 0.017 * i, true);
    }

    flash(color, ms) {
      var c = colorRgb(color, [255, 255, 255]);
      this.cameras.main.flash(clamp(+ms || 110, 30, 600), c[0], c[1], c[2], true);
    }

    squash(go, sx, sy, ms) {
      if (!go || !go.scene || typeof go.setScale !== "function") return;
      if (!go.__popSq || !go.__popBase) go.__popBase = { x: go.scaleX, y: go.scaleY };
      var b = go.__popBase;
      if (go.__popSq) {
        go.__popSq.stop();
        go.__popSq = null;
      }
      go.setScale(b.x * (+sx || 1), b.y * (+sy || 1));
      go.__popSq = this.tweens.add({
        targets: go,
        scaleX: b.x,
        scaleY: b.y,
        duration: clamp(+ms || 180, 40, 1000),
        ease: "Back.easeOut",
        easeParams: [3],
        onComplete: function () {
          go.__popSq = null;
        },
      });
    }

    nearMiss(x, y) {
      if (this.phase !== "live" || this.ended) return false;
      if (this.t - this.lastNear < 0.7) return false;
      this.lastNear = this.t;
      var txt = !this.meme.enabled || Math.random() < 0.45 ? "CLOSE!" : this.phrase("good");
      this.popup(txt, x, (typeof y === "number" ? y : H / 2) - 36, { kind: "meme", color: "#ffffff" });
      this.scoreAdd(1, x, y, { popup: false, sfx: false, vfx: false });
      this.slowmo(0.4, 160);
      playSfx("blip", 1 + Math.min(this.combo, 10) * 0.05);
      return true;
    }

    punchScore() {
      var s = this.scoreText;
      s.setText(String(this.ctx.score));
      if (s.__tw) s.__tw.stop();
      s.setScale(1.35 + Math.min(this.combo, 10) * 0.03);
      s.__tw = this.tweens.add({ targets: s, scale: 1, duration: 240, ease: "Back.easeOut", easeParams: [3] });
    }

    updateComboHud() {
      var c = this.combo;
      var t = this.comboText;
      if (c < 2) return;
      t.setText("x" + c + " COMBO");
      if (t.__tw) t.__tw.stop();
      t.setVisible(true).setAlpha(1).setScale(1.3);
      t.__tw = this.tweens.add({ targets: t, scale: 1, duration: 200, ease: "Back.easeOut" });
    }

    scoreAdd(n, x, y, o) {
      if (this.ended || !(n > 0) || !this.ctx) return;
      o = o || {};
      var ctx = this.ctx;
      ctx.score += n;
      this.combo = this.t - this.lastScoreAt <= 1.5 ? this.combo + 1 : 1;
      this.lastScoreAt = this.t;
      var c = this.combo;
      this.punchScore();
      post({ type: "score", score: ctx.score });
      if (o.sfx !== false && this.t - (this.lastScoreSfx || -1) >= 0.12) {
        this.lastScoreSfx = this.t;
        playSfx("score", 1 + Math.min(c - 1, 12) * 0.06);
      }
      var px = typeof x === "number" ? x : W / 2;
      var py = typeof y === "number" ? y : 160;
      if (o.vfx !== false) ctx.vfx("score", px, py);
      if (o.popup !== false) this.popup("+" + n, px, py - 18, { kind: "score" });
      this.updateComboHud();
      if (this.backdrop) this.backdrop.pump(n, c);

      // One callout per score event, by priority: new best > milestone > combo.
      var call = null;
      if (this.best !== null && this.best > 0 && !this.bestCalled && ctx.score > this.best) {
        this.bestCalled = true;
        call = [this.meme.enabled ? "NEW ATH!" : "NEW BEST!", "#ffe14d", "best"];
      }
      var crossed = false;
      while (ctx.score >= this.msNext) {
        crossed = true;
        this.msNext = nextMilestone(this.msNext);
      }
      if (!call && crossed) call = [this.phrase("milestone"), "#ffffff", "milestone"];
      if (!call && (c === 3 || c === 5 || (c >= 10 && c % 5 === 0))) {
        call = ["x" + c + " " + this.phrase("good"), c >= 10 ? "#ffe14d" : c >= 5 ? PUMP_CSS : "#ffffff", null];
      }
      if (call) {
        this.bigCallout(call[0], call[1]);
        if (call[2]) {
          playSfx(call[2]);
          ctx.vfx("score", W / 2, H * 0.3);
          this.shake(0.25);
        }
      }
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
          this.realMs = 0;
          startMusic();
          this.bigCallout(this.meme.enabled ? "LFG!" : "GO!", "#ffffff", 70);
          if (this.tpl.onInput && !inp.move) this.tpl.onInput(ctx, inp);
          break;
        case "live":
          if (this.tpl.onInput) this.tpl.onInput(ctx, inp);
          break;
        case "over":
          if (!embedded && this.t - this.overAt > 0.5) rt.arm();
          break;
      }
    }

    endRun(x, y) {
      if (this.ended || this.phase !== "live") return;
      var self = this;
      var ctx = this.ctx;
      this.ended = true;
      this.dying = true;
      this.phase = "over";
      ctx.phase = "over";
      this.overAt = Infinity;
      stopMusic();
      playSfx("hit");
      var hx = typeof x === "number" ? x : W / 2;
      var hy = typeof y === "number" ? y : H / 2;
      ctx.vfx("hit", hx, hy);
      this.combo = 0;
      this.comboText.setVisible(false);
      // freeze -> flash -> shake -> slow-mo -> death screen
      this.hitstop(110);
      this.flash("#ffffff", 180);
      this.shake(0.9);
      this.slowmo(0.3, 760);
      try {
        this.cameras.main.zoomTo(1.06, 320, "Quad.easeOut", true);
      } catch (e) {
        /* ignore */
      }
      if (this.backdrop) this.backdrop.dump();
      var score = ctx.score;
      var isBest = this.best !== null && score > this.best;
      rt.best = Math.max(this.best || 0, score);
      post({ type: "gameOver", score: score, durationMs: Math.round(this.realMs) });
      this.time.delayedCall(760, function () {
        self.showDeath(score, isBest);
      });
    }

    showDeath(score, isBest) {
      var self = this;
      var m = this.meme;
      var cfg = this.cfg;
      this.dying = false;
      try {
        this.cameras.main.zoomTo(1, 160, "Quad.easeOut", true);
      } catch (e) {
        /* ignore */
      }
      // clear leftover run popups so the death screen reads cleanly
      for (var pi = 0; pi < this.popups.length; pi++) {
        var pt = this.popups[pi];
        if (!pt.busy) continue;
        this.tweens.killTweensOf(pt);
        pt.busy = false;
        pt.setVisible(false);
      }
      this.scoreText.setVisible(false);
      this.labelText.setVisible(false);
      var dim = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.55).setAlpha(0);
      var big = this.memeText(this.phrase("bad"), 92, m.enabled ? "#ff3b5c" : cfg.palette.accent, { wrap: 440 });
      if (big.height > 230) big.setFontSize(Math.round(62 * m.scale));
      var y = H * 0.3;
      big.setPosition(W / 2, y);
      var rot = (Math.random() * 2 - 1) * 7;
      big.setAngle(rot).setScale(2.8).setAlpha(0);
      y += big.height / 2 + 56;
      var sc = this.memeText(String(score), 80, "#ffffff").setPosition(W / 2, y).setAlpha(0);
      y += sc.height / 2 + 6;
      var objs = [dim, big, sc];
      if (cfg.scoreLabel) {
        var lb = this.memeText(cfg.scoreLabel, 22, "#ffffff", { stroke: 4 });
        lb.setPosition(W / 2, y + lb.height / 2).setAlpha(0);
        y += lb.height + 4;
        objs.push(lb);
      }
      var bestT = null;
      if (isBest) {
        bestT = this.memeText(m.enabled ? "NEW BEST - WE'RE SO BACK" : "NEW BEST!", 30, "#ffe14d", { wrap: 420 });
      } else if (this.best !== null) {
        bestT = this.memeText("BEST " + Math.max(this.best, score), 22, "#ffffff", { stroke: 4 });
      }
      if (bestT) {
        y += 22;
        bestT.setPosition(W / 2, y + bestT.height / 2).setAlpha(0);
        y += bestT.height;
        objs.push(bestT);
      }
      var hintStr = m.enabled
        ? embedded
          ? "PRESS PLAY TO RUN IT BACK"
          : "TAP TO RUN IT BACK"
        : embedded
          ? "Press Play to retry"
          : "Tap to retry";
      var hint = this.memeText(hintStr, 26, cfg.palette.accent, { stroke: 6 });
      hint.setPosition(W / 2, Math.max(y + 60, H * 0.72)).setAlpha(0);
      objs.push(hint);
      this.overBox = this.add.container(0, 0, objs).setDepth(60);

      this.tweens.add({ targets: dim, alpha: 1, duration: 220 });
      this.tweens.add({
        targets: big,
        scale: 1,
        alpha: 1,
        duration: 200,
        ease: "Quad.easeIn",
        onComplete: function () {
          self.shake(0.45);
          playSfx("stamp");
        },
      });
      var rest = objs.slice(2);
      this.tweens.add({ targets: rest, alpha: 1, duration: 260, delay: 260 });
      if (bestT && isBest) {
        this.time.delayedCall(420, function () {
          playSfx("best");
          self.ctx.vfx("score", W / 2, bestT.y);
        });
        this.tweens.add({ targets: bestT, scale: 1.1, duration: 420, yoyo: true, repeat: -1, delay: 500, ease: "Sine.easeInOut" });
      }
      this.tweens.add({ targets: hint, scale: 1.08, duration: 520, yoyo: true, repeat: -1, delay: 520, ease: "Sine.easeInOut" });
      this.overAt = this.t;
    }

    updateSpeedLines(dt, live) {
      var g = this.speedG;
      g.clear();
      if (!live || this.lowPerf || dt <= 0) return;
      var ctx = this.ctx;
      var base = this.cfg.physics.scrollSpeed;
      var spd = ctx.speed();
      var inten = clamp((spd - base) / (base * 1.2), 0, 1) * 0.75 + Math.min(this.combo, 10) * 0.025;
      if (inten < 0.04) return;
      var n = Math.round(this.lines.length * Math.min(1, inten * 1.3));
      var v = spd * 2.4;
      g.lineStyle(2, this.lightSky ? 0x000000 : 0xffffff, (this.lightSky ? 0.04 : 0.05) + 0.16 * inten);
      var maxY = this.vertical ? H : ctx.groundY - 16;
      for (var i = 0; i < n; i++) {
        var l = this.lines[i];
        var len = l.len * (0.6 + inten);
        if (this.vertical) {
          l.y += v * l.v * dt;
          if (l.y - len > H) {
            l.y = -Math.random() * 80;
            l.x = Math.random() * W;
          }
          g.lineBetween(l.x, l.y, l.x, l.y - len);
        } else {
          l.x -= v * l.v * dt;
          if (l.x + len < 0 || l.y > maxY) {
            l.x = W + Math.random() * 80;
            l.y = 20 + Math.random() * (maxY - 20);
          }
          g.lineBetween(l.x, l.y, l.x + len, l.y);
        }
      }
    }

    applyTimeScale(ts) {
      if (Math.abs(ts - this.appliedTs) < 0.01) return;
      this.appliedTs = ts;
      var all = this.trails.slice();
      for (var k in this.emitters) if (this.emitters[k]) all.push(this.emitters[k]);
      for (var i = 0; i < all.length; i++) if (all[i] && all[i].active !== false) all[i].timeScale = ts;
      this.tweens.timeScale = Math.max(ts, 0.05);
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

      // time scale: hit-stop freezes the world; slow-mo snaps down and eases back up
      var frozen = this.t < this.stopUntil;
      var target = this.t < this.slowUntil ? this.slowScale : 1;
      if (target < this.timeScale) this.timeScale = target;
      else this.timeScale += (target - this.timeScale) * (1 - Math.exp(-7 * dt));
      if (this.timeScale > 0.995) this.timeScale = 1;
      var ts = frozen ? 0 : this.timeScale;
      this.applyTimeScale(frozen ? 0.02 : ts);
      var gdtMs = dtMs * ts;
      var gdt = gdtMs / 1000;

      var live = this.phase === "live";
      if (live) {
        ctx.elapsedMs += gdtMs;
        this.realMs += dtMs;
      }
      var moving = live ? ctx.speed() : this.phase === "over" ? 0 : this.cfg.physics.scrollSpeed * 0.35;

      if (this.ground && !this.vertical) this.ground.tilePositionX += moving * gdt;
      var self = this;
      this.decor.forEach(function (im) {
        if (self.vertical) {
          im.y += moving * im.factor * gdt;
          if (im.y > H + im.displayHeight / 2) {
            im.y = -im.displayHeight / 2 - Math.random() * 120;
            im.x = Math.random() * W;
          }
        } else {
          im.x -= moving * im.factor * gdt;
          if (im.x < -im.displayWidth / 2) self.placeDecor(im, true);
        }
      });

      // combo decay
      if (this.combo > 0 && this.t - this.lastScoreAt > 1.5) {
        this.combo = 0;
        var ct = this.comboText;
        if (ct.visible) {
          if (ct.__tw) ct.__tw.stop();
          ct.__tw = this.tweens.add({
            targets: ct,
            alpha: 0,
            duration: 200,
            onComplete: function () {
              ct.setVisible(false);
            },
          });
        }
      }

      this.updateSpeedLines(gdt, live);
      if (this.backdrop) {
        try {
          this.backdrop.update(this.phase === "over" ? Math.max(gdt, dt * 0.3) : gdt, {
            phase: this.phase,
            speed: live ? ctx.speed() : 0,
            combo: this.combo,
          });
        } catch (e) {
          console.warn("[pop] backdrop disabled", e);
          this.backdrop = null;
        }
      }

      try {
        if (live) {
          if (!frozen) this.tpl.update(ctx, gdtMs);
        } else if (this.dying) {
          if (!frozen && this.tpl.dying) this.tpl.dying(ctx, gdtMs);
        } else if (this.phase !== "over" && this.tpl.idle) this.tpl.idle(ctx, dtMs);
      } catch (e) {
        console.error(e);
        this.broken = true;
        post({ type: "error", message: "Game crashed: " + (e && e.message ? e.message : String(e)) });
      }

      // perf watchdog: drop bloom, then speed lines, if the frame rate sags
      if ((this.bloom || !this.lowPerf) && !document.hidden) {
        var fps = this.game.loop.actualFps;
        if (fps < 42) this.slowFrames += dt;
        else this.slowFrames = Math.max(0, this.slowFrames - dt * 0.5);
        if (this.slowFrames > 2.5) {
          this.slowFrames = 0;
          if (this.bloom) {
            try {
              this.bloomOwner.preFX.remove(this.bloom);
            } catch (e) {
              /* ignore */
            }
            this.bloom = null;
            rt.noBloom = true;
          } else {
            this.lowPerf = rt.lowPerf = true;
          }
        }
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
    best: null, // player's best on this game (from the parent; raised locally after each run)
    ticker: "",
    noBloom: false,
    lowPerf: false,
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

  function handleLoad(cfg, assets, best, ticker) {
    assets = assets && typeof assets === "object" ? assets : {};
    var hasBest = typeof best === "number" && isFinite(best) && best >= 0;
    rt.ticker = cleanTicker(ticker);
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
      if (hasBest) rt.best = Math.max(best, rt.best || 0);
      post({ type: "loaded" });
      return;
    }
    // A different game: forget the local best.
    if (key !== rt.key) rt.best = hasBest ? best : null;
    else if (hasBest) rt.best = Math.max(best, rt.best || 0);
    rt.key = key;
    rt.ready = false;
    var gen = ++rt.gen;
    document.body.style.background = cfg.palette.skyBottom;
    Promise.all([buildTextures(cfg, assets, gen), loadSounds(cfg, assets), loadFonts()])
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
    if (d.type === "load") handleLoad(d.config, d.assets, d.best, d.ticker);
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
