import "@webxdc/highscores";
import { allLevels, appVersion, upgrades } from "./loadGameData";
import {
  Ball,
  Coin,
  GameState,
  Level,
  LightFlash,
  OptionId,
  ParticleFlash,
  PerksMap,
  RunParams,
  TextFlash,
} from "./types";
import { getAudioContext, playPendingSounds } from "./sounds";
import {
  brickCenterX,
  brickCenterY,
  currentLevelInfo,
  getRowColIndex,
  highScoreText,
  hoursSpentPlaying,
  sample,
} from "./game_utils";

import "./PWA/sw_loader";
import { getCurrentLang, languages, t } from "./i18n/i18n";
import {
  commitSettingsChangesToLocalStorage,
  cycleMaxCoins,
  getCurrentMaxCoins,
  getSettingValue,
  setSettingValue,
} from "./settings";
import {
  forEachLiveOne,
  gameStateTick,
  normalizeGameState,
  setLevel,
  setMousePos,
} from "./gameStateMutators";
import {
  backgroundCanvas,
  gameCanvas,
  getHaloScale,
  haloCanvas,
  render,
  scoreDisplay,
} from "./render";
import {
  pauseRecording,
  recordOneFrame,
  resumeRecording,
  startRecordingGame,
} from "./recording";
import { newGameState } from "./newGameState";
import {
  alertsOpen,
  asyncAlert,
  AsyncAlertAction,
  closeModal,
} from "./asyncAlert";
import { getPixelRatio, isOptionOn, options, toggleOption } from "./options";
import { clamp } from "./pure_functions";
import { helpMenuEntry } from "./help";
import { creativeMode } from "./creative";
import { hideAnyTooltip, setupTooltips } from "./tooltip";
import "./migrations";
import { generateSaveFileContent } from "./generateSaveFileContent";
import { runHistoryViewerMenuEntry } from "./runHistoryViewer";
import { openScorePanel } from "./openScorePanel";
import { monitorLevelsUnlocks } from "./monitorLevelsUnlocks";
import {
  closeEditorTrialRun,
  editRawLevel,
  levelEditorMenuEntry,
} from "./levelEditor";
import { frameStarted, getWorstFPSAndReset, startWork } from "./fps";
import { openUnlockedUpgradesList } from "./openUnlockedUpgradesList";
import { getCheckboxIcon, getIcon } from "./levelIcon";
import { openLevelDetails } from "./openLevelDetails";

export async function play() {
  if (await applyFullScreenChoice()) return;
  if (mainGameState.running) return;
  mainGameState.running = true;
  mainGameState.ballStickToPuck = false;

  startRecordingGame(mainGameState);
  getAudioContext()?.resume();
  resumeRecording();
  hideAnyTooltip();
  // document.body.classList[gameState.running ? 'add' : 'remove']('running')
}

export function pause(playerAskedForPause: boolean) {
  if (!mainGameState.running) return;

  if (mainGameState.pauseTimeout && playerAskedForPause) {
    return;
  }

  if (mainGameState.startParams.computer_controlled) {
    play();
    return;
  }
  const stop = () => {
    mainGameState.running = false;

    setTimeout(() => {
      if (!mainGameState.running) getAudioContext()?.suspend();
    }, 1000);

    pauseRecording();
    if (mainGameState.pauseTimeout) {
      // In case an instant pause was requested while a delayed pause was pending
      clearTimeout(mainGameState.pauseTimeout);
      mainGameState.pauseTimeout = null;
    }
    mainGameState.needsRender = true;
  };

  if (playerAskedForPause) {
    // Pausing many times in a run will make pause slower
    mainGameState.pauseUsesDuringRun++;
    mainGameState.pauseTimeout = setTimeout(
      stop,
      Math.min(Math.max(0, mainGameState.pauseUsesDuringRun - 5) * 50, 500),
    );
  } else {
    stop();
  }

  if (document.exitPointerLock) {
    document.exitPointerLock();
  }
  hideAnyTooltip();
}

export const fitSize = (gameState: GameState) => {
  if (!gameState) throw new Error("Missign game state");
  if (gameState.startParams.animated_perk_preview) return;
  const past_off = gameState.offsetXRoundedDown,
    past_width = gameState.gameZoneWidthRoundedUp,
    past_heigh = gameState.gameZoneHeight;

  const width = Math.floor(window.innerWidth * getPixelRatio()),
    height = Math.floor(window.innerHeight * getPixelRatio());

  gameState.canvasWidth = width;
  gameState.canvasHeight = height;
  gameCanvas.width = width;
  gameCanvas.height = height;
  backgroundCanvas.width = width;
  backgroundCanvas.height = height;
  const haloScale = getHaloScale();
  haloCanvas.width = width / haloScale;
  haloCanvas.height = height / haloScale;

  gameState.gameZoneHeight = isOptionOn("mobile-mode")
    ? Math.floor(height * 0.8)
    : height;

  const baseWidth = Math.round(
    Math.min(
      gameState.canvasWidth,
      (gameState.gameZoneHeight *
        0.73 *
        (gameState.gridSize + gameState.perks.unbounded * 2)) /
        gameState.gridSize,
    ),
  );

  // in case getPixelRatio changed value
  gameState.ballSize = Math.ceil(20 * getPixelRatio());
  gameState.coinSize = Math.ceil(14 * getPixelRatio());
  gameState.puckHeight = Math.ceil(20 * getPixelRatio());
  forEachLiveOne(gameState.coins, (b) => (b.size = gameState.coinSize));

  gameState.brickWidth =
    Math.floor(
      baseWidth / (gameState.gridSize + gameState.perks.unbounded * 2) / 2,
    ) * 2;

  gameState.gameZoneWidth = gameState.brickWidth * gameState.gridSize;
  gameState.offsetX = Math.floor(
    (gameState.canvasWidth - gameState.gameZoneWidth) / 2,
  );
  // Space between left side and border
  gameState.offsetXRoundedDown =
    gameState.offsetX - gameState.perks.unbounded * gameState.brickWidth;
  if (
    gameState.offsetX <
    gameState.ballSize + gameState.perks.unbounded * 2 * gameState.brickWidth
  )
    gameState.offsetXRoundedDown = 0;
  gameState.gameZoneWidthRoundedUp = width - 2 * gameState.offsetXRoundedDown;
  backgroundCanvas.title = "resized";
  // Ensure puck stays within bounds
  setMousePos(gameState, gameState.puckPosition);

  function mapXY(item: ParticleFlash | TextFlash | LightFlash) {
    item.x =
      gameState.offsetXRoundedDown +
      ((item.x - past_off) / past_width) * gameState.gameZoneWidthRoundedUp;
    item.y = (item.y / past_heigh) * gameState.gameZoneHeight;
  }

  function mapXYPastCoord(coin: Coin | Ball) {
    coin.x =
      gameState.offsetXRoundedDown +
      ((coin.x - past_off) / past_width) * gameState.gameZoneWidthRoundedUp;
    coin.y = (coin.y / past_heigh) * gameState.gameZoneHeight;
    coin.previousX = coin.x;
    coin.previousY = coin.y;
  }

  gameState.balls.forEach(mapXYPastCoord);
  forEachLiveOne(gameState.coins, mapXYPastCoord);
  forEachLiveOne(gameState.particles, mapXY);
  forEachLiveOne(gameState.texts, mapXY);
  forEachLiveOne(gameState.lights, mapXY);
  pause(true);
  // For safari mobile https://css-tricks.com/the-trick-to-viewport-units-on-mobile/
  document.documentElement.style.setProperty(
    "--vh",
    `${window.innerHeight * 0.01}px`,
  );
};
window.addEventListener("resize", () => fitSize(mainGameState));
window.addEventListener("fullscreenchange", () => fitSize(mainGameState));

setInterval(() => {
  // Sometimes, the page changes size without triggering the event (when switching to fullscreen, closing debug panel...)

  const width = Math.floor(window.innerWidth * getPixelRatio()),
    height = Math.floor(window.innerHeight * getPixelRatio());

  if (
    width !== mainGameState.canvasWidth ||
    height !== mainGameState.canvasHeight
  )
    fitSize(mainGameState);
}, 1000);

gameCanvas.addEventListener("mouseup", (e) => {
  if (e.button !== 0) return;
  if (mainGameState.running) {
    pause(true);
  } else {
    play();
    if (isOptionOn("pointerLock") && gameCanvas.requestPointerLock) {
      gameCanvas.requestPointerLock().then();
    }
  }
});

gameCanvas.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement === gameCanvas) {
    setMousePos(
      mainGameState,
      mainGameState.puckPosition + e.movementX * getPixelRatio(),
    );
  } else {
    setMousePos(mainGameState, e.clientX * getPixelRatio());
  }
});

let timers = [];
function startPlayCountDown() {
  stopPlayCountDown();

  mainGameState.startCountDown = 3;
  mainGameState.needsRender = true;

  timers.push(
    setTimeout(() => {
      mainGameState.startCountDown = 2;
      mainGameState.needsRender = true;
    }, 1000),
  );
  timers.push(
    setTimeout(() => {
      mainGameState.startCountDown = 1;
      mainGameState.needsRender = true;
    }, 2000),
  );
  timers.push(
    setTimeout(() => {
      mainGameState.startCountDown = 0;
      play();
    }, 3000),
  );
}
function stopPlayCountDown() {
  if (!timers.length) return;

  mainGameState.startCountDown = 0;
  timers.forEach((id) => clearTimeout(id));
  timers.length = 0;
}
gameCanvas.addEventListener("touchstart", (e) => {
  e.preventDefault();
  if (!e.touches?.length) return;
  setMousePos(mainGameState, e.touches[0].pageX * getPixelRatio());
  normalizeGameState(mainGameState);
  if (mainGameState.levelTime || !isOptionOn("touch_delayed_start")) {
    play();
  } else {
    //   start play sequence
    startPlayCountDown();
  }
});
gameCanvas.addEventListener("touchend", (e) => {
  stopPlayCountDown();
  e.preventDefault();
  pause(true);
});
gameCanvas.addEventListener("touchcancel", (e) => {
  stopPlayCountDown();
  e.preventDefault();
  pause(true);
});
gameCanvas.addEventListener("touchmove", (e) => {
  if (!e.touches?.length) return;
  setMousePos(mainGameState, e.touches[0].pageX * getPixelRatio());
});

export function brickIndex(gameState: GameState, x: number, y: number) {
  const index = getRowColIndex(
    gameState,
    Math.floor(y / gameState.brickWidth),
    Math.floor((x - gameState.offsetX) / gameState.brickWidth),
  );
  if (gameState.perks.round_bricks && index !== -1) {
    const dx = x - brickCenterX(gameState, index);
    const dy = y - brickCenterY(gameState, index);
    const radius = gameState.brickWidth / 2.8;
    if (dx * dx + dy * dy > radius * radius) return -1;
  }
  return index;
}

export function hasBrick(
  gameState: GameState,
  index: number,
): number | undefined {
  if (gameState.bricks[index]) return index;
}

export function hitsSomething(
  gameState: GameState,
  x: number,
  y: number,
  radius: number,
) {
  return (
    hasBrick(gameState, brickIndex(gameState, x - radius, y - radius)) ??
    hasBrick(gameState, brickIndex(gameState, x + radius, y - radius)) ??
    hasBrick(gameState, brickIndex(gameState, x + radius, y + radius)) ??
    hasBrick(gameState, brickIndex(gameState, x - radius, y + radius))
  );
}
const ctx = gameCanvas.getContext("2d", {
  alpha: false,
}) as CanvasRenderingContext2D;

export function tick() {
  frameStarted();
  startWork("physics");
  const currentTick = performance.now();
  const timeDeltaMs = currentTick - mainGameState.lastTick;
  mainGameState.lastTick = currentTick;

  let frames = Math.min(4, timeDeltaMs / (1000 / 60));
  if (mainGameState.keyboardPuckSpeed) {
    setMousePos(
      mainGameState,
      mainGameState.puckPosition + mainGameState.keyboardPuckSpeed,
    );
  }
  if (mainGameState.perks.superhot) {
    frames *= clamp(
      Math.abs(mainGameState.puckPosition - mainGameState.lastPuckPosition) / 5,
      0.2 / mainGameState.perks.superhot,
      1,
    );
  }

  normalizeGameState(mainGameState);
  if (mainGameState.running) {
    mainGameState.levelTime += timeDeltaMs * frames;
    mainGameState.runStatistics.runTime += timeDeltaMs * frames;
    let maxSpeed2 = 0;
    mainGameState.balls.forEach(
      ({ vx, vy }) => (maxSpeed2 = Math.max(maxSpeed2, vx * vx + vy * vy)),
    );
    forEachLiveOne(
      mainGameState.coins,
      ({ vx, vy }) => (maxSpeed2 = Math.max(maxSpeed2, vx * vx + vy * vy)),
    );
    const steps = Math.ceil((Math.sqrt(maxSpeed2) * frames) / 8);

    for (let i = 0; i < steps; i++) {
      gameStateTick(mainGameState, frames / steps);
    }
  }
  mainGameState.lastPuckPosition = mainGameState.puckPosition;

  if (mainGameState.running || mainGameState.needsRender) {
    mainGameState.needsRender = false;
    if (gameCanvas.width && gameCanvas.height) {
      render(mainGameState, ctx);
    }
  }
  startWork("record video");
  if (mainGameState.running) {
    recordOneFrame(mainGameState);
  }
  startWork("sound");
  if (isOptionOn("sound")) {
    playPendingSounds(mainGameState);
  }
  startWork("idle");

  requestAnimationFrame(tick);
}

setInterval(() => {
  monitorLevelsUnlocks(mainGameState);
}, 500);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pause(true);
  }
});
if (getSettingValue("score-opened", 0) < 3) {
  scoreDisplay.classList.add("button-look");
}
const menuDisplay = document.getElementById("menu") as HTMLButtonElement;
if (getSettingValue("menu-opened", 0) < 3) {
  menuDisplay.classList.add("button-look");
}

function scoreOpen(e) {
  e.preventDefault();
  if (alertsOpen) return;
  if (typeof mainGameState.startParams.isEditorTrialRun === "number") {
    closeEditorTrialRun();
    return;
  }
  if (alertsOpen) {
    setSettingValue("score-opened", getSettingValue("score-opened", 0) + 1);
    openScorePanel(mainGameState);
  }
}

scoreDisplay.addEventListener("click", scoreOpen);
scoreDisplay.addEventListener("mousedown", scoreOpen);

menuDisplay.addEventListener("click", (e) => {
  e.preventDefault();
  if (!alertsOpen) {
    setSettingValue("menu-opened", getSettingValue("menu-opened", 0) + 1);
    openMainMenu();
  }
});

export const creativeModeThreshold = Math.max(
  ...upgrades.map((u) => u.threshold),
);

export async function openMainMenu() {
  pause(true);

  const actions: AsyncAlertAction<() => void>[] = [
    {
      icon: getIcon("icon:new_run"),
      text: t("main_menu.normal"),
      help: highScoreText() || t("main_menu.normal_help"),
      value: () => {
        restart({
          levelToAvoid: currentLevelInfo(mainGameState).name,
        });
      },
    },
    creativeMode(mainGameState),
    ...runHistoryViewerMenuEntry(),
    levelEditorMenuEntry(),
    {
      icon: getIcon("icon:unlocked_upgrades"),
      text: t("unlocks.upgrades"),
      help: t("unlocks.upgrades_help", { count: upgrades.length }),
      value() {
        openUnlockedUpgradesList();
      },
    },
    {
      icon: getIcon("icon:unlocked_levels"),
      text: t("unlocks.levels"),
      help: t("unlocks.levels_help", {
        count: allLevels.filter((l) => !l.name.startsWith("icon:")).length,
      }),
      value() {
        openUnlockedLevelsList();
      },
    },

    ...donationNag(mainGameState),
    {
      text: t("main_menu.settings_title"),
      help: t("main_menu.settings_help"),
      icon: getIcon("icon:settings"),
      value() {
        openSettingsMenu();
      },
    },
    helpMenuEntry(),
  ];

  const cb = await asyncAlert<() => void>({
    title: t("main_menu.title"),
    content: [
      ...actions,

      `<p>       
        <span>Made in France by <a href="https://lecaro.me">Renan LE CARO</a>.</span> 
        <a href="https://paypal.me/renanlecaro" target="_blank">Donate</a>
        <a href="https://discord.gg/bbcQw4x5zA" target="_blank">Discord</a>
        <a href="https://f-droid.org/en/packages/me.lecaro.breakout/" target="_blank">F-Droid</a>
        <a href="https://play.google.com/store/apps/details?id=me.lecaro.breakout" target="_blank">Google Play</a>
        <a href="https://renanlecaro.itch.io/breakout71" target="_blank">itch.io</a> 
        <a href="https://gitlab.com/lecarore/breakout71" target="_blank">Gitlab</a>
        <a href="https://hosted.weblate.org/projects/breakout-71/" target="_blank">Weblate</a>
        <a href="https://breakout.lecaro.me/" target="_blank">Web version</a>
        <a href="https://news.ycombinator.com/item?id=43183131" target="_blank">HackerNews</a>
        <a href="https://breakout.lecaro.me/privacy.html" target="_blank">Privacy Policy</a>
        <a href="https://archive.lecaro.me/public-files/b71/" target="_blank">Archives</a>
        <span>v.${appVersion}</span>
      </p>`,
    ],
    allowClose: true,
  });
  if (cb) {
    cb();
    mainGameState.needsRender = true;
  }
}

function donationNag() {
  if (!isOptionOn("donation_reminder")) return [];
  const hours = hoursSpentPlaying();
  return [
    {
      text: t("main_menu.donate", { hours }),
      help: t("main_menu.donate_help", {
        suggestion: Math.min(20, Math.max(1, 0.2 * hours)).toFixed(0),
      }),
      icon: getIcon("icon:premium"),
      value() {
        window.open("https://paypal.me/renanlecaro", "_blank");
      },
    },
  ];
}

async function openSettingsMenu() {
  pause(true);

  const actions: AsyncAlertAction<() => void>[] = [];

  actions.push({
    icon: getIcon(
      languages.find((l) => l.value === getCurrentLang())?.levelName || "",
    ),
    text: t("settings.language"),
    help: t("settings.language_help"),
    async value() {
      const pick = await asyncAlert({
        title: t("settings.language"),
        content: [
          t("settings.language_help"),
          ...languages.map((l) => ({ ...l, icon: getIcon(l.levelName) })),
        ],
        allowClose: true,
      });
      if (
        pick &&
        pick !== getCurrentLang() &&
        (await confirmRestart(mainGameState))
      ) {
        setSettingValue("lang", pick);
        commitSettingsChangesToLocalStorage();
        window.location.reload();
      }
    },
  });
  for (const key of Object.keys(options) as OptionId[]) {
    // Skip displaying option if it does nothing
    if (window.devicePixelRatio === 1 && key == "match_pixel_ratio") continue;
    if (options[key]) {
      actions.push({
        icon: getCheckboxIcon(isOptionOn(key)),
        text: options[key].name,
        help: options[key].help,
        disabled:
          (isOptionOn("basic") &&
            [
              "extra_bright",
              "contrast",
              "smooth_lighting",
              "precise_lighting",
              "probabilistic_lighting",
            ].includes(key)) ||
          false,
        value: () => {
          toggleOption(key);
          fitSize(mainGameState);
          applyFullScreenChoice();
          openSettingsMenu();
        },
      });
    }
  }
  actions.push({
    icon: getIcon("icon:download"),
    text: t("settings.download_save_file"),
    help: t("settings.download_save_file_help"),
    async value() {
      const dlLink = document.createElement("a");
      const obj = {
        fileType: "B71-save-file",
        appVersion,
        payload: generateSaveFileContent(),
      };
      const json = JSON.stringify(obj, null, 2);
      dlLink.setAttribute(
        "href",
        "data:application/json;charset=utf-8," + encodeURIComponent(json),
      );

      dlLink.setAttribute(
        "download",
        "b71-save-" +
          new Date()
            .toISOString()
            .slice(0, 19)
            .replace(/[^0-9]+/gi, "-") +
          ".json",
      );
      document.body.appendChild(dlLink);
      dlLink.click();
      setTimeout(() => document.body.removeChild(dlLink), 1000);
    },
  });

  actions.push({
    icon: getIcon("icon:upload"),
    text: t("settings.load_save_file"),
    help: t("settings.load_save_file_help"),
    async value() {
      if (!document.getElementById("save_file_picker")) {
        let input: HTMLInputElement = document.createElement("input");
        input.setAttribute("type", "file");
        input.setAttribute("id", "save_file_picker");
        input.setAttribute("accept", ".b71,.json");
        input.style.position = "absolute";
        input.style.left = "-1000px";
        input.addEventListener("change", async (e) => {
          try {
            const file = input && input.files?.item(0);
            if (file) {
              const content = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = function () {
                  resolve(reader.result?.toString() || "");
                };
                reader.onerror = function () {
                  reject(reader.error);
                };

                // Read the file as a text string

                reader.readAsText(file);
              });
              const { fileType, signedPayload, payload } = JSON.parse(content);
              if (fileType !== "B71-save-file")
                throw new Error("Not a B71 save file");
              if (payload) {
                localStorage.clear();
                for (let key in payload) {
                  localStorage.setItem(key, JSON.stringify(payload[key]));
                }
              } else if (signedPayload) {
                //   Old file format
                const localStorageContent = JSON.parse(signedPayload);
                localStorage.clear();
                for (let key in localStorageContent) {
                  localStorage.setItem(key, localStorageContent[key]);
                }
              }
              await asyncAlert({
                title: t("settings.save_file_loaded"),
                content: [
                  t("settings.save_file_loaded_help"),
                  { text: t("settings.save_file_loaded_ok") },
                ],
              });
              window.location.reload();
            }
          } catch (e: any) {
            await asyncAlert({
              title: t("settings.save_file_error"),
              content: [e.message, { text: t("settings.save_file_loaded_ok") }],
            });
          }
          input.value = "";
        });
        document.body.appendChild(input);
      }
      document.getElementById("save_file_picker")?.click();
    },
  });

  actions.push({
    icon: getIcon("icon:coins"),
    text: t("settings.max_coins", { max: getCurrentMaxCoins() }),
    help: t("settings.max_coins_help"),
    async value() {
      cycleMaxCoins();
      await openSettingsMenu();
    },
  });

  actions.push({
    icon: getIcon("icon:reset"),
    text: t("settings.reset"),
    help: t("settings.reset_help"),
    async value() {
      if (
        await asyncAlert({
          title: t("settings.reset"),
          content: [
            t("settings.reset_instruction"),
            {
              text: t("settings.reset_confirm"),
              value: true,
            },
            {
              text: t("settings.reset_cancel"),
              value: false,
            },
          ],
          allowClose: true,
        })
      ) {
        localStorage.clear();
        window.location.reload();
      }
    },
  });
  actions.push({
    text: t("settings.autoplay"),
    help: t("settings.autoplay_help"),
    async value() {
      startComputerControlledGame(false);
    },
  });
  actions.push({
    text: t("settings.stress_test"),
    help: t("settings.stress_test_help"),
    async value() {
      startComputerControlledGame(true);
    },
  });

  const cb = await asyncAlert<() => void>({
    title: t("main_menu.settings_title"),
    content: [t("main_menu.settings_help"), ...actions],
    allowClose: true,
    className: "settings",
  });
  if (cb) {
    cb();
    mainGameState.needsRender = true;
  }
}

async function applyFullScreenChoice() {
  try {
    if (!(document.fullscreenEnabled || document.webkitFullscreenEnabled)) {
      return false;
    }

    if (document.fullscreenElement !== null && !isOptionOn("fullscreen")) {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
        return true;
      } else if (document.webkitCancelFullScreen) {
        await document.webkitCancelFullScreen();
        return true;
      }
    } else if (isOptionOn("fullscreen") && !document.fullscreenElement) {
      const docel = document.documentElement;
      if (docel.requestFullscreen) {
        await docel.requestFullscreen();
        return true;
      } else if (docel.webkitRequestFullscreen) {
        await docel.webkitRequestFullscreen();
        return true;
      }
    }
  } catch (e) {
    console.warn(e);
  }
  return false;
}

export async function openUnlockedLevelsList() {
  const unlockedBefore = new Set<string>(
    getSettingValue("breakout_71_unlocked_levels", []),
  );
  const levelActions = allLevels.map((l, li) => {
    const locked = !unlockedBefore.has(l.name);

    return {
      // text: l.name,
      // disabled: locked,
      value: l,
      icon: getIcon(l.name),
      // help: locked?.text || describeLevel(l),
      className:
        "level choice no-border " +
        (!locked ? "used" : " grey-out-unless-hovered"),
      // link: extractLinkFromText(l.credit || ""),
      tooltip: l.name,
      locked,
    };
  });

  const level = await asyncAlert<Level>({
    title: t("unlocks.levels"),
    content: [
      t("unlocks.level", {
        unlocked: levelActions.filter((a) => !a.locked).length,
        out_of: levelActions.length,
      }),
      ...levelActions,
    ],
    allowClose: true,
    className: "actionsAsGrid compact",
  });

  if (level) {
    await openLevelDetails(level);
  }
}

export async function confirmRestart(gameState) {
  if (!gameState.currentLevel) return true;
  if (alertsOpen) return true;
  pause(true);
  return asyncAlert({
    title: t("confirmRestart.title"),
    content: [
      t("confirmRestart.text"),
      {
        value: true,
        text: t("confirmRestart.yes"),
      },
      {
        value: false,
        text: t("confirmRestart.no"),
      },
    ],
  });
}

const pressed: { [k: string]: number } = {
  ArrowLeft: 0,
  ArrowRight: 0,
  Shift: 0,
};

export function setKeyPressed(key: string, on: 0 | 1) {
  pressed[key] = on;
  mainGameState.keyboardPuckSpeed =
    ((pressed.ArrowRight - pressed.ArrowLeft) *
      (1 + pressed.Shift * 2) *
      mainGameState.gameZoneWidth) /
    50;
}

document.addEventListener("keydown", async (e) => {
  if (e.key.toLowerCase() === "f" && !e.ctrlKey && !e.metaKey) {
    toggleOption("fullscreen");
    applyFullScreenChoice();
  } else if (e.key in pressed) {
    setKeyPressed(e.key, 1);
  }
  if (e.key === " " && !alertsOpen) {
    if (mainGameState.running) {
      pause(true);
    } else {
      play();
    }
  } else {
    return;
  }
  e.preventDefault();
});

let pageLoad = new Date();
document.addEventListener("keyup", async (e) => {
  const focused = document.querySelector("button:focus");
  if (e.key in pressed) {
    setKeyPressed(e.key, 0);
  } else if (
    e.key === "ArrowDown" &&
    focused?.nextElementSibling?.tagName === "BUTTON"
  ) {
    (focused?.nextElementSibling as HTMLButtonElement)?.focus();
  } else if (
    e.key === "ArrowUp" &&
    focused?.previousElementSibling?.tagName === "BUTTON"
  ) {
    (focused?.previousElementSibling as HTMLButtonElement)?.focus();
  } else if (e.key === "Escape" && closeModal) {
    closeModal();
  } else if (e.key === "Escape" && mainGameState.running) {
    pause(true);
  } else if (e.key.toLowerCase() === "m" && !alertsOpen) {
    openMainMenu().then();
  } else if (e.key.toLowerCase() === "s" && !alertsOpen) {
    openScorePanel(mainGameState).then();
  } else if (
    e.key.toLowerCase() === "r" &&
    !alertsOpen &&
    pageLoad < Date.now() - 500
  ) {
    if (mainGameState.startParams.computer_controlled) {
      return startComputerControlledGame(mainGameState.startParams.stress);
    }
    // When doing ctrl + R in dev to refresh, i don't want to instantly restart a run
    if (await confirmRestart(mainGameState)) {
      restart({
        levelToAvoid: currentLevelInfo(mainGameState).name,
      });
    }
  } else {
    return;
  }
  e.preventDefault();
});

export const mainGameState = newGameState({});
window.mainGameState = mainGameState;

export function restart(params: RunParams) {
  getWorstFPSAndReset();
  Object.assign(mainGameState, newGameState(params));
  // Recompute brick size according to level
  fitSize(mainGameState);

  pauseRecording();
  setLevel(mainGameState, 0);
  if (params?.computer_controlled) {
    play();
  }
}
if (window.location.search.match(/autoplay|stress/)) {
  startComputerControlledGame(window.location.search.includes("stress"));
} else {
  restart({});
}

export function startComputerControlledGame(stress: boolean = false) {
  const perks: Partial<PerksMap> = { base_combo: 20, pierce: 3 };
  if (stress) {
    Object.assign(perks, {
      base_combo: 150,
      pierce: 20,
      rainbow: 3,
      sapper: 2,
      etherealcoins: 1,
      bricks_attract_ball: 1,
      respawn: 3,
    });
  } else {
    for (let i = 0; i < 10; i++) {
      const u = sample(upgrades);
      perks[u.id] ||= Math.floor(Math.random() * u.max) + 1;
      if (u.requires) {
        perks[u.requires] ||= 1;
      }
    }
    perks.superhot = 0;
  }
  restart({
    level: sample(allLevels.filter((l) => l.color === "#000000")),
    computer_controlled: true,
    perks,
    stress,
  });
}

await window.highscores.init();
tick();
setupTooltips();
document
  .getElementById("menu")
  ?.setAttribute("data-tooltip", t("play.menu_tooltip"));
