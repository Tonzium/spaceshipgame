# Starship Dodger

A browser game with no dependencies. Open `index.html` or serve the folder on GitHub Pages.

## Controls

| Key | Action |
| --- | --- |
| Arrow keys / WASD | Fire thrusters (left, right, forward, retro) |
| Space | Hard brake |
| P / Esc | Pause |
| Enter / Space | Launch or restart |

Touch: hold the left or right half of the screen to thrust sideways, hold both to brake, touch the top third to thrust forward.

## Gameplay

- **Newtonian flight.** Thrusters add acceleration, not position. You coast, drift and carry momentum. A gentle auto-stabilizer bleeds off speed; the brake bleeds it fast. Edges bounce.
- **Three hull points.** A hit knocks the rock apart, shoves the ship, and grants two seconds of invulnerability.
- **Near misses** score bonus points. Bigger rocks and closer passes pay more.
- **Rock tiers.** Shards are tiny and nearly twice as fast as the flow, drawn with a streak. Pebbles, rocks, asteroids and giants follow as levels rise.
- **Levels** tick every 10 seconds. Each raises scroll speed, spawn rate and the share of large asteroids. Giants appear from level 4. Dense "asteroid field" waves arrive periodically.
- **Black holes** from level 10. Gravity follows an inverse-square law, so the pull grows sharply as you approach. Rocks get bent and swallowed too. Crossing the event horizon is instant death, invulnerability or not.
- **Quasars** from level 10. One sits in the background, locks onto your position, shows a red dashed corridor for about two seconds, then fires. The beam costs one hull point and vaporizes every rock in its path. Each quasar fires up to three times before drifting away.
- **Twin quasar** from level 15. Two orbiting cores fire two beams at once, spread on either side of you.
- **Leaderboard** is stored in the browser's localStorage, top 10.

## Files

- `index.html` – markup for the canvas and the start / pause / game-over panels
- `style.css` – panel styling
- `game.js` – simulation, rendering and UI logic. Tunables live in the `CFG`, `TIERS` and `HAZ` objects at the top.

## Developing

Any static server works, for example:

```bash
npx http-server -p 8766 -c-1 .
```

`window.__dodger` exposes a small debug hook in the console:

- `__dodger.setLevel(9)` jumps to displayed level 10
- `__dodger.spawn(4, x, y)` drops a giant asteroid
- `__dodger.hole(x, y)` places a black hole
- `__dodger.quasar(true)` summons a twin quasar (`false` for a single one)
- `__dodger.step(2.5)` advances the simulation by 2.5 seconds synchronously
