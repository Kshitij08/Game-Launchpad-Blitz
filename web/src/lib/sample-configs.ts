import type { GameConfig } from "./game-config";

/**
 * Hand-written sample configs. They double as demo seeds and as few-shot
 * examples for the AI generator, so keep them valid against gameConfigSchema
 * and keep the SVGs simple: flat shapes, a viewBox, no external refs/fonts.
 *
 * Sprite conventions the templates expect:
 *  - player: ~48x48, facing right
 *  - obstacle (flappy): one tall pipe/column, cap at the TOP (viewBox ~72x560);
 *    the template flips it for the upper pipe
 *  - obstacle (runner): ground obstacle ~48x64 standing on its bottom edge
 *  - collectible: ~32x32
 *  - decor: ~128x64 background element (drifts across the sky)
 *  - shooter: player ~48x48 facing UP, obstacle = enemy ~48x48 facing DOWN,
 *    projectile ~8x20 bullet
 *  - dodge: player ~48x48 at the bottom, obstacle = falling hazard ~40x40
 */

const orbitHopper: GameConfig = {
  version: 1,
  template: "flappy",
  title: "Orbit Hopper",
  tagline: "Thread your rocket through the asteroid gates and grab every star.",
  scoreLabel: "gates",
  palette: {
    sky: "#0b0f2e",
    skyBottom: "#3a1c71",
    ground: "#2b1d4f",
    accent: "#ffd23f",
    text: "#ffffff",
  },
  sprites: {
    player:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M2 24 L13 16 L13 32 Z" fill="#ff9f1c"/><path d="M6 24 L13 19.5 L13 28.5 Z" fill="#fff3b0"/><path d="M14 16 L10 7 H20 L25 16 Z" fill="#ef476f" stroke="#1d2340" stroke-width="2" stroke-linejoin="round"/><path d="M14 32 L10 41 H20 L25 32 Z" fill="#ef476f" stroke="#1d2340" stroke-width="2" stroke-linejoin="round"/><path d="M12 15 H30 Q44 17 46 24 Q44 31 30 33 H12 Z" fill="#eef1fa" stroke="#1d2340" stroke-width="2" stroke-linejoin="round"/><rect x="16" y="15" width="3.5" height="18" fill="#ef476f"/><circle cx="31" cy="24" r="5" fill="#4cc9f0" stroke="#1d2340" stroke-width="2"/><circle cx="29.5" cy="22.5" r="1.6" fill="#ffffff"/></svg>',
    obstacle:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 560"><defs><linearGradient id="p" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#3b2f9e"/><stop offset="0.45" stop-color="#9d8cff"/><stop offset="1" stop-color="#2a2077"/></linearGradient></defs><rect x="9" y="24" width="54" height="540" fill="url(#p)" stroke="#120a33" stroke-width="3"/><rect x="2" y="2" width="68" height="30" rx="7" fill="#ffd23f" stroke="#120a33" stroke-width="3"/><rect x="8" y="9" width="56" height="5" rx="2.5" fill="#fff6c2" opacity="0.8"/><g fill="#4cc9f0" opacity="0.85"><circle cx="36" cy="64" r="5"/><circle cx="36" cy="140" r="5"/><circle cx="36" cy="216" r="5"/><circle cx="36" cy="292" r="5"/><circle cx="36" cy="368" r="5"/><circle cx="36" cy="444" r="5"/><circle cx="36" cy="520" r="5"/></g><rect x="20" y="24" width="6" height="540" fill="#ffffff" opacity="0.18"/></svg>',
    collectible:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#ffd23f" stroke="#b8860b" stroke-width="2"/><path d="M16 6.5 L18.7 12.2 L24.9 12.9 L20.3 17.1 L21.6 23.3 L16 20.2 L10.4 23.3 L11.7 17.1 L7.1 12.9 L13.3 12.2 Z" fill="#fff6c2" stroke="#e0a800" stroke-width="1" stroke-linejoin="round"/></svg>',
    decor:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 64"><circle cx="64" cy="32" r="19" fill="#ff7eb6"/><path d="M50 26 Q64 20 78 27" stroke="#ffb3d1" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M48 38 Q64 44 80 37" stroke="#d65a93" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="64" cy="34" rx="40" ry="8" fill="none" stroke="#ffd23f" stroke-width="3" transform="rotate(-12 64 34)"/><g fill="#ffffff"><circle cx="10" cy="10" r="2"/><circle cx="118" cy="54" r="2"/><circle cx="112" cy="8" r="1.5"/><circle cx="20" cy="56" r="1.5"/></g></svg>',
  },
  physics: {
    gravity: 1400,
    jumpVelocity: 470,
    scrollSpeed: 170,
    speedRampPerSec: 4,
  },
  obstacles: {
    spawnIntervalMs: 1550,
    gapSize: 195,
    variance: 0.6,
  },
  scoring: {
    pointsPerObstacle: 1,
    collectibleChance: 0.45,
    pointsPerCollectible: 3,
  },
};

const jungleDash: GameConfig = {
  version: 1,
  template: "runner",
  title: "Jungle Dash",
  tagline: "Hop the stumps, snatch the bananas, outrun the jungle.",
  scoreLabel: "stumps",
  palette: {
    sky: "#6fd0ff",
    skyBottom: "#e6ffd0",
    ground: "#6b4423",
    accent: "#ffb703",
    text: "#12351a",
  },
  sprites: {
    player:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M10 36 Q1 33 4 22 Q6 17 9 19" stroke="#7a4a21" stroke-width="4" fill="none" stroke-linecap="round"/><ellipse cx="22" cy="35" rx="12" ry="10" fill="#8b5a2b"/><ellipse cx="23" cy="37" rx="6" ry="6" fill="#d9a066"/><circle cx="14" cy="13" r="5.5" fill="#8b5a2b"/><circle cx="14" cy="13" r="2.8" fill="#e8b98a"/><circle cx="26" cy="18" r="13" fill="#8b5a2b"/><ellipse cx="31" cy="21" rx="9.5" ry="8" fill="#e8b98a"/><circle cx="32" cy="15.5" r="2.6" fill="#1b1b1b"/><circle cx="33" cy="14.6" r="0.9" fill="#ffffff"/><path d="M30 24.5 Q34.5 28 39 23.5" stroke="#5a3415" stroke-width="2" fill="none" stroke-linecap="round"/><ellipse cx="16" cy="45" rx="5.5" ry="3" fill="#6b3f18"/><ellipse cx="29" cy="45" rx="5.5" ry="3" fill="#6b3f18"/></svg>',
    obstacle:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 64"><path d="M7 64 V20 Q7 13 14 13 H34 Q41 13 41 20 V64 Z" fill="#8a5a2b" stroke="#4a2c12" stroke-width="3"/><path d="M15 30 V58 M24 26 V62 M33 32 V56" stroke="#6b4220" stroke-width="2.5" stroke-linecap="round"/><ellipse cx="24" cy="15" rx="17" ry="6" fill="#d9a066" stroke="#4a2c12" stroke-width="3"/><ellipse cx="24" cy="15" rx="8" ry="2.6" fill="none" stroke="#a8743f" stroke-width="2"/><path d="M3 12 Q9 1 19 8 Q13 16 3 12 Z" fill="#3fa34d" stroke="#1f6b2a" stroke-width="1.5"/><path d="M45 13 Q39 2 29 8 Q35 16 45 13 Z" fill="#2e8b3e" stroke="#1f6b2a" stroke-width="1.5"/></svg>',
    collectible:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M7 8 Q4 25 22 27.5 Q28 28 29 24.5 Q15 22 12 7 Z" fill="#ffd60a" stroke="#a07800" stroke-width="2" stroke-linejoin="round"/><path d="M10 11 Q10 20 19 23" stroke="#fff3a3" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M7 8 L8 3.5 L12 7" fill="#6b4f00" stroke="#6b4f00" stroke-width="2" stroke-linejoin="round"/></svg>',
    decor:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 64"><g fill="#ffffff"><ellipse cx="38" cy="40" rx="26" ry="15"/><ellipse cx="68" cy="29" rx="28" ry="21"/><ellipse cx="96" cy="41" rx="23" ry="14"/><rect x="22" y="38" width="90" height="17" rx="8.5"/></g><ellipse cx="66" cy="54" rx="42" ry="4" fill="#bde9ff" opacity="0.7"/></svg>',
  },
  physics: {
    gravity: 2000,
    jumpVelocity: 820,
    scrollSpeed: 270,
    speedRampPerSec: 8,
  },
  obstacles: {
    spawnIntervalMs: 1350,
    gapSize: 160,
    variance: 0.55,
  },
  scoring: {
    pointsPerObstacle: 1,
    collectibleChance: 0.5,
    pointsPerCollectible: 2,
  },
};

const neonRush: GameConfig = {
  version: 1,
  template: "runner",
  title: "Neon Rush",
  tagline: "A rogue bot sprinting through a synthwave city. Jump the pylons, grab the bolts.",
  scoreLabel: "pylons",
  palette: {
    sky: "#090014",
    skyBottom: "#4a0d6b",
    ground: "#1a0638",
    accent: "#00f0ff",
    text: "#f5f0ff",
  },
  sprites: {
    player:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M24 7 V3" stroke="#ff4fd8" stroke-width="2.5" stroke-linecap="round"/><circle cx="24" cy="3" r="2.5" fill="#ffe600"/><rect x="6" y="8" width="36" height="29" rx="8" fill="#1a0533" stroke="#ff4fd8" stroke-width="3"/><rect x="17" y="15" width="21" height="10" rx="5" fill="#00f0ff"/><rect x="29" y="17" width="6" height="6" rx="3" fill="#ffffff"/><path d="M12 31 H24" stroke="#ff4fd8" stroke-width="2" stroke-linecap="round" opacity="0.7"/><path d="M2 19 H6 M0 26 H6" stroke="#00f0ff" stroke-width="2" stroke-linecap="round"/><rect x="11" y="39" width="10" height="7" rx="3" fill="#00f0ff"/><rect x="27" y="39" width="10" height="7" rx="3" fill="#00f0ff"/></svg>',
    obstacle:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 64"><path d="M24 4 L42 59 H6 Z" fill="#1a0533" stroke="#00f0ff" stroke-width="3" stroke-linejoin="round"/><path d="M18 24 H30 M13 40 H35" stroke="#ff4fd8" stroke-width="5" stroke-linecap="round"/><circle cx="24" cy="9" r="3" fill="#ffe600"/><rect x="2" y="57" width="44" height="7" rx="3.5" fill="#00f0ff"/></svg>',
    collectible:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13.5" fill="#1a0533" stroke="#ffe600" stroke-width="2.5"/><path d="M18 5 L9 18 H15 L13 27 L23 13 H17 Z" fill="#ffe600" stroke="#fff7a8" stroke-width="1" stroke-linejoin="round"/></svg>',
    decor:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 64"><path d="M18 40 Q22 22 44 20 H76 Q92 20 101 31 L113 33 Q120 35 118 42 H16 Z" fill="#2a0a4a" stroke="#ff4fd8" stroke-width="2.5" stroke-linejoin="round"/><path d="M48 24 H72 Q84 24 90 31 H42 Z" fill="#00f0ff" opacity="0.75"/><ellipse cx="40" cy="49" rx="15" ry="3" fill="#00f0ff" opacity="0.6"/><ellipse cx="94" cy="49" rx="15" ry="3" fill="#00f0ff" opacity="0.6"/><path d="M117 37 H125" stroke="#ffe600" stroke-width="3" stroke-linecap="round"/><path d="M4 30 H14 M0 36 H12" stroke="#ff4fd8" stroke-width="2" stroke-linecap="round" opacity="0.6"/></svg>',
  },
  physics: {
    gravity: 2300,
    jumpVelocity: 870,
    scrollSpeed: 330,
    speedRampPerSec: 12,
  },
  obstacles: {
    spawnIntervalMs: 1150,
    gapSize: 160,
    variance: 0.75,
  },
  scoring: {
    pointsPerObstacle: 1,
    collectibleChance: 0.4,
    pointsPerCollectible: 5,
  },
};

const cometClash: GameConfig = {
  version: 1,
  template: "shooter",
  title: "Comet Clash",
  tagline: "Alien bugs are swarming the comet belt. Hold the line, blast them all.",
  scoreLabel: "bugs",
  palette: {
    sky: "#05061a",
    skyBottom: "#1b1446",
    ground: "#120c33",
    accent: "#4df0ff",
    text: "#ffffff",
  },
  sprites: {
    player:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M20 40 L24 47 L28 40 Z" fill="#ff9f1c"/><path d="M21.5 40 L24 44.5 L26.5 40 Z" fill="#fff3b0"/><path d="M14 26 L3 38 L4 42 L16 37 Z" fill="#ef476f" stroke="#151a3a" stroke-width="2" stroke-linejoin="round"/><path d="M34 26 L45 38 L44 42 L32 37 Z" fill="#ef476f" stroke="#151a3a" stroke-width="2" stroke-linejoin="round"/><path d="M24 2 Q33 12 33 28 L31 40 H17 L15 28 Q15 12 24 2 Z" fill="#e9edf8" stroke="#151a3a" stroke-width="2" stroke-linejoin="round"/><path d="M19 32 H29" stroke="#ef476f" stroke-width="3"/><ellipse cx="24" cy="18" rx="4.5" ry="6.5" fill="#4df0ff" stroke="#151a3a" stroke-width="2"/><ellipse cx="22.6" cy="16" rx="1.4" ry="2.2" fill="#ffffff"/></svg>',
    obstacle:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><g stroke="#2a0b3d" stroke-width="2.5" stroke-linecap="round" fill="none"><path d="M12 18 L3 12 M12 25 L2 26 M14 32 L5 39 M36 18 L45 12 M36 25 L46 26 M34 32 L43 39"/><path d="M19 38 L16 46 M29 38 L32 46"/></g><ellipse cx="24" cy="23" rx="13" ry="15" fill="#8be04e" stroke="#2a0b3d" stroke-width="2.5"/><path d="M24 9 V37" stroke="#2a0b3d" stroke-width="2"/><ellipse cx="18" cy="17" rx="3" ry="5" fill="#c2ff8c" opacity="0.8"/><ellipse cx="24" cy="38" rx="9" ry="6" fill="#b14aed" stroke="#2a0b3d" stroke-width="2.5"/><circle cx="20" cy="39" r="2.6" fill="#ff3864"/><circle cx="28" cy="39" r="2.6" fill="#ff3864"/><circle cx="20.6" cy="38.4" r="0.9" fill="#ffffff"/><circle cx="28.6" cy="38.4" r="0.9" fill="#ffffff"/></svg>',
    collectible:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M16 2 L26 12 L16 30 L6 12 Z" fill="#ffd23f" stroke="#a86b00" stroke-width="2" stroke-linejoin="round"/><path d="M6 12 H26 M16 2 L12 12 L16 30 L20 12 Z" fill="none" stroke="#a86b00" stroke-width="1.2" stroke-linejoin="round"/><path d="M11 7 L13 11" stroke="#fff6c2" stroke-width="2" stroke-linecap="round"/></svg>',
    decor:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 64"><circle cx="92" cy="30" r="16" fill="#3a2a7a"/><path d="M80 24 Q92 18 104 24" stroke="#5e48b8" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="86" cy="36" r="3" fill="#2a1d5c"/><path d="M8 50 Q40 40 66 18" stroke="#4df0ff" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.5"/><circle cx="68" cy="16" r="3.5" fill="#bdf8ff"/><g fill="#ffffff"><circle cx="14" cy="10" r="1.6"/><circle cx="40" cy="30" r="1.2"/><circle cx="120" cy="56" r="1.6"/><circle cx="118" cy="8" r="1.2"/><circle cx="56" cy="56" r="1.2"/></g></svg>',
    projectile:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 20"><rect x="0.5" y="0.5" width="7" height="19" rx="3.5" fill="#4df0ff"/><rect x="2.5" y="2" width="3" height="14" rx="1.5" fill="#ffffff"/></svg>',
  },
  physics: {
    gravity: 1000,
    jumpVelocity: 500,
    scrollSpeed: 170,
    speedRampPerSec: 5,
  },
  obstacles: {
    spawnIntervalMs: 800,
    gapSize: 160,
    variance: 0.6,
  },
  scoring: {
    pointsPerObstacle: 1,
    collectibleChance: 0.18,
    pointsPerCollectible: 5,
  },
  tuning: {
    playerSpeed: 460,
    fireRateMs: 240,
    enemyHp: 2,
  },
  vfx: {
    score: { style: "explosion", colors: ["#8be04e", "#ffd23f", "#ff3864"] },
    shoot: { style: "pixels", colors: ["#4df0ff", "#ffffff"] },
    collect: { style: "sparkle", colors: ["#ffd23f", "#fff6c2"] },
    hit: { style: "explosion", colors: ["#ff9f1c", "#ef476f", "#ffffff"] },
    trail: { style: "fire", colors: ["#ff9f1c", "#ffd23f"] },
  },
};

const pizzaRain: GameConfig = {
  version: 1,
  template: "dodge",
  title: "Pizza Rain",
  tagline: "Toppings are falling! Catch the pepperoni, dodge the pineapple.",
  scoreLabel: "dodged",
  palette: {
    sky: "#ffcf8a",
    skyBottom: "#ff8f6b",
    ground: "#8a4b2a",
    accent: "#e63946",
    text: "#3b1406",
  },
  sprites: {
    player:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect x="21" y="34" width="6" height="13" rx="2" fill="#a0632e" stroke="#4a2410" stroke-width="2"/><ellipse cx="24" cy="26" rx="22" ry="11" fill="#d99a52" stroke="#4a2410" stroke-width="2.5"/><ellipse cx="24" cy="24.5" rx="18" ry="8" fill="#ffd166"/><ellipse cx="24" cy="25" rx="15.5" ry="6.4" fill="#f4a259" opacity="0.55"/><circle cx="16" cy="24" r="3" fill="#c1121f"/><circle cx="27" cy="22" r="3" fill="#c1121f"/><circle cx="32" cy="27" r="2.6" fill="#c1121f"/><circle cx="22" cy="28" r="2.4" fill="#c1121f"/><path d="M18 20 Q20 18 22 20" stroke="#3a7d44" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M29 29 Q31 27 33 29" stroke="#3a7d44" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
    obstacle:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><g fill="#4caf50" stroke="#1f5e24" stroke-width="1.5" stroke-linejoin="round"><path d="M20 15 L14 2 L21 10 Z"/><path d="M20 15 L26 1 L22 11 Z"/><path d="M20 15 L8 6 L18 12 Z"/><path d="M20 15 L32 6 L22 12 Z"/></g><ellipse cx="20" cy="27" rx="11" ry="12" fill="#f4b400" stroke="#7a4a00" stroke-width="2"/><path d="M12 21 L28 35 M10 28 L22 38 M18 16 L30 27 M28 19 L12 35 M30 27 L19 38 M22 16 L10 27" stroke="#b07500" stroke-width="1.4" fill="none"/><circle cx="16" cy="25" r="1.5" fill="#1b1b1b"/><circle cx="24" cy="25" r="1.5" fill="#1b1b1b"/><path d="M16.5 31 Q20 28.5 23.5 31" stroke="#1b1b1b" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M13 21 L18 23 M27 21 L22 23" stroke="#1b1b1b" stroke-width="1.5" stroke-linecap="round"/></svg>',
    collectible:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="#c1121f" stroke="#6a040f" stroke-width="2"/><circle cx="11" cy="12" r="2.2" fill="#8c0b16"/><circle cx="20" cy="10" r="1.8" fill="#8c0b16"/><circle cx="21" cy="20" r="2.4" fill="#8c0b16"/><circle cx="12" cy="21" r="1.6" fill="#8c0b16"/><path d="M9 9 Q12 6 15 6.5" stroke="#ff6b6b" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
    decor:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 64"><g fill="#fff4e0"><ellipse cx="38" cy="40" rx="26" ry="15"/><ellipse cx="68" cy="29" rx="28" ry="21"/><ellipse cx="96" cy="41" rx="23" ry="14"/><rect x="22" y="38" width="90" height="17" rx="8.5"/></g><ellipse cx="66" cy="54" rx="42" ry="4" fill="#ffd9b8" opacity="0.8"/></svg>',
  },
  physics: {
    gravity: 1000,
    jumpVelocity: 500,
    scrollSpeed: 230,
    speedRampPerSec: 7,
  },
  obstacles: {
    spawnIntervalMs: 620,
    gapSize: 160,
    variance: 0.65,
  },
  scoring: {
    pointsPerObstacle: 1,
    collectibleChance: 0.6,
    pointsPerCollectible: 3,
  },
  tuning: {
    playerSpeed: 480,
  },
  vfx: {
    collect: { style: "confetti", colors: ["#e63946", "#ffd166", "#4caf50"] },
    hit: { style: "smoke", colors: ["#7a4a00", "#3b1406"] },
    score: { style: "pixels", colors: ["#f4b400"] },
    trail: { style: "none" },
  },
};

export interface SampleConfig {
  id: string;
  name: string;
  /** Example user prompt that could have produced this config (handy for few-shot). */
  prompt: string;
  config: GameConfig;
}

export const SAMPLE_CONFIGS: SampleConfig[] = [
  { id: "orbit-hopper", name: "Orbit Hopper", prompt: "a tap-to-fly space game with a little rocket dodging asteroid gates", config: orbitHopper },
  { id: "jungle-dash", name: "Jungle Dash", prompt: "a monkey running through the jungle jumping over tree stumps and collecting bananas", config: jungleDash },
  { id: "neon-rush", name: "Neon Rush", prompt: "neon synthwave city runner with a robot jumping over traffic pylons", config: neonRush },
  { id: "comet-clash", name: "Comet Clash", prompt: "a space shooter where my little ship blasts swarms of alien bugs in a comet belt", config: cometClash },
  { id: "pizza-rain", name: "Pizza Rain", prompt: "catch falling pizza toppings and dodge the pineapples", config: pizzaRain },
];

export function getSampleConfig(id: string): GameConfig | undefined {
  return SAMPLE_CONFIGS.find((s) => s.id === id)?.config;
}
