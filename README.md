# RFXCOM2MQTT
RFXCOM to MQTT bridge for RFXtrx433 devices

All received RFXCOM events are published to the MQTT rfxcom2mqtt/devices/\<id\> topic.
It is up to the MQTT receiver to filter these messages or to have a register/learning/pairing mechanism.

## Usage

### Configuration

See example **config.yml**


### Subscribe to topic **rfxcom2mqtt/devices** to receive incoming messages.

Example JSON message on topic `"rfxcom2mqtt/devices/0x5C02"`:

    {
      "title": "Bathroom Temp & Hum",
      "type":"temperaturehumidity1",
      "subtype": 13,
      "id": "0x5C03",
      "seqnbr": 12,
      "temperature": 18,
      "humidity": 74,
      "humidityStatus": 3,
      "batteryLevel": 9,
      "rssi": 6
    }

## Publish command examples (topic/payload)

#### With RFY blinds (Somfy)
    rfxcom2mqtt/command/Rfy/0x00000A/1
    { "deviceFunction": "up", "subType": "RFY", "options": { "venetian_blind_mode": "US" } }

#### With a Lighting3 device
    rfxcom2mqtt/commmand/Lighting3/1001010/1
    { "deviceFunction": "setLevel", "subType": "KOPPLA", "value": 15 }

    rfxcom2mqtt/commmand/Lighting3/1001010/1
    { "deviceFunction": "switchOn", "subType": "KOPPLA" }


## Payload Information
With the MQTT payload, the following configuration values are possible:

| Key | Value |
| --- | ----------- |
| deviceFunction | The function defined within the [rfxcom library class](https://github.com/rfxcom/node-rfxcom/blob/master/DeviceCommands.md) |
| subType | The relevant device subtype for the [rfxcom library class](https://github.com/rfxcom/node-rfxcom/blob/master/DeviceCommands.md) |
| value | Passthrough for values such as lighting level, colour etc. [Example showing value being passed to function](https://github.com/rfxcom/node-rfxcom/blob/master/lib/lighting3.js#L75) |
| options | Pass parameters to the device class. Can be seen by visiting the device function. [Example showing RFY blinds options](https://github.com/rfxcom/node-rfxcom/blob/master/lib/rfy.js). |

## MQTT Topic Information
Real example:

      rfxcom2mqtt/commmand/Lighting3/1001010/1

As variables:

      rfxcom2mqtt/commmand/<device class>/<entity id>


| Key | Value |
| --- | ----------- |
| Device Class | As per [rfxcom library class](https://github.com/rfxcom/node-rfxcom/blob/master/DeviceCommands.md) list
| Device ID | This is the entity id for your device. It can either be the exact value for your device (e.g. 1001010/1 or a friendly name which can be defined within `config.yml`) |

### Healthcheck

If healthcheck is enabled in the config, the rfxcom status will checked every minute.
In case of an error the node process will exit.
If installed in docker the container will try to restart try to reconnect to the RFXCOM device.

----

## Dependencies:

The [RFXCOM](https://github.com/rfxcom/node-rfxcom) Node library for the communication with the [RFXCOM](http://www.rfxcom.com) RFXtrx433 433.92MHz Transceiver.

The [MQTT.js](https://github.com/mqttjs/MQTT.js) library for sending and receiving MQTT messages.
