import {
  Ball,
  Coin,
  GameState,
  Level,
  PerkId,
  PerksMap,
  Upgrade,
} from "./types";
import { upgrades } from "./loadGameData";
import { t } from "./i18n/i18n";
import { clamp } from "./pure_functions";
import { getSettingValue, getTotalScore } from "./settings";
import { isOptionOn } from "./options";
import { getIcon } from "./levelIcon";

export function describeLevel(level: Level) {
  let bricks = 0,
    colors = new Set(),
    bombs = 0;
  level.bricks.forEach((color) => {
    if (!color) return;
    if (color === "black") {
      bombs++;
      return;
    } else {
      colors.add(color);
      bricks++;
    }
  });
  return t("unlocks.level_description", {
    size: level.size,
    bricks,
    colors: colors.size,
    bombs,
  });
}

export function getMajorityValue(arr: string[]): string {
  const count: { [k: string]: number } = {};
  arr.forEach((v) => (count[v] = (count[v] || 0) + 1));
  // Object.values inline polyfill
  const max = Math.max(...Object.keys(count).map((k) => count[k]));
  return sample(Object.keys(count).filter((k) => count[k] == max));
}

export function sample<T>(arr: T[]): T {
  return arr[Math.floor(arr.length * Math.random())];
}

export function sumOfValues(obj: { [key: string]: number } | undefined | null) {
  let sum = 0;
  if (obj)
    for (let k in obj) {
      sum += obj[k];
    }
  return sum;
}

export const makeEmptyPerksMap = (upgrades: { id: PerkId }[]) => {
  const p = {} as any;
  upgrades.forEach((u) => (p[u.id] = 0));
  return p as PerksMap;
};

export function brickCenterX(gameState: GameState, index: number) {
  return (
    gameState.offsetX +
    ((index % gameState.gridSize) + 0.5) * gameState.brickWidth
  );
}

export function brickCenterY(gameState: GameState, index: number) {
  return (Math.floor(index / gameState.gridSize) + 0.5) * gameState.brickWidth;
}

export function getRowColIndex(gameState: GameState, row: number, col: number) {
  if (
    row < 0 ||
    col < 0 ||
    row >= gameState.gridSize ||
    col >= gameState.gridSize
  )
    return -1;
  return row * gameState.gridSize + col;
}

export function getClosestBall(
  gameState: GameState,
  x: number,
  y: number,
): Ball | null {
  let closestBall: Ball | null = null;
  let dist = 0;
  gameState.balls.forEach((ball) => {
    const d2 = (ball.x - x) * (ball.x - x) + (ball.y - y) * (ball.y - y);
    if (d2 < dist || !closestBall) {
      closestBall = ball;
      dist = d2;
    }
  });
  return closestBall;
}
export function getPossibleUpgrades(gameState: GameState) {
  return upgrades
    .filter((u) => getTotalScore() >= u.threshold)
    .filter((u) => !u?.requires || gameState.perks[u?.requires]);
}

export function renderMaxLevel(gameState: GameState) {
  return gameState.perks.chill ? "∞" : max_levels(gameState);
}
export function max_levels(gameState: GameState) {
  if (gameState.creative) return 1;
  if (gameState.perks.chill) return gameState.currentLevel + 2;
  return 7 + gameState.perks.extra_levels;
}

export function upgradeLevelAndMaxDisplay(
  upgrade: Upgrade,
  gameState: GameState,
) {
  const lvl = gameState.perks[upgrade.id];
  const max = upgrade.max + gameState.perks.limitless;
  return levelAndMaxBadge(lvl, max);
}

export function levelAndMaxBadge(lvl: number, max: number) {
  return ` <span class="level ${lvl < max ? "can-upgrade" : "capped"}"><span>${lvl}</span><span>${max}</span></span>`;
}

export function pickedUpgradesHTMl(gameState: GameState) {
  const upgradesList = getPossibleUpgrades(gameState)
    .filter((u) => gameState.perks[u.id])
    .map((u) => {
      const newMax = Math.max(0, u.max + gameState.perks.limitless);

      const state = (gameState.perks[u.id] && 1) || (!newMax && 2) || 3;
      const tooltip = escapeAttribute(u.fullHelp(gameState.perks[u.id] || 1));
      return {
        state,
        html: `
        <div class="upgrade ${["??", "used", "banned", "free"][state]}">
            ${getIcon("icon:" + u.id)}
            <p data-tooltip="${tooltip}"
            data-help-content="${tooltip}"
            >
            <strong>${u.name}</strong>
            ${upgradeLevelAndMaxDisplay(u, gameState)} 
            ${u.help(gameState.perks[u.id] || 1)} 
          
          </p>  
        </div>
        `,
      };
    })
    .sort((a, b) => a.state - b.state)
    .map((a) => a.html);

  return ` <p>${t("score_panel.upgrades_picked")}</p>` + upgradesList.join("");
}

export function levelsListHTMl(
  gameState: GameState,
  currentLevelIndex: number,
) {
  if (!gameState.perks.clairvoyant) return "";
  if (gameState.creative) return "";
  let list = "";
  for (let i = 0; i < max_levels(gameState); i++) {
    let level = gameState.runLevels[i % gameState.runLevels.length];
    list += `<span style="opacity: ${i >= currentLevelIndex ? 1 : 0.2}" title="${level.name}">${getIcon(level.name)}</span>`;
  }
  return `<p>${t("score_panel.upcoming_levels")}</p><p>${list}</p>`;
}

export function currentLevelInfo(gameState: GameState) {
  return gameState.level;
}

export function isPickyEatingPossible(gameState: GameState) {
  return gameState.bricks.indexOf(gameState.ballsColor) !== -1;
}

export function reachRedRowIndex(gameState: GameState) {
  if (!gameState.perks.reach) return -1;
  const { size } = gameState.level;
  let minY = -1,
    maxY = -1,
    maxYCount = -1;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (gameState.bricks[x + y * size]) {
        if (minY == -1) minY = y;
        if (maxY < y) {
          maxY = y;
          maxYCount = 0;
        }
        if (maxY == y) maxYCount++;
      }

  if (maxY < 1) return -1;
  if (maxY == minY) return -1;
  if (maxYCount === size) return -1;
  return maxY;
}

export function telekinesisEffectRate(gameState: GameState, ball: Ball) {
  return (
    (gameState.perks.telekinesis &&
      ball.vy < 0 &&
      clamp((ball.y / gameState.gameZoneHeight) * 1.1 + 0.1, 0, 1)) ||
    0
  );
}

export function yoyoEffectRate(gameState: GameState, ball: Ball) {
  if (ball.vy < 0) return 0;
  if (!gameState.perks.yoyo) return 0;
  return (
    (((Math.abs(gameState.puckPosition - ball.x) / gameState.gameZoneWidth) *
      gameState.perks.yoyo) /
      2) *
    clamp(1 - ball.y / gameState.gameZoneHeight, 0, 1) *
    2
  );
}

export function findLast<T>(
  arr: T[],
  predicate: (item: T, index: number, array: T[]) => boolean,
) {
  let i = arr.length;
  while (--i)
    if (predicate(arr[i], i, arr)) {
      return arr[i];
    }
}

export function distance2(
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  return Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2);
}

export function distanceBetween(
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  return Math.sqrt(distance2(a, b));
}

export function defaultSounds() {
  return {
    aboutToPlaySound: {
      wallBeep: { vol: 0, x: 0 },
      comboIncreaseMaybe: { vol: 0, x: 0 },
      comboDecrease: { vol: 0, x: 0 },
      coinBounce: { vol: 0, x: 0 },
      explode: { vol: 0, x: 0 },
      lifeLost: { vol: 0, x: 0 },
      coinCatch: { vol: 0, x: 0 },
      plouf: { vol: 0, x: 0 },
      colorChange: { vol: 0, x: 0 },
    },
  };
}

export function shouldPierceByColor(
  gameState: GameState,
  vhit: number | undefined,
  hhit: number | undefined,
  chit: number | undefined,
) {
  if (!gameState.perks.pierce_color) return false;
  if (
    typeof vhit !== "undefined" &&
    gameState.bricks[vhit] !== gameState.ballsColor
  ) {
    return false;
  }
  if (
    typeof hhit !== "undefined" &&
    gameState.bricks[hhit] !== gameState.ballsColor
  ) {
    return false;
  }
  if (
    typeof chit !== "undefined" &&
    gameState.bricks[chit] !== gameState.ballsColor
  ) {
    return false;
  }
  return true;
}

export function isMovingWhilePassiveIncome(gameState: GameState) {
  return !!(
    gameState.lastPuckMove &&
    gameState.perks.passive_income &&
    gameState.lastPuckMove >
      gameState.levelTime - (100 * gameState.perks.passive_income - 50)
  );
}

export function getHighScore() {
  try {
    return BigInt(
      //parseFloat(localStorage.getItem("breakout-3-hs-short") || "0"),
      window.highscores.getScore(),
    );
  } catch (e) {}
  return BigInt(0);
}

export function highScoreText() {
  if (getHighScore()) {
    return t("main_menu.high_score", { score: getHighScore().toString() });
  }
  return "";
}

export function getCoinRenderColor(gameState: GameState, coin: Coin) {
  if (
    gameState.perks.metamorphosis ||
    isOptionOn("colorful_coins") ||
    gameState.perks.sticky_coins ||
    gameState.perks.rainbow
  )
    return coin.color;
  return "#ffd300";
}

export function getCornerOffset(gameState: GameState) {
  return (
    (gameState.levelTime
      ? gameState.perks.corner_shot * gameState.brickWidth
      : 0) -
    gameState.perks.unbounded * gameState.brickWidth
  );
}

export const isInWebView = !!window.location.href.includes("isInWebView=true");

export function hoursSpentPlaying() {
  try {
    const timePlayed = getSettingValue("breakout_71_total_play_time", 0);
    return Math.floor(timePlayed / 1000 / 60 / 60);
  } catch (e) {
    return 0;
  }
}

export function escapeAttribute(str: String) {
  return str
    .replace(/&/gi, "&amp;")
    .replace(/</gi, "&lt;")
    .replace(/"/gi, "&quot;")
    .replace(/'/gi, "&#39;");
}

export function canvasCenterX(gameState: GameState) {
  return gameState.canvasWidth / 2;
}
export function zoneLeftBorderX(gameState: GameState) {
  return gameState.offsetXRoundedDown - 1;
}
export function zoneRightBorderX(gameState: GameState) {
  return gameState.canvasWidth - gameState.offsetXRoundedDown + 1;
}

let countsCounterSet: Record<string, number> = {};
export function countBrickColors(gameState: GameState) {
  for (let key in countsCounterSet) {
    countsCounterSet[key] = 0;
  }
  gameState.bricks.forEach((brick) => {
    if (brick && brick !== "black") countsCounterSet[brick] = 1;
  });
  return sumOfValues(countsCounterSet);
}
