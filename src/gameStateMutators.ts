import {
  Ball,
  BallLike,
  Coin,
  colorString,
  GameState,
  LightFlash,
  ParticleFlash,
  ReusableArray,
  TextFlash,
} from "./types";

import {
  brickCenterX,
  brickCenterY,
  canvasCenterX,
  countBrickColors,
  currentLevelInfo,
  distance2,
  distanceBetween,
  getClosestBall,
  getCoinRenderColor,
  getCornerOffset,
  getMajorityValue,
  getRowColIndex,
  isMovingWhilePassiveIncome,
  isPickyEatingPossible,
  max_levels,
  reachRedRowIndex,
  shouldPierceByColor,
  telekinesisEffectRate,
  yoyoEffectRate,
  zoneLeftBorderX,
  zoneRightBorderX,
} from "./game_utils";
import { t } from "./i18n/i18n";

import { getCurrentMaxCoins, getCurrentMaxParticles } from "./settings";
import { background } from "./render";
import { gameOver } from "./gameOver";
import {
  brickIndex,
  fitSize,
  hasBrick,
  hitsSomething,
  pause,
  startComputerControlledGame,
} from "./game";
import { stopRecording } from "./recording";
import { getPixelRatio, isOptionOn } from "./options";
import {
  ballTransparency,
  base_combo_from_stronger_foundation,
  clamp,
  coinsBoostedCombo,
  comboKeepingRate,
} from "./pure_functions";
import { addToTotalScore } from "./addToTotalScore";
import { openUpgradesPicker } from "./openUpgradesPicker";
import { computerControl } from "./computerControl";

export function setMousePos(gameState: GameState, x: number) {
  if (
    gameState.startParams.computer_controlled ||
    gameState.startParams.animated_perk_preview
  )
    return;
  gameState.puckPosition = Math.round(x);

  // Sets the puck position, and updates the ball position if they are supposed to follow it
  gameState.needsRender = true;
}

function getBallDefaultVx(gameState: GameState) {
  return (
    (gameState.perks.concave_puck ? 0 : 1) *
    (Math.random() > 0.5 ? gameState.baseSpeed : -gameState.baseSpeed)
  );
}

function isBounceToEmptyLevel(gameState: GameState) {
  return (
    gameState.bricks.filter((i) => i).length <
    gameState.balls.filter((b) => !b.destroyed).length
  );
}

export function resetBalls(gameState: GameState) {
  // Always compute speed first
  normalizeGameState(gameState);
  const count = 1 + (gameState.perks?.multiball || 0);
  const perBall = gameState.puckWidth / (count + 1);
  gameState.balls = [];
  gameState.ballsColor = "#FFFFFF";
  if (gameState.perks.picky_eater || gameState.perks.pierce_color) {
    gameState.ballsColor =
      getMajorityValue(gameState.bricks.filter((i) => i)) || "#FFFFFF";
  }
  for (let i = 0; i < count; i++) {
    const x =
      gameState.puckPosition - gameState.puckWidth / 2 + perBall * (i + 1);
    const vx = getBallDefaultVx(gameState);

    gameState.balls.push({
      x,
      previousX: x,
      y: gameState.gameZoneHeight - 1.5 * gameState.ballSize,
      previousY: gameState.gameZoneHeight - 1.5 * gameState.ballSize,
      vx,
      previousVX: vx,
      vy: -gameState.baseSpeed,
      previousVY: -gameState.baseSpeed,
      piercePoints: gameState.perks.pierce * 2,
      hitSinceBounce: 0,
      hasGravity: false,
      brokenSinceBounce: 0,
      brokenSinceWallOrPaddleBounce: 0,
      sidesHitsSinceBounce: 0,
      topHitsSinceBounce: 0,
      wrapsSinceBounce: 0,
      sapperUses: 0,
      bouncedToEmptyLevel: false,
    });
  }
  gameState.ballStickToPuck = true;
}

export function putBallsAtPuck(gameState: GameState) {
  // This reset could be abused to cheat quite easily
  const count = gameState.balls.length;
  const perBall = gameState.puckWidth / (count + 1);
  // const vx = getBallDefaultVx(gameState);
  gameState.balls.forEach((ball, i) => {
    const x =
      gameState.puckPosition - gameState.puckWidth / 2 + perBall * (i + 1);

    ball.x = x;
    ball.previousX = x;
    ball.y = gameState.gameZoneHeight - 1.5 * gameState.ballSize;
    ball.previousY = ball.y;
    ball.hitSinceBounce = 0;
    ball.hasGravity = false;
    ball.bouncedToEmptyLevel = isBounceToEmptyLevel(gameState);
    ball.brokenSinceBounce = 0;
    ball.brokenSinceWallOrPaddleBounce = 0;
    ball.sidesHitsSinceBounce = 0;
    ball.topHitsSinceBounce = 0;
    ball.wrapsSinceBounce = 0;
    ball.piercePoints = gameState.perks.pierce * 2;
  });
}

export function normalizeGameState(gameState: GameState) {
  // This function resets most parameters on the state to correct values, and should be used even when the game is paused

  gameState.baseSpeed = Math.max(
    3 * getPixelRatio(),
    gameState.gameZoneWidth / 12 / 10 +
      gameState.currentLevel / 3 / (1 + gameState.perks.chill * 10) +
      gameState.levelTime / (30 * 1000) -
      gameState.perks.slow_down * 2,
  );

  gameState.puckWidth = Math.max(
    gameState.ballSize,
    (gameState.gameZoneWidth / 12) *
      Math.min(
        12,
        3 - gameState.perks.smaller_puck + gameState.perks.bigger_puck,
      ),
  );

  const corner = getCornerOffset(gameState);

  let minX = gameState.offsetXRoundedDown + gameState.puckWidth / 2 - corner;

  let maxX =
    gameState.offsetXRoundedDown +
    gameState.gameZoneWidthRoundedUp -
    gameState.puckWidth / 2 +
    corner;

  gameState.puckPosition = clamp(gameState.puckPosition, minX, maxX);

  if (
    gameState.perks.flyswatter &&
    gameState.puckPosition === minX &&
    gameState.running
  ) {
    gameState.balls.forEach((ball) => {
      applyGravity(gameState, ball);
    });
  }

  if (gameState.ballStickToPuck) {
    putBallsAtPuck(gameState);
  }

  if (
    Math.abs(gameState.lastPuckPosition - gameState.puckPosition) > 1 &&
    gameState.running
  ) {
    gameState.lastPuckMove = gameState.levelTime;
  }
}

export function baseCombo(gameState: GameState) {
  return base_combo_from_stronger_foundation(gameState.perks.base_combo);
}

export function resetCombo(
  gameState: GameState,
  x: number,
  y: number,
  speedReference: Ball | Coin | undefined = undefined,
) {
  const prev = gameState.combo;
  gameState.combo = baseCombo(gameState);
  // skip combo reset when no brick on screen
  if (!gameState.bricks.find(Boolean)) return;

  if (gameState.perks.double_or_nothing && prev > gameState.combo) {
    if (gameState.perks.extra_life) {
      justLostALife(gameState, x, y);
    } else {
      gameOver(
        t("gameOver.double_or_nothing.title"),
        t("gameOver.double_or_nothing.summary", {
          perk: t("upgrades.double_or_nothing.name"),
        }),
      );
    }
  }

  if (prev > gameState.combo && gameState.perks.soft_reset) {
    gameState.combo += Math.floor(
      (prev - gameState.combo) * comboKeepingRate(gameState.perks.soft_reset),
    );
  }
  const lost = Math.max(0, prev - gameState.combo);
  if (lost) {
    for (let i = 0; i < lost && i < 8; i++) {
      setTimeout(
        () => schedulGameSound(gameState, "comboDecrease", x, 1),
        i * 100,
      );
    }
    if (typeof x !== "undefined" && typeof y !== "undefined") {
      makeText(
        gameState,
        x,
        y,
        "#FF0000",
        "-" + lost,
        20,
        500 + clamp(lost, 0, 500),
        speedReference?.vx ?? 0,
        speedReference?.vy ?? -6,
      );
    }
  }
  return lost;
}

export function offsetCombo(
  gameState: GameState,
  by: number,
  x: number,
  y: number,
  speedReference: Ball | Coin | undefined = undefined,
) {
  if (!by) return;
  if (by > 0) {
    by *= 1 + gameState.perks.double_or_nothing;
    gameState.combo += by;
    makeText(gameState, x, y, "#ffd300", "+" + by, 25, 400 + by);
  } else {
    const prev = gameState.combo;
    gameState.combo = Math.max(baseCombo(gameState), gameState.combo + by);
    const lost = Math.max(0, prev - gameState.combo);

    if (lost) {
      schedulGameSound(gameState, "comboDecrease", x, 1);
      makeText(
        gameState,
        x,
        y,
        "#FF0000",
        "-" + lost,
        20,
        400 + lost,
        speedReference?.vx ?? 0,
        speedReference?.vy ?? -6,
      );
    }
  }
}

export function spawnParticlesExplosion(
  gameState: GameState,
  count: number,
  x: number,
  y: number,
  color: string,
) {
  if (liveCount(gameState.particles) > getCurrentMaxParticles()) {
    // Avoid freezing when lots of explosion happen at once
    count = 1;
  }
  for (let i = 0; i < count; i++) {
    makeParticle(
      gameState,

      x + ((Math.random() - 0.5) * gameState.brickWidth) / 2,
      y + ((Math.random() - 0.5) * gameState.brickWidth) / 2,
      (Math.random() - 0.5) * 30,
      (Math.random() - 0.5) * 30,
      color,
      false,
    );
  }
}

export function spawnXShapedParticlesExplosion(
  gameState: GameState,
  count: number,
  x: number,
  y: number,
  color: string,
) {
  if (color == "black") return;
  if (liveCount(gameState.particles) > getCurrentMaxParticles()) {
    // Avoid freezing when lots of explosion happen at once
    return;
  }
  spawnInLine(gameState, count, x, y, -5, -5, color);
  spawnInLine(gameState, count, x, y, -5, 5, color);
  spawnInLine(gameState, count, x, y, 5, 5, color);
  spawnInLine(gameState, count, x, y, -5, -5, color);
}

function spawnInLine(
  gameState: GameState,
  count: number,
  x: number,
  y: number,
  dx: number,
  dy: number,
  color: string,
) {
  for (let i = 1; i <= count; i++) {
    makeParticle(
      gameState,
      x + i * dx,
      y + i * dy,
      dx,
      dy,
      color,
      true,
      8,
      400,
    );
  }
}

export function spawnParticlesImplosion(
  gameState: GameState,
  count: number,
  x: number,
  y: number,
  color: string,
) {
  if (liveCount(gameState.particles) > getCurrentMaxParticles()) {
    // Avoid freezing when lots of explosion happen at once
    count = 1;
  }
  for (let i = 0; i < count; i++) {
    const dx = ((Math.random() - 0.5) * gameState.brickWidth) / 2;
    const dy = ((Math.random() - 0.5) * gameState.brickWidth) / 2;
    makeParticle(gameState, x - dx * 10, y - dy * 10, dx, dy, color, false);
  }
}

export function explosionAt(
  gameState: GameState,
  index: number,
  x: number,
  y: number,
  ball: Ball,
  extraSize: number = 0,
) {
  const size =
    1 +
    gameState.perks.bigger_explosions +
    Math.max(0, gameState.perks.implosions - 1) +
    extraSize;
  schedulGameSound(gameState, "explode", ball.x, 1);
  if (index !== -1) {
    const col = index % gameState.gridSize;
    const row = Math.floor(index / gameState.gridSize);
    // Break bricks around
    for (let dx = -size; dx <= size; dx++) {
      for (let dy = -size; dy <= size; dy++) {
        const i = getRowColIndex(gameState, row + dy, col + dx);
        if (gameState.bricks[i] && i !== -1) {
          // Study bricks resist explosions too
          gameState.brickHP[i]--;
          if (gameState.brickHP[i] <= 0) {
            ball.brokenSinceWallOrPaddleBounce++;
            applyNBrickPerk(gameState, ball);
            explodeBrick(gameState, i, ball, true);
          }
        }
      }
    }
  }

  const factor = gameState.perks.implosions ? -1 : 1;
  // Blow nearby coins
  forEachLiveOne(gameState.coins, (c) => {
    const dx = c.x - x;
    const dy = c.y - y;
    const d2 = Math.max(gameState.brickWidth, Math.abs(dx) + Math.abs(dy));
    c.vx += (((dx / d2) * 10 * size) / c.weight) * factor;
    c.vy += (((dy / d2) * 10 * size) / c.weight) * factor;
  });
  gameState.lastExplosion = gameState.levelTime;

  if (gameState.perks.implosions) {
    spawnParticlesImplosion(gameState, 7 * size, x, y, "#FFFFFF");
  } else {
    spawnParticlesExplosion(gameState, 7 * size, x, y, "#FFFFFF");
  }

  gameState.runStatistics.bricks_broken++;
  gameState.levelBrickBroken++;

  if (gameState.perks.zen) {
    gameState.lastZenComboIncrease = gameState.levelTime;
    resetCombo(gameState, x, y, ball);
  }
}

export function explodeBrick(
  gameState: GameState,
  index: number,
  ball: Ball,
  isExplosion: boolean,
) {
  const color = gameState.bricks[index];
  if (!color) return;

  const wasPickyEaterPossible =
    gameState.perks.picky_eater && isPickyEatingPossible(gameState);
  const redRowReach = reachRedRowIndex(gameState);

  gameState.lastBrickBroken = gameState.levelTime;

  if (color === "black") {
    const x = brickCenterX(gameState, index),
      y = brickCenterY(gameState, index);

    setBrick(gameState, index, "");
    explosionAt(gameState, index, x, y, ball, 0);
  } else if (color) {
    // Even if it bounces we don't want to count that as a miss

    // Flashing is take care of by the tick loop
    const x = brickCenterX(gameState, index),
      y = brickCenterY(gameState, index);

    let resetComboNeeeded = false;
    let comboGain =
      gameState.perks.streak_shots +
      gameState.perks.compound_interest +
      gameState.perks.left_is_lava +
      gameState.perks.right_is_lava +
      gameState.perks.top_is_lava +
      gameState.perks.asceticism * 3 +
      gameState.perks.passive_income +
      gameState.perks.addiction;

    // should run before the brick is removed
    if (gameState.perks.palette) {
      const colorsCount = countBrickColors(gameState);
      if (colorsCount > 1) {
        comboGain += (colorsCount - 1) * gameState.perks.palette;
      } else if (
        // not the first one
        gameState.levelBrickBroken &&
        // not the last one
        gameState.bricks.find((b, bi) => bi !== index && b !== "black" && b)
      ) {
        resetComboNeeeded = true;
      }
    }

    setBrick(gameState, index, "");

    let coinsToSpawn = coinsBoostedCombo(gameState);
    let multiplier = 1;

    if (gameState.perks.vibrant_neighborhood) {
      const baseX = index % gameState.gridSize;
      const baseY = Math.floor(index / gameState.gridSize);

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const neighbor =
            gameState.bricks[getRowColIndex(gameState, baseY + dy, baseX + dx)];
          if (neighbor && neighbor !== "black" && neighbor !== color) {
            multiplier++;
          }
        }
      }
    }

    coinsToSpawn *= multiplier;
    if (multiplier !== 1)
      makeText(
        gameState,
        x,
        y,
        gameState.ballsColor,
        "x" + multiplier,
        18,
        500,
        ball.vx,
        ball.vy,
      );

    gameState.levelSpawnedCoins += coinsToSpawn;
    gameState.runStatistics.coins_spawned += coinsToSpawn;
    gameState.runStatistics.bricks_broken++;

    const maxCoins = getCurrentMaxCoins();
    const spawnableCoins =
      liveCount(gameState.coins) > getCurrentMaxCoins()
        ? 1
        : Math.floor((maxCoins - liveCount(gameState.coins)) / 2);

    const pointsPerCoin = Math.max(1, Math.ceil(coinsToSpawn / spawnableCoins));

    while (coinsToSpawn > 0) {
      const points = Math.min(pointsPerCoin, coinsToSpawn);
      if (points < 0 || isNaN(points)) {
        console.error({ points });
        debugger;
      }

      coinsToSpawn -= points;

      const cx =
          x +
          (Math.random() - 0.5) * (gameState.brickWidth - gameState.coinSize),
        cy =
          y +
          (Math.random() - 0.5) * (gameState.brickWidth - gameState.coinSize);

      makeCoin(
        gameState,
        cx,
        cy,
        ball.previousVX * (0.5 + Math.random()),
        ball.previousVY * (0.5 + Math.random()),
        color,
        points,
      );
    }

    if (
      gameState.perks.nbricks &&
      ball.brokenSinceWallOrPaddleBounce <= gameState.perks.nbricks * 2
    ) {
      comboGain += gameState.perks.nbricks * 2;
    }

    if (Math.abs(ball.y - y) < Math.abs(ball.x - x)) {
      if (gameState.perks.side_kick) {
        if (ball.previousVX > 0) {
          comboGain += gameState.perks.side_kick;
        } else {
          comboGain -= gameState.perks.side_kick * 2;
        }
      }
      if (gameState.perks.side_flip) {
        if (ball.previousVX < 0) {
          comboGain += gameState.perks.side_flip;
        } else {
          comboGain -= gameState.perks.side_flip * 2;
        }
      }
    }

    if (gameState.perks.picky_eater) {
      comboGain += Math.max(
        0,
        gameState.perks.picky_eater * (countBrickColors(gameState) - 1),
      );
    }

    if (redRowReach !== -1) {
      if (Math.floor(index / gameState.level.size) === redRowReach) {
        resetComboNeeeded = true;
      } else {
        for (let x = 0; x < gameState.level.size; x++) {
          if (gameState.bricks[redRowReach * gameState.level.size + x])
            comboGain += gameState.perks.reach;
        }
      }
    }

    if (!isExplosion) {
      // color change
      if (
        (gameState.perks.picky_eater || gameState.perks.pierce_color) &&
        color !== gameState.ballsColor &&
        color
      ) {
        if (wasPickyEaterPossible) {
          resetComboNeeeded = true;
        }
        schedulGameSound(gameState, "colorChange", ball.x, 0.8);
        // gameState.lastExplosion = gameState.levelTime;
        gameState.ballsColor = color;
        gameState.balls.forEach((ball) => {
          spawnParticlesExplosion(
            gameState,
            7,
            ball.previousX,
            ball.previousY,
            color,
          );
        });
      } else {
        schedulGameSound(gameState, "comboIncreaseMaybe", ball.x, 1);
      }
    }

    if (resetComboNeeeded) {
      resetCombo(gameState, ball.x, ball.y, ball);
    } else {
      offsetCombo(gameState, comboGain, ball.x, ball.y, ball);
    }
    // Particle effect
    spawnParticlesExplosion(
      gameState,
      5 + Math.min(gameState.combo, 30),
      x,
      y,
      color,
    );
    gameState.levelBrickBroken++;
  }

  if (
    gameState.perks.respawn &&
    color !== "black" &&
    !gameState.bricks[index] &&
    gameState.bricks.find(Boolean)
  ) {
    if (Math.random() < comboKeepingRate(gameState.perks.respawn)) {
      append(gameState.respawns, (b) => {
        b.color = color;
        b.index = index;
        b.time = gameState.levelTime + (3 * 1000) / gameState.perks.respawn;
      });
    }
  }
}

export function schedulGameSound(
  gameState: GameState,
  sound: keyof GameState["aboutToPlaySound"],
  x: number | void,
  vol: number,
) {
  if (!vol) return;
  if (!isOptionOn("sound")) return;

  x ??= gameState.offsetX + gameState.gameZoneWidth / 2;
  const ex = gameState.aboutToPlaySound[sound] as { vol: number; x: number };

  ex.x = (x * vol + ex.x * ex.vol) / (vol + ex.vol);
  ex.vol += vol;
}

export function addToScore(gameState: GameState, coin: Coin) {
  gameState.score += coin.points;

  gameState.levelCaughtCoins += coin.points;
  gameState.lastScoreIncrease = gameState.levelTime;
  addToTotalScore(gameState, coin.points);
  if (gameState.score > gameState.highScore && !gameState.creative) {
    gameState.highScore = gameState.score;
    try {
      localStorage.setItem("breakout-3-hs-short", gameState.score.toString());
    } catch (e) {}
  }

  makeParticle(
    gameState,
    coin.previousX,
    coin.previousY,
    (gameState.canvasWidth - coin.x) / 100,
    -coin.y / 100,
    getCoinRenderColor(gameState, coin),
    true,
    8,
    100 + Math.random() * 50,
  );

  schedulGameSound(gameState, "coinCatch", coin.x, 1);
  gameState.runStatistics.score += coin.points;
  if (gameState.perks.asceticism) {
    offsetCombo(
      gameState,
      -gameState.perks.asceticism * 3 * coin.points,
      coin.x,
      coin.y,
      coin,
    );
  }
}

export async function setLevel(gameState: GameState, l: number) {
  // Ignore duplicated calls, can happen when ticking is split in multiple updates because the ball goes fast
  if (gameState.upgradesOfferedFor >= l) {
    return;
  }
  if (!gameState.running && l > 0) return;
  if (!gameState.startParams.animated_perk_preview) {
    pause(false);
    gameState.upgradesOfferedFor = l;
  }
  stopRecording();

  gameState.currentLevel = l;
  gameState.level = gameState.runLevels[l % gameState.runLevels.length];

  if (l > 0) {
    await openUpgradesPicker(gameState);
  }

  gameState.levelTime = 0;
  gameState.winAt = 0;
  gameState.levelWallBounces = 0;
  gameState.lastPuckMove = 0;
  gameState.lastZenComboIncrease = 0;
  gameState.autoCleanUses = 0;

  gameState.lastTickDown = gameState.levelTime;
  gameState.levelStartScore = gameState.score;
  gameState.levelSpawnedCoins = 0;
  gameState.levelCaughtCoins = 0;
  gameState.levelBrickBroken = 0;
  gameState.levelLostCoins = 0;
  gameState.levelMisses = 0;
  gameState.lastBrickBroken = 0;
  gameState.runStatistics.levelsPlayed++;

  // Reset combo silently
  const finalCombo = gameState.combo;
  gameState.combo = baseCombo(gameState);
  if (gameState.perks.shunt) {
    gameState.combo += Math.round(
      Math.max(
        0,
        (finalCombo - gameState.combo) *
          comboKeepingRate(gameState.perks.shunt),
      ),
    );
  }

  gameState.combo += gameState.perks.hot_start * 30;

  const lvl = currentLevelInfo(gameState);
  if (lvl.size !== gameState.gridSize) {
    gameState.gridSize = lvl.size;
    fitSize(gameState);
  }
  gameState.levelLostCoins += empty(gameState.coins);
  empty(gameState.particles);
  empty(gameState.lights);
  empty(gameState.texts);
  empty(gameState.respawns);
  gameState.bricks = [];

  for (let i = 0; i < lvl.size * lvl.size; i++) {
    setBrick(gameState, i, lvl.bricks[i]);
  }

  // Balls color will depend on most common brick color sometimes
  resetBalls(gameState);
  gameState.needsRender = true;
  // This caused problems with accented characters like the ô of côte d'ivoire for odd reasons
  // background.src = 'data:image/svg+xml;base64,' + btoa(lvl.svg)
  background.src = "data:image/svg+xml;UTF8," + lvl.svg;
  document.body.style.setProperty("--level-background", lvl.color || "#000000");
  document
    .getElementById("themeColor")
    ?.setAttribute("content", lvl.color || "#000000");
}

function setBrick(gameState: GameState, index: number, color: string) {
  gameState.bricks[index] = color || "";
  gameState.brickHP[index] =
    (color === "black" && 1) ||
    (color && 1 + gameState.perks.sturdy_bricks) ||
    0;
}

const rainbow = [
  "#ff2e2e",
  "#ffe02e",
  "#70ff33",
  "#33ffa7",
  "#38acff",
  "#6262EA",
  "#ff3de5",
];

export function rainbowColor(gameState: GameState): colorString {
  return rainbow[Math.floor(gameState.levelTime / 50) % rainbow.length];
}

export function repulse(
  gameState: GameState,
  a: Ball,
  b: BallLike,
  power: number,
  impactsBToo: boolean,
) {
  const distance = distanceBetween(a, b);
  // Ensure we don't get soft locked
  const max = gameState.gameZoneWidth / 4;
  if (distance > max) return;
  // Unit vector
  const dx = (a.x - b.x) / distance;
  const dy = (a.y - b.y) / distance;
  const fact =
    (((-power * (max - distance)) / (max * 1.2) / 3) *
      Math.min(500, gameState.levelTime)) /
    500;
  if (
    impactsBToo &&
    typeof b.vx !== "undefined" &&
    typeof b.vy !== "undefined"
  ) {
    b.vx += dx * fact;
    b.vy += dy * fact;
  }
  a.vx -= dx * fact;
  a.vy -= dy * fact;

  const speed = 10;
  const rand = 2;
  makeParticle(
    gameState,
    a.x,
    a.y,
    -dx * speed + a.vx + (Math.random() - 0.5) * rand,
    -dy * speed + a.vy + (Math.random() - 0.5) * rand,
    rainbowColor(gameState),
    true,
    8,
    100,
  );
  if (
    impactsBToo &&
    typeof b.vx !== "undefined" &&
    typeof b.vy !== "undefined"
  ) {
    makeParticle(
      gameState,
      b.x,
      b.y,
      dx * speed + b.vx + (Math.random() - 0.5) * rand,
      dy * speed + b.vy + (Math.random() - 0.5) * rand,
      rainbowColor(gameState),
      true,
      8,
      100,
    );
  }
}

export function attract(gameState: GameState, a: Ball, b: Ball, power: number) {
  const distance = distanceBetween(a, b);
  // Ensure we don't get soft locked
  const min = (gameState.gameZoneWidth * 3) / 4;
  if (distance < min) return;
  // Unit vector
  const dx = (a.x - b.x) / distance;
  const dy = (a.y - b.y) / distance;

  const fact =
    (((power * (distance - min)) / min) * Math.min(500, gameState.levelTime)) /
    500;
  b.vx += dx * fact;
  b.vy += dy * fact;
  a.vx -= dx * fact;
  a.vy -= dy * fact;

  const speed = 10;
  const rand = 2;

  makeParticle(
    gameState,
    a.x,
    a.y,
    dx * speed + a.vx + (Math.random() - 0.5) * rand,
    dy * speed + a.vy + (Math.random() - 0.5) * rand,
    rainbowColor(gameState),
    true,
    8,
    100,
  );
  makeParticle(
    gameState,
    b.x,
    b.y,
    -dx * speed + b.vx + (Math.random() - 0.5) * rand,
    -dy * speed + b.vy + (Math.random() - 0.5) * rand,
    rainbowColor(gameState),
    true,
    8,
    100,
  );
}

export function coinBrickHitCheck(gameState: GameState, coin: Coin) {
  // Make ball/coin bonce, and return bricks that were hit
  const radius = coin.size / 2;
  const { x, y, previousX, previousY } = coin;

  const vhit = hitsSomething(gameState, previousX, y, radius);
  const hhit = hitsSomething(gameState, x, previousY, radius);
  const chit =
    (typeof vhit == "undefined" &&
      typeof hhit == "undefined" &&
      hitsSomething(gameState, x, y, radius)) ||
    undefined;

  if (typeof (vhit ?? hhit ?? chit) !== "undefined") {
    if (gameState.perks.ghost_coins) {
      //     slow down
      coin.vy *= 1 - 0.2 / gameState.perks.ghost_coins;
      coin.vx *= 1 - 0.2 / gameState.perks.ghost_coins;
    } else {
      if (typeof vhit !== "undefined" || typeof chit !== "undefined") {
        coin.y = coin.previousY;
        coin.vy *= -1;

        //   Roll on corners
        const leftHit =
          gameState.bricks[brickIndex(gameState, x - radius, y + radius)];
        const rightHit =
          gameState.bricks[brickIndex(gameState, x + radius, y + radius)];

        if (leftHit && !rightHit) {
          coin.vx += 1;
          coin.sa -= 1;
        }
        if (!leftHit && rightHit) {
          coin.vx -= 1;
          coin.sa += 1;
        }
      }
      if (typeof hhit !== "undefined" || typeof chit !== "undefined") {
        coin.x = coin.previousX;
        coin.vx *= -1;
      }
    }
  }
  return vhit ?? hhit ?? chit;
}

export function bordersHitCheck(
  gameState: GameState,
  coin: Coin | Ball,
  radius: number,
  delta: number,
) {
  if (coin.destroyed) return 0;
  coin.previousX = coin.x;
  coin.previousY = coin.y;
  coin.x += coin.vx * delta;
  coin.y += coin.vy * delta;

  if (gameState.perks.wind) {
    coin.vx +=
      ((gameState.puckPosition -
        (gameState.offsetX + gameState.gameZoneWidth / 2)) /
        gameState.gameZoneWidth) *
      gameState.perks.wind *
      0.5;
  }

  let vhit = 0,
    hhit = 0;

  if (
    coin.x < gameState.offsetXRoundedDown + radius &&
    gameState.perks.left_is_lava < 2
  ) {
    coin.x =
      gameState.offsetXRoundedDown +
      radius +
      (gameState.offsetXRoundedDown + radius - coin.x);
    coin.vx *= -1;
    hhit = 1;
  }
  if (coin.y < radius && gameState.perks.top_is_lava < 2) {
    coin.y = radius + (radius - coin.y);
    coin.vy *= -1;
    vhit = 1;
  }
  if (
    coin.x > gameState.canvasWidth - gameState.offsetXRoundedDown - radius &&
    gameState.perks.right_is_lava < 2
  ) {
    coin.x =
      gameState.canvasWidth -
      gameState.offsetXRoundedDown -
      radius -
      (coin.x -
        (gameState.canvasWidth - gameState.offsetXRoundedDown - radius));
    coin.vx *= -1;
    hhit = 1;
  }

  return hhit + vhit * 2;
}

export function gameStateTick(
  gameState: GameState,
  // How many frames to compute at once, can go above 1 to compensate lag
  frames = 1,
) {
  // Going to the next level or getting a game over in a previous sub-tick would pause the game
  if (!gameState.running) {
    return;
  }
  // Ai movement of puck
  if (
    gameState.startParams.computer_controlled ||
    gameState.startParams.animated_perk_preview
  )
    computerControl(gameState);

  gameState.runStatistics.max_combo = Math.max(
    gameState.runStatistics.max_combo,
    gameState.combo,
  );
  gameState.lastCombo = gameState.combo;
  zenTick(gameState);

  if (
    gameState.perks.addiction &&
    gameState.lastBrickBroken &&
    gameState.lastBrickBroken <
      gameState.levelTime - 5000 / gameState.perks.addiction
  ) {
    resetCombo(
      gameState,
      gameState.puckPosition,
      gameState.gameZoneHeight - gameState.puckHeight * 2,
    );
    // In case you have soft reset, we shouldn't immediately reset it again next frame
    gameState.lastBrickBroken = gameState.levelTime;
  }

  gameState.balls = gameState.balls.filter((ball) => !ball.destroyed);

  let remainingBricks = 0;
  for (let b of gameState.bricks) {
    if (b && b !== "black") {
      remainingBricks++;
    }
  }

  if (!remainingBricks && gameState.lastBrickBroken) {
    // Avoid a combo reset just because we're waiting for coins
    gameState.lastBrickBroken = 0;
  }

  if (gameState.perks.hot_start) {
    if (gameState.combo === baseCombo(gameState)) {
      // Give 1s of time between catching a coin and tick down
      gameState.lastTickDown = gameState.levelTime;
    } else if (gameState.levelTime > gameState.lastTickDown + 1000) {
      gameState.lastTickDown = gameState.levelTime;
      offsetCombo(
        gameState,
        -gameState.perks.hot_start,
        gameState.puckPosition,
        gameState.gameZoneHeight - 2 * gameState.puckHeight,
      );
    }
  }

  if (
    (window.location.search.includes("skipplaying") ||
      (gameState.perks.skip_last &&
        remainingBricks <= gameState.perks.skip_last)) &&
    !gameState.autoCleanUses
  ) {
    gameState.bricks.forEach((type, index) => {
      if (type) {
        explodeBrick(gameState, index, gameState.balls[0], true);
        spawnXShapedParticlesExplosion(
          gameState,
          10,
          brickCenterX(gameState, index),
          brickCenterY(gameState, index),
          type,
        );
      }
    });
    gameState.autoCleanUses++;
  }

  const hasPendingBricks = liveCount(gameState.respawns);

  if (!remainingBricks && !hasPendingBricks) {
    if (!gameState.winAt) {
      gameState.winAt = gameState.levelTime + 5000;
    }
  } else {
    gameState.winAt = 0;
  }

  if (
    // Lost ball while waiting to win, will level up for fairness
    (gameState.winAt && !gameState.balls.find((b) => !b.destroyed)) ||
    // Delayed win when coins are still flying
    (gameState.winAt && gameState.levelTime > gameState.winAt) ||
    //   instant win condition
    (gameState.levelTime &&
      !remainingBricks &&
      !hasPendingBricks &&
      !liveCount(gameState.coins))
  ) {
    if (gameState.startParams.computer_controlled) {
      startComputerControlledGame(gameState.startParams.stress);
    } else if (gameState.startParams.animated_perk_preview) {
      gameState.isGameOver = true;
    } else if (gameState.currentLevel + 1 < max_levels(gameState)) {
      setLevel(gameState, gameState.currentLevel + 1);
    } else {
      gameOver(t("gameOver.win.title"), t("gameOver.win.summary"));
    }
  } else {
    const coinRadius = Math.round(gameState.coinSize / 2);

    forEachLiveOne(gameState.coins, (coin, coinIndex) => {
      if (gameState.perks.coin_magnet) {
        const strength =
          (100 /
            (100 +
              Math.pow(coin.y - gameState.gameZoneHeight, 2) +
              Math.pow(coin.x - gameState.puckPosition, 2))) *
          gameState.perks.coin_magnet;

        const attractionX =
          frames * (gameState.puckPosition - coin.x) * strength;

        coin.vx += attractionX;
        coin.vy +=
          (frames * (gameState.gameZoneHeight - coin.y) * strength) / 2;
        coin.sa -= attractionX / 10;
      }

      if (gameState.perks.ball_attracts_coins && gameState.balls.length) {
        // Find closest ball
        let closestBall = getClosestBall(gameState, coin.x, coin.y);
        if (closestBall) {
          let dist = distance2(closestBall, coin);

          const minDist = gameState.brickWidth * gameState.brickWidth;
          if (
            dist > minDist &&
            dist < minDist * 4 * 4 * gameState.perks.ball_attracts_coins
          ) {
            // Slow down coins in effect radius
            const ratio =
              1 - 0.02 * (0.5 + gameState.perks.ball_attracts_coins);
            coin.vx *= ratio;
            coin.vy *= ratio;
            coin.vy *= ratio;
            // Carry them
            const dx =
              ((closestBall.x - coin.x) / dist) *
              50 *
              gameState.perks.ball_attracts_coins;
            const dy =
              ((closestBall.y - coin.y) / dist) *
              50 *
              gameState.perks.ball_attracts_coins;
            coin.vx += dx;
            coin.vy += dy;

            if (
              Math.random() * gameState.perks.ball_attracts_coins * frames >
              0.9
            ) {
              makeParticle(
                gameState,
                coin.x + dx * 5,
                coin.y + dy * 5,
                dx * 2,
                dy * 2,
                rainbowColor(gameState),
                true,
                8,
                100,
              );
            }
          }
        }
      }

      if (gameState.perks.bricks_attract_coins) {
        goToNearestBrick(
          gameState,
          coin,
          gameState.perks.bricks_attract_coins * frames,
          2,
          false,
        );
      }

      const ratio =
        1 -
        ((gameState.perks.viscosity * 0.03 +
          0.002 +
          (coin.y > gameState.gameZoneHeight ? 0.2 : 0)) *
          frames) /
          (1 + gameState.perks.etherealcoins);

      if (!gameState.perks.etherealcoins) {
        coin.vy *= ratio;
        coin.vx *= ratio;
      }
      if (
        coin.y > gameState.gameZoneHeight &&
        coin.floatingTime < gameState.perks.buoy * 30
      ) {
        coin.floatingTime += frames;
        coin.vy -= 1.5;
      }

      if (coin.vx > 7 * gameState.baseSpeed) coin.vx = 7 * gameState.baseSpeed;
      if (coin.vx < -7 * gameState.baseSpeed)
        coin.vx = -7 * gameState.baseSpeed;
      if (coin.vy > 7 * gameState.baseSpeed) coin.vy = 7 * gameState.baseSpeed;
      if (coin.vy < -7 * gameState.baseSpeed)
        coin.vy = -7 * gameState.baseSpeed;
      coin.a += coin.sa;

      let dvy = frames * coin.weight * 0.8;

      if (gameState.perks.etherealcoins) {
        dvy = 0;
      }

      if (gameState.perks.helium && coin.y < gameState.gameZoneHeight) {
        const underPaddle =
          Math.abs(coin.x - gameState.puckPosition) * 2 <
          gameState.puckWidth + coin.size;
        dvy -=
          (underPaddle ? -0.05 : 1) *
          gameState.perks.helium *
          frames *
          coin.weight *
          0.7;
      }

      coin.vy += dvy;

      const speed = (Math.abs(coin.vx) + Math.abs(coin.vy)) * 10;

      const hitBorder = bordersHitCheck(gameState, coin, coin.size / 2, frames);

      if (
        gameState.perks.wrap_left > 1 &&
        hitBorder % 2 &&
        coin.previousX < gameState.offsetX + gameState.gameZoneWidth / 2
      ) {
        schedulGameSound(gameState, "plouf", coin.x, 1);
        coin.x =
          gameState.offsetX + gameState.gameZoneWidth - gameState.coinSize;
        if (coin.vx > 0) {
          coin.vx *= -1;
        }
        spawnParticlesExplosion(gameState, 3, coin.x, coin.y, "#6262EA");
        spawnParticlesImplosion(
          gameState,
          3,
          coin.previousX,
          coin.previousY,
          "#6262EA",
        );
      }

      if (
        gameState.perks.wrap_right > 1 &&
        hitBorder % 2 &&
        coin.previousX > canvasCenterX(gameState)
      ) {
        schedulGameSound(gameState, "plouf", coin.x, 1);
        coin.x = gameState.offsetX + gameState.coinSize;

        if (coin.vx < 0) {
          coin.vx *= -1;
        }
        spawnParticlesExplosion(gameState, 3, coin.x, coin.y, "#6262EA");
        spawnParticlesImplosion(
          gameState,
          3,
          coin.previousX,
          coin.previousY,
          "#6262EA",
        );
      }

      if (gameState.perks.wrap_up > 1 && hitBorder >= 2) {
        applyWrapUp(gameState, coin, gameState.coinSize / 2);
      }

      if (
        coin.previousY < gameState.gameZoneHeight &&
        coin.y > gameState.gameZoneHeight &&
        coin.vy > 0 &&
        speed > 20 &&
        !coin.floatingTime
      ) {
        schedulGameSound(
          gameState,
          "plouf",
          coin.x,
          (clamp(speed, 20, 100) / 100) * 0.2,
        );
        makeParticle(
          gameState,
          coin.x,
          gameState.gameZoneHeight,
          -coin.vx / 5,
          -coin.vy / 5,
          getCoinRenderColor(gameState, coin),
          false,
        );
      }

      if (
        coin.y > gameState.gameZoneHeight - coinRadius - gameState.puckHeight &&
        coin.y < gameState.gameZoneHeight + gameState.puckHeight + coin.vy &&
        Math.abs(coin.x - gameState.puckPosition) <
          coinRadius +
            gameState.puckWidth / 2 +
            // a bit of margin to be nice , negative in case it's a negative coin
            gameState.puckHeight * (coin.points ? 1 : -1) &&
        !isMovingWhilePassiveIncome(gameState)
      ) {
        addToScore(gameState, coin);
        destroy(gameState.coins, coinIndex);
      } else if (
        coin.y > gameState.canvasHeight + coinRadius * 10 ||
        coin.y < -coinRadius * 10 ||
        coin.x < -coinRadius * 10 ||
        coin.x > gameState.canvasWidth + coinRadius * 10
      ) {
        gameState.levelLostCoins += coin.points;
        destroy(gameState.coins, coinIndex);
        if (gameState.perks.compound_interest && gameState.perks.buoy) {
          // If you have buoy, we wait a bit more before declaring a coin "lost"
          resetCombo(gameState, coin.x, coin.y, coin);
        }

        if (
          gameState.combo < gameState.perks.fountain_toss * 30 &&
          Math.random() / coin.points <
            (1 / gameState.combo) * gameState.perks.fountain_toss
        ) {
          offsetCombo(gameState, 1, coin.x, coin.y, coin);
        }
      } else if (
        gameState.perks.compound_interest &&
        coin.previousY < gameState.gameZoneHeight &&
        coin.y > gameState.gameZoneHeight &&
        coin.vy > 0 &&
        speed > 20 &&
        !coin.floatingTime &&
        !gameState.perks.buoy
      ) {
        // Prematurely reset combo as soon as coin is missed
        // If you don't have buoy, we directly declare the coin "lost" to make it clear
        resetCombo(gameState, coin.x, coin.y, coin);
      }

      const positionBeforeBrickBounceX = coin.x;
      const positionBeforeBrickBounceY = coin.y;
      const hitBrick = coinBrickHitCheck(gameState, coin);
      if (gameState.perks.metamorphosis && typeof hitBrick !== "undefined") {
        if (
          gameState.bricks[hitBrick] &&
          coin.color !== gameState.bricks[hitBrick] &&
          gameState.bricks[hitBrick] !== "black" &&
          coin.metamorphosisPoints
        ) {
          // Not using setbrick because we don't want to reset HP
          gameState.bricks[hitBrick] = coin.color;
          coin.metamorphosisPoints--;
          schedulGameSound(gameState, "colorChange", coin.x, 0.3);
        }
      }

      if (
        gameState.perks.sticky_coins &&
        typeof hitBrick !== "undefined" &&
        (coin.color === gameState.bricks[hitBrick] ||
          gameState.perks.sticky_coins > 1)
      ) {
        if (coin.collidedLastFrame) {
          coin.x = coin.previousX;
          coin.y = coin.previousY;
        } else {
          coin.x = positionBeforeBrickBounceX;
          coin.y = positionBeforeBrickBounceY;
        }
        coin.vx = 0;
        coin.vy = 0;
      }

      // Sound and slow down
      if (
        (!gameState.perks.ghost_coins && typeof hitBrick !== "undefined") ||
        hitBorder
      ) {
        const ratio = 1 - 0.2 / (1 + gameState.perks.etherealcoins);
        coin.vx *= ratio;
        coin.vy *= ratio;
        if (Math.abs(coin.vy) < 1) {
          coin.vy = 0;
        }
        coin.sa *= 0.9;
        if (speed > 20 && !coin.collidedLastFrame) {
          schedulGameSound(gameState, "coinBounce", coin.x, 0.2);
        }
      }

      if (
        (gameState.perks.golden_goose && typeof hitBrick !== "undefined") ||
        (gameState.perks.golden_goose > 1 && hitBorder)
      ) {
        const closestBall = getClosestBall(gameState, coin.x, coin.y);
        if (closestBall) {
          spawnParticlesExplosion(gameState, 3, coin.x, coin.y, "#6262EA");
          spawnParticlesImplosion(
            gameState,
            3,
            closestBall.x,
            closestBall.y,
            "#6262EA",
          );
          coin.x = closestBall.x;
          coin.y = closestBall.y;
        }
      }

      // remember collision
      coin.collidedLastFrame = !!(typeof hitBrick !== "undefined" || hitBorder);
    });

    gameState.balls.forEach((ball) => ballTick(gameState, ball, frames));

    if (gameState.perks.shocks) {
      gameState.balls.forEach((a, ai) =>
        gameState.balls.forEach((b, bi) => {
          if (
            ai < bi &&
            !a.destroyed &&
            !b.destroyed &&
            distance2(a, b) < gameState.ballSize * gameState.ballSize
          ) {
            // switch speeds
            let tempVx = a.vx;
            let tempVy = a.vy;
            a.vx = b.vx;
            a.vy = b.vy;
            b.vx = tempVx;
            b.vy = tempVy;
            // Compute center
            let x = (a.x + b.x) / 2;
            let y = (a.y + b.y) / 2;
            // space out the balls with extra speed
            const limit = (gameState.baseSpeed * gameState.perks.shocks) / 2;
            a.vx +=
              clamp(a.x - x, -limit, limit) +
              ((Math.random() - 0.5) * limit) / 3;
            a.vy +=
              clamp(a.y - y, -limit, limit) +
              ((Math.random() - 0.5) * limit) / 3;
            b.vx +=
              clamp(b.x - x, -limit, limit) +
              ((Math.random() - 0.5) * limit) / 3;
            b.vy +=
              clamp(b.y - y, -limit, limit) +
              ((Math.random() - 0.5) * limit) / 3;

            let index = brickIndex(gameState, x, y);
            explosionAt(
              gameState,
              index,
              x,
              y,
              a,
              Math.max(0, gameState.perks.shocks - 1),
            );
          }
        }),
      );
    }

    if (gameState.perks.wind) {
      const windD =
        ((gameState.puckPosition - canvasCenterX(gameState)) /
          gameState.gameZoneWidth) *
        2 *
        gameState.perks.wind;
      for (let i = 0; i < gameState.perks.wind; i++) {
        if (Math.random() * Math.abs(windD) > 0.5) {
          makeParticle(
            gameState,
            gameState.offsetXRoundedDown +
              Math.random() * gameState.gameZoneWidthRoundedUp,
            Math.random() * gameState.gameZoneHeight,
            windD * 8,
            0,
            rainbowColor(gameState),
            true,
            8,
            150,
          );
        }
      }
    }
    forEachLiveOne(gameState.particles, (flash, index) => {
      flash.x += flash.vx * frames;
      flash.y += flash.vy * frames;
      if (!flash.ethereal) {
        flash.vy += 0.5 * frames;
        if (hasBrick(gameState, brickIndex(gameState, flash.x, flash.y))) {
          destroy(gameState.particles, index);
        }
      }
    });
  }

  if (
    gameState.combo > baseCombo(gameState) &&
    (gameState.combo - baseCombo(gameState)) * Math.random() * frames > 5
  ) {
    // The red should still be visible on a white bg

    if (gameState.perks.top_is_lava == 1) {
      makeParticle(
        gameState,
        gameState.offsetXRoundedDown +
          Math.random() * gameState.gameZoneWidthRoundedUp,
        0,
        (Math.random() - 0.5) * 10,
        5,
        "#FF0000",
        true,
        8,
        100 * (Math.random() + 1),
      );
    }

    if (gameState.perks.left_is_lava == 1) {
      makeParticle(
        gameState,
        gameState.offsetXRoundedDown,
        Math.random() * gameState.gameZoneHeight,
        5,
        (Math.random() - 0.5) * 10,
        "#FF0000",
        true,
        8,
        100 * (Math.random() + 1),
      );
    }

    if (gameState.perks.right_is_lava == 1) {
      makeParticle(
        gameState,
        gameState.offsetXRoundedDown + gameState.gameZoneWidthRoundedUp,
        Math.random() * gameState.gameZoneHeight,
        -5,
        (Math.random() - 0.5) * 10,
        "#FF0000",
        true,
        8,
        100 * (Math.random() + 1),
      );
    }

    if (gameState.perks.compound_interest) {
      let x = gameState.puckPosition,
        attemps = 0;
      do {
        x =
          gameState.offsetXRoundedDown +
          gameState.gameZoneWidthRoundedUp * Math.random();
        attemps++;
      } while (
        Math.abs(x - gameState.puckPosition) < gameState.puckWidth / 2 &&
        attemps < 10
      );

      makeParticle(
        gameState,
        x,
        gameState.gameZoneHeight,
        (Math.random() - 0.5) * 10,
        -5,
        "#FF0000",
        true,
        8,
        100 * (Math.random() + 1),
      );
    }
    if (
      gameState.perks.streak_shots &&
      !isMovingWhilePassiveIncome(gameState)
    ) {
      const pos = 0.5 - Math.random();
      makeParticle(
        gameState,
        gameState.puckPosition + gameState.puckWidth * pos,
        gameState.gameZoneHeight - gameState.puckHeight,
        pos * 10,
        -5,
        "#FF0000",
        true,
        8,
        100 * (Math.random() + 1),
      );
    }
  }

  addGravityParticules(gameState, frames);

  if (
    gameState.perks.wrap_left &&
    gameState.perks.left_is_lava < 2 &&
    Math.random() * frames > 0.1
  ) {
    makeParticle(
      gameState,
      zoneLeftBorderX(gameState),
      Math.random() * gameState.gameZoneHeight,
      5,
      (Math.random() - 0.5) * 10,
      "#6262EA",
      true,
      8,
      100 * (Math.random() + 1),
    );
  }
  if (
    gameState.perks.wrap_right &&
    gameState.perks.right_is_lava < 2 &&
    Math.random() * frames > 0.1
  ) {
    makeParticle(
      gameState,
      zoneRightBorderX(gameState),
      Math.random() * gameState.gameZoneHeight,
      -5,
      (Math.random() - 0.5) * 10,
      "#6262EA",
      true,
      8,
      100 * (Math.random() + 1),
    );
  }

  // Respawn what's needed, show particles
  forEachLiveOne(gameState.respawns, (r, ri) => {
    if (gameState.bricks[r.index]) {
      destroy(gameState.respawns, ri);
    } else if (gameState.levelTime > r.time) {
      setBrick(gameState, r.index, r.color);
      destroy(gameState.respawns, ri);
    } else {
      const { index, color } = r;
      const vertical = Math.random() > 0.5;
      const dx = Math.random() > 0.5 ? 1 : -1;
      const dy = Math.random() > 0.5 ? 1 : -1;

      makeParticle(
        gameState,
        brickCenterX(gameState, index) + (dx * gameState.brickWidth) / 2,
        brickCenterY(gameState, index) + (dy * gameState.brickWidth) / 2,
        vertical ? 0 : -dx * gameState.baseSpeed,
        vertical ? -dy * gameState.baseSpeed : 0,
        color,
        true,
        8,
        250,
      );
    }
  });

  forEachLiveOne(gameState.particles, (p, pi) => {
    if (gameState.levelTime > p.time + p.duration) {
      destroy(gameState.particles, pi);
    }
  });
  forEachLiveOne(gameState.texts, (p, pi) => {
    if (gameState.levelTime > p.time + p.duration) {
      destroy(gameState.texts, pi);
    }
  });
  forEachLiveOne(gameState.lights, (p, pi) => {
    if (gameState.levelTime > p.time + p.duration) {
      destroy(gameState.lights, pi);
    }
  });
}

function applyNBrickPerk(gameState: GameState, ball: Ball) {
  if (gameState.perks.nbricks) {
    if (ball.brokenSinceWallOrPaddleBounce > gameState.perks.nbricks * 2) {
      resetCombo(gameState, ball.x, ball.y, ball);
    }
  }
}

export function ballTick(gameState: GameState, ball: Ball, frames: number) {
  ball.previousVX = ball.vx;
  ball.previousVY = ball.vy;

  let speedLimitDampener =
    1 +
    gameState.perks.telekinesis +
    gameState.perks.ball_repulse_ball +
    gameState.perks.puck_repulse_ball +
    gameState.perks.ball_attract_ball;

  // Speed changes

  if (telekinesisEffectRate(gameState, ball) > 0) {
    speedLimitDampener += 3;
    ball.vx +=
      ((gameState.puckPosition - ball.x) / 1000) *
      frames *
      gameState.perks.telekinesis *
      telekinesisEffectRate(gameState, ball);
  }
  if (yoyoEffectRate(gameState, ball) > 0) {
    speedLimitDampener += 3;
    ball.vx +=
      (gameState.puckPosition > ball.x ? 1 : -1) *
      frames *
      yoyoEffectRate(gameState, ball);
  }

  if (ball.hitSinceBounce < gameState.perks.bricks_attract_ball * 3) {
    goToNearestBrick(
      gameState,
      ball,
      gameState.perks.bricks_attract_ball * frames * 0.2,
      2 + gameState.perks.bricks_attract_ball,
      Math.random() < 0.5 * frames,
    );
  }
  if (ball.hasGravity) {
    speedLimitDampener += 3;
    ball.vy += 0.3 * frames;
  }

  if (
    ball.vx * ball.vx + ball.vy * ball.vy <
    gameState.baseSpeed * gameState.baseSpeed * 2
  ) {
    ball.vx *= 1 + 0.02 / speedLimitDampener;
    ball.vy *= 1 + 0.02 / speedLimitDampener;
  } else {
    ball.vx *= 1 - 0.02 / speedLimitDampener;
    ball.vy *= 1 - 0.02 / speedLimitDampener;
  }

  // Ball could get stuck horizontally because of ball-ball interactions in repulse/attract
  if (Math.abs(ball.vy) < 0.2 * gameState.baseSpeed) {
    ball.vy += ((ball.vy > 0 ? 1 : -1) * 0.02) / speedLimitDampener;
  }

  if (gameState.perks.ball_repulse_ball) {
    for (let b2 of gameState.balls) {
      // avoid computing this twice, and repulsing itself
      if (b2.x >= ball.x) continue;
      repulse(gameState, ball, b2, gameState.perks.ball_repulse_ball, true);
    }
  }

  if (gameState.perks.ball_attract_ball) {
    for (let b2 of gameState.balls) {
      // avoid computing this twice, and repulsing itself
      if (b2.x >= ball.x) continue;
      attract(gameState, ball, b2, gameState.perks.ball_attract_ball);
    }
  }

  if (
    gameState.perks.puck_repulse_ball &&
    Math.abs(ball.x - gameState.puckPosition) <
      gameState.puckWidth / 2 +
        (gameState.ballSize * (9 + gameState.perks.puck_repulse_ball)) / 10
  ) {
    repulse(
      gameState,
      ball,
      {
        x: gameState.puckPosition,
        y: gameState.gameZoneHeight,
      },
      gameState.perks.puck_repulse_ball + 1,
      false,
    );
  }

  if (gameState.perks.steering) {
    const delta = gameState.puckPosition - gameState.lastPuckPosition;
    if (Math.abs(delta) > 1) {
      const angle =
        Math.atan2(ball.vy, ball.vx) +
        ((((delta / gameState.gameZoneWidth) * Math.PI) / 2) *
          gameState.perks.steering *
          frames) /
          2;
      const d = Math.sqrt(ball.vy * ball.vy + ball.vx * ball.vx);
      ball.vy = Math.sin(angle) * d;
      ball.vx = Math.cos(angle) * d;
      if (Math.random() < frames) {
        makeParticle(
          gameState,
          ball.x,
          ball.y,
          -ball.vx / 10,
          -ball.vy / 10,
          "#6262EA",
          true,
          8,
          500,
        );
      }
    }
  }

  // Bounces
  const borderHitCode = bordersHitCheck(
    gameState,
    ball,
    gameState.ballSize / 2,
    frames,
  );
  if (borderHitCode) {
    if (borderHitCode > 1) {
      ball.topHitsSinceBounce++;
    }
    if (borderHitCode % 2) {
      ball.sidesHitsSinceBounce++;
    }
    ball.brokenSinceWallOrPaddleBounce = 0;
    if (
      ball.sidesHitsSinceBounce + ball.topHitsSinceBounce <=
      gameState.perks.three_cushion * 3
    ) {
      offsetCombo(gameState, 1, ball.x, ball.y, ball);
    }
    if (
      gameState.perks.wrap_left &&
      borderHitCode % 2 &&
      // x might be moved by wrap, so we rely on previousX
      ball.previousX < gameState.offsetX + gameState.gameZoneWidth / 2 &&
      underWrapLimit(gameState, ball)
    ) {
      schedulGameSound(gameState, "plouf", ball.x, 1);
      ball.x = gameState.offsetX + gameState.gameZoneWidth - gameState.ballSize;
      if (ball.vx > 0) {
        ball.vx *= -1;
      }

      spawnParticlesExplosion(gameState, 7, ball.x, ball.y, "#6262EA");
      spawnParticlesImplosion(
        gameState,
        7,
        ball.previousX,
        ball.previousY,
        "#6262EA",
      );
    }

    if (
      gameState.perks.wrap_right &&
      borderHitCode % 2 &&
      // x might be moved by wrap, so we rely on previousX
      ball.previousX > gameState.offsetX + gameState.gameZoneWidth / 2 &&
      underWrapLimit(gameState, ball)
    ) {
      schedulGameSound(gameState, "plouf", ball.x, 1);
      ball.x = gameState.offsetX + gameState.ballSize;

      if (ball.vx < 0) {
        ball.vx *= -1;
      }

      spawnParticlesExplosion(gameState, 7, ball.x, ball.y, "#6262EA");
      spawnParticlesImplosion(
        gameState,
        7,
        ball.previousX,
        ball.previousY,
        "#6262EA",
      );
    }

    if (
      gameState.perks.wrap_up &&
      borderHitCode >= 2 &&
      underWrapLimit(gameState, ball)
    ) {
      applyWrapUp(gameState, ball, gameState.ballSize / 2);
    }

    if (
      gameState.perks.left_is_lava &&
      borderHitCode % 2 &&
      // x might be moved by wrap, so we rely on previousX
      ball.previousX < gameState.offsetX + gameState.gameZoneWidth / 2
    ) {
      resetCombo(gameState, ball.x, ball.y, ball);
    }

    if (
      gameState.perks.right_is_lava &&
      borderHitCode % 2 &&
      // x might be moved by wrap, so we rely on previousX
      ball.previousX > gameState.offsetX + gameState.gameZoneWidth / 2
    ) {
      resetCombo(gameState, ball.x, ball.y, ball);
    }

    if (gameState.perks.top_is_lava && borderHitCode >= 2) {
      resetCombo(gameState, ball.x, ball.y, ball);
    }
    if (gameState.perks.gravity_falls && borderHitCode >= 2) {
      applyGravity(gameState, ball);
    }

    if (gameState.perks.trampoline) {
      offsetCombo(gameState, -gameState.perks.trampoline, ball.x, ball.y, ball);
    }

    if (gameState.perks.disco_ball) {
      const currentColorIndex = rainbow.indexOf(gameState.ballsColor);
      if (currentColorIndex === -1) {
        gameState.ballsColor = rainbowColor(gameState);
      } else {
        // cycle through predictably
        gameState.ballsColor =
          rainbow[(currentColorIndex + 1) % rainbow.length];
      }
    }

    schedulGameSound(gameState, "wallBeep", ball.x, 1);
    gameState.levelWallBounces++;
    gameState.runStatistics.wall_bounces++;
  }

  // Puck collision
  const ylimit =
    gameState.gameZoneHeight - gameState.puckHeight - gameState.ballSize / 2;
  const ballIsUnderPuck =
    Math.abs(ball.x - gameState.puckPosition) <
      gameState.ballSize / 2 + gameState.puckWidth / 2 &&
    !isMovingWhilePassiveIncome(gameState);
  if (ball.y > ylimit && ball.vy > 0 && ballIsUnderPuck) {
    const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    const angle = Math.atan2(
      -gameState.puckWidth / 2,
      (ball.x - gameState.puckPosition) *
        (gameState.perks.concave_puck
          ? -1 / (1 + gameState.perks.concave_puck)
          : 1),
    );
    ball.vx = speed * Math.cos(angle);
    ball.vy = speed * Math.sin(angle);
    schedulGameSound(gameState, "wallBeep", ball.x, 1);

    if (gameState.perks.streak_shots) {
      resetCombo(gameState, ball.x, ball.y, ball);
    }

    offsetCombo(
      gameState,
      gameState.perks.trampoline +
        gameState.perks.happy_family * Math.max(0, gameState.balls.length - 1),
      ball.x,
      ball.y,
      ball,
    );

    if (
      !ball.hitSinceBounce &&
      gameState.bricks.find((i) => i) &&
      !ball.bouncedToEmptyLevel &&
      ball.topHitsSinceBounce
    ) {
      if (gameState.levelMisses < gameState.perks.forgiving) {
        gameState.levelMisses++;
        makeText(
          gameState,
          gameState.puckPosition,
          gameState.gameZoneHeight - gameState.puckHeight * 2,
          "#00b2ff",
          t("play.forgiven"),
          gameState.puckHeight,
          500,
          ball.vx,
          ball.vy,
        );
      } else {
        gameState.levelMisses++;
        gameState.runStatistics.misses++;
        resetCombo(gameState, ball.x, ball.y, ball);
        makeText(
          gameState,
          gameState.puckPosition,
          gameState.gameZoneHeight - gameState.puckHeight * 2,
          "#FF0000",
          t("play.missed_ball"),
          gameState.puckHeight,
          500,
          ball.vx,
          ball.vy,
        );
      }
    }

    gameState.runStatistics.puck_bounces++;
    ball.hitSinceBounce = 0;
    ball.hasGravity = false;
    ball.bouncedToEmptyLevel = isBounceToEmptyLevel(gameState);
    ball.brokenSinceBounce = 0;
    ball.brokenSinceWallOrPaddleBounce = 0;
    ball.sidesHitsSinceBounce = 0;
    ball.topHitsSinceBounce = 0;
    ball.wrapsSinceBounce = 0;
    ball.sapperUses = 0;
    ball.piercePoints = gameState.perks.pierce * 2;
  }

  const outOfBounds =
    ball.y > gameState.gameZoneHeight + gameState.ballSize / 2 ||
    ball.y < -gameState.gameZoneHeight ||
    ball.x < -gameState.gameZoneHeight ||
    ball.x > gameState.canvasWidth + gameState.gameZoneHeight;

  const isLastBall = gameState.balls.filter((b) => !b.destroyed).length == 1;
  if (
    outOfBounds &&
    isLastBall &&
    gameState.perks.extra_life &&
    ball.y > gameState.gameZoneHeight
  ) {
    // bounce and loose a life
    ball.vy *= -1;
    justLostALife(gameState, ball.x, ball.y);
  } else if (outOfBounds && gameState.perks.extra_life && isLastBall) {
    // Rescue the ball using an extra life
    gameState.balls.forEach((b) => {
      // there should be just one but just in case
      b.vx = getBallDefaultVx(gameState);
      b.previousVX = b.vx;
      b.vy = -gameState.baseSpeed;
      b.previousVY = b.vy;
    });
    justLostALife(gameState, ball.x, ball.y);
    putBallsAtPuck(gameState);
    gameState.ballStickToPuck = true;
    if (!gameState.startParams.animated_perk_preview) pause(false);
  } else if (outOfBounds) {
    ball.destroyed = true;
    gameState.runStatistics.balls_lost++;
    if (gameState.perks.happy_family) {
      resetCombo(gameState, ball.x, ball.y, ball);
    }
    if (gameState.perks.thomas) {
      gameState.level.bricks.forEach((brick, index) => {
        if (
          brick &&
          !gameState.bricks[index] &&
          Math.random() > 1 / (1 + gameState.perks.thomas)
        ) {
          gameState.bricks[index] = gameState.level.bricks[index];
          if (brick !== "black") {
            spawnParticlesImplosion(
              gameState,
              10,
              brickCenterX(gameState, index),
              brickCenterY(gameState, index),
              brick,
            );
          }
        }
      });
    }

    // If you loose a ball while waiting to level up, setLevel is called and pauses the game
    // In that case it's ok to not have any ball, don't game over
    if (
      !gameState.balls.find((b) => !b.destroyed) &&
      gameState.running &&
      !gameState.winAt
    ) {
      if (gameState.startParams.computer_controlled) {
        startComputerControlledGame(gameState.startParams.stress);
      } else if (gameState.startParams.animated_perk_preview) {
        gameState.isGameOver = true;
      } else {
        window.highscores.setScore(gameState.highScore);
        gameOver(t("gameOver.lost.title"), t("gameOver.lost.summary"));
      }
    }
  }
  const radius = gameState.ballSize / 2;
  // Make ball/coin bonce, and return bricks that were hit
  const { x, y, previousX, previousY } = ball;

  const vhit = hitsSomething(gameState, previousX, y, radius);
  const hhit = hitsSomething(gameState, x, previousY, radius);
  const chit =
    (typeof vhit == "undefined" &&
      typeof hhit == "undefined" &&
      hitsSomething(gameState, x, y, radius)) ||
    undefined;

  const hitBrick = vhit ?? hhit ?? chit;

  if (typeof hitBrick !== "undefined") {
    const initialBrickColor = gameState.bricks[hitBrick];
    ball.hitSinceBounce++;

    if (
      !(ball.sidesHitsSinceBounce + ball.topHitsSinceBounce) &&
      gameState.perks.three_cushion
    ) {
      resetCombo(gameState, ball.x, ball.y, ball);
    }

    let pierce = false;
    let damage =
      1 +
      (shouldPierceByColor(gameState, vhit, hhit, chit)
        ? gameState.perks.pierce_color
        : 0);

    gameState.brickHP[hitBrick] -= damage;

    const used = Math.min(
      ball.piercePoints,
      Math.max(1, gameState.brickHP[hitBrick] + 1),
    );
    gameState.brickHP[hitBrick] -= used;
    ball.piercePoints -= used;

    if (gameState.brickHP[hitBrick] < 0) {
      gameState.brickHP[hitBrick] = 0;
      pierce = true;
    }
    if (typeof vhit !== "undefined" || typeof chit !== "undefined") {
      if (!pierce) {
        ball.y = ball.previousY;
        ball.vy *= -1;
      }
    }
    if (typeof hhit !== "undefined" || typeof chit !== "undefined") {
      if (!pierce) {
        ball.x = ball.previousX;
        ball.vx *= -1;
      }
    }

    if (!gameState.brickHP[hitBrick]) {
      ball.brokenSinceBounce++;
      ball.brokenSinceWallOrPaddleBounce++;
      applyNBrickPerk(gameState, ball);
      applyOttawaTreatyPerk(gameState, hitBrick, ball);
      explodeBrick(gameState, hitBrick, ball, false);
      if (
        ball.sapperUses < gameState.perks.sapper &&
        initialBrickColor !== "black" && // don't replace a brick that bounced with sturdy_bricks
        !gameState.bricks[hitBrick]
      ) {
        setBrick(gameState, hitBrick, "black");
        ball.sapperUses++;
      }
    } else {
      schedulGameSound(gameState, "wallBeep", x, 1);
      makeLight(
        gameState,
        brickCenterX(gameState, hitBrick),
        brickCenterY(gameState, hitBrick),
        initialBrickColor === "#FFFFFF" ? "#999999" : "#FFFFFF",
        gameState.brickWidth + 2,
        50 * gameState.brickHP[hitBrick],
      );
    }
  }

  if (ballTransparency(ball, gameState) < Math.random()) {
    const remainingPierce = ball.piercePoints;
    const remainingSapper = ball.sapperUses < gameState.perks.sapper ? 1 : 0;
    const willMiss =
      ball.vy > 0 &&
      !ball.hitSinceBounce &&
      !ball.bouncedToEmptyLevel &&
      ball.topHitsSinceBounce;
    const willBeForgiven =
      willMiss && gameState.levelMisses < gameState.perks.forgiving;
    const extraCombo = gameState.combo - 1;

    if (
      willMiss ||
      (extraCombo && Math.random() > 0.1 / (1 + extraCombo)) ||
      (remainingSapper && Math.random() > 0.1 / (1 + remainingSapper)) ||
      (extraCombo && Math.random() > 0.1 / (1 + extraCombo))
    ) {
      const color =
        (remainingSapper && (Math.random() > 0.5 ? "#ffb92a" : "#FF0000")) ||
        (willBeForgiven && "#00b2ff") ||
        (willMiss && "#FF0000") ||
        gameState.ballsColor;

      makeParticle(
        gameState,
        ball.x,
        ball.y,
        gameState.perks.pierce_color || remainingPierce
          ? -ball.vx + ((Math.random() - 0.5) * gameState.baseSpeed) / 3
          : (Math.random() - 0.5) * gameState.baseSpeed,
        gameState.perks.pierce_color || remainingPierce
          ? -ball.vy + ((Math.random() - 0.5) * gameState.baseSpeed) / 3
          : (Math.random() - 0.5) * gameState.baseSpeed,
        color,
        true,
        8,
        100,
      );
    }
  }
}

function justLostALife(gameState: GameState, x: number, y: number) {
  gameState.perks.extra_life -= 1;

  if (gameState.perks.extra_life < 0) {
    gameState.perks.extra_life = 0;
  } else if (gameState.perks.sacrifice) {
    offsetCombo(gameState, gameState.combo + 1, x, y);
  }

  schedulGameSound(gameState, "lifeLost", x, 1);

  for (let i = 0; i < 10; i++)
    makeParticle(
      gameState,
      x,
      y,
      Math.random() * gameState.baseSpeed * 3,
      gameState.baseSpeed * 3,
      "#FF0000",
      false,
      8,
      150,
    );
}

function makeCoin(
  gameState: GameState,
  x: number,
  y: number,
  vx: number,
  vy: number,
  color = "#ffd300",
  points = 1,
) {
  let weight = 0.8 + Math.random() * 0.2 + Math.min(2, points * 0.01);
  weight *= 5 / (5 + gameState.perks.etherealcoins);

  if (gameState.perks.trickledown) y = -20;
  if (
    gameState.perks.rainbow &&
    Math.random() > 1 / (1 + gameState.perks.rainbow)
  )
    color = rainbowColor(gameState);

  append(gameState.coins, (p: Partial<Coin>) => {
    p.x = x;
    p.y = y;
    p.collidedLastFrame = true;
    p.size = gameState.coinSize;
    p.previousX = x;
    p.previousY = y;
    p.vx = vx;
    p.vy = vy;
    // p.sx = 0;
    // p.sy = 0;
    p.color = color;
    p.a = Math.random() * Math.PI * 2;
    p.sa = Math.random() - 0.5;
    p.points = points;
    p.weight = weight;
    p.metamorphosisPoints = gameState.perks.metamorphosis;
    p.floatingTime = 0;
  });
}

function makeParticle(
  gameState: GameState,
  x: number,
  y: number,
  vx: number,
  vy: number,
  color: colorString,
  ethereal = false,
  size = 8,
  duration = 150,
) {
  if (!color.match(/^#[a-f0-9]{6}$/gi)) {
    throw new Error("Particle creation ignored, invalid color : " + color);
  }
  append(gameState.particles, (p: Partial<ParticleFlash>) => {
    p.time = gameState.levelTime;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.color = color;
    p.size = size * getPixelRatio();
    p.duration = duration;
    p.ethereal = ethereal;
  });
}

function makeText(
  gameState: GameState,
  x: number,
  y: number,
  color: colorString,
  text: string,
  size = 20,
  duration = 500,
  vx: number = 0,
  vy: number = -6,
) {
  append(gameState.texts, (p: Partial<TextFlash>) => {
    p.time = gameState.levelTime;
    p.x = clamp(x, 20, gameState.canvasWidth - 20);
    p.y = clamp(
      y,
      40,
      gameState.gameZoneHeight - gameState.puckHeight - gameState.ballSize,
    );
    p.vx = vx;
    p.vy = vy;
    p.color = color;
    p.size = size * getPixelRatio();
    p.duration = clamp(duration, 400, 2000);
    p.text = text;
  });
}

function makeLight(
  gameState: GameState,
  x: number,
  y: number,
  color: colorString,
  size = 8,
  duration = 150,
) {
  append(gameState.lights, (p: Partial<LightFlash>) => {
    p.time = gameState.levelTime;
    p.x = x;
    p.y = y;
    p.color = color;
    p.size = size;
    p.duration = duration;
  });
}

export function append<T>(
  where: ReusableArray<T>,
  makeItem: (match: Partial<T>) => void,
) {
  while (
    where.list[where.indexMin] &&
    !where.list[where.indexMin].destroyed &&
    where.indexMin < where.list.length
  ) {
    where.indexMin++;
  }
  if (where.indexMin < where.list.length) {
    where.list[where.indexMin].destroyed = false;
    makeItem(where.list[where.indexMin]);
    where.indexMin++;
  } else {
    const p = { destroyed: false };
    makeItem(p);
    where.list.push(p);
  }
  where.total++;
}

export function destroy<T>(where: ReusableArray<T>, index: number) {
  if (where.list[index].destroyed) return;
  where.list[index].destroyed = true;
  where.indexMin = Math.min(where.indexMin, index);
  where.total--;
}

function applyGravity(gameState: GameState, ball: Ball) {
  if (!ball.hasGravity && !ball.destroyed) {
    ball.hasGravity = true;
    makeText(
      gameState,
      ball.x,
      ball.y - gameState.ballSize,
      "#FFFFFF",
      t("play.gravity"),
      20,
      500,
    );
  }
}

export function liveCount<T>(where: ReusableArray<T>) {
  return where.total;
}

export function empty<T>(where: ReusableArray<T>) {
  let destroyed = 0;
  where.total = 0;
  where.indexMin = 0;
  where.list.forEach((i) => {
    if (!i.destroyed) {
      i.destroyed = true;
      destroyed++;
    }
  });
  return destroyed;
}

export function forEachLiveOne<T>(
  where: ReusableArray<T>,
  cb: (t: T, index: number) => void,
) {
  where.list.forEach((item: T, index: number) => {
    if (item && !item.destroyed) {
      cb(item, index);
    }
  });
}

function goToNearestBrick(
  gameState: GameState,
  coin: Ball | Coin,
  strength: number,
  size = 2,
  particle = false,
) {
  const row = Math.floor(coin.y / gameState.brickWidth);
  const col = Math.floor((coin.x - gameState.offsetX) / gameState.brickWidth);
  let vx = 0,
    vy = 0;
  for (let dcol = -size; dcol < size; dcol++) {
    for (let drow = -size; drow < size; drow++) {
      const index = getRowColIndex(gameState, row + drow, col + dcol);
      if (gameState.bricks[index]) {
        const dx =
          brickCenterX(gameState, index) +
          (clamp(-dcol, -1, 1) * gameState.brickWidth) / 2 -
          coin.x;
        const dy =
          brickCenterY(gameState, index) +
          (clamp(-drow, -1, 1) * gameState.brickWidth) / 2 -
          coin.y;
        const d2 = dx * dx + dy * dy;
        vx += (dx / d2) * 20;
        vy += (dy / d2) * 20;
      }
    }
  }

  coin.vx += vx * strength;
  coin.vy += vy * strength;
  const s2 = coin.vx * coin.vx + coin.vy * coin.vy;
  if (s2 > gameState.baseSpeed * gameState.baseSpeed * 2) {
    coin.vx *= 0.95;
    coin.vy *= 0.95;
  }

  if ((vx || vy) && particle) {
    makeParticle(
      gameState,
      coin.x,
      coin.y,
      -vx * 2,
      -vy * 2,
      rainbowColor(gameState),
      true,
    );
  }
}

function applyOttawaTreatyPerk(
  gameState: GameState,
  index: number,
  ball: Ball,
) {
  if (!gameState.perks.ottawa_treaty) return;
  if (ball.sapperUses) return;

  const originalColor = gameState.bricks[index];
  if (originalColor == "black") return;
  const x = index % gameState.gridSize;
  const y = Math.floor(index / gameState.gridSize);
  let converted = 0;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      if (dx || dy) {
        const nIndex = getRowColIndex(gameState, y + dy, x + dx);
        if (gameState.bricks[nIndex] && gameState.bricks[nIndex] === "black") {
          setBrick(gameState, nIndex, originalColor);
          schedulGameSound(
            gameState,
            "colorChange",
            brickCenterX(gameState, index),
            1,
          );
          // Avoid infinite bricks generation hack
          ball.sapperUses = Infinity;
          converted++;
          // Don't convert more than one brick per hit normally
          if (converted >= gameState.perks.ottawa_treaty) return;
        }
      }
  return;
}

export function zenTick(gameState: GameState) {
  if (!gameState.perks.zen) return;
  if (gameState.levelTime > gameState.lastZenComboIncrease + 3000) {
    gameState.lastZenComboIncrease = gameState.levelTime;
    offsetCombo(
      gameState,
      gameState.perks.zen,
      gameState.puckPosition,
      gameState.gameZoneHeight - gameState.puckHeight,
    );
  }
}

function underWrapLimit(gameState: GameState, ball: Ball) {
  ball.wrapsSinceBounce++;
  if (ball.wrapsSinceBounce > 10) {
    ball.wrapsSinceBounce = 0;
    return false;
  }
  return true;
}

function applyWrapUp(gameState: GameState, ball: Ball | Coin, radius) {
  schedulGameSound(gameState, "plouf", ball.x, 1);

  ball.y = gameState.gameZoneHeight - gameState.puckHeight - radius;
  ball.x = clamp(
    gameState.puckPosition,
    gameState.offsetXRoundedDown + radius,
    gameState.canvasWidth - gameState.offsetXRoundedDown - radius,
  );
  if (ball.vy > 0) {
    ball.vy *= -1;
  }

  spawnParticlesExplosion(gameState, 7, ball.x, ball.y, "#6262EA");
  spawnParticlesImplosion(
    gameState,
    7,
    ball.previousX,
    ball.previousY,
    "#6262EA",
  );
}

function addGravityParticules(gameState: GameState, frames: number) {
  if (!gameState.balls.find((b) => !b.destroyed && !b.hasGravity)) return;
  if (
    gameState.perks.gravity_falls &&
    Math.random() < frames * 0.2 &&
    gameState.balls.find(
      (b) =>
        !b.destroyed &&
        b.vy < 0 &&
        !b.hasGravity &&
        b.y < gameState.gameZoneHeight / 3,
    )
  ) {
    makeParticle(
      gameState,
      gameState.offsetX + gameState.gameZoneWidth * Math.random(),
      0,
      0,
      2,
      "#ffe02e",
    );
  }
  if (
    gameState.perks.flyswatter &&
    Math.random() < frames * 0.05 &&
    gameState.puckPosition <
      gameState.offsetXRoundedDown + gameState.gameZoneWidth / 2
  ) {
    makeParticle(
      gameState,
      gameState.offsetXRoundedDown + 20 * Math.random(),
      gameState.gameZoneHeight - 50,
      0,
      2,
      "#ffe02e",
    );
  }
}
