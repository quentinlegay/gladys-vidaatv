# Hisense VIDAA TV

Control a Hisense TV running **VIDAA OS** from Gladys: power, volume, remote
keys, sources (HDMI...) and applications (Netflix, YouTube...). Gladys talks to
the TV over your local network, the same way as the VIDAA mobile app
("VIDAA" / "RemoteNOW"): no cloud account is needed.

## Before you start

- The TV and Gladys must be on the same local network.
- Give the TV a **fixed IP address** (a DHCP reservation in your router): the
  integration reaches it by this address.
- Note the TV's **MAC address**: on the TV, _Settings > Network > Network
  information_ (or _About_). Take the address of the interface the TV uses
  (Wi-Fi or Ethernet). It identifies the TV in Gladys and is used to turn it on.
- To turn the TV on from Gladys, enable the network standby on the TV:
  _Settings > Network > Wake on LAN_ / _Wake on Wireless LAN_ (the name depends
  on the model), or _Settings > System > Power > Quick start_.

## Configuration

| Field                             | What to enter                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| **TV IP address**                 | e.g. `192.168.1.50`                                                                          |
| **TV MAC address**                | e.g. `aa:bb:cc:dd:ee:ff` (any format: `-`, `:` or none)                                      |
| **TV name**                       | The name of the device in Gladys                                                             |
| **Authentication method**         | Leave _Automatic_: the integration tries every method the VIDAA firmwares use                |
| **Client certificate / key**      | Only for the TVs that require them, see [below](#client-certificate)                         |
| **Wake-on-LAN broadcast address** | Only if the TV does not turn on: the broadcast address of your network, e.g. `192.168.1.255` |

Save the configuration.

## Pairing

Like the mobile app, Gladys must be authorized by the TV once:

1. Turn the TV on.
2. In the integration's Configuration screen, click **Start pairing**. A PIN
   (4 digits) appears on the TV.
3. Within a minute, click **Confirm pairing**, type the PIN and validate.
4. The message "Paired!" confirms it. **Test the connection** tells you at any
   time whether the TV accepts Gladys' commands.

The pairing is stored by the integration: it survives restarts. **Forget the
pairing** erases it (useful after replacing the TV or a factory reset).

## Add the TV to Gladys

Go to the **Discovery** tab of the integration and add the TV. It offers:

| Feature                                                 | Effect                                                 |
| ------------------------------------------------------- | ------------------------------------------------------ |
| Power                                                   | Turns the TV on (Wake-on-LAN or power key) and off     |
| Volume                                                  | Sets the volume (0-100), follows the changes on the TV |
| Volume up/down, Mute                                    | Remote keys                                            |
| Channel up/down                                         | Remote keys                                            |
| Up, Down, Left, Right, OK, Back, Exit, Menu, Home, Info | Navigation keys                                        |
| Play, Pause, Stop, Rewind, Fast forward                 | Playback keys                                          |
| Source                                                  | Switches input (the list comes from the TV)            |
| Application                                             | Opens an application (the list comes from the TV)      |

The state is refreshed every 30 seconds, and immediately when the TV reports a
change (power, volume, source).

## Scenes

Two actions are available in the scene editor:

- **Press a TV remote key**: any key of the remote, optionally several times
  (e.g. "Volume down" × 5);
- **Open a TV application**: by its name, e.g. `Netflix`, `YouTube`,
  `Prime Video`.

The device features (power, volume, source...) can also be used with the
standard "Control a device" action.

## Client certificate

Recent VIDAA firmwares only accept the secure connection of a client presenting
the certificate of the official mobile app (mutual TLS). This certificate is
**not** distributed with the integration. If **Test the connection** says that
the TV refused the secure connection:

1. Get the client certificate and its private key of the VIDAA app: the
   community documents how to extract them from the app
   ([pyvidaa — obtaining the client certificate](https://github.com/warrenrees/myhisense-tv#readme),
   [protocol analysis](https://github.com/warrenrees/myhisense-tv/blob/main/VIDAA_PROTOCOL_ANALYSIS.md)).
2. Paste the certificate (`-----BEGIN CERTIFICATE-----...`) in **Client
   certificate** and the key (`-----BEGIN PRIVATE KEY-----...`) in **Client
   private key**. Line breaks lost when pasting are restored automatically, and
   a base64-encoded file is accepted too.
3. Save, then pair again.

## Troubleshooting

- **"The TV does not answer"**: the TV is off without network standby, or its
  IP address changed. Check the address, enable the network standby (see
  above).
- **"The TV refused every login method"**: force another authentication
  method, or add the client certificate.
- **Connected but "it ignores the commands"**: run the pairing.
- **The TV does not turn on**: enable Wake on LAN on the TV, check the MAC
  address (Wi-Fi and Ethernet have different ones), set the broadcast address of
  your network. Some models only wake up from a short standby.
- **The PIN does not appear**: the TV may have reached its maximum of paired
  devices: remove old ones in its settings, then retry.

For the integration logs, open the integration's page in Gladys
(Supervision).

## Credits

The VIDAA protocol was documented by the community, in particular the
[pyvidaa](https://github.com/warrenrees/myhisense-tv) and
[hisensetv](https://github.com/newAM/hisensetv) projects.
