# Paperman 2

Voxel paperboy, take two. TypeScript + Three.js. **Current phase: rider art & animation only.**

```bash
npm install
npm run dev        # rider lab at http://localhost:5173
npm run check      # type-check
```

## Rider lab

The rider is a procedural rig, not baked frames:

- **Voxel parts** (`src/rider/models.ts`): every body part and bike part is its own voxel mesh with baked AO (`src/voxel/vox.ts`).
- **IK limbs** (`src/rider/motion.ts`): legs solve two-bone IK onto pedals that ride a real crank; hands solve onto grips on the steering fork.
- **Springs everywhere** (`src/rider/rider.ts`): heading, lean, bar steer, standing, braking, foot-down, bag swing and head look are damped springs, so every transition blends.
- **Physically-driven lean**: lean = atan(v · yawRate / g); bar angle comes from bike kinematics, plus a flick of countersteer.
- Three true headings: straight, and ±30° (`HEADING_MAX`).

Animations: cruise pedaling, sprint out of the saddle (bike rocks under the rider), coast with level pedals, brake/skid with dust and fishtail, stop with the left foot planted, push-off, throw left/right (reach into bag → wind-up → release → follow-through, paper flies and lands), road bumps absorbed by the legs, crash (endo, flip, sprawl, stars, respawn blink).

Keys: ←/→ veer, ↑ sprint, ↓ brake/stop, Z throw left, X throw right, C crash, 1–5 cameras, P pause, `.` step, `[` `]` time scale, K bones, V pixel mode, G demo reel.
