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
- **Levels** tick every 10 seconds. Each raises scroll speed, spawn rate and the share of large asteroids. Giants appear from level 4. Dense "asteroid field" waves arrive periodically.
- **Leaderboard** is stored in the browser's localStorage, top 10.

## Files

- `index.html` – markup for the canvas and the start / pause / game-over panels
- `style.css` – panel styling
- `game.js` – simulation, rendering and UI logic. Tunables live in the `CFG` and `TIERS` objects at the top.

## Developing

Any static server works, for example:

```bash
npx http-server -p 8765 -c-1 .
```

`window.__dodger` exposes a small debug hook in the console: `__dodger.setLevel(7)` jumps the difficulty, `__dodger.spawn(3, x, y)` drops a giant asteroid.
