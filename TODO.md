# ProcUniverse Feature Roadmap

## Universe Generation & Objects

- [ ] Add moons
  - Generate moons around planets
  - Render moons in both star system and galaxy views
  - Include moon properties in inspector

## Scale & Units Display

- [x] Add kilometers as a unit for distance scale under 1 AU
  - Show "millions of km" when viewing very zoomed in (under 1 AU)
- [ ] Add more unit conversions to the properties in the inspector
  - Mass: show in kg in addition to solar/earth masses
  - Radius: show in km in addition to solar/earth radii
  - Other properties audit for common conversions
- [x] Persist unit choice upon reload
  - Store selected unit preference in localStorage
  - Restore on app start

## Solar System Viewing & Scale Representation

- [ ] Find a better way to preserve the scale when viewing a solar system
  - Current issue: planets sometimes drawn as same size as stars at real scale
  - Reflect on balance between realism and visibility
  - Consider alternative visualization strategies
  - Investigate impact of existing grid and scale indicator

## Star & System Interaction

- [ ] In the star view, enable clicking on a planetary system to inspect it
  - Display system information: star properties, planet count, stats
  - Show clickable/selectable systems on star view
- [ ] Auto-zoom to system from star view
  - Double-click on star to zoom to system
  - Add button on star inspector to zoom to system
  - Auto-zoom should center on star and frame entire orbit of outermost planet

## View Persistence & Navigation

- [x] Persist current view upon reload
  - Store camera position, zoom level in localStorage
  - Restore view state on app start
  - Add "return to origin" button for manual reset
- [x] Add "tree view" navigation hierarchy
  - Show current location: Galaxy → Star → Planets → Moons (Moons deferred until moons exist)
  - Only show tree nodes relevant to current zoom level
  - Hide star node if not yet zoomed into system
  - Consider subdividing galaxies (core, inner/outer disk, halo, spiral arms, sectors) — deferred (kept flat for usability)
  - Balance realism with usability

## Inspector & UX Improvements

- [ ] Add more explanations (tooltips) to inspector properties
  - Identify properties that are unclear
  - Add helpful context for each property
  - Ensure clarity for non-astronomical users
- [ ] Add bookmarking of celestial bodies
  - Bookmark system for currently viewed body
  - Display bookmark list in UI
  - Enable zoom-to action from bookmark
  - Enable inspector open action from bookmark
  - Persist bookmarks in localStorage
