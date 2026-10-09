# Desktop launcher (Windows)

A desktop shortcut that starts the local Ledgerline API and web server if they are not already running, then opens the app in the browser. If both are already running it only opens the browser. No Node packages beyond the project's own are needed, and nothing here reads or writes a credential.

## Create the shortcut

From the repository folder, after `npm install`:

```bash
npm run launcher:shortcut
```

This puts `Ledgerline.lnk` on your desktop, pointing at `tools/desktop-launcher/launch.cmd` and using `design/brand/ledgerline.ico`. Run it again to refresh the shortcut, for example after moving the folder. To put it somewhere else:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File tools/desktop-launcher/create-shortcut.ps1 -Directory "C:\path\to\folder"
```

## What a double-click does

- **Both servers stopped:** starts the API (port 4174) and the web server (port 5173), waits until each answers, then opens `http://127.0.0.1:5173`. The window closes by itself.
- **Both running:** opens the browser and starts nothing.
- **One running:** starts only the other.
- **A port is held by some other program, a server stops while starting, or one does not answer within 60 seconds:** the window stays open and says which server and which port, with the last lines the server printed. Nothing else is started when a port is held by another program.

The servers keep running after the browser closes; there is no stop shortcut. To stop them, end the `node` processes listening on ports 4174 and 5173 (for example from Task Manager), or restart the computer. Server output is written to `data/launcher/api.log` and `data/launcher/web.log` (Git-ignored); each start replaces the previous log.

Both servers listen on `127.0.0.1` only. To use other ports, set `API_PORT` and `LEDGERLINE_WEB_PORT` in the environment before launching. Running `node tools/desktop-launcher/launch.mjs --no-open` does everything except open the browser.

If the window says Node.js was not found, or that dependencies are not installed, install Node.js 18 or later, or run `npm install` in the repository folder.

## The icon

`design/brand/ledgerline.ico` holds 16, 32, 48, 64, 128, and 256 px images, each stored as a PNG. The 16, 32, and 48 px images are `design/brand/png/favicon-16.png`, `favicon-32.png`, and `favicon-48.png` exactly as supplied (the mark with the heavier stroke made for small sizes). The 64, 128, and 256 px images are `png/app-icon-1024.png` averaged down by a whole factor. Nothing is redrawn, recolored, or cropped.

To rebuild it after the brand PNGs change:

```bash
npm run launcher:icon
```

The same input gives the same icon. `png/mark-reverse-512.ico`, the one `.ico` the brand folder once mentioned, is a single 32 px reverse mark and is not used.

## Tests

`npm run test:launcher` (also part of `npm test`) checks the icon's sizes and sources, and the launcher against fake listeners: already running, port in use, a server that stops, and one that never answers. It never starts the real servers or opens a browser.
