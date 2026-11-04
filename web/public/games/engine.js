/*
 * Proof-of-Play game runtime (runs inside <iframe sandbox="allow-scripts">).
 *
 * Templates: "flappy" and "runner", both one-button (tap / click / space / up).
 * Everything is driven by a GameConfig (see src/lib/game-config.ts).
 *
 * Protocol (all messages carry source: "pop"):
 *   parent -> game: load {config} | start | reset
 *   game -> parent: ready | loaded | score {score} | gameOver {score, durationMs} | error {message}
 *
 * Flow: boot -> "ready" -> parent sends "load" -> title screen + "loaded"
 *       -> parent sends "start" -> "tap to fly/jump" -> first tap begins the run
 *       -> collision -> "gameOver" -> parent sends "start" (new run) or "reset" (title).
 *
 * Plain JS on purpose: it is served statically from /games and needs no bundler.
 */
(function () {
  "use strict";

  var W = 480;
  var H = 720;
  var RES = 2; // sprite textures are rasterised at 2x for crisp scaling
  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  var embedded = window.parent && window.parent !== window;

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
  // Validation. Mirrors gameConfigSchema in src/lib/game-config.ts (the parent
  // GamePlayer also validates with zod before sending; this is the in-sandbox
  // safety net so a bad config can never crash the runtime).
  // ---------------------------------------------------------------------------
  var HEX = /^#[0-9a-fA-F]{6}$/;

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
    function num(o, k, p, min, max, int) {
      var v = o[k];
      if (typeof v !== "number" || !isFinite(v)) return need(false, p + k + ": expected number");
      need(v >= min && v <= max, p + k + ": must be between " + min + " and " + max);
      if (int) need(Math.floor(v) === v, p + k + ": must be an integer");
    }
    function hex(o, k, p) {
      need(typeof o[k] === "string" && HEX.test(o[k]), p + k + ": expected 6-digit hex colour like #12ab34");
    }
    function svg(o, k, p, optional) {
      var v = o[k];
      if (v === undefined && optional) return;
      need(
        typeof v === "string" && v.length <= 12000 && v.trim().indexOf("<svg") === 0 && v.indexOf("</svg>") !== -1,
        p + k + ": must be a complete <svg>...</svg> (max 12000 chars)"
      );
    }
    function section(k) {
      if (!isObj(c[k])) {
        errs.push(k + ": expected object");
        return null;
      }
      return c[k];
    }

    if (!isObj(c)) return ["config: expected object"];
    need(c.version === 1, "version: must be 1");
    need(c.template === "flappy" || c.template === "runner", 'template: must be "flappy" or "runner"');
    str(c, "title", "", 2, 40);
    str(c, "tagline", "", 0, 90);
    str(c, "scoreLabel", "", 0, 16);
    var s;
    if ((s = section("palette")))
      ["sky", "skyBottom", "ground", "accent", "text"].forEach(function (k) {
        hex(s, k, "palette.");
      });
    if ((s = section("sprites"))) {
      svg(s, "player", "sprites.");
      svg(s, "obstacle", "sprites.");
      svg(s, "collectible", "sprites.", true);
      svg(s, "decor", "sprites.", true);
    }
    if ((s = section("physics"))) {
      num(s, "gravity", "physics.", 300, 2500);
      num(s, "jumpVelocity", "physics.", 250, 1000);
      num(s, "scrollSpeed", "physics.", 120, 600);
      num(s, "speedRampPerSec", "physics.", 0, 15);
    }
    if ((s = section("obstacles"))) {
      num(s, "spawnIntervalMs", "obstacles.", 700, 2600);
      num(s, "gapSize", "obstacles.", 110, 280);
      num(s, "variance", "obstacles.", 0, 1);
    }
    if ((s = section("scoring"))) {
      num(s, "pointsPerObstacle", "scoring.", 1, 10, true);
      num(s, "collectibleChance", "scoring.", 0, 1);
      num(s, "pointsPerCollectible", "scoring.", 0, 25, true);
    }
    return errs;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function rand(a, b) {
    return a + Math.random() * (b - a);
  }
  function hexToInt(h) {
    return parseInt(h.slice(1), 16);
  }
  function rgb(h) {
    var n = hexToInt(h);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
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

  // ---------------------------------------------------------------------------
  // SVG -> canvas rasterisation
  // ---------------------------------------------------------------------------
  function stripWH(tag) {
    return tag.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g, "");
  }

  /** Normalise the root <svg> tag so it has xmlns and explicit numeric width/height. */
  function prepareSvg(src) {
    var s = String(src).trim();
    var m = s.match(/^<svg\b[^>]*>/i);
    if (!m) return { text: s, vw: 64, vh: 64 };
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
    return { text: newTag + s.slice(tag.length), vw: vw, vh: vh };
  }

  function fallbackCanvas(w, h, color) {
    var cv = document.createElement("canvas");
    cv.width = Math.max(2, Math.round(w * RES));
    cv.height = Math.max(2, Math.round(h * RES));
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
   * mode "fit": scale to fit inside boxW x boxH keeping aspect.
   * mode "width": width = boxW, height follows aspect, clamped to [boxW, boxH].
   */
  function rasterise(src, boxW, boxH, mode, fallbackColor) {
    return new Promise(function (resolve) {
      var p = prepareSvg(src);
      var w;
      var h;
      if (mode === "width") {
        w = boxW;
        h = clamp((boxW * p.vh) / p.vw, boxW, boxH);
      } else {
        var sc = Math.min(boxW / p.vw, boxH / p.vh);
        w = p.vw * sc;
        h = p.vh * sc;
      }
      var done = false;
      function finish(cv) {
        if (done) return;
        done = true;
        resolve({ canvas: cv, w: w, h: h });
      }
      var img = new Image();
      img.onload = function () {
        try {
          var cv = document.createElement("canvas");
          cv.width = Math.max(2, Math.round(w * RES));
          cv.height = Math.max(2, Math.round(h * RES));
          cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
          finish(cv);
        } catch (e) {
          finish(fallbackCanvas(w, h, fallbackColor));
        }
      };
      img.onerror = function () {
        console.warn("[pop] could not rasterise svg, using fallback");
        finish(fallbackCanvas(w, h, fallbackColor));
      };
      setTimeout(function () {
        finish(fallbackCanvas(w, h, fallbackColor));
      }, 4000);
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(p.text);
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
    cv.height = height;
    var ctx = cv.getContext("2d");
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 96, height);
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

  /** Build every texture a config needs. Resolves to { name: {key, canvas, w, h} }. */
  function buildTextures(cfg, gen) {
    var flappy = cfg.template === "flappy";
    var pal = cfg.palette;
    var sp = cfg.sprites;
    var groundH = H - (flappy ? FLAPPY_GROUND_Y : RUNNER_GROUND_Y);
    var jobs = {
      player: rasterise(sp.player, 52, 52, "fit", pal.accent),
      obstacle: flappy
        ? rasterise(sp.obstacle, 72, 620, "width", shade(pal.ground, 0.2))
        : rasterise(sp.obstacle, 52, 68, "fit", shade(pal.ground, 0.2)),
    };
    if (sp.collectible) jobs.collectible = rasterise(sp.collectible, 34, 34, "fit", pal.accent);
    if (sp.decor) jobs.decor = rasterise(sp.decor, 140, 72, "fit", shade(pal.sky, 0.2));
    var names = Object.keys(jobs);
    return Promise.all(
      names.map(function (n) {
        return jobs[n];
      })
    ).then(function (results) {
      var tex = {};
      names.forEach(function (n, i) {
        var r = results[i];
        tex[n] = { key: "g" + gen + "_" + n, canvas: r.canvas, w: r.w, h: r.h };
      });
      tex.bg = { key: "g" + gen + "_bg", canvas: gradientCanvas(pal.sky, pal.skyBottom), w: W, h: H };
      tex.ground = { key: "g" + gen + "_ground", canvas: groundCanvas(pal.ground, groundH), w: 96, h: groundH };
      return tex;
    });
  }

  // ---------------------------------------------------------------------------
  // The scene (one scene, two templates)
  // ---------------------------------------------------------------------------
  var FLAPPY_GROUND_Y = 660;
  var RUNNER_GROUND_Y = 610;
  var MAX_SPEED = 900;

  class MainScene extends Phaser.Scene {
    constructor() {
      super({ key: "main" });
    }

    init(data) {
      this.cfg = data.config;
      this.tx = data.tex;
      this.oldKeys = data.oldKeys || [];
      this.onReady = data.onReady;
    }

    create() {
      try {
        this.build();
      } catch (e) {
        console.error(e);
        post({ type: "error", message: "Game failed to start: " + (e && e.message ? e.message : String(e)) });
        return;
      }
      if (this.onReady) this.onReady(this);
    }

    build() {
      var self = this;
      var c = this.cfg;
      var t = this.tx;
      var pal = c.palette;

      // Swap textures: drop the previous config's, register this one's.
      this.oldKeys.forEach(function (k) {
        if (self.textures.exists(k)) self.textures.remove(k);
      });
      Object.keys(t).forEach(function (n) {
        if (!self.textures.exists(t[n].key)) self.textures.addCanvas(t[n].key, t[n].canvas);
      });

      this.isFlappy = c.template === "flappy";
      this.groundY = this.isFlappy ? FLAPPY_GROUND_Y : RUNNER_GROUND_Y;
      this.state = "title";
      this.t = 0;
      this.score = 0;
      this.elapsed = 0;
      this.speed = c.physics.scrollSpeed;
      this.obstacles = [];
      this.items = [];
      this.lastCenter = null;
      this.jumpBuffer = 0;
      var g = c.physics.gravity;
      var jv = c.physics.jumpVelocity;
      this.apex = (jv * jv) / (2 * g);
      this.airtime = (2 * jv) / g;

      var lightText = luminance(pal.text) > 0.5;
      this.strokeColor = lightText ? shade(pal.sky, -0.7) : "#ffffff";
      this.panelColor = lightText ? 0x000000 : 0xffffff;
      this.panelAlpha = lightText ? 0.35 : 0.55;

      // Background
      this.add.image(0, 0, t.bg.key).setOrigin(0, 0).setDisplaySize(W, H).setDepth(0);

      // Parallax decor: a far (small, faint, slow) and a near layer.
      this.decor = [];
      if (t.decor) {
        for (var i = 0; i < 5; i++) {
          var far = i < 3;
          var d = this.add.image(rand(0, W), 0, t.decor.key);
          var sc = far ? 0.6 : 1;
          d.setDisplaySize(t.decor.w * sc, t.decor.h * sc).setAlpha(far ? 0.5 : 0.9).setDepth(far ? 1 : 1.5);
          d.factor = far ? 0.15 : 0.38;
          d.far = far;
          d.x = (i % 3) * (W / 3) + rand(0, W / 3) + (far ? 0 : 60);
          this.placeDecorY(d);
          this.decor.push(d);
        }
      }

      // Ground
      this.ground = this.add
        .tileSprite(0, this.groundY, W, H - this.groundY, t.ground.key)
        .setOrigin(0, 0)
        .setDepth(3);

      // Player
      this.player = this.add.image(0, 0, t.player.key).setDisplaySize(t.player.w, t.player.h).setDepth(5);
      if (!this.isFlappy) this.player.setOrigin(0.5, 1);

      // HUD
      var hudStyle = {
        fontFamily: FONT,
        fontSize: "64px",
        fontStyle: "bold",
        color: pal.text,
        stroke: this.strokeColor,
        strokeThickness: 8,
        resolution: 2,
      };
      this.scoreText = this.add.text(W / 2, 64, "0", hudStyle).setOrigin(0.5).setDepth(10);
      this.labelText = this.add
        .text(W / 2, 108, c.scoreLabel || "", {
          fontFamily: FONT,
          fontSize: "20px",
          fontStyle: "bold",
          color: pal.text,
          stroke: this.strokeColor,
          strokeThickness: 4,
          resolution: 2,
        })
        .setOrigin(0.5)
        .setDepth(10);

      // Title overlay
      this.titleBox = this.makePanel([
        { text: c.title, size: 46, bold: true, color: pal.text, wrap: 400 },
        { text: c.tagline, size: 20, color: pal.text, wrap: 380, gap: 14 },
        {
          text: embedded ? "Press Play to start" : "Tap to play",
          size: 18,
          bold: true,
          color: pal.accent,
          gap: 26,
        },
      ]);

      // "Tap to fly / jump" prompt shown after `start`, before the first tap
      this.armHint = this.add
        .text(W / 2, H * 0.6, this.isFlappy ? "TAP TO FLY" : "TAP TO JUMP", {
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
        .setDepth(20);
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
        .setDepth(20);
      this.tweens.add({ targets: this.armHint, scale: 1.08, duration: 520, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

      // Game over overlay (texts updated in die())
      this.overBox = this.makePanel([
        { text: "GAME OVER", size: 44, bold: true, color: pal.accent },
        { text: "0", size: 30, bold: true, color: pal.text, gap: 12, ref: "overScore" },
        { text: embedded ? "" : "Tap to retry", size: 18, color: pal.text, gap: 18 },
      ]);

      // Input
      var onTap = function (e) {
        if (e && e.repeat) return;
        self.tap();
      };
      this.input.on("pointerdown", onTap);
      if (this.input.keyboard) {
        this.input.keyboard.addCapture("SPACE,UP,W");
        this.input.keyboard.on("keydown-SPACE", onTap);
        this.input.keyboard.on("keydown-UP", onTap);
        this.input.keyboard.on("keydown-W", onTap);
      }
      this.events.once("shutdown", function () {
        self.input.off("pointerdown", onTap);
        if (self.input.keyboard) {
          self.input.keyboard.off("keydown-SPACE", onTap);
          self.input.keyboard.off("keydown-UP", onTap);
          self.input.keyboard.off("keydown-W", onTap);
        }
      });

      this.toTitle();
    }

    /** Stacked centred texts on a rounded translucent panel. */
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
      var top = Math.round(H * 0.4 - boxH / 2);
      var gfx = this.add.graphics();
      gfx.fillStyle(this.panelColor, this.panelAlpha);
      gfx.fillRoundedRect(28, top, W - 56, boxH, 26);
      objs.forEach(function (o) {
        o.y += top + padY;
      });
      var container = this.add.container(0, 0, [gfx].concat(objs)).setDepth(30);
      return container;
    }

    placeDecorY(d) {
      var maxY = this.groundY - (d.far ? 260 : 150);
      d.y = d.far ? rand(40, Math.max(60, maxY)) : rand(90, Math.max(110, maxY));
    }

    showHud(on) {
      this.scoreText.setVisible(on);
      this.labelText.setVisible(on && !!this.cfg.scoreLabel);
    }

    setArmHint(on) {
      this.armHint.setVisible(on);
      this.armSub.setVisible(on);
    }

    clearWorld() {
      this.obstacles.forEach(function (o) {
        o.parts.forEach(function (p) {
          p.sprite.destroy();
        });
      });
      this.items.forEach(function (it) {
        it.sprite.destroy();
      });
      this.obstacles = [];
      this.items = [];
      this.lastCenter = null;
    }

    resetPlayer() {
      this.vy = 0;
      this.jumpBuffer = 0;
      this.grounded = !this.isFlappy;
      this.px = this.isFlappy ? 140 : 110;
      this.py = this.isFlappy ? H * 0.42 : this.groundY;
      this.player.setAngle(0).clearTint().setAlpha(1);
      this.player.x = this.px;
      this.player.y = this.py;
    }

    // ---- state transitions ---------------------------------------------------
    toTitle() {
      this.state = "title";
      this.clearWorld();
      this.resetPlayer();
      if (this.isFlappy) this.py = H * 0.66; // below the title panel
      this.titleBox.setVisible(true);
      this.overBox.setVisible(false);
      this.setArmHint(false);
      this.showHud(false);
      this.speed = this.cfg.physics.scrollSpeed;
    }

    arm() {
      this.state = "armed";
      this.clearWorld();
      this.resetPlayer();
      this.score = 0;
      this.elapsed = 0;
      this.speed = this.cfg.physics.scrollSpeed;
      this.scoreText.setText("0");
      this.titleBox.setVisible(false);
      this.overBox.setVisible(false);
      this.setArmHint(true);
      this.showHud(true);
      post({ type: "score", score: 0 });
    }

    begin() {
      this.state = "playing";
      this.setArmHint(false);
      this.elapsed = 0;
      this.spawnIn = this.isFlappy ? 0.8 : 1.0;
      this.action();
    }

    die() {
      if (this.state !== "playing") return;
      this.state = "over";
      this.overAt = this.t;
      var durationMs = Math.round(this.elapsed * 1000);
      this.cameras.main.shake(220, 0.012);
      this.player.setTint(0xff7777);
      this.burst(this.player.x, this.isFlappy ? this.player.y : this.player.y - this.tx.player.h / 2, "");
      this.overScore.setText(this.score + (this.cfg.scoreLabel ? " " + this.cfg.scoreLabel : ""));
      this.overBox.setVisible(true).setAlpha(0);
      this.tweens.add({ targets: this.overBox, alpha: 1, duration: 300, delay: 250 });
      post({ type: "gameOver", score: this.score, durationMs: durationMs });
    }

    tap() {
      switch (this.state) {
        case "title":
          if (!embedded) this.arm();
          break;
        case "armed":
          this.begin();
          break;
        case "playing":
          this.action();
          break;
        case "over":
          if (!embedded && this.t - this.overAt > 0.6) this.arm();
          break;
      }
    }

    action() {
      var jv = this.cfg.physics.jumpVelocity;
      if (this.isFlappy) {
        this.vy = -jv;
      } else if (this.grounded) {
        this.vy = -jv;
        this.grounded = false;
      } else {
        this.jumpBuffer = 0.14; // jump as soon as we land
      }
    }

    addScore(n) {
      if (n <= 0) return;
      this.score += n;
      this.scoreText.setText(String(this.score));
      this.scoreText.setScale(1.25);
      this.tweens.add({ targets: this.scoreText, scale: 1, duration: 160, ease: "Quad.easeOut" });
      post({ type: "score", score: this.score });
    }

    // ---- spawning ------------------------------------------------------------
    nextInterval() {
      var o = this.cfg.obstacles;
      var base = o.spawnIntervalMs / 1000;
      var j = base * (1 + (Math.random() * 2 - 1) * 0.4 * o.variance);
      if (this.isFlappy) {
        j = Math.max(j, (this.tx.obstacle.w + 150) / this.speed);
      } else {
        // Always leave room to land and jump again.
        j = Math.max(j, this.airtime + 0.3 + (this.tx.obstacle.w * 2.2) / this.speed);
      }
      return j;
    }

    spawn(interval) {
      if (this.isFlappy) this.spawnPipes(interval);
      else this.spawnGroundObstacle(interval);
    }

    spawnPipes(interval) {
      var c = this.cfg;
      var ob = this.tx.obstacle;
      var gap = c.obstacles.gapSize;
      var margin = 60;
      var minC = margin + gap / 2;
      var maxC = this.groundY - margin - gap / 2;
      var mid = (minC + maxC) / 2;
      var half = (maxC - minC) / 2;
      var center = mid + (Math.random() * 2 - 1) * half * c.obstacles.variance;
      if (this.lastCenter !== null) center = clamp(center, this.lastCenter - 240, this.lastCenter + 240);
      center = clamp(center, minC, maxC);
      this.lastCenter = center;

      var w = ob.w;
      var ph = Math.max(ob.h, 640);
      var x = W + w / 2 + 8;
      var gapTop = center - gap / 2;
      var gapBot = center + gap / 2;
      var top = this.add.image(x, gapTop, ob.key).setOrigin(0.5, 1).setFlipY(true).setDisplaySize(w, ph).setDepth(2);
      var bot = this.add.image(x, gapBot, ob.key).setOrigin(0.5, 0).setDisplaySize(w, ph).setDepth(2);
      var inset = w * 0.08;
      this.obstacles.push({
        x: x,
        w: w,
        scored: false,
        parts: [
          { sprite: top, dx: 0, l: -w / 2 + inset, r: w / 2 - inset, top: -9999, bottom: gapTop - 2 },
          { sprite: bot, dx: 0, l: -w / 2 + inset, r: w / 2 - inset, top: gapBot + 2, bottom: 9999 },
        ],
      });

      if (this.tx.collectible && Math.random() < c.scoring.collectibleChance) {
        var ix = x + (this.speed * interval) / 2;
        var iy = clamp(center + rand(-0.25, 0.25) * gap, 60, this.groundY - 60);
        this.spawnItem(ix, iy);
      }
    }

    spawnGroundObstacle(interval) {
      var c = this.cfg;
      var ob = this.tx.obstacle;
      var v = c.obstacles.variance;
      var sc = 1 + (Math.random() * 2 - 1) * 0.3 * v;
      var w = ob.w * sc;
      var h = ob.h * sc;
      var maxH = Math.max(26, this.apex - 34); // must always be jumpable
      if (h > maxH) {
        w *= maxH / h;
        h = maxH;
      }
      var count = 1;
      if (v > 0.4 && Math.random() < (v - 0.4) * 0.8 && this.airtime * this.speed > w * 2 + 80) count = 2;
      var x = W + w / 2 + 8;
      var parts = [];
      var inset = w * 0.14;
      for (var i = 0; i < count; i++) {
        var dx = i * w * 0.9;
        var s = this.add.image(x + dx, this.groundY + 2, ob.key).setOrigin(0.5, 1).setDisplaySize(w, h).setDepth(4);
        parts.push({ sprite: s, dx: dx, l: dx - w / 2 + inset, r: dx + w / 2 - inset, top: this.groundY - h + inset, bottom: 9999 });
      }
      this.obstacles.push({ x: x, w: w * (count === 2 ? 1.9 : 1), scored: false, parts: parts });

      if (this.tx.collectible && Math.random() < c.scoring.collectibleChance) {
        var ix = x + (this.speed * interval) / 2;
        var iy = this.groundY - rand(56, Math.max(60, Math.min(this.apex * 0.85, 210)));
        this.spawnItem(ix, iy);
      }
    }

    spawnItem(x, y) {
      var ct = this.tx.collectible;
      var s = this.add.image(x, y, ct.key).setDisplaySize(ct.w, ct.h).setDepth(4.5);
      this.items.push({ sprite: s, x: x, baseY: y, phase: rand(0, Math.PI * 2), r: Math.max(ct.w, ct.h) * 0.45 });
    }

    burst(x, y, label) {
      var col = hexToInt(this.cfg.palette.accent);
      for (var i = 0; i < 10; i++) {
        var a = (i / 10) * Math.PI * 2;
        var dot = this.add.circle(x, y, rand(3, 6), col).setDepth(6);
        this.tweens.add({
          targets: dot,
          x: x + Math.cos(a) * rand(30, 60),
          y: y + Math.sin(a) * rand(30, 60),
          alpha: 0,
          scale: 0.3,
          duration: 420,
          ease: "Quad.easeOut",
          onComplete: function (tw, targets) {
            targets[0].destroy();
          },
        });
      }
      if (label) {
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
          .setDepth(11);
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
    }

    // ---- main loop -----------------------------------------------------------
    update(time, deltaMs) {
      if (!this.player) return;
      var dt = Math.min(deltaMs / 1000, 0.05);
      this.t += dt;
      var c = this.cfg;
      var self = this;

      if (this.state === "playing") {
        this.elapsed += dt;
        this.speed = Math.min(c.physics.scrollSpeed + c.physics.speedRampPerSec * this.elapsed, MAX_SPEED);
      }
      var moving = this.state === "playing" ? this.speed : this.state === "over" ? 0 : c.physics.scrollSpeed * 0.35;

      // Parallax + ground scroll
      this.ground.tilePositionX += moving * dt;
      this.decor.forEach(function (d) {
        d.x -= moving * d.factor * dt;
        if (d.x < -d.displayWidth / 2) {
          d.x = W + d.displayWidth / 2 + rand(0, 160);
          self.placeDecorY(d);
        }
      });

      var pw = this.tx.player.w;
      var ph = this.tx.player.h;

      if (this.state === "title" || this.state === "armed") {
        if (this.isFlappy) {
          this.player.y = this.py + Math.sin(this.t * 3) * 10;
          this.player.setAngle(Math.sin(this.t * 3 + 1) * 6);
        } else {
          this.player.y = this.groundY - Math.abs(Math.sin(this.t * 6)) * 6;
        }
        this.bobItems();
        return;
      }

      if (this.state === "over") {
        if (this.isFlappy) {
          var floor = this.groundY - ph * 0.4;
          if (this.py < floor) {
            this.vy += c.physics.gravity * dt;
            this.py = Math.min(this.py + this.vy * dt, floor);
            this.player.y = this.py;
            this.player.setAngle(Math.min(this.player.angle + 360 * dt, 90));
          }
        }
        return;
      }

      // ---- playing: player physics
      var g = c.physics.gravity;
      if (this.isFlappy) {
        this.vy += g * dt;
        this.py += this.vy * dt;
        if (this.py < 14) {
          this.py = 14;
          this.vy = Math.max(this.vy, 0);
        }
        var target = clamp(this.vy * 0.07, -25, 80);
        this.player.setAngle(this.player.angle + (target - this.player.angle) * Math.min(1, dt * 10));
        this.player.y = this.py;
      } else {
        this.jumpBuffer -= dt;
        if (!this.grounded) {
          this.vy += g * dt;
          this.py += this.vy * dt;
          if (this.py >= this.groundY) {
            this.py = this.groundY;
            this.vy = 0;
            this.grounded = true;
            if (this.jumpBuffer > 0) {
              this.jumpBuffer = 0;
              this.action();
            }
          }
        }
        var bob = this.grounded ? Math.abs(Math.sin(this.t * 16)) * 3 : 0;
        this.player.y = this.py - bob;
        this.player.setAngle(this.grounded ? 0 : clamp(this.vy * 0.015, -12, 12));
      }

      // ---- spawning
      this.spawnIn -= dt;
      if (this.spawnIn <= 0) {
        var interval = this.nextInterval();
        this.spawn(interval);
        this.spawnIn = interval;
      }

      // ---- player hitbox
      var hx = this.px;
      var hy = this.isFlappy ? this.py : this.py - ph / 2;
      var hw = pw * (this.isFlappy ? 0.34 : 0.3);
      var hh = ph * (this.isFlappy ? 0.34 : 0.4);
      var L = hx - hw;
      var R = hx + hw;
      var T = hy - hh;
      var B = hy + hh;

      // ---- obstacles
      var dead = false;
      var keep = [];
      for (var i = 0; i < this.obstacles.length; i++) {
        var o = this.obstacles[i];
        o.x -= this.speed * dt;
        for (var j = 0; j < o.parts.length; j++) {
          var p = o.parts[j];
          p.sprite.x = o.x + p.dx;
          if (!dead && R > o.x + p.l && L < o.x + p.r && B > p.top && T < p.bottom) dead = true;
        }
        if (!o.scored && o.x + o.w / 2 < L) {
          o.scored = true;
          this.addScore(c.scoring.pointsPerObstacle);
        }
        if (o.x + o.w < -40) {
          o.parts.forEach(function (pp) {
            pp.sprite.destroy();
          });
        } else keep.push(o);
      }
      this.obstacles = keep;

      // ---- collectibles
      var keepItems = [];
      for (var k = 0; k < this.items.length; k++) {
        var it = this.items[k];
        it.x -= this.speed * dt;
        it.sprite.x = it.x;
        it.sprite.y = it.baseY + Math.sin(this.t * 4 + it.phase) * 6;
        var cx = clamp(it.x, L, R);
        var cy = clamp(it.sprite.y, T, B);
        var dx = it.x - cx;
        var dy = it.sprite.y - cy;
        if (dx * dx + dy * dy < it.r * it.r) {
          var pts = c.scoring.pointsPerCollectible;
          this.burst(it.x, it.sprite.y, pts > 0 ? "+" + pts : "");
          it.sprite.destroy();
          this.addScore(pts);
          continue;
        }
        if (it.x < -40) {
          it.sprite.destroy();
          continue;
        }
        keepItems.push(it);
      }
      this.items = keepItems;

      // ---- ground (flappy only: touching the ground kills)
      if (this.isFlappy && B >= this.groundY) dead = true;

      if (dead) this.die();
    }

    bobItems() {
      var self = this;
      this.items.forEach(function (it) {
        it.sprite.y = it.baseY + Math.sin(self.t * 4 + it.phase) * 6;
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Runtime: one Phaser.Game, the scene restarted for every new config
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
    pendingStart: false,
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

  function handleLoad(cfg) {
    var errs = validate(cfg);
    if (errs.length) {
      post({ type: "error", message: "Invalid game config: " + errs.slice(0, 6).join("; ") });
      return;
    }
    var key = JSON.stringify(cfg);
    if (key === rt.key && rt.ready) {
      post({ type: "loaded" });
      return;
    }
    rt.key = key;
    rt.ready = false;
    var gen = ++rt.gen;
    document.body.style.background = cfg.palette.skyBottom;
    buildTextures(cfg, gen)
      .then(function (tex) {
        if (gen !== rt.gen) return;
        ensureGame(function () {
          if (gen !== rt.gen) return;
          var old = rt.keys;
          rt.keys = Object.keys(tex).map(function (n) {
            return tex[n].key;
          });
          rt.game.scene.start("main", {
            config: cfg,
            tex: tex,
            oldKeys: old,
            onReady: function (scene) {
              if (gen !== rt.gen) return;
              rt.scene = scene;
              rt.ready = true;
              post({ type: "loaded" });
              if (rt.pendingStart) {
                rt.pendingStart = false;
                scene.arm();
              }
            },
          });
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
    if (d.type === "load") {
      handleLoad(d.config);
    } else if (d.type === "start") {
      if (rt.ready && rt.scene) rt.scene.arm();
      else rt.pendingStart = true;
    } else if (d.type === "reset") {
      rt.pendingStart = false;
      if (rt.ready && rt.scene) rt.scene.toTitle();
    }
  });

  var reportedError = false;
  window.addEventListener("error", function (ev) {
    if (reportedError) return;
    reportedError = true;
    post({ type: "error", message: "Runtime error: " + (ev && ev.message ? ev.message : "unknown") });
  });

  // Standalone debugging: open /games/engine.html#<url-encoded config JSON>
  if (!embedded) window.__pop = rt;
  if (!embedded && location.hash.length > 1) {
    try {
      handleLoad(JSON.parse(decodeURIComponent(location.hash.slice(1))));
    } catch (e) {
      console.error("[pop] bad config in hash", e);
    }
  }

  if (typeof Phaser === "undefined") {
    post({ type: "error", message: "Phaser failed to load" });
  } else {
    post({ type: "ready" });
  }
})();
