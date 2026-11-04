/* Flappy template: tap to flap through pipe pairs. See src/lib/games/TEMPLATE_API.md. */
(function () {
  "use strict";
  if (!window.POP) return;
  var clamp = POP.util.clamp;

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
      });
      st.player = s.add.image(st.px, st.py, ctx.tex.player).setDepth(5);
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
    },

    update: function (ctx, dtMs) {
      var dt = dtMs / 1000;
      var st = ctx.flappy;
      var cfg = ctx.config;
      var s = ctx.scene;
      var speed = ctx.speed();
      var pw = ctx.size.player.w;
      var ph = ctx.size.player.h;
      st.t += dt;

      // player
      st.vy += cfg.physics.gravity * dt;
      st.py += st.vy * dt;
      if (st.py < 14) {
        st.py = 14;
        st.vy = Math.max(st.vy, 0);
      }
      var target = clamp(st.vy * 0.07, -25, 80);
      st.player.setAngle(st.player.angle + (target - st.player.angle) * Math.min(1, dt * 10));
      st.player.y = st.py;

      // spawn
      st.spawnIn -= dt;
      if (st.spawnIn <= 0) {
        var interval = nextInterval(ctx, speed);
        spawnPipes(ctx, st, speed, interval);
        st.spawnIn = interval;
      }

      // player hitbox
      var hw = pw * 0.34;
      var hh = ph * 0.34;
      var L = st.px - hw;
      var R = st.px + hw;
      var T = st.py - hh;
      var B = st.py + hh;
      var dead = false;

      var keep = [];
      for (var i = 0; i < st.pipes.length; i++) {
        var o = st.pipes[i];
        o.x -= speed * dt;
        o.top.x = o.x;
        o.bot.x = o.x;
        var l = o.x - o.w / 2 + o.w * 0.08;
        var r = o.x + o.w / 2 - o.w * 0.08;
        if (R > l && L < r && (T < o.gapTop - 2 || B > o.gapBot + 2)) dead = true;
        if (!o.scored && o.x + o.w / 2 < L) {
          o.scored = true;
          ctx.addScore(cfg.scoring.pointsPerObstacle, o.x + o.w / 2, (o.gapTop + o.gapBot) / 2);
        }
        if (o.x + o.w < -40) {
          o.top.destroy();
          o.bot.destroy();
        } else keep.push(o);
      }
      st.pipes = keep;

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

      if (B >= ctx.groundY) dead = true;
      if (dead) {
        st.player.setTint(0xff7777);
        ctx.gameOver(st.px, st.py);
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
    st.pipes.push({ x: x, w: w, gapTop: gapTop, gapBot: gapBot, top: top, bot: bot, scored: false });

    if (ctx.tex.collectible && ctx.rng() < cfg.scoring.collectibleChance) {
      var ix = x + (speed * interval) / 2;
      var iy = clamp(center + (ctx.rng() - 0.5) * 0.5 * gap, 60, ctx.groundY - 60);
      var sp = s.add.image(ix, iy, ctx.tex.collectible).setDepth(4.5);
      st.items.push({ sprite: sp, x: ix, baseY: iy, phase: ctx.rng() * 6.28, r: Math.max(sp.width, sp.height) * 0.45 });
    }
  }
})();
