# CLANKO GP

An original open-wheel racing simulator that runs in the browser. Built for CLANKO100.COM by clanko.

Everything in the game is original: ten fictional circuits, ten fictional teams, twenty fictional
drivers and all the liveries and trackside branding. No real series, team, driver or sponsor is used.

## Layout

    core/      physics, tyres, circuits, AI, collisions, weather, session rules (plain JS, runs in Node)
    render/    three.js: circuit meshes, scenery, cars, cameras, effects, lighting, garage
    game/      app shell, race controller, input, settings, radio, career, weekend, replays, achievements
    net/       signalling client (PeerJS protocol), WebRTC peer link, online race sync, lobby
    ui/        menus, HUD, garage screens, debug overlay
    audio/     synthesised engine, tyre, wind and ambience audio (no recordings)
    tests/     headless tests that run the real physics and AI in Node
    tools/     build script and the local signalling broker used for offline testing

## Building

    node tools/build-gp.mjs          # bundles and minifies into ../../embed/clanko-gp
    node tools/build-gp.mjs --dev    # writes dev.html, which loads the modules unbundled

The game is then served at /embed/clanko-gp/ and listed on the site through tools/games.json.

## Tests

    node tests/physics.test.mjs      # acceleration, braking, top speed, cornering
    node tests/laps.test.mjs         # an AI car laps every circuit cleanly
    node tests/race.test.mjs         # a full 20-car race with pit stops, flags and results

## Online racing

Races run peer to peer over WebRTC. The only server involved is a signalling broker, which is used
for the handshake and nothing else; the public PeerJS broker is the default. To use your own:

    node tools/mock-signal.mjs 9000          # a tiny broker, also used by the tests
    open .../index.html?broker=ws://host:9000

The player who creates the room runs the race: lap timing, collisions, flags and results are decided
there, and the guest's inputs are checked before they are applied.
