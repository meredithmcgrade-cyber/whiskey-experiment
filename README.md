# Is It Wednesday?

A scroll-driven 3D whiskey bottle. The bottle swings its way through every day of the week, then pours a drink at the end. It is always Wednesday.

Built with Vite, React Three Fiber, Lenis (smooth scroll) and Theatre.js (the animation timeline). Hosted on Vercel, which redeploys on every push.

## Run it locally

```
npm install
npm run dev
```

Then open the address it prints, usually http://localhost:5173.

## Where things live

| What | File |
| --- | --- |
| All of the words | `src/content.js` |
| Page layout | `src/App.jsx` |
| Colors, type and spacing | `src/styles.css` |
| The 3D scene | `src/scene/Scene.jsx` |
| Quality tiers | `src/quality.js` |
| Sound | `src/audio.js` and `public/sounds/` |
| Liquid, glass and cork looks | `src/scene/materials.js` |
| The animation timeline | `src/theatre/state.json` |
| The Blender export | `public/models/whiskey.glb` |
| Baked cork texture | `public/textures/` |

## Quality tiers

The site checks the visitor's graphics hardware and picks one of three levels. It steps down a level only if the frame rate stays below 20 frames a second for several seconds. The thresholds are in `GOVERNOR` in `src/quality.js`.

- **High**: real glass refraction with color fringing, bloom, film grain and a vignette.
- **Medium**: real glass refraction and the same effects at a lower resolution.
- **Low**: lightweight glass and no effects.

Add `?quality=low`, `?quality=medium` or `?quality=high` to the address to force one while testing. A forced level never changes.

## Editing the animation

The choreography is a Theatre.js timeline. Scroll position moves its playhead, and one screen of scroll equals one unit of time. Monday sits at 1, Sunday at 7 and the pour runs from about 8 to 10.

1. Run `npm run dev` and open http://localhost:5173/?studio. The `?studio` part turns the editor on.
2. Pick an object in the outline on the left: Bottle, Cork, Glass, Liquid or Camera. There are two sets. **Scroll** is the wide layout. **Scroll Phone** is a separate composition used on tall, narrow screens, so narrow the browser window to see and edit that one.
3. Scroll the page or drag the playhead to the moment you want to change, then adjust values in the panel on the right. Edit keyframes and easing curves in the timeline at the bottom.
4. When it looks right, click the project name (Whiskey) in the outline and choose "Export Whiskey to JSON".
5. Replace `src/theatre/state.json` with the file it downloads, then commit and push.

The editor keeps unsaved work in the browser. If the page ever looks different from the saved file, that is why. Clearing site data for localhost resets it.

What each control does:

- **Bottle**: `x`, `y` and `scale` place it. `spin` is full turns. `lean` is tilt in degrees, and past 90 it is pouring.
- **Cork**: `lift` goes from 0 (in the bottle) to 1 (popped and gone). Tiny values make it wiggle in place, which is the Tuesday beat. The pop sound plays as it passes 0.2.
- **Glass**: `x`, `y` and `scale`. It waits below the screen until the finale.
- **Liquid**: `bottleFill` and `glassFill` run from 0 to 1. `streamHead` and `streamTail` are the front and back ends of the pour.
- **Camera**: `z` is distance and `y` is height.

## Updating the models

The models come from `whiskey.1_web.blend`. To update them, select Bottle, Cork, Label, Glass, Glass Liquid and Ice in Blender, export as glTF Binary with "Selected Objects" and "Apply Modifiers" on, and save over `public/models/whiskey.glb`. Keep the object names the same, because the scene finds each piece by name.

A few things are done in code instead of Blender:

- **The whiskey in the bottle** is a shape generated from the bottle's inside measurements (`BOTTLE_INTERIOR` in `Scene.jsx`) so it can run into the neck when the bottle tips. If the bottle's shape changes, those numbers need to change too.
- **The headline** is the raised lettering on the bottle, an object named `Label` parented to the bottle in Blender. It was built from the "Is It Wednesday_.svg" curves: extruded slightly and wrapped 130 degrees around the body. The HTML headline stays in the page for screen readers, hidden from view.
- **Lighting** recreates the Blender file's four area lights and green ambient (see `Lighting` in `Scene.jsx`). If the lights move in Blender, they need to be moved here too.
- **The pour, splash and cork pop** are generated in code, with no baked simulations.
- **Sound** is two recordings in `public/sounds/`: `cork-pop.mp3` plays as the cork leaves the bottle, and `pour.mp3` plays while the whiskey pours. The pour repeats its steady middle section if the visitor scrolls slowly, and the loop points are set at the top of `src/audio.js`. Replace either file to change the sound.
- **Materials** are all set in `materials.js`. Blender materials are ignored, except the cork. Its procedural Blender material is baked to two images in `public/textures/` (color and surface bumps). If the cork's look or shape changes in Blender, it needs to be baked again.
