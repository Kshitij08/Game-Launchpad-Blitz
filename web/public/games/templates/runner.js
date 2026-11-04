/* Runner template: tap to jump over ground obstacles. See src/lib/games/TEMPLATE_API.md. */
(function () {
  "use strict";
  if (!window.POP) return;
  var clamp = POP.util.clamp;

  POP.registerTemplate("runner", {
    titleHint: "TAP TO JUMP",
    groundY: 610,
    sizes: { obstacle: { w: 52, h: 68 } },

    create: function (ctx) {
      var s = ctx.scene;
      ctx.drawGround();
      var g = ctx.config.physics.gravity;
      var jv = ctx.config.physics.jumpVelocity;
      var st = (ctx.runner = {
        px: 110,
        py: ctx.groundY,
        vy: 0,
        grounded: true,
        jumpBuffer: 0,
        obstacles: [],
        items: [],
        spawnIn: 1.0,
        t: 0,
        apex: (jv * jv) / (2 * g),
        airtime: (2 * jv) / g,
      });
      st.player = s.add.image(st.px, st.py, ctx.tex.player).setOrigin(0.5, 1).setDepth(5);
      st.dust = ctx.trail(st.player);
    },

    idle: function (ctx, dtMs) {
      var st = ctx.runner;
      st.t += dtMs / 1000;
      st.player.y = ctx.groundY - Math.abs(Math.sin(st.t * 6)) * 6;
    },

    onInput: function (ctx) {
      jump(ctx, ctx.runner);
    },

    update: function (ctx, dtMs) {
      var dt = dtMs / 1000;
      var st = ctx.runner;
      var cfg = ctx.config;
      var s = ctx.scene;
      var speed = ctx.speed();
      var pw = ctx.size.player.w;
      var ph = ctx.size.player.h;
      st.t += dt;

      // player
      st.jumpBuffer -= dt;
      if (!st.grounded) {
        st.vy += cfg.physics.gravity * dt;
        st.py += st.vy * dt;
        if (st.py >= ctx.groundY) {
          st.py = ctx.groundY;
          st.vy = 0;
          st.grounded = true;
          if (st.jumpBuffer > 0) {
            st.jumpBuffer = 0;
            jump(ctx, st);
          }
        }
      }
      var bob = st.grounded ? Math.abs(Math.sin(st.t * 16)) * 3 : 0;
      st.player.y = st.py - bob;
      st.player.setAngle(st.grounded ? 0 : clamp(st.vy * 0.015, -12, 12));

      // spawn
      st.spawnIn -= dt;
      if (st.spawnIn <= 0) {
        var interval = nextInterval(ctx, st, speed);
        spawn(ctx, st, speed, interval);
        st.spawnIn = interval;
      }

      // hitbox
      var hy = st.py - ph / 2;
      var hw = pw * 0.3;
      var hh = ph * 0.4;
      var L = st.px - hw;
      var R = st.px + hw;
      var T = hy - hh;
      var B = hy + hh;
      var dead = false;

      var keep = [];
      for (var i = 0; i < st.obstacles.length; i++) {
        var o = st.obstacles[i];
        o.x -= speed * dt;
        for (var j = 0; j < o.parts.length; j++) {
          var p = o.parts[j];
          p.sprite.x = o.x + p.dx;
          if (R > o.x + p.l && L < o.x + p.r && B > p.top) dead = true;
        }
        if (!o.scored && o.x + o.w / 2 < L) {
          o.scored = true;
          ctx.addScore(cfg.scoring.pointsPerObstacle, o.x, ctx.groundY - o.h - 10);
        }
        if (o.x + o.w < -40) {
          o.parts.forEach(function (pp) {
            pp.sprite.destroy();
          });
        } else keep.push(o);
      }
      st.obstacles = keep;

      var keepItems = [];
      for (var k = 0; k < st.items.length; k++) {
        var it = st.items[k];
        it.x -= speed * dt;
        it.sprite.x = it.x;
        it.sprite.y = it.baseY + Math.sin(st.t * 4 + it.phase) * 6;
        var cx = clamp(it.x, L, R);
        var cy = clamp(it.sprite.y, T, B);
        var dx = it.x - cx;
        var dy = it.sprite.y - cy;
        if (dx * dx + dy * dy < it.r * it.r) {
          ctx.collect(it.x, it.sprite.y);
          it.sprite.destroy();
          continue;
        }
        if (it.x < -40) {
          it.sprite.destroy();
          continue;
        }
        keepItems.push(it);
      }
      st.items = keepItems;

      if (dead) {
        st.player.setTint(0xff7777);
        ctx.gameOver(st.px, hy);
      }
    },
  });

  function jump(ctx, st) {
    if (st.grounded) {
      st.vy = -ctx.config.physics.jumpVelocity;
      st.grounded = false;
      ctx.sfx("jump");
    } else {
      st.jumpBuffer = 0.14; // jump as soon as we land
    }
  }

  function nextInterval(ctx, st, speed) {
    var o = ctx.config.obstacles;
    var base = o.spawnIntervalMs / 1000;
    var j = base * (1 + (ctx.rng() * 2 - 1) * 0.4 * o.variance);
    // Always leave room to land and jump again.
    return Math.max(j, st.airtime + 0.3 + (ctx.size.obstacle.w * 2.2) / speed);
  }

  function spawn(ctx, st, speed, interval) {
    var cfg = ctx.config;
    var s = ctx.scene;
    var ob = ctx.size.obstacle;
    var v = cfg.obstacles.variance;
    var sc = 1 + (ctx.rng() * 2 - 1) * 0.3 * v;
    var w = ob.w * sc;
    var h = ob.h * sc;
    var maxH = Math.max(26, st.apex - 34); // must always be jumpable
    if (h > maxH) {
      w *= maxH / h;
      h = maxH;
    }
    var count = 1;
    if (v > 0.4 && ctx.rng() < (v - 0.4) * 0.8 && st.airtime * speed > w * 2 + 80) count = 2;
    var x = ctx.W + w / 2 + 8;
    var parts = [];
    var inset = w * 0.14;
    for (var i = 0; i < count; i++) {
      var dx = i * w * 0.9;
      var sp = s.add.image(x + dx, ctx.groundY + 2, ctx.tex.obstacle).setOrigin(0.5, 1).setDisplaySize(w, h).setDepth(4);
      parts.push({ sprite: sp, dx: dx, l: dx - w / 2 + inset, r: dx + w / 2 - inset, top: ctx.groundY - h + inset });
    }
    st.obstacles.push({ x: x, w: w * (count === 2 ? 1.9 : 1), h: h, scored: false, parts: parts });

    if (ctx.tex.collectible && ctx.rng() < cfg.scoring.collectibleChance) {
      var ix = x + (speed * interval) / 2;
      var iy = ctx.groundY - (56 + ctx.rng() * Math.max(4, Math.min(st.apex * 0.85, 210) - 56));
      var it = s.add.image(ix, iy, ctx.tex.collectible).setDepth(4.5);
      st.items.push({ sprite: it, x: ix, baseY: iy, phase: ctx.rng() * 6.28, r: Math.max(it.width, it.height) * 0.45 });
    }
  }
})();
