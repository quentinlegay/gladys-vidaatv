// -----------------------------------------------------------------------------
// VIDAA MQTT protocol: topics, remote keys, sources.
//
// Commands are published to  /remoteapp/tv/<service>/<clientId>/actions/<action>
// Answers come back on       /remoteapp/mobile/<clientId>/<service>/data/<type>
// and broadcasts on          /remoteapp/mobile/broadcast/...
// Some firmware refuses wildcard subscriptions: every topic is listed.
// -----------------------------------------------------------------------------

export const DEFAULT_PORT = 36669;

export const commandTopic = (service, clientId, action) =>
  `/remoteapp/tv/${service}/${clientId}/actions/${action}`;

export const dataTopic = (service, clientId, type) =>
  `/remoteapp/mobile/${clientId}/${service}/data/${type}`;

export const COMMANDS = Object.freeze({
  SEND_KEY: ['remote_service', 'sendkey'],
  GET_STATE: ['ui_service', 'gettvstate'],
  GET_VOLUME: ['platform_service', 'getvolume'],
  SET_VOLUME: ['platform_service', 'changevolume'],
  GET_SOURCES: ['ui_service', 'sourcelist'],
  SET_SOURCE: ['ui_service', 'changesource'],
  GET_APPS: ['ui_service', 'applist'],
  LAUNCH_APP: ['ui_service', 'launchapp'],
  PAIRING_START: ['ui_service', 'vidaa_app_connect'],
  PAIRING_CODE: ['ui_service', 'authenticationcode'],
  PAIRING_CLOSE: ['ui_service', 'authenticationcodeclose'],
});

// The token request is the one command published on a "data" path.
export const tokenRequestTopic = (clientId) =>
  `/remoteapp/tv/platform_service/${clientId}/data/gettoken`;

export const BROADCAST_TOPICS = Object.freeze({
  STATE: '/remoteapp/mobile/broadcast/ui_service/state',
  SLEEP: '/remoteapp/mobile/broadcast/platform_service/actions/tvsleep',
  VOLUME: '/remoteapp/mobile/broadcast/ui_service/volume',
  VOLUME_CHANGE: '/remoteapp/mobile/broadcast/platform_service/actions/volumechange',
});

/** Every topic the client listens to, for a given client id. */
export function subscriptionTopics(clientId) {
  return [
    ...Object.values(BROADCAST_TOPICS),
    dataTopic('ui_service', clientId, 'state'),
    dataTopic('platform_service', clientId, 'volume'),
    dataTopic('ui_service', clientId, 'sourcelist'),
    dataTopic('ui_service', clientId, 'applist'),
    dataTopic('ui_service', clientId, 'authentication'),
    dataTopic('ui_service', clientId, 'authenticationcode'),
    dataTopic('ui_service', clientId, 'vidaa_app_connect'),
    dataTopic('ui_service', clientId, 'tokenissuance'),
    dataTopic('platform_service', clientId, 'tokenissuance'),
  ];
}

// Remote control keys, as the TV names them.
export const KEYS = Object.freeze({
  POWER: 'KEY_POWER',
  UP: 'KEY_UP',
  DOWN: 'KEY_DOWN',
  LEFT: 'KEY_LEFT',
  RIGHT: 'KEY_RIGHT',
  OK: 'KEY_OK',
  BACK: 'KEY_RETURNS',
  EXIT: 'KEY_EXIT',
  MENU: 'KEY_MENU',
  HOME: 'KEY_HOME',
  INFO: 'KEY_INFO',
  VOLUME_UP: 'KEY_VOLUMEUP',
  VOLUME_DOWN: 'KEY_VOLUMEDOWN',
  MUTE: 'KEY_MUTE',
  CHANNEL_UP: 'KEY_CHANNELUP',
  CHANNEL_DOWN: 'KEY_CHANNELDOWN',
  PLAY: 'KEY_PLAY',
  PAUSE: 'KEY_PAUSE',
  STOP: 'KEY_STOP',
  FORWARD: 'KEY_FORWARDS',
  REWIND: 'KEY_BACK',
  SUBTITLE: 'KEY_SUBTITLE',
  RED: 'KEY_RED',
  GREEN: 'KEY_GREEN',
  YELLOW: 'KEY_YELLOW',
  BLUE: 'KEY_BLUE',
  0: 'KEY_0',
  1: 'KEY_1',
  2: 'KEY_2',
  3: 'KEY_3',
  4: 'KEY_4',
  5: 'KEY_5',
  6: 'KEY_6',
  7: 'KEY_7',
  8: 'KEY_8',
  9: 'KEY_9',
});

export const ALL_KEY_NAMES = Object.freeze([...new Set(Object.values(KEYS))]);

// The state the TV announces when it goes to standby. Many VIDAA models keep
// their network (and the broker) up in this "fake sleep" mode.
export function isSleepState(state) {
  return typeof state?.statetype === 'string' && state.statetype.startsWith('fake_sleep');
}
