# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-11-24

### Added

- Control of Hisense TVs running VIDAA OS over the local network: power,
  volume, remote buttons, source and application selects.
- Power on through Wake-on-LAN (relayed by the Gladys core), or the power key
  when the TV is in network standby.
- Live state: power, volume and source follow the TV broadcasts, and the TV is
  polled every 30 seconds.
- Pairing with the PIN displayed on the TV, from the Configuration screen, and
  automatic refresh of the token the TV issues.
- Every VIDAA login method (dynamic credentials of the official app, fixed
  login of old firmware), detected automatically, and an optional client
  certificate for the TVs that require mutual TLS.
- Scene actions: press a remote key, open an application.
- User documentation in English and French.

[Unreleased]: https://github.com/quentinlegay/gladys-vidaatv/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/quentinlegay/gladys-vidaatv/releases/tag/v0.1.1
