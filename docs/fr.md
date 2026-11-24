# Téléviseur Hisense VIDAA

Pilotez un téléviseur Hisense sous **VIDAA OS** depuis Gladys : marche/arrêt,
volume, touches de la télécommande, sources (HDMI...) et applications
(Netflix, YouTube...). Gladys dialogue avec le téléviseur sur votre réseau
local, comme l'application mobile VIDAA (« VIDAA » / « RemoteNOW ») : aucun
compte cloud n'est nécessaire.

## Avant de commencer

- Le téléviseur et Gladys doivent être sur le même réseau local.
- Donnez au téléviseur une **adresse IP fixe** (réservation DHCP dans votre
  box) : l'intégration le joint à cette adresse.
- Notez l'**adresse MAC** du téléviseur : sur la TV, _Paramètres > Réseau >
  Informations réseau_ (ou _À propos_). Prenez celle de l'interface utilisée
  (Wi-Fi ou Ethernet). Elle identifie le téléviseur dans Gladys et sert à
  l'allumer.
- Pour allumer le téléviseur depuis Gladys, activez la veille réseau sur la
  TV : _Paramètres > Réseau > Wake on LAN_ / _Wake on Wireless LAN_ (le nom
  dépend du modèle), ou _Paramètres > Système > Alimentation > Démarrage
  rapide_.

## Configuration

| Champ                                | Valeur                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **Adresse IP du téléviseur**         | ex. `192.168.1.50`                                                                                |
| **Adresse MAC du téléviseur**        | ex. `aa:bb:cc:dd:ee:ff` (tout format : `-`, `:` ou aucun séparateur)                              |
| **Nom du téléviseur**                | Le nom de l'appareil dans Gladys                                                                  |
| **Méthode d'authentification**       | Laissez _Automatique_ : l'intégration essaie toutes les méthodes des firmwares VIDAA              |
| **Certificat client / clé**          | Uniquement pour les téléviseurs qui l'exigent, voir [plus bas](#certificat-client)                |
| **Adresse de broadcast Wake-on-LAN** | Uniquement si la TV ne s'allume pas : l'adresse de broadcast de votre réseau, ex. `192.168.1.255` |

Enregistrez la configuration.

## Appairage

Comme l'application mobile, Gladys doit être autorisé une fois par le
téléviseur :

1. Allumez le téléviseur.
2. Dans l'écran de configuration de l'intégration, cliquez sur **Démarrer
   l'appairage**. Un code (4 chiffres) s'affiche sur la TV.
3. Dans la minute, cliquez sur **Confirmer l'appairage**, saisissez le code et
   validez.
4. Le message « Appairé ! » le confirme. **Tester la connexion** indique à tout
   moment si le téléviseur accepte les commandes de Gladys.

L'appairage est conservé par l'intégration : il survit aux redémarrages.
**Oublier l'appairage** l'efface (utile après un remplacement du téléviseur ou
une réinitialisation).

## Ajouter le téléviseur à Gladys

Ouvrez l'onglet **Découverte** de l'intégration et ajoutez le téléviseur. Il
propose :

| Fonctionnalité                                          | Effet                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| Power                                                   | Allume (Wake-on-LAN ou touche marche) et éteint la TV         |
| Volume                                                  | Règle le volume (0-100), suit les changements faits sur la TV |
| Volume up/down, Mute                                    | Touches de la télécommande                                    |
| Channel up/down                                         | Touches de la télécommande                                    |
| Up, Down, Left, Right, OK, Back, Exit, Menu, Home, Info | Touches de navigation                                         |
| Play, Pause, Stop, Rewind, Fast forward                 | Touches de lecture                                            |
| Source                                                  | Change d'entrée (la liste vient du téléviseur)                |
| Application                                             | Ouvre une application (la liste vient du téléviseur)          |

L'état est rafraîchi toutes les 30 secondes, et immédiatement quand le
téléviseur signale un changement (marche, volume, source).

## Scènes

Deux actions sont disponibles dans l'éditeur de scènes :

- **Appuyer sur une touche de la télécommande** : n'importe quelle touche,
  éventuellement plusieurs fois (ex. « Volume - » × 5) ;
- **Ouvrir une application TV** : par son nom, ex. `Netflix`, `YouTube`,
  `Prime Video`.

Les fonctionnalités de l'appareil (marche, volume, source...) s'utilisent aussi
avec l'action standard « Contrôler un appareil ».

## Certificat client

Les firmwares VIDAA récents n'acceptent que la connexion sécurisée d'un client
présentant le certificat de l'application mobile officielle (TLS mutuel). Ce
certificat n'est **pas** fourni avec l'intégration. Si **Tester la connexion**
indique que le téléviseur a refusé la connexion sécurisée :

1. Récupérez le certificat client et sa clé privée de l'application VIDAA : la
   communauté documente comment les extraire de l'application
   ([pyvidaa — obtenir le certificat client](https://github.com/warrenrees/myhisense-tv#readme),
   [analyse du protocole](https://github.com/warrenrees/myhisense-tv/blob/main/VIDAA_PROTOCOL_ANALYSIS.md)).
2. Collez le certificat (`-----BEGIN CERTIFICATE-----...`) dans **Certificat
   client** et la clé (`-----BEGIN PRIVATE KEY-----...`) dans **Clé privée du
   client**. Les retours à la ligne perdus au collage sont rétablis
   automatiquement, et un fichier encodé en base64 est aussi accepté.
3. Enregistrez, puis refaites l'appairage.

## Dépannage

- **« Le téléviseur ne répond pas »** : la TV est éteinte sans veille réseau,
  ou son adresse IP a changé. Vérifiez l'adresse, activez la veille réseau
  (voir plus haut).
- **« Le téléviseur a refusé toutes les méthodes de connexion »** : forcez une
  autre méthode d'authentification, ou ajoutez le certificat client.
- **Connecté mais « il ignore les commandes »** : faites l'appairage.
- **La TV ne s'allume pas** : activez le Wake on LAN sur la TV, vérifiez
  l'adresse MAC (Wi-Fi et Ethernet en ont une différente), renseignez
  l'adresse de broadcast de votre réseau. Certains modèles ne se réveillent
  qu'après une veille courte.
- **Le code ne s'affiche pas** : le téléviseur a peut-être atteint son maximum
  d'appareils appairés : supprimez les anciens dans ses paramètres, puis
  réessayez.

Les logs de l'intégration sont sur sa page dans Gladys (Supervision).

## Remerciements

Le protocole VIDAA a été documenté par la communauté, notamment les projets
[pyvidaa](https://github.com/warrenrees/myhisense-tv) et
[hisensetv](https://github.com/newAM/hisensetv).
