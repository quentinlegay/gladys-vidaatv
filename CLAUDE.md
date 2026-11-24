# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** that controls Hisense TVs running
VIDAA OS: a Node.js service (Node 22+, ESM, no build step) that runs in its own
sandboxed Docker container and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
and to the TV through its MQTT broker (port 36669, TLS) with
[`mqtt`](https://github.com/mqttjs/MQTT.js). It started from the official
JavaScript template.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/tv.test.js               # one file
node --test --test-name-pattern "pairing" # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/tv.js                         TV controller: state, commands, pairing, Wake-on-LAN
src/devices/television.js         the Gladys device (features, supported options)
src/actions.js                    manifest `actions` handlers (Configuration screen)
src/scenes.js                     scene action handlers (manifest `scene_actions`)
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/vidaa/client.js               MQTT client of the TV: credential fallback, requests, pairing
src/vidaa/credentials.js          VIDAA credential generation (pinned by a reference vector)
src/vidaa/protocol.js             topics and remote keys
src/vidaa/certs.js                PEM normalization of the pasted client certificate
src/vidaa/store.js                pairing store (uuid, method, tokens) under /data
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test: fake TV broker (test/helpers.js) + the SDK's fake Gladys
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **Every feature carries `name`, `min`, `max`, `read_only` and
  `has_feedback`**, even where they mean nothing: Gladys stores them NOT NULL.
  `min`/`max` are `0`/`1` for a binary feature, the real range for a numeric
  one, `0`/`0` for a feature without a range (text, image...). A missing one
  can pass the publication on a core that does not check it, then fail when
  the user clicks "Add" (HTTP 422 `t_device_feature.min cannot be null`). The
  SDK's fake Gladys refuses it on publication, and `test/devices.test.js`
  checks them.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume (`DATA_DIR` in development). Never log tokens, passwords,
  the client certificate or its key.
- **The TV device external id derives from the TV MAC address** (config
  `tv_mac`), never from its IP. Feature keys (`power`, `volume`, `source`,
  `app`, the button keys of `BUTTON_FEATURES`) are forever.
- **Never ship the VIDAA app client certificate or key**: users supply them.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** `keywords` and `countries` require Gladys 5.3.0: the
  manifest stays at `>=5.1.0` without them. Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
