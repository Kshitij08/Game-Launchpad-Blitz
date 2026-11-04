/*
 * Template "dodge": dodge & catch.
 * Player stands at the bottom and moves left/right (drag / arrows / A-D).
 * Hazards (sprites.obstacle) are telegraphed by a marker at the top and a
 * growing floor shadow, then fall at ctx.speed(); every hazard that lands
 * safely scores pointsPerObstacle, getting hit ends the run. Collectibles
 * fall too and are caught with ctx.collect. Spawns speed up over time, and
 * every ~11 s a "PUMP" (collectible shower) or "DUMP" (hazard wall with a
 * gap) wave hits.
 * Contract: src/lib/games/TEMPLATE_API.md
 */
(function () {
  "use strict";

  var PLAYER = 52;
  var HAZARD = 42;
  var ITEM = 32;
  var MAX_FALL = 680;
  var WARN = 0.42; // s of telegraph before a hazard drops in
  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function hexInt(h) {
    return parseInt(String(h || "#ffffff").slice(1), 16) || 0xffffff;
  }

  function sprite(scene, key, x, y, w, h) {
    var img = scene.add.image(x, y, key);
    var fw = img.width || w;
    var fh = img.height || h;
    var s = Math.min(w / fw, h / fh);
    img.setDisplaySize(fw * s, fh * s);
    return img;
  }

  // ---- juice helpers: prefer core's, fall back locally
  function popText(ctx, text, x, y, o) {
    o = o || {};
    if (ctx.popup) return ctx.popup(text, x, y, o);
    var s = ctx.scene;
    var t = s.add
      .text(x, y, text, {
        fontFamily: FONT,
        fontSize: (o.size || 22) + "px",
        fontStyle: "bold",
        color: o.color || ctx.palette.text,
        stroke: "#000000",
        strokeThickness: 4,
        resolution: 2,
      })
      .setOrigin(0.5)
      .setDepth(45)
      .setScale(0.5);
    s.tweens.add({ targets: t, scale: 1, duration: 140, ease: "Back.easeOut" });
    s.tweens.add({ targets: t, y: y - 46, alpha: 0, duration: 800, delay: 160, ease: "Quad.easeIn", onComplete: function () { t.destroy(); } });
  }
  function nearMiss(ctx, x, y) {
    if (ctx.nearMiss) ctx.nearMiss(x, y);
    else popText(ctx, "CLOSE!", x, y - 30, { size: 20, color: ctx.palette.accent, kind: "meme" });
  }
  function shake(ctx, a) {
    if (ctx.shake) ctx.shake(a);
    else ctx.scene.cameras.main.shake(90, 0.002 + 0.01 * a);
  }

  function destroyHazard(h) {
    if (h.img) h.img.destroy();
    if (h.marker) h.marker.destroy();
    if (h.shadow) h.shadow.destroy();
  }

  POP.registerTemplate("dodge", {
    titleHint: "DRAG TO MOVE",
    background: true,
    decorDirection: "down", // core: decor drifts down; ground band stays still
    groundY: 664, // core draws the ground band from here via ctx.drawGround()

    create: function (ctx) {
      var scene = ctx.scene;
      var c = ctx.config;
      var tu = c.tuning || {};
      var W = ctx.W;
      var H = ctx.H;

      // Floor: use core's ground band if it gives a sensible line, else a thin floor near the bottom.
      var floorY = H - 56;
      if (typeof ctx.drawGround === "function") {
        var gy = ctx.drawGround();
        if (typeof gy === "number" && gy > H * 0.7 && gy < H) floorY = gy;
      }
      var accent = hexInt(c.palette.accent);

      var st = {
        moveSpeed: tu.playerSpeed || 420,
        hazards: [],
        items: [],
        spawnIn: 0.5,
        itemIn: 1.2,
        waveIn: 10,
        floorY: floorY,
        t: 0,
        lean: 0,
        lastDir: 0,
        lastNear: -9,
        lastCatch: -9,
        chain: 0,
        accent: accent,
      };
      ctx._dodge = st;

      st.pshadow = scene.add.ellipse(W / 2, floorY + 2, PLAYER * 0.9, 12, 0x000000, 0.3).setDepth(3.5);
      st.player = sprite(scene, ctx.tex.player, W / 2, 0, PLAYER, PLAYER).setOrigin(0.5, 1).setDepth(5);
      st.player.y = floorY + 2;
      st.pw = st.player.displayWidth;
      st.ph = st.player.displayHeight;
      st.bsx = st.player.scaleX;
      st.bsy = st.player.scaleY;
      st.minX = st.pw / 2 + 4;
      st.maxX = W - st.pw / 2 - 4;

      st.dust = scene.add
        .particles(0, 0, "pop_dot", {
          emitting: false,
          speedX: { min: -120, max: 120 },
          speedY: { min: -80, max: -10 },
          scale: { start: 0.8, end: 0 },
          alpha: { start: 0.6, end: 0 },
          lifespan: { min: 220, max: 400 },
          tint: [hexInt(POP.util.shade(c.palette.ground, 0.4)), 0xffffff],
        })
        .setDepth(4.6);
      st.sparkle = scene.add
        .particles(0, 0, "pop_dot", {
          emitting: false,
          speed: { min: 90, max: 260 },
          scale: { start: 1, end: 0 },
          alpha: { start: 1, end: 0 },
          lifespan: { min: 260, max: 480 },
          blendMode: "ADD",
          tint: [accent, 0xffffff, 0xffd23f],
        })
        .setDepth(6);
    },

    update: function (ctx, dtMs) {
      var st = ctx._dodge;
      if (!st) return;
      var c = ctx.config;
      var scene = ctx.scene;
      var dt = Math.min(dtMs / 1000, 0.05);
      var inp = ctx.input || {};
      var p = st.player;
      st.t += dt;
      var elapsed = (ctx.elapsedMs || 0) / 1000;
      var fall = Math.min(ctx.speed(), MAX_FALL);

      // ---- movement
      var dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      var vx = 0;
      if (dir !== 0) {
        vx = dir * st.moveSpeed;
        p.x += vx * dt;
      } else if (inp.pointerDown && typeof inp.pointerX === "number") {
        var maxStep = st.moveSpeed * 2.6 * dt;
        var dx = clamp(inp.pointerX - p.x, -maxStep, maxStep);
        vx = dx / dt;
        p.x += dx;
      }
      p.x = clamp(p.x, st.minX, st.maxX);
      // lean into the move, squash on direction change
      var md = vx > 40 ? 1 : vx < -40 ? -1 : 0;
      if (md !== 0 && st.lastDir !== 0 && md !== st.lastDir) squash(scene, st, 0.78, 1.16, 200);
      if (md !== 0) st.lastDir = md;
      var leanT = clamp(vx * 0.035, -16, 16);
      st.lean += (leanT - st.lean) * Math.min(1, dt * 14);
      p.setAngle(st.lean);
      p.y = st.floorY + 2 - (md !== 0 ? Math.abs(Math.sin(st.t * 18)) * 4 : 0);
      st.pshadow.x = p.x;

      // player hitbox: body box, a bit smaller than the sprite
      var hw = st.pw * 0.32;
      var top = p.y - st.ph * 0.78;
      var bottom = p.y - st.ph * 0.08;
      var L = p.x - hw;
      var R = p.x + hw;

      // ---- spawning: interval shrinks to 55% over ~40 s
      var ob = c.obstacles;
      var ramp = Math.max(0.55, 1 - elapsed * 0.011);
      st.spawnIn -= dt;
      st.waveIn -= dt;
      if (st.waveIn <= 0) {
        st.waveIn = 10 + ctx.rng() * 4;
        if (ctx.tex.collectible && ctx.rng() < 0.45) pumpWave(ctx, st);
        else dumpWave(ctx, st);
        st.spawnIn = Math.max(st.spawnIn, 1.6);
      } else if (st.spawnIn <= 0) {
        var jitter = 1 + (ctx.rng() * 2 - 1) * 0.45 * ob.variance;
        st.spawnIn = Math.max(0.22, (ob.spawnIntervalMs / 1000) * ramp * jitter);
        spawnHazard(ctx, st, null, WARN);
        // at higher variance, occasionally a second hazard in the same wave
        if (ob.variance > 0.5 && elapsed > 8 && ctx.rng() < (ob.variance - 0.5) * 0.6) spawnHazard(ctx, st, null, WARN);
      }
      if (ctx.tex.collectible) {
        st.itemIn -= dt;
        if (st.itemIn <= 0) {
          st.itemIn = (ob.spawnIntervalMs / 1000) * (0.8 + ctx.rng() * 0.6);
          if (ctx.rng() < c.scoring.collectibleChance) spawnItem(ctx, st, 40 + ctx.rng() * (ctx.W - 80), 0);
        }
      }

      // ---- hazards
      var n = 0;
      for (var i = 0; i < st.hazards.length; i++) {
        var h = st.hazards[i];
        // shadow grows as the hazard approaches (also during the warning)
        var prox = clamp(1 - (st.floorY - h.y) / st.floorY, 0, 1);
        h.shadow.setScale(0.45 + 0.65 * prox, 0.45 + 0.65 * prox);
        h.shadow.setAlpha(0.2 + 0.35 * prox);
        if (h.warn > 0) {
          h.warn -= dt;
          var pulse = Math.abs(Math.sin(st.t * 22));
          h.marker.setAlpha(0.6 + 0.4 * pulse);
          h.marker.setScale(1 + 0.25 * pulse);
          if (h.warn <= 0) {
            h.marker.destroy();
            h.marker = null;
            h.img.setVisible(true);
          }
          st.hazards[n++] = h;
          continue;
        }
        h.y += fall * h.mult * dt;
        h.img.y = h.y;
        h.img.angle += h.spin * dt;
        // circle (hazard) vs box (player)
        var cx = clamp(h.x, L, R);
        var cy = clamp(h.y, top, bottom);
        var ddx = h.x - cx;
        var ddy = h.y - cy;
        if (ddx * ddx + ddy * ddy < h.r * h.r) {
          p.setTint(0xff7777);
          if (ctx.hitstop) ctx.hitstop(80);
          ctx.gameOver(h.x, h.y);
          scene.tweens.add({ targets: p, scaleX: st.bsx * 1.4, scaleY: st.bsy * 0.5, duration: 160, ease: "Quad.easeOut" });
          return;
        }
        if (h.y + h.r >= st.floorY) {
          land(ctx, st, h, p.x, hw);
          continue;
        }
        st.hazards[n++] = h;
      }
      st.hazards.length = n;

      // ---- collectibles
      n = 0;
      for (var j = 0; j < st.items.length; j++) {
        var it = st.items[j];
        if (it.delay > 0) {
          it.delay -= dt;
          st.items[n++] = it;
          continue;
        }
        it.y += fall * 0.8 * dt;
        it.img.y = it.y;
        it.img.x = it.baseX + Math.sin(st.t * 2.5 + it.phase) * 18;
        it.img.setAngle(Math.sin(st.t * 4 + it.phase) * 14);
        var ix = clamp(it.img.x, L - 6, R + 6);
        var iy = clamp(it.y, top - 6, bottom);
        var ex = it.img.x - ix;
        var ey = it.y - iy;
        if (ex * ex + ey * ey < it.r * it.r) {
          catchItem(ctx, st, it);
          continue;
        }
        if (it.y - it.r > st.floorY) {
          it.img.destroy();
          continue;
        }
        st.items[n++] = it;
      }
      st.items.length = n;
    },
  });

  function squash(scene, st, sx, sy, ms) {
    var p = st.player;
    scene.tweens.killTweensOf(p);
    p.setScale(st.bsx * sx, st.bsy * sy);
    scene.tweens.add({ targets: p, scaleX: st.bsx, scaleY: st.bsy, duration: ms, ease: "Back.easeOut" });
  }

  function land(ctx, st, h, px, hw) {
    var c = ctx.config;
    var scene = ctx.scene;
    ctx.addScore(c.scoring.pointsPerObstacle, h.x, st.floorY - 10);
    st.dust.explode(6, h.x, st.floorY);
    var gap = Math.abs(h.x - px) - (hw + h.r);
    if (gap < 18 && st.t - st.lastNear > 0.35) {
      st.lastNear = st.t;
      nearMiss(ctx, px, st.floorY - st.ph);
    }
    h.shadow.destroy();
    var img = h.img;
    img.y = st.floorY - h.r * 0.6;
    var sx = img.scaleX;
    var sy = img.scaleY;
    img.setScale(sx * 1.5, sy * 0.5);
    scene.tweens.chain({
      targets: img,
      tweens: [
        { scaleX: sx * 0.85, scaleY: sy * 1.15, y: img.y - 26, duration: 160, ease: "Quad.easeOut" },
        { scaleX: sx * 1.2, scaleY: sy * 0.7, y: st.floorY - h.r * 0.5, alpha: 0, duration: 200, ease: "Quad.easeIn" },
      ],
      onComplete: function () {
        img.destroy();
      },
    });
  }

  function catchItem(ctx, st, it) {
    var x = it.img.x;
    var y = it.y;
    ctx.collect(x, y);
    st.sparkle.explode(12, x, y);
    squash(ctx.scene, st, 1.22, 0.82, 220);
    if (!ctx.combo) {
      // fallback combo (core counts combos itself via addScore/collect)
      st.chain = st.t - st.lastCatch < 2.2 ? st.chain + 1 : 1;
      if (st.chain >= 2) popText(ctx, "COMBO x" + st.chain, x, y - 40, { size: 18 + Math.min(st.chain, 10) * 1.5, color: ctx.palette.accent, kind: "meme" });
    }
    st.lastCatch = st.t;
    var img = it.img;
    ctx.scene.tweens.add({
      targets: img,
      scaleX: img.scaleX * 1.8,
      scaleY: img.scaleY * 1.8,
      alpha: 0,
      duration: 160,
      ease: "Quad.easeOut",
      onComplete: function () {
        img.destroy();
      },
    });
  }

  /** forceX: fixed column (waves) or null; warn: telegraph seconds. */
  function spawnHazard(ctx, st, forceX, warn, mult) {
    var v = ctx.config.obstacles.variance;
    var W = ctx.W;
    var scene = ctx.scene;
    var sc = forceX === null ? 1 + (ctx.rng() * 2 - 1) * 0.25 * v : 1;
    var img = sprite(scene, ctx.tex.obstacle, 0, 0, HAZARD * sc, HAZARD * sc).setDepth(3);
    var w = img.displayWidth;
    var h = img.displayHeight;
    var x;
    if (forceX !== null) x = forceX;
    // A share of hazards aim near the player so camping in one spot doesn't work.
    else if (ctx.rng() < 0.3) x = st.player.x + (ctx.rng() * 2 - 1) * 70;
    else x = w / 2 + ctx.rng() * (W - w);
    x = clamp(x, w / 2 + 2, W - w / 2 - 2);
    img.x = x;
    img.y = -h / 2;
    img.setVisible(false);
    var r = Math.min(w, h) * 0.36;
    var marker = scene.add.triangle(x, 8, 0, 0, 32, 0, 16, 24, st.accent).setOrigin(0.5, 0).setDepth(7).setStrokeStyle(3, 0xffffff, 1);
    var shadow = scene.add.ellipse(x, st.floorY + 3, w * 1.1, 12, 0x000000, 0.2).setDepth(3.4);
    st.hazards.push({
      img: img,
      marker: marker,
      shadow: shadow,
      warn: warn,
      x: x,
      y: -h / 2,
      r: r,
      mult: mult || 1 + (ctx.rng() * 2 - 1) * 0.18 * v,
      spin: (ctx.rng() * 2 - 1) * 90 * v,
    });
  }

  function dumpWave(ctx, st) {
    // a wall of hazards with a 2-column gap (always reachable in the telegraph + fall time)
    var W = ctx.W;
    var cols = 8;
    var step = W / cols;
    var gap = Math.floor(ctx.rng() * (cols - 1));
    for (var i = 0; i < cols; i++) {
      if (i === gap || i === gap + 1) continue;
      spawnHazard(ctx, st, step * (i + 0.5), 0.7, 0.9);
    }
    popText(ctx, "DUMP!", W / 2, 200, { size: 44, color: "#ff4d4d", kind: "big" });
    shake(ctx, 0.3);
  }

  function pumpWave(ctx, st) {
    var W = ctx.W;
    var start = ctx.rng() < 0.5;
    for (var i = 0; i < 6; i++) {
      var f = i / 5;
      spawnItem(ctx, st, 60 + (start ? f : 1 - f) * (W - 120), i * 0.18);
    }
    popText(ctx, "PUMP!", W / 2, 200, { size: 44, color: "#3dff8a", kind: "big" });
  }

  function spawnItem(ctx, st, baseX, delay) {
    var img = sprite(ctx.scene, ctx.tex.collectible, 0, 0, ITEM, ITEM).setDepth(3.5);
    var r = Math.max(img.displayWidth, img.displayHeight) * 0.45;
    img.x = baseX;
    img.y = -r;
    st.items.push({ img: img, baseX: baseX, y: -r, r: r, phase: ctx.rng() * 6.28, delay: delay || 0 });
  }
})();
