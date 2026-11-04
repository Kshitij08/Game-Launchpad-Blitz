/* Flappy template: tap to flap through pipe pairs. See src/lib/games/TEMPLATE_API.md. */
(function () {
  "use strict";
  if (!window.POP) return;
  var clamp = POP.util.clamp;
  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  // ---- juice helpers: prefer core's (ctx.popup / nearMiss / shake / hitstop), fall back locally
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
    else popText(ctx, "CLOSE!", x, y - 34, { size: 20, color: ctx.palette.accent, kind: "meme" });
  }
  function puffEmitter(s, tint) {
    return s.add
      .particles(0, 0, "pop_dot", {
        emitting: false,
        speed: { min: 30, max: 110 },
        angle: { min: 120, max: 200 },
        scale: { start: 0.7, end: 0 },
        alpha: { start: 0.8, end: 0 },
        lifespan: { min: 220, max: 380 },
        tint: tint,
      })
      .setDepth(4.8);
  }

  POP.registerTemplate("flappy", {
    titleHint: "TAP TO FLY",
    groundY: 660,
    sizes: { obstacle: { w: 72, h: 620, mode: "width" } },

    create: function (ctx) {
      var s = ctx.scene;
      ctx.drawGround();
      var st = (ctx.flappy = {
        px: 140,
        py: ctx.phase === "title" ? ctx.H * 0.66 : ctx.H * 0.42,
        vy: 0,
        pipes: [],
        items: [],
        lastCenter: null,
        spawnIn: 0.8,
        t: 0,
        lastNear: -9,
      });
      st.player = s.add.image(st.px, st.py, ctx.tex.player).setDepth(5);
      st.puff = puffEmitter(s, [0xffffff, POP.util.hexToInt(POP.util.shade(ctx.palette.accent, 0.5))]);
      ctx.trail(st.player);
    },

    idle: function (ctx, dtMs) {
      var st = ctx.flappy;
      st.t += dtMs / 1000;
      st.player.y = st.py + Math.sin(st.t * 3) * 10;
      st.player.setAngle(Math.sin(st.t * 3 + 1) * 6);
    },

    onInput: function (ctx) {
      var st = ctx.flappy;
      if (st.py === ctx.H * 0.66) st.py = ctx.H * 0.42; // defensive: never start from the title spot
      st.vy = -ctx.config.physics.jumpVelocity;
      ctx.sfx("jump");
      // stretch on flap, settle back
      var p = st.player;
      var s = ctx.scene;
      s.tweens.killTweensOf(p);
      p.setScale(0.78, 1.28);
      s.tweens.add({ targets: p, scaleX: 1, scaleY: 1, duration: 260, ease: "Back.easeOut" });
      st.puff.explode(5, st.px - ctx.size.player.w * 0.3, st.py + ctx.size.player.h * 0.2);
    },

    update: function (ctx, dtMs) {
      var dt = dtMs / 1000;
      var st = ctx.flappy;
      var cfg = ctx.config;
      var speed = ctx.speed();
      var pw = ctx.size.player.w;
      var ph = ctx.size.player.h;
      st.t += dt;

      // player
      st.vy += cfg.physics.gravity * dt;
      st.py += st.vy * dt;
      // gentle ceiling: soft bump instead of a sticky wall
      var ceil = ph * 0.4 + 6;
      if (st.py < ceil) {
        st.py = ceil;
        if (st.vy < 0) st.vy = Math.min(120, -st.vy * 0.25);
      }
      // nose up while rising, ease into a dive while falling
      var jv = cfg.physics.jumpVelocity;
      var target = st.vy < 0 ? -24 : clamp(-24 + (st.vy / jv) * 70, -24, 70);
      var rate = target < st.player.angle ? 16 : 5;
      st.player.setAngle(st.player.angle + (target - st.player.angle) * Math.min(1, dt * rate));
      st.player.y = st.py;

      // spawn
      st.spawnIn -= dt;
      if (st.spawnIn <= 0) {
        var interval = nextInterval(ctx, speed);
        spawnPipes(ctx, st, speed, interval);
        st.spawnIn = interval;
      }

      // player hitbox (68% of sprite, independent of aspect ratio)
      var hw = pw * 0.34;
      var hh = ph * 0.34;
      var L = st.px - hw;
      var R = st.px + hw;
      var T = st.py - hh;
      var B = st.py + hh;
      var dead = false;

      var n = 0;
      for (var i = 0; i < st.pipes.length; i++) {
        var o = st.pipes[i];
        o.x -= speed * dt;
        o.top.x = o.x;
        o.bot.x = o.x;
        o.top.y = o.gapTop - o.off;
        o.bot.y = o.gapBot + o.off;
        var l = o.x - o.w / 2 + o.w * 0.08;
        var r = o.x + o.w / 2 - o.w * 0.08;
        if (R > l && L < r) {
          if (T < o.gapTop - 2 || B > o.gapBot + 2) dead = true;
          else {
            var clr = Math.min(T - o.gapTop, o.gapBot - B);
            if (clr < o.minClr) o.minClr = clr;
          }
        }
        if (!o.scored && o.x + o.w / 2 < L) {
          o.scored = true;
          ctx.addScore(cfg.scoring.pointsPerObstacle, o.x + o.w / 2, (o.gapTop + o.gapBot) / 2);
          if (o.minClr < 12 && st.t - st.lastNear > 0.4) {
            st.lastNear = st.t;
            nearMiss(ctx, st.px, st.py);
          }
        }
        if (o.x + o.w < -40) {
          o.top.destroy();
          o.bot.destroy();
        } else st.pipes[n++] = o;
      }
      st.pipes.length = n;

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
          ctx.scene.tweens.add({ targets: st.player, scaleX: 1.18, scaleY: 1.18, duration: 70, yoyo: true });
          continue;
        }
        if (it.x < -40) {
          it.sprite.destroy();
          continue;
        }
        st.items[n++] = it;
      }
      st.items.length = n;

      if (B >= ctx.groundY) dead = true;
      if (dead) {
        var p = st.player;
        p.setTint(0xff7777);
        if (ctx.hitstop) ctx.hitstop(70);
        ctx.gameOver(st.px, st.py);
        // tumble to the ground
        var s = ctx.scene;
        s.tweens.killTweensOf(p);
        p.setScale(1);
        s.tweens.add({ targets: p, y: ctx.groundY - ph * 0.4, angle: 90, duration: Math.max(120, (ctx.groundY - st.py) * 1.4), ease: "Quad.easeIn" });
      }
    },
  });

  function nextInterval(ctx, speed) {
    var o = ctx.config.obstacles;
    var base = o.spawnIntervalMs / 1000;
    var j = base * (1 + (ctx.rng() * 2 - 1) * 0.4 * o.variance);
    return Math.max(j, (ctx.size.obstacle.w + 150) / speed);
  }

  function spawnPipes(ctx, st, speed, interval) {
    var cfg = ctx.config;
    var s = ctx.scene;
    var gap = cfg.obstacles.gapSize;
    var margin = 60;
    var minC = margin + gap / 2;
    var maxC = ctx.groundY - margin - gap / 2;
    var mid = (minC + maxC) / 2;
    var half = (maxC - minC) / 2;
    var center = mid + (ctx.rng() * 2 - 1) * half * cfg.obstacles.variance;
    if (st.lastCenter !== null) center = clamp(center, st.lastCenter - 240, st.lastCenter + 240);
    center = clamp(center, minC, maxC);
    st.lastCenter = center;

    var w = ctx.size.obstacle.w;
    var ph = Math.max(ctx.size.obstacle.h, 640);
    var x = ctx.W + w / 2 + 8;
    var gapTop = center - gap / 2;
    var gapBot = center + gap / 2;
    var top = s.add.image(x, gapTop, ctx.tex.obstacle).setOrigin(0.5, 1).setFlipY(true).setDisplaySize(w, ph).setDepth(2);
    var bot = s.add.image(x, gapBot, ctx.tex.obstacle).setOrigin(0.5, 0).setDisplaySize(w, ph).setDepth(2);
    // pipes slam shut into place as they enter (visual only; still off to the right of the player)
    var o = { x: x, w: w, gapTop: gapTop, gapBot: gapBot, top: top, bot: bot, scored: false, off: 70, minClr: 1e9 };
    s.tweens.add({ targets: o, off: 0, duration: 420, ease: "Back.easeOut" });
    st.pipes.push(o);

    if (ctx.tex.collectible && ctx.rng() < cfg.scoring.collectibleChance) {
      var ix = x + (speed * interval) / 2;
      var iy = clamp(center + (ctx.rng() - 0.5) * 0.5 * gap, 60, ctx.groundY - 60);
      var sp = s.add.image(ix, iy, ctx.tex.collectible).setDepth(4.5);
      st.items.push({ sprite: sp, x: ix, baseY: iy, phase: ctx.rng() * 6.28, r: Math.max(sp.width, sp.height) * 0.45 });
    }
  }
})();
