/*
 * Template "shooter": vertical space shooter.
 * Player near the bottom (drag / arrows / A-D), auto-fires upward.
 * Enemies (sprites.obstacle) descend at ctx.speed() with a sideways wobble,
 * take tuning.enemyHp hits; destroying one scores pointsPerObstacle.
 * Enemies that slip past the bottom just vanish. Touching one ends the run.
 * Contract: src/lib/games/TEMPLATE_API.md
 */
(function () {
  "use strict";

  var PLAYER = 48; // nominal display sizes (px, logical 480x720)
  var ENEMY = 48;
  var ITEM = 32;
  var SHOT_W = 8;
  var SHOT_H = 20;
  var SHOT_SPEED = 900;
  var MAX_FALL = 620;

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function hexInt(h) {
    return parseInt(String(h || "#ffffff").slice(1), 16) || 0xffffff;
  }

  /** Display an image at (x, y) fitting inside box w x h, keeping the texture's aspect. */
  function sprite(scene, key, x, y, w, h) {
    var img = scene.add.image(x, y, key);
    var fw = img.width || w;
    var fh = img.height || h;
    var s = Math.min(w / fw, h / fh);
    img.setDisplaySize(fw * s, fh * s);
    return img;
  }

  function overlap(ax, ay, ar, bx, by, br) {
    var dx = ax - bx;
    var dy = ay - by;
    var r = ar + br;
    return dx * dx + dy * dy < r * r;
  }

  function destroyAll(list) {
    for (var i = 0; i < list.length; i++) if (list[i].img) list[i].img.destroy();
    list.length = 0;
  }

  POP.registerTemplate("shooter", {
    titleHint: "DRAG TO MOVE",
    background: true,
    decorDirection: "down", // core: decor drifts down like a starfield

    create: function (ctx) {
      var scene = ctx.scene;
      var c = ctx.config;
      var tu = c.tuning || {};
      var W = ctx.W;
      var H = ctx.H;

      var old = ctx._shooter;
      if (old) {
        destroyAll(old.enemies);
        destroyAll(old.shots);
        destroyAll(old.items);
        if (old.player) old.player.destroy();
      }

      var st = {
        moveSpeed: tu.playerSpeed || 420,
        fireMs: tu.fireRateMs || 280,
        hp: tu.enemyHp || 1,
        enemies: [],
        shots: [],
        items: [],
        fireIn: 0.15,
        shotCount: 0,
        spawnIn: 0.6,
        t: 0,
      };
      ctx._shooter = st;

      st.player = sprite(scene, ctx.tex.player, W / 2, H - 110, PLAYER, PLAYER).setDepth(5);
      st.pw = st.player.displayWidth;
      st.ph = st.player.displayHeight;
      st.pr = Math.min(st.pw, st.ph) * 0.32; // forgiving hitbox
      st.minX = st.pw / 2 + 6;
      st.maxX = W - st.pw / 2 - 6;
      ctx.trail(st.player);
    },

    update: function (ctx, dtMs) {
      var st = ctx._shooter;
      if (!st) return;
      var scene = ctx.scene;
      var c = ctx.config;
      var W = ctx.W;
      var H = ctx.H;
      var dt = Math.min(dtMs / 1000, 0.05);
      var inp = ctx.input || {};
      var p = st.player;
      st.t += dt;
      var elapsed = (ctx.elapsedMs || 0) / 1000;
      var fall = Math.min(ctx.speed(), MAX_FALL);

      // ---- movement: drag follows the pointer, keys move at playerSpeed
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
      p.setAngle(clamp(vx * 0.02, -14, 14));

      // ---- auto-fire
      st.fireIn -= dt;
      if (st.fireIn <= 0) {
        st.fireIn += st.fireMs / 1000;
        if (st.fireIn < 0) st.fireIn = st.fireMs / 1000;
        var sx = p.x;
        var sy = p.y - st.ph / 2;
        var shot;
        if (ctx.tex.projectile) shot = sprite(scene, ctx.tex.projectile, sx, sy, SHOT_W * 1.5, SHOT_H);
        else shot = scene.add.rectangle(sx, sy, 6, 18, hexInt(c.palette.accent)).setStrokeStyle(2, 0xffffff, 0.6);
        shot.setDepth(4);
        st.shots.push({ img: shot, r: 7 });
        if (st.shotCount++ % 3 === 0) ctx.sfx("shoot"); // every 3rd shot: audible but not noisy
      }

      // ---- spawning (slightly faster over time)
      st.spawnIn -= dt;
      if (st.spawnIn <= 0) {
        var ob = c.obstacles;
        var base = (ob.spawnIntervalMs / 1000) * Math.max(0.6, 1 - elapsed * 0.01);
        var jitter = 1 + (ctx.rng() * 2 - 1) * 0.4 * ob.variance;
        st.spawnIn = Math.max(0.28, base * jitter);
        spawnEnemy(ctx, st);
        if (ctx.tex.collectible && ctx.rng() < c.scoring.collectibleChance) spawnItem(ctx, st);
      }

      // ---- shots
      var keepShots = [];
      for (var i = 0; i < st.shots.length; i++) {
        var s = st.shots[i];
        s.img.y -= SHOT_SPEED * dt;
        if (s.img.y < -30) s.img.destroy();
        else keepShots.push(s);
      }
      st.shots = keepShots;

      // ---- enemies
      var keep = [];
      for (var j = 0; j < st.enemies.length; j++) {
        var e = st.enemies[j];
        e.y += fall * e.mult * dt;
        e.img.y = e.y;
        e.img.x = clamp(e.baseX + Math.sin(st.t * e.freq + e.phase) * e.amp, e.w / 2, W - e.w / 2);

        // bullets
        for (var k = 0; k < st.shots.length && e.hp > 0; k++) {
          var sh = st.shots[k];
          if (!sh.img.active) continue;
          if (overlap(sh.img.x, sh.img.y, sh.r, e.img.x, e.y, e.r)) {
            sh.img.destroy();
            e.hp--;
            if (e.hp > 0) {
              ctx.vfx("shoot", sh.img.x, sh.img.y);
              e.img.setTintFill(0xffffff);
              e.flash = 0.07;
            }
          }
        }
        if (e.hp <= 0) {
          ctx.addScore(c.scoring.pointsPerObstacle, e.img.x, e.y);
          e.img.destroy();
          continue;
        }
        if (e.flash > 0) {
          e.flash -= dt;
          if (e.flash <= 0) e.img.clearTint();
        }

        // player
        if (overlap(p.x, p.y, st.pr, e.img.x, e.y, e.r)) {
          ctx.gameOver(p.x, p.y);
          return;
        }
        if (e.y - e.h / 2 > H + 10) e.img.destroy(); // slipped past: forgiving, no penalty
        else keep.push(e);
      }
      st.enemies = keep;
      st.shots = st.shots.filter(function (sh) {
        return sh.img.active;
      });

      // ---- collectibles
      var keepItems = [];
      for (var m = 0; m < st.items.length; m++) {
        var it = st.items[m];
        it.img.y += fall * 0.75 * dt;
        it.img.x = it.baseX + Math.sin(st.t * 3 + it.phase) * 14;
        it.img.setAngle(Math.sin(st.t * 4 + it.phase) * 12);
        if (overlap(p.x, p.y, st.pr + 6, it.img.x, it.img.y, it.r)) {
          ctx.collect(it.img.x, it.img.y);
          it.img.destroy();
          continue;
        }
        if (it.img.y > H + 30) it.img.destroy();
        else keepItems.push(it);
      }
      st.items = keepItems;
    },
  });

  function spawnEnemy(ctx, st) {
    var v = ctx.config.obstacles.variance;
    var W = ctx.W;
    var img = sprite(ctx.scene, ctx.tex.obstacle, 0, -40, ENEMY, ENEMY).setDepth(3);
    var w = img.displayWidth;
    var h = img.displayHeight;
    var amp = 12 + 70 * v * ctx.rng();
    var margin = w / 2 + amp + 4;
    var baseX = margin + ctx.rng() * Math.max(1, W - margin * 2);
    img.x = baseX;
    img.y = -h / 2;
    st.enemies.push({
      img: img,
      baseX: baseX,
      y: -h / 2,
      w: w,
      h: h,
      r: Math.min(w, h) * 0.36,
      hp: st.hp,
      amp: amp,
      freq: 1.4 + ctx.rng() * 1.8,
      phase: ctx.rng() * Math.PI * 2,
      mult: 0.85 + ctx.rng() * 0.3 * (0.5 + v),
      flash: 0,
    });
  }

  function spawnItem(ctx, st) {
    var W = ctx.W;
    var img = sprite(ctx.scene, ctx.tex.collectible, 0, -30, ITEM, ITEM).setDepth(3.5);
    var baseX = 40 + ctx.rng() * (W - 80);
    img.x = baseX;
    img.y = -img.displayHeight / 2 - 40;
    st.items.push({ img: img, baseX: baseX, phase: ctx.rng() * 6.28, r: Math.max(img.displayWidth, img.displayHeight) * 0.45 });
  }
})();
