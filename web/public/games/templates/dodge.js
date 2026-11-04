/*
 * Template "dodge": dodge & catch.
 * Player stands at the bottom and moves left/right (drag / arrows / A-D).
 * Hazards (sprites.obstacle) fall at ctx.speed(); every hazard that lands
 * safely scores pointsPerObstacle, getting hit ends the run. Collectibles
 * fall too and are caught with ctx.collect. Spawns speed up over time.
 * Contract: src/lib/games/TEMPLATE_API.md
 */
(function () {
  "use strict";

  var PLAYER = 52;
  var HAZARD = 42;
  var ITEM = 32;
  var MAX_FALL = 680;

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function sprite(scene, key, x, y, w, h) {
    var img = scene.add.image(x, y, key);
    var fw = img.width || w;
    var fh = img.height || h;
    var s = Math.min(w / fw, h / fh);
    img.setDisplaySize(fw * s, fh * s);
    return img;
  }

  function destroyAll(list) {
    for (var i = 0; i < list.length; i++) if (list[i].img) list[i].img.destroy();
    list.length = 0;
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

      var old = ctx._dodge;
      if (old) {
        destroyAll(old.hazards);
        destroyAll(old.items);
        if (old.player) old.player.destroy();
      }

      // Floor: use core's ground band if it gives a sensible line, else a thin floor near the bottom.
      var floorY = H - 56;
      if (typeof ctx.drawGround === "function") {
        var gy = ctx.drawGround();
        if (typeof gy === "number" && gy > H * 0.7 && gy < H) floorY = gy;
      }

      var st = {
        moveSpeed: tu.playerSpeed || 420,
        hazards: [],
        items: [],
        spawnIn: 0.5,
        itemIn: 1.2,
        floorY: floorY,
        t: 0,
      };
      ctx._dodge = st;

      st.player = sprite(scene, ctx.tex.player, W / 2, 0, PLAYER, PLAYER).setOrigin(0.5, 1).setDepth(5);
      st.player.y = floorY + 2;
      st.pw = st.player.displayWidth;
      st.ph = st.player.displayHeight;
      st.minX = st.pw / 2 + 4;
      st.maxX = W - st.pw / 2 - 4;
    },

    update: function (ctx, dtMs) {
      var st = ctx._dodge;
      if (!st) return;
      var c = ctx.config;
      var W = ctx.W;
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
      p.setAngle(clamp(vx * 0.02, -10, 10));
      p.y = st.floorY + 2 - (vx !== 0 ? Math.abs(Math.sin(st.t * 18)) * 3 : 0);

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
      if (st.spawnIn <= 0) {
        var jitter = 1 + (ctx.rng() * 2 - 1) * 0.45 * ob.variance;
        st.spawnIn = Math.max(0.22, (ob.spawnIntervalMs / 1000) * ramp * jitter);
        spawnHazard(ctx, st);
        // at higher variance, occasionally a second hazard in the same wave
        if (ob.variance > 0.5 && elapsed > 8 && ctx.rng() < (ob.variance - 0.5) * 0.6) spawnHazard(ctx, st);
      }
      if (ctx.tex.collectible) {
        st.itemIn -= dt;
        if (st.itemIn <= 0) {
          st.itemIn = (ob.spawnIntervalMs / 1000) * (0.8 + ctx.rng() * 0.6);
          if (ctx.rng() < c.scoring.collectibleChance) spawnItem(ctx, st);
        }
      }

      // ---- hazards
      var keep = [];
      for (var i = 0; i < st.hazards.length; i++) {
        var h = st.hazards[i];
        h.y += fall * h.mult * dt;
        h.img.y = h.y;
        h.img.x = h.x;
        h.img.angle += h.spin * dt;
        // circle (hazard) vs box (player)
        var cx = clamp(h.x, L, R);
        var cy = clamp(h.y, top, bottom);
        var ddx = h.x - cx;
        var ddy = h.y - cy;
        if (ddx * ddx + ddy * ddy < h.r * h.r) {
          ctx.gameOver(h.x, h.y);
          return;
        }
        if (h.y + h.r >= st.floorY) {
          ctx.addScore(c.scoring.pointsPerObstacle, h.x, st.floorY - 10);
          var img = h.img;
          ctx.scene.tweens.add({
            targets: img,
            scaleY: img.scaleY * 0.3,
            scaleX: img.scaleX * 1.4,
            alpha: 0,
            duration: 180,
            onComplete: function (tw, targets) {
              targets[0].destroy();
            },
          });
          continue;
        }
        keep.push(h);
      }
      st.hazards = keep;

      // ---- collectibles
      var keepItems = [];
      for (var j = 0; j < st.items.length; j++) {
        var it = st.items[j];
        it.y += fall * 0.8 * dt;
        it.img.y = it.y;
        it.img.x = it.baseX + Math.sin(st.t * 2.5 + it.phase) * 18;
        it.img.setAngle(Math.sin(st.t * 4 + it.phase) * 14);
        var ix = clamp(it.img.x, L - 6, R + 6);
        var iy = clamp(it.y, top - 6, bottom);
        var ex = it.img.x - ix;
        var ey = it.y - iy;
        if (ex * ex + ey * ey < it.r * it.r) {
          ctx.collect(it.img.x, it.y);
          it.img.destroy();
          continue;
        }
        if (it.y - it.r > st.floorY) {
          it.img.destroy();
          continue;
        }
        keepItems.push(it);
      }
      st.items = keepItems;
    },
  });

  function spawnHazard(ctx, st) {
    var v = ctx.config.obstacles.variance;
    var W = ctx.W;
    var sc = 1 + (ctx.rng() * 2 - 1) * 0.25 * v;
    var img = sprite(ctx.scene, ctx.tex.obstacle, 0, 0, HAZARD * sc, HAZARD * sc).setDepth(3);
    var w = img.displayWidth;
    var h = img.displayHeight;
    var x;
    // A share of hazards aim near the player so camping in one spot doesn't work.
    if (ctx.rng() < 0.3) x = st.player.x + (ctx.rng() * 2 - 1) * 70;
    else x = w / 2 + ctx.rng() * (W - w);
    x = clamp(x, w / 2 + 2, W - w / 2 - 2);
    img.x = x;
    img.y = -h / 2;
    st.hazards.push({
      img: img,
      x: x,
      y: -h / 2,
      r: Math.min(w, h) * 0.36,
      mult: 1 + (ctx.rng() * 2 - 1) * 0.18 * v,
      spin: (ctx.rng() * 2 - 1) * 90 * v,
    });
  }

  function spawnItem(ctx, st) {
    var W = ctx.W;
    var img = sprite(ctx.scene, ctx.tex.collectible, 0, 0, ITEM, ITEM).setDepth(3.5);
    var baseX = 40 + ctx.rng() * (W - 80);
    var r = Math.max(img.displayWidth, img.displayHeight) * 0.45;
    img.x = baseX;
    img.y = -r;
    st.items.push({ img: img, baseX: baseX, y: -r, r: r, phase: ctx.rng() * 6.28 });
  }
})();
