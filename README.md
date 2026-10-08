# Paperman 2: The Maple Hollow Route

A voxel paper-route game in TypeScript and Three.js. Deliver the *Herald* Monday to Friday
down one suburban route and keep your subscribers.

**Play:** https://pwshfan1980h.github.io/paperman-2/ · rider lab: https://pwshfan1980h.github.io/paperman-2/lab.html

```bash
npm install
npm run dev        # game at http://localhost:5173, rider lab at /lab.html
npm run build      # static build in dist/ (pushing to main deploys it to GitHub Pages)
npm run check      # type-check
```

## The game

- **Goal:** survive the week. Houses with a gold marker and a raised flag subscribe. A miss is a
  strike; two strikes (or a smashed window) and they cancel. A perfect day wins two back and a
  bike. Finish Friday for a rank: Gold (85%+ kept), Silver (60%+), Bronze. Run out of bikes or
  subscribers and you're fired.
- **Route** (~6,000 voxels long, ~85 s a day): Herald Depot → Maple Row → crossing → Sycamore Court →
  Birch Park (ramps, bullseyes, pond) → Hilltop Lane → road works → Elm Street → crossing →
  Willow Bend → finish arch.
- **Houses:** ranch, colonial, craftsman, Cape Cod, modern, Victorian (turret), split-level,
  A-frame; each district has its own style mix, trees, fences and yard clutter.
- **Life:** dogs (7 breeds; sleep, sit, bark, chase, return; fenced ones run the fence line),
  cats (6 coats; perch, groom, loaf, dart across the road), bot mowers (stripe lawns; rogue
  ones roam the street from Wednesday), bird flocks that scatter, ducks, geese overhead,
  squirrels, parked and moving cars, trash cans, knockable cones, paper bundles.
- **Scoring:** mailbox 250, porch 100, non-subscriber window 100, bullseye 200, bonk a dog or
  mower 50, air time × 400, bench/fountain/porch stalls 75. Deliveries build a streak up to ×4.

Keys: ←/→ veer · ↑ sprint · ↓ brake · Z/X throw left/right · Space hop · Esc pause · M mute.

## Code

```
src/rider/        rigged voxel rider: IK legs/arms, springs, hop, ramps, crash (the locked "feel")
src/voxel/        Vox (sparse, for characters) and Grid (dense + greedy AO mesher, for the world)
src/game/world/   route layout, streaming, collision/ground queries, houses, lots, props, specials
src/game/entities creature and vehicle models + behaviours, particles
src/game/         game loop and state machine, papers, audio synth + music, HUD
src/lab/          rider lab (lab.html)
```

Debug: `#debug` keeps the drawing buffer for screenshots, `#debug-play` / `#debug-play3` jumps
straight into a day, and `game.debugBot(frames)` rides a day with a simple bot and reports.

See `ROADMAP.md` for the second-pass plan.
