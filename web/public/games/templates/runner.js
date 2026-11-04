/* Runner template: tap to jump over ground obstacles. See src/lib/games/TEMPLATE_API.md. */
(function () {
  "use strict";
  if (!window.POP) return;
  var clamp = POP.util.clamp;
  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  var COYOTE = 0.09; // s of grace to still jump after leaving the ground
  var BUFFER = 0.12; // s a press is remembered before landing
  var HOLD_MAX = 0.2; // s of "hold for a higher jump"
  var HOLD_GRAV = 0.5; // gravity multiplier while holding (rising only)

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
    s.tweens.add({ targets: t, y: y - 46, alpha: 0, duration: 700, delay: 120, ease: "Quad.easeIn", onComplete: function () { t.destroy(); } });
  }
  function nearMiss(ctx, x, y) {
    if (ctx.nearMiss) ctx.nearMiss(x, y);
    else popText(ctx, "CLOSE!", x, y - 30, { size: 20, color: ctx.palette.accent, kind: "meme" });
  }
  function held(inp) {
    return !!(inp && (inp.pointerDown || inp.up || inp.action));
  }

  POP.registerTemplate("runner", {
    titleHint: "TAP TO JUMP",
    groundY: 610,
    sizes: { obstacle: { w: 52, h: 68 } },

    create: function (ctx) {
      var s = ctx.scene;
      ctx.drawGround();
      var g = ctx.config.physics.gravity;
      var jv = ctx.config.physics.jumpVelocity;
      var pw = ctx.size.player.w;
      var st = (ctx.runner = {
        px: 110,
        py: ctx.groundY,
        vy: 0,
        grounded: true,
        coyote: 0,
        jumpBuffer: 0,
        hold: 0,
        obstacles: [],
        items: [],
        spawnIn: 1.0,
        t: 0,
        lastNear: -9,
        apex: (jv * jv) / (2 * g), // tap jump: obstacles are always clearable with this
        airtime: (2 * jv) / g,
      });
      // a held jump floats a bit longer: leave room for it in the spacing
      st.airtimeMax = st.airtime + HOLD_MAX * (1 - HOLD_GRAV) * 1.6;
      st.shadow = s.add.ellipse(st.px, ctx.groundY + 3, pw * 0.8, 10, 0x000000, 0.25).setDepth(3.5);
      st.player = s.add.image(st.px, st.py, ctx.tex.player).setOrigin(0.5, 1).setDepth(5);
      st.dust = ctx.trail(st.player);
      var gc = POP.util.hexToInt(POP.util.shade(ctx.palette.ground, 0.35));
      st.puff = s.add
        .particles(0, 0, "pop_dot", {
          emitting: false,
          speedX: { min: -140, max: 40 },
          speedY: { min: -70, max: -10 },
          scale: { start: 0.9, end: 0 },
          alpha: { start: 0.7, end: 0 },
          lifespan: { min: 240, max: 420 },
          tint: [gc, 0xffffff],
        })
        .setDepth(4.6);
    },

    idle: function (ctx, dtMs) {
      var st = ctx.runner;
      st.t += dtMs / 1000;
      st.player.y = ctx.groundY - Math.abs(Math.sin(st.t * 6)) * 6;
    },

    onInput: function (ctx) {
      var st = ctx.runner;
      if (!tryJump(ctx, st)) st.jumpBuffer = BUFFER;
    },

    update: function (ctx, dtMs) {
      var dt = dtMs / 1000;
      var st = ctx.runner;
      var cfg = ctx.config;
      var s = ctx.scene;
      var speed = ctx.speed();
      var pw = ctx.size.player.w;
      var ph = ctx.size.player.h;
      var p = st.player;
      st.t += dt;

      // player
      st.jumpBuffer -= dt;
      if (st.grounded) st.coyote = COYOTE;
      else st.coyote -= dt;
      if (!st.grounded) {
        var gmul = 1;
        if (st.vy < 0 && st.hold > 0) {
          if (held(ctx.input)) {
            st.hold -= dt;
            gmul = HOLD_GRAV;
          } else st.hold = 0; // released: normal arc from here
        }
        st.vy += cfg.physics.gravity * gmul * dt;
        st.py += st.vy * dt;
        if (st.py >= ctx.groundY) {
          var impact = st.vy;
          st.py = ctx.groundY;
          st.vy = 0;
          st.grounded = true;
          land(ctx, st, impact);
          if (st.jumpBuffer > 0) {
            st.jumpBuffer = 0;
            tryJump(ctx, st);
          }
        }
      }
      var bob = st.grounded ? Math.abs(Math.sin(st.t * 16)) * 3 : 0;
      p.y = st.py - bob;
      var tilt = st.grounded ? Math.sin(st.t * 16) * 3 : clamp(st.vy * 0.02, -14, 16);
      p.setAngle(p.angle + (tilt - p.angle) * Math.min(1, dt * 14));
      // shadow shrinks with height
      var hgt = ctx.groundY - st.py;
      var sh = clamp(1 - hgt / 260, 0.35, 1);
      st.shadow.setScale(sh, sh);
      st.shadow.setAlpha(0.28 * sh);

      // spawn
      st.spawnIn -= dt;
      if (st.spawnIn <= 0) {
        var interval = nextInterval(ctx, st, speed);
        spawn(ctx, st, speed, interval);
        st.spawnIn = interval;
      }

      // hitbox (60% wide, 80% tall of the sprite; works for any aspect)
      var hy = st.py - ph / 2;
      var hw = pw * 0.3;
      var hh = ph * 0.4;
      var L = st.px - hw;
      var R = st.px + hw;
      var T = hy - hh;
      var B = hy + hh;
      var dead = false;

      var n = 0;
      for (var i = 0; i < st.obstacles.length; i++) {
        var o = st.obstacles[i];
        o.x -= speed * dt;
        for (var j = 0; j < o.parts.length; j++) {
          var pt = o.parts[j];
          pt.sprite.x = o.x + pt.dx;
          pt.sprite.scaleY = pt.sy * (1 + Math.sin(st.t * 6 + pt.ph) * 0.04);
          pt.sprite.scaleX = pt.sx * (1 - Math.sin(st.t * 6 + pt.ph) * 0.03);
          pt.shadow.x = pt.sprite.x;
          if (R > o.x + pt.l && L < o.x + pt.r) {
            if (B > pt.top) dead = true;
            else if (pt.top - B < o.minClr) o.minClr = pt.top - B;
          }
        }
        if (!o.scored && o.x + o.w / 2 < L) {
          o.scored = true;
          ctx.addScore(cfg.scoring.pointsPerObstacle, o.x, ctx.groundY - o.h - 10);
          if (o.minClr < 14 && st.t - st.lastNear > 0.4) {
            st.lastNear = st.t;
            nearMiss(ctx, st.px, hy);
          }
        }
        if (o.x + o.w < -40) {
          for (var d = 0; d < o.parts.length; d++) {
            o.parts[d].sprite.destroy();
            o.parts[d].shadow.destroy();
          }
        } else st.obstacles[n++] = o;
      }
      st.obstacles.length = n;

      n = 0;
      for (var k = 0; k < st.items.length; k++) {
        var it = st.items[k];
        it.x -= speed * dt;
        it.sprite.x = it.x;
        it.sprite.y = it.baseY + Math.sin(st.t * 4 + it.phase) * 6;
        it.sprite.setScale(1 + Math.sin(st.t * 7 + it.phase) * 0.08);
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
        st.items[n++] = it;
      }
      st.items.length = n;

      if (dead) {
        p.setTint(0xff7777);
        if (ctx.hitstop) ctx.hitstop(70);
        ctx.gameOver(st.px, hy);
        s.tweens.killTweensOf(p);
        p.setScale(1);
        s.tweens.add({ targets: p, x: st.px - 40, angle: -100, duration: 420, ease: "Quad.easeOut" });
        s.tweens.add({ targets: p, y: st.py - 70, duration: 200, yoyo: true, ease: "Quad.easeOut" });
      }
    },
  });

  function tryJump(ctx, st) {
    if (!(st.grounded || st.coyote > 0)) return false;
    st.vy = -ctx.config.physics.jumpVelocity;
    st.grounded = false;
    st.coyote = 0;
    st.jumpBuffer = 0;
    st.hold = HOLD_MAX;
    ctx.sfx("jump");
    var s = ctx.scene;
    var p = st.player;
    s.tweens.killTweensOf(p);
    p.setScale(0.78, 1.25);
    s.tweens.add({ targets: p, scaleX: 1, scaleY: 1, duration: 280, ease: "Quad.easeOut" });
    st.puff.explode(4, st.px, ctx.groundY);
    return true;
  }

  function land(ctx, st, impact) {
    var s = ctx.scene;
    var p = st.player;
    var k = clamp(impact / ctx.config.physics.jumpVelocity, 0.4, 1.2);
    s.tweens.killTweensOf(p);
    p.setScale(1 + 0.3 * k, 1 - 0.28 * k);
    s.tweens.add({ targets: p, scaleX: 1, scaleY: 1, duration: 220, ease: "Back.easeOut" });
    st.puff.explode(Math.round(4 + 4 * k), st.px, ctx.groundY);
  }

  function nextInterval(ctx, st, speed) {
    var o = ctx.config.obstacles;
    var base = o.spawnIntervalMs / 1000;
    var j = base * (1 + (ctx.rng() * 2 - 1) * 0.4 * o.variance);
    // Always leave room to land and jump again (even after a held, floatier jump).
    return Math.max(j, st.airtimeMax + 0.3 + (ctx.size.obstacle.w * 2.2) / speed);
  }

  function spawn(ctx, st, speed, interval) {
    var cfg = ctx.config;
    var s = ctx.scene;
    var ob = ctx.size.obstacle;
    var v = cfg.obstacles.variance;
    var sc = 1 + (ctx.rng() * 2 - 1) * 0.3 * v;
    var w = ob.w * sc;
    var h = ob.h * sc;
    var maxH = Math.max(26, st.apex - 34); // must always be jumpable with a plain tap
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
      var shd = s.add.ellipse(x + dx, ctx.groundY + 3, w * 0.95, 10, 0x000000, 0.25).setDepth(3.5);
      var sp = s.add.image(x + dx, ctx.groundY + 2, ctx.tex.obstacle).setOrigin(0.5, 1).setDisplaySize(w, h).setDepth(4);
      parts.push({ sprite: sp, shadow: shd, sx: sp.scaleX, sy: sp.scaleY, ph: ctx.rng() * 6.28, dx: dx, l: dx - w / 2 + inset, r: dx + w / 2 - inset, top: ctx.groundY - h + inset });
    }
    st.obstacles.push({ x: x, w: w * (count === 2 ? 1.9 : 1), h: h, scored: false, parts: parts, minClr: 1e9 });

    if (ctx.tex.collectible && ctx.rng() < cfg.scoring.collectibleChance) {
      var ix = x + (speed * interval) / 2;
      var iy = ctx.groundY - (56 + ctx.rng() * Math.max(4, Math.min(st.apex * 0.85, 210) - 56));
      var it = s.add.image(ix, iy, ctx.tex.collectible).setDepth(4.5);
      st.items.push({ sprite: it, x: ix, baseY: iy, phase: ctx.rng() * 6.28, r: Math.max(it.width, it.height) * 0.45 });
    }
  }
})();
