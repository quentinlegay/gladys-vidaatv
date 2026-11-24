# gladys-vidaatv — Hisense VIDAA TV for Gladys Assistant

External integration for [Gladys Assistant](https://gladysassistant.com) that
controls **Hisense TVs running VIDAA OS** over the local network, like the
VIDAA mobile app: power (Wake-on-LAN), volume, remote keys, sources and
applications, plus two scene actions.

Built from the official
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js)
with [`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

- User documentation: [English](docs/en.md) · [Français](docs/fr.md)
- Requires Gladys **5.1.0** or later (scene actions).

## Features

| Surface               | What it does                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| Device `Hisense TV`   | Power, volume (0-100), 20 remote buttons, source select, application select                      |
| States                | Pushed by the TV (power, volume, source) and polled every 30 s                                   |
| Configuration actions | Start pairing (PIN on the TV), confirm pairing, test the connection, forget the pairing          |
| Scene actions         | `send_key` (any remote key, repeatable), `launch_app` (by name)                                  |
| Power on              | Wake-on-LAN through the Gladys core (`network_wake`), or the power key when the TV is in standby |

## How it talks to the TV

VIDAA TVs run an MQTT broker on port **36669** (TLS, self-signed
certificate). The integration ([`src/vidaa/`](src/vidaa)):

1. connects with the credentials the TV accepts, tried in order: the token the
   TV issued at pairing, then the dynamic credentials of the official app
   (`modern`, `middle`, `legacy` variants, derived from a client uuid and the
   time), then the fixed login of old firmware — and remembers the one that
   worked;
2. optionally presents the client certificate of the official app (mutual TLS,
   required by recent firmware; supplied by the user, never shipped);
3. pairs with the PIN displayed on the TV (`vidaa_app_connect` →
   `authenticationcode` → `tokenissuance`), and refreshes the token;
4. publishes commands on `/remoteapp/tv/<service>/<clientId>/actions/<action>`
   and listens to the state, volume and standby broadcasts.

The pairing (client uuid, method, tokens) is stored in `/data`, the writable
volume of the container. Tokens are never logged.

The protocol knowledge comes from the community reverse engineering, in
particular [pyvidaa](https://github.com/warrenrees/myhisense-tv) (MIT) and
[hisensetv](https://github.com/newAM/hisensetv).

## Project structure

```
index.js                          SDK wiring only (handlers registered before connect())
src/tv.js                         TV controller: state, commands, pairing, Wake-on-LAN
src/devices/television.js         the Gladys device: features, supported options
src/actions.js                    manifest actions (Configuration screen buttons)
src/scenes.js                     scene actions
src/config.js                     defaults + normalization of the configuration
src/vidaa/client.js               MQTT client of the TV (connection, requests, pairing)
src/vidaa/credentials.js          credential generation (dynamic + fixed login)
src/vidaa/protocol.js             topics, remote keys
src/vidaa/certs.js                PEM normalization of the pasted certificate
src/vidaa/store.js                pairing store under /data
gladys-assistant-integration.json manifest
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys
test/                             node --test, fake TV broker + the SDK's fake Gladys
```

## Development

```bash
npm install
npm test                 # node --test (no network: fake TV + fake Gladys)
npm run lint             # ESLint
npm run format:check     # Prettier
```

Run it against a real Gladys:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="gladys-vidaatv" \
DATA_DIR=./data \
LOG_LEVEL=debug \
npm start
```

`DATA_DIR` (default `/data`) is where the pairing is stored.

Check the store rules locally before a release:

```bash
npx github:GladysAssistant/integration-store .
```

## Publishing

1. Add the GitHub topic `gladys-assistant-integration` to the repository.
2. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
3. **Actions → Release → Run workflow** (`patch`, `minor` or `major`): it bumps
   the versions, tags, builds the `linux/amd64` + `linux/arm64` image to
   `ghcr.io/quentinlegay/gladys-vidaatv` and publishes the GitHub Release.
4. Make the ghcr.io package public, so Gladys can pull it.

## License

Apache-2.0
