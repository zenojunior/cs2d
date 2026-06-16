# CS Demo Analyzer

## Assets

### Map radars
The radar images in `apps/app/public/maps/` come from the **cs2-map-icons** repo:
https://github.com/MurkyYT/cs2-map-icons/tree/main/images/radars

When adding support for a new map, grab its radar from there and add a matching
entry to `MAP_CALIBRATION` in `apps/app/src/viewer/calibration.ts` (using the
official overview `pos_x` / `pos_y` / `scale` values). Without a calibration
entry the viewer falls back to `de_dust2`, so the map renders with the wrong
radar and coordinates.
