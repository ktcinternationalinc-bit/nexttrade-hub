# Avatar Portraits

This directory holds the portrait photos for the 3 AI personas:
- nadia.png — Executive Assistant
- jenna.png — HR Representative
- sara.png — Work Coach

If your portraits are already deployed on Vercel, leave them in place — unzipping
this build won't overwrite them.

If you ever need to replace them, just drop a new PNG with the matching name
into this folder. Recommended: 400x400 px, centered headshot. The AnimatedPortrait
component's default face anchors expect:
- Mouth at ~74% Y, centered
- Eyes at ~46% Y, at 41% and 59% X
If your portrait has a face that's off-center, tune the faceAnchors block in
src/lib/agent-personalities.js for that persona.
