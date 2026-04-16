# Breakout 71 Mini-app

A WebXDC port of [Breakout 71](https://gitlab.com/lecarore/breakout71)

## Contributing

### Installing Dependencies

After cloning this repo, install dependencies:

```
pnpm i
```

### Checking code format

```
pnpm check
```

### Testing the app in the browser

To test your work in your browser (with hot reloading!) while developing:

```
pnpm start
```

### Building

To package the WebXDC file:

```
pnpm build
```

To package the WebXDC with developer tools inside to debug in Delta Chat, set the `NODE_ENV`
environment variable to "debug":

```
NODE_ENV=debug pnpm build
```

The resulting optimized `.xdc` file is saved in `dist-xdc/` folder.

### Releasing

To automatically build and create a new GitHub release with the `.xdc` file:

```
git tag -a v1.0.1
git push origin v1.0.1
```

# Old README:

Break colourful bricks, catch bouncing coins and select powerful upgrades !

- [Play now](https://breakout.lecaro.me/)  
- [Donate](https://paypal.me/renanlecaro)
- Bitcoin : bc1qlh8kywy3ttsuqqa08yx2rdc8dqhdvyt43wlxmr
- [Discord](https://discord.gg/bbcQw4x5zA)
- [itch.io](https://renanlecaro.itch.io/breakout71)    
- [F-Droid](https://f-droid.org/en/packages/me.lecaro.breakout/)  
- [Google Play](https://play.google.com/store/apps/details?id=me.lecaro.breakout)  
- [GitLab](https://gitlab.com/lecarore/breakout71)  
- [Weblate](https://hosted.weblate.org/projects/breakout-71/in-app-translations/)

**Installation**

Breakout 71 can be installed and work offline in many ways:

- Download an index.html file from [itch.io](https://renanlecaro.itch.io/breakout71) to play offline on your computer (latest version always)
- Download the latest apk from [itch.io](https://renanlecaro.itch.io/breakout71) to play offline on your android phone (latest version always)
- Add [the app](https://breakout.lecaro.me/) to your home screen on android, and it should play even when offline thanks to the service workers (latest version always)
- Install the latest version from the play store  : https://play.google.com/store/apps/details?id=me.lecaro.breakout (updated from time to time) 
- Install the latest version from Fdroid : https://f-droid.org/packages/me.lecaro.breakout/ (updated very rarely because of the updates publication lag) 
- Download the index.html file or apk from my archive server : https://archive.lecaro.me/public-files/b71/ (any version including latests)

**System requirements**

The game should perform well even on low-end devices.  It's very lean and does not take much storage space (Roughly 0.1MB). The web version is supposed to work on iOS safari, Firefox ESR and chrome, on desktop and mobile.
If the app stutters, turn on "fast mode" in the settings to render a simplified view that should be faster. You can adjust many aspects of the game there, go have a look !

**credits**

I pulled the background patterns from https://pattern.monster/
Colin (obigre) brought a lot of fantastic ideas to the game, here's his website (in French) : https://colin-crapahute.bearblog.dev/
