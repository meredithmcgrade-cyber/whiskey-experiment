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
| Liquid, glass and cork looks | `src/scene/materials.js` |
| The animation timeline | `src/theatre/state.json` |
| The Blender export | `public/models/whiskey.glb` |
| Baked cork texture | `public/textures/` |

## Editing the animation

The choreography is a Theatre.js timeline. Scroll position moves its playhead, and one screen of scroll equals one unit of time. Monday sits at 1, Sunday at 7 and the pour runs from about 8 to 10.

1. Run `npm run dev` and open http://localhost:5173/?studio. The `?studio` part turns the editor on.
2. Pick an object in the outline on the left: Bottle, Cork, Glass, Liquid or Camera.
3. Scroll the page or drag the playhead to the moment you want to change, then adjust values in the panel on the right. Edit keyframes and easing curves in the timeline at the bottom.
4. When it looks right, click the project name (Whiskey) in the outline and choose "Export Whiskey to JSON".
5. Replace `src/theatre/state.json` with the file it downloads, then commit and push.

The editor keeps unsaved work in the browser. If the page ever looks different from the saved file, that is why. Clearing site data for localhost resets it.

What each control does:

- **Bottle**: `x`, `y` and `scale` place it. `spin` is full turns. `lean` is tilt in degrees, and past 90 it is pouring.
- **Cork**: `lift` goes from 0 (in the bottle) to 1 (popped and gone).
- **Glass**: `x`, `y` and `scale`. It waits below the screen until the finale.
- **Liquid**: `bottleFill` and `glassFill` run from 0 to 1. `streamHead` and `streamTail` are the front and back ends of the pour.
- **Camera**: `z` is distance and `y` is height.

## Updating the models

The models come from `whiskey.1_web.blend`. To update them, select Bottle, Cork, Glass, Glass Liquid and Ice in Blender, export as glTF Binary with "Selected Objects" and "Apply Modifiers" on, and save over `public/models/whiskey.glb`. Keep the object names the same, because the scene finds each piece by name.

Two things are done in code instead of Blender:

- **The whiskey in the bottle** is a shape generated from the bottle's inside measurements (`BOTTLE_INTERIOR` in `Scene.jsx`) so it can run into the neck when the bottle tips. If the bottle's shape changes, those numbers need to change too.
- **Materials** are all set in `materials.js`. Blender materials are ignored, except the cork. Its procedural Blender material is baked to two images in `public/textures/` (color and surface bumps). If the cork's look or shape changes in Blender, it needs to be baked again.
