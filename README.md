# 67 Frenzy

Browser-based arcade mini-game inspired by the "67" meme. Numbers rain from the sky and only the sacred `67` may be collected. Grab enough correct `67`s before the chaos overwhelms you.

## Gameplay Loop

- Numbers spawn at the top and fall toward the bottom.
- Click the ones labeled `67` to score points.
- Clicking a wrong number costs a life; missing a `67` also hurts.
- Survive the wave timer to level up and watch the pace accelerate.

## Project Structure

- `index.html` — static page scaffold and canvas container.
- `styles.css` — minimal styling and meme-flavored palette.
- `game.js` — canvas rendering, spawn logic, input handling, and game state.

## Running Locally

This is a static site. Open `index.html` in any modern browser or run a local web server:

```bash
python3 -m http.server 8000
```

Then visit [http://localhost:8000](http://localhost:8000).
