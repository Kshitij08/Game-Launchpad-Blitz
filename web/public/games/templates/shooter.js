/*
 * Template "shooter": vertical space shooter.
 * Player near the bottom (drag / arrows / A-D), auto-fires upward.
 * Enemies (sprites.obstacle) descend at ctx.speed() with a sideways wobble,
 * take tuning.enemyHp hits; destroying one scores pointsPerObstacle.
 * Every ~10 s a formation (V or line with a hole) flies in; every ~15 s an
 * elite (bigger, +2 hp, worth 3x). Enemies that slip past just vanish.
 * Touching one ends the run.
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
  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

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
    s.tweens.add({ targets: t, y: y - 46, alpha: 0, duration: 700, delay: 120, ease: "Quad.easeIn", onComplete: function () { t.destroy(); } });
  }
  function nearMiss(ctx, x, y) {
    if (ctx.nearMiss) ctx.nearMiss(x, y);
    else popText(ctx, "CLOSE!", x, y - 40, { size: 20, color: ctx.palette.accent, kind: "meme" });
  }
  function shake(ctx, a) {
    if (ctx.shake) ctx.shake(a);
    else ctx.scene.cameras.main.shake(90, 0.002 + 0.01 * a);
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
      var accent = hexInt(c.palette.accent);

      var st = {
        moveSpeed: tu.playerSpeed || 420,
        fireMs: tu.fireRateMs || 280,
        hp: tu.enemyHp || 1,
        enemies: [],
        shots: [], // pool: {img, glow, active}
        items: [],
        fireIn: 0.15,
        shotCount: 0,
        spawnIn: 0.6,
        formationIn: 9,
        eliteIn: 15,
        t: 0,
        recoil: 0,
        lastNear: -9,
        lastKill: -9,
        chain: 0,
        accent: accent,
      };
      ctx._shooter = st;

      st.baseY = H - 110;
      st.player = sprite(scene, ctx.tex.player, W / 2, st.baseY, PLAYER, PLAYER).setDepth(5);
      st.pw = st.player.displayWidth;
      st.ph = st.player.displayHeight;
      st.psx = st.player.scaleX;
      st.psy = st.player.scaleY;
      st.pr = Math.min(st.pw, st.ph) * 0.32; // forgiving hitbox
      st.minX = st.pw / 2 + 6;
      st.maxX = W - st.pw / 2 - 6;
      ctx.trail(st.player);

      st.muzzle = scene.add.image(W / 2, st.baseY - st.ph / 2, "pop_dot").setDepth(5.5).setBlendMode("ADD").setTint(0xffffff).setAlpha(0);
      st.kill = scene.add
        .particles(0, 0, "pop_dot", {
          emitting: false,
          speed: { min: 80, max: 300 },
          scale: { start: 1.2, end: 0 },
          alpha: { start: 1, end: 0 },
          lifespan: { min: 250, max: 520 },
          blendMode: "ADD",
          tint: [accent, 0xffffff, 0xffd23f],
        })
        .setDepth(6);
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
      var bank = clamp(vx * 0.03, -18, 18);
      p.setAngle(p.angle + (bank - p.angle) * Math.min(1, dt * 12));
      st.recoil = Math.max(0, st.recoil - dt * 60);
      p.y = st.baseY + st.recoil;

      // ---- auto-fire
      st.fireIn -= dt;
      if (st.fireIn <= 0) {
        st.fireIn += st.fireMs / 1000;
        if (st.fireIn < 0) st.fireIn = st.fireMs / 1000;
        fire(ctx, st, p.x, p.y - st.ph / 2);
        if (st.shotCount++ % 3 === 0) ctx.sfx("shoot"); // every 3rd shot: audible but not noisy
      }
      if (st.muzzle.alpha > 0) {
        st.muzzle.setAlpha(Math.max(0, st.muzzle.alpha - dt * 14));
        st.muzzle.x = p.x;
        st.muzzle.y = p.y - st.ph / 2 - 4;
      }

      // ---- spawning (slightly faster over time), formations and elites
      st.spawnIn -= dt;
      st.formationIn -= dt;
      st.eliteIn -= dt;
      if (st.formationIn <= 0) {
        st.formationIn = 9 + ctx.rng() * 4;
        spawnFormation(ctx, st);
        st.spawnIn = Math.max(st.spawnIn, 1.4);
      } else if (st.eliteIn <= 0) {
        st.eliteIn = 14 + ctx.rng() * 3;
        spawnEnemy(ctx, st, null, true);
        st.spawnIn = Math.max(st.spawnIn, 0.9);
      } else if (st.spawnIn <= 0) {
        var ob = c.obstacles;
        var base = (ob.spawnIntervalMs / 1000) * Math.max(0.6, 1 - elapsed * 0.01);
        var jitter = 1 + (ctx.rng() * 2 - 1) * 0.4 * ob.variance;
        st.spawnIn = Math.max(0.28, base * jitter);
        spawnEnemy(ctx, st, null, false);
        if (ctx.tex.collectible && ctx.rng() < c.scoring.collectibleChance) spawnItem(ctx, st);
      }

      // ---- shots (pooled)
      for (var i = 0; i < st.shots.length; i++) {
        var s = st.shots[i];
        if (!s.active) continue;
        s.img.y -= SHOT_SPEED * dt;
        s.glow.x = s.img.x;
        s.glow.y = s.img.y + 14;
        if (s.img.y < -30) release(s);
      }

      // ---- enemies
      var n = 0;
      for (var j = 0; j < st.enemies.length; j++) {
        var e = st.enemies[j];
        if (e.kb < 0) e.kb = Math.min(0, e.kb + 900 * dt);
        e.y += (fall * e.mult + e.kb) * dt;
        e.img.y = e.y;
        e.img.x = clamp(e.baseX + Math.sin(st.t * e.freq + e.phase) * e.amp, e.w / 2, W - e.w / 2);
        if (e.elite) e.img.angle = Math.sin(st.t * 3 + e.phase) * 10;

        // bullets
        for (var k = 0; k < st.shots.length && e.hp > 0; k++) {
          var sh = st.shots[k];
          if (!sh.active) continue;
          if (overlap(sh.img.x, sh.img.y, 7, e.img.x, e.y, e.r)) {
            var hx = sh.img.x;
            var hy = sh.img.y;
            release(sh);
            e.hp--;
            if (e.hp > 0) {
              ctx.vfx("shoot", hx, hy);
              e.img.setTintFill(0xffffff);
              e.flash = 0.06;
              e.kb = -170;
              e.img.setScale(e.sx * 1.15, e.sy * 0.88);
            }
          }
        }
        if (e.hp <= 0) {
          killEnemy(ctx, st, e);
          continue;
        }
        if (e.flash > 0) {
          e.flash -= dt;
          if (e.flash <= 0) {
            if (e.elite) e.img.setTint(st.accent);
            else e.img.clearTint();
            e.img.setScale(e.sx, e.sy);
          }
        }

        // player
        if (overlap(p.x, p.y, st.pr, e.img.x, e.y, e.r)) {
          if (ctx.hitstop) ctx.hitstop(80);
          ctx.gameOver(p.x, p.y);
          scene.tweens.add({ targets: p, angle: p.angle + 200, alpha: 0, scaleX: st.psx * 0.3, scaleY: st.psy * 0.3, duration: 450, ease: "Quad.easeOut" });
          return;
        }
        // near miss: enemy passes the ship's line close by
        if (!e.passed && e.y > p.y) {
          e.passed = true;
          var gx = Math.abs(e.img.x - p.x) - (st.pr + e.r);
          if (gx < 16 && st.t - st.lastNear > 0.5) {
            st.lastNear = st.t;
            nearMiss(ctx, p.x, p.y);
          }
        }
        if (e.y - e.h / 2 > H + 10) e.img.destroy(); // slipped past: forgiving, no penalty
        else st.enemies[n++] = e;
      }
      st.enemies.length = n;

      // ---- collectibles
      n = 0;
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
        else st.items[n++] = it;
      }
      st.items.length = n;
    },
  });

  function fire(ctx, st, x, y) {
    var shot = null;
    for (var i = 0; i < st.shots.length; i++) {
      if (!st.shots[i].active) {
        shot = st.shots[i];
        break;
      }
    }
    if (!shot) {
      var scene = ctx.scene;
      var img;
      if (ctx.tex.projectile) img = sprite(scene, ctx.tex.projectile, x, y, SHOT_W * 1.5, SHOT_H);
      else img = scene.add.rectangle(x, y, 6, 18, st.accent).setStrokeStyle(2, 0xffffff, 0.6);
      img.setDepth(4);
      var glow = scene.add.image(x, y, "pop_dot").setDepth(3.9).setBlendMode("ADD").setTint(st.accent).setAlpha(0.7).setScale(1.1, 2.6);
      shot = { img: img, glow: glow, active: false };
      st.shots.push(shot);
    }
    shot.active = true;
    shot.img.setPosition(x, y).setVisible(true);
    shot.glow.setPosition(x, y + 14).setVisible(true);
    // muzzle flash + recoil
    st.muzzle.setAlpha(1).setScale(1.6 + Math.random() * 0.6);
    st.recoil = 5;
  }

  function release(s) {
    s.active = false;
    s.img.setVisible(false);
    s.glow.setVisible(false);
    s.img.y = -100;
  }

  function killEnemy(ctx, st, e) {
    var c = ctx.config;
    var pts = c.scoring.pointsPerObstacle * (e.elite ? 3 : 1);
    var x = e.img.x;
    var y = e.y;
    ctx.addScore(pts, x, y);
    st.kill.explode(e.elite ? 30 : 14, x, y);
    if (ctx.hitstop) ctx.hitstop(e.elite ? 80 : 40);
    if (e.elite) {
      shake(ctx, 0.5);
      popText(ctx, "ELITE x3", x, y - 20, { size: 26, color: ctx.palette.accent, kind: "meme" });
    }
    // combo on rapid kills
    if (!ctx.combo) {
      // fallback combo (core counts combos itself via addScore/collect)
      st.chain = st.t - st.lastKill < 0.9 ? st.chain + 1 : 1;
      if (st.chain >= 3) popText(ctx, "x" + st.chain, x, y - 30, { size: 18 + Math.min(st.chain, 10) * 1.5, kind: "meme" });
    }
    st.lastKill = st.t;
    // spin and pop
    var img = e.img;
    img.setTintFill(0xffffff);
    ctx.scene.tweens.add({
      targets: img,
      angle: img.angle + 280,
      scaleX: e.sx * 1.7,
      scaleY: e.sy * 1.7,
      alpha: 0,
      duration: 220,
      ease: "Quad.easeOut",
      onComplete: function () {
        img.destroy();
      },
    });
  }

  /** opts: {x, y, amp, freq, phase, mult} overrides for formations. */
  function spawnEnemy(ctx, st, opts, elite) {
    var v = ctx.config.obstacles.variance;
    var W = ctx.W;
    var size = elite ? ENEMY * 1.4 : ENEMY;
    var img = sprite(ctx.scene, ctx.tex.obstacle, 0, -40, size, size).setDepth(3);
    if (elite) img.setTint(st.accent);
    var w = img.displayWidth;
    var h = img.displayHeight;
    var amp = opts ? opts.amp : 12 + 70 * v * ctx.rng();
    var margin = w / 2 + amp + 4;
    var baseX = opts ? opts.x : margin + ctx.rng() * Math.max(1, W - margin * 2);
    var y = opts ? opts.y : -h / 2;
    img.x = baseX;
    img.y = y;
    // pop in
    var sx = img.scaleX;
    var sy = img.scaleY;
    img.setScale(sx * 0.4, sy * 0.4);
    ctx.scene.tweens.add({ targets: img, scaleX: sx, scaleY: sy, duration: 260, ease: "Back.easeOut" });
    st.enemies.push({
      img: img,
      baseX: baseX,
      y: y,
      w: w,
      h: h,
      sx: sx,
      sy: sy,
      r: Math.min(w, h) * 0.36,
      hp: elite ? st.hp + 2 : st.hp,
      amp: amp,
      freq: opts ? opts.freq : 1.4 + ctx.rng() * 1.8,
      phase: opts ? opts.phase : ctx.rng() * Math.PI * 2,
      mult: opts ? opts.mult : elite ? 0.7 : 0.85 + ctx.rng() * 0.3 * (0.5 + v),
      flash: 0,
      kb: 0,
      elite: !!elite,
      passed: false,
    });
  }

  function spawnFormation(ctx, st) {
    var W = ctx.W;
    var phase = ctx.rng() * 6.28;
    var freq = 1.2;
    var amp = 18;
    if (ctx.rng() < 0.5) {
      // V: 5 ships, leader in front
      var cx = 120 + ctx.rng() * (W - 240);
      for (var i = -2; i <= 2; i++) {
        spawnEnemy(ctx, st, { x: clamp(cx + i * 54, 50, W - 50), y: -30 - Math.abs(i) * 46, amp: amp, freq: freq, phase: phase, mult: 0.8 }, false);
      }
      popText(ctx, "INCOMING V", W / 2, 170, { size: 30, color: ctx.palette.accent, kind: "big" });
    } else {
      // line across with a 2-slot hole to fly through
      var slots = 6;
      var step = (W - 80) / (slots - 1);
      var hole = Math.floor(ctx.rng() * (slots - 1));
      for (var j = 0; j < slots; j++) {
        if (j === hole || j === hole + 1) continue;
        spawnEnemy(ctx, st, { x: 40 + j * step, y: -30, amp: 8, freq: freq, phase: phase, mult: 0.75 }, false);
      }
      popText(ctx, "WALL INCOMING", W / 2, 170, { size: 30, color: ctx.palette.accent, kind: "big" });
    }
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
