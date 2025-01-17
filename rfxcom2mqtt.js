'use strict';

const mqtt = require('mqtt');
const rfxcom = require('rfxcom');
const config = require('node-config-yaml').load('./config.yml');
const cron = require('node-cron');

const topic = 'rfxcom2mqtt/devices';
const topicWill = 'rfxcom2mqtt/status';
const topicInfo = 'rfxcom2mqtt/info';
const topicCommand = 'rfxcom2mqtt/command/#';

console.log('RFXCOM2MQTT Starting');

const debug = (config.debug) ? config.debug : false;
if (debug) {
  console.log(config);
}

const will = {'topic': topicWill, 'payload': 'offline', 'retain': 'true'};
const options = {'will': will};
if (config.mqtt.username) {
  options.username = config.mqtt.username;
  options.password = config.mqtt.password;
}

let port = '1883';
if (config.mqtt.port) {
  port = config.mqtt.port;
}

let qos = 0;
if (config.mqtt.qos) {
  qos = config.mqtt.qos;
}

const mqttClient = mqtt.connect(config.mqtt.server + ':' + port, options);

const getRfxcomDevices = () => {
  return Object.keys(rfxcom);
};

const validRfxcomDevice = (device) => {
  return (getRfxcomDevices()
      .find((rfxcomDevice) => device === rfxcomDevice) !== undefined);
};

const validRfxcomDeviceFunction = (device, deviceFunction) => {
  if (rfxcom[device] === undefined) {
    return false;
  }

  const deviceFunctions = Object.getOwnPropertyNames(rfxcom[device].prototype);
  return (deviceFunctions.find((rfxcomDeviceFunction) => rfxcomDeviceFunction === deviceFunction) !== undefined);
};

const getDeviceConfig = (deviceId) => {
  if (config.devices === undefined) {
    return;
  }

  return config.devices.find((dev) => dev.id === deviceId);
};

mqttClient.on('connect', () => {
  console.log('Connected to MQTT');
  mqttClient.subscribe([topicCommand], () => {
    console.log(`Subscribing to topic '${topicCommand}'`);
  });
});

mqttClient.on('error', (err) => {
  console.error(err);
});

// MQTT Connect
mqttClient.on('connect', () => {
  mqttClient.publish(topicWill, 'online', {qos: qos, retain: config.mqtt.retain}, (error) => {
    if (error) {
      console.error(error);
    }
  });
});

const sendToMQTT = function(type, evt) {
  // Add type to event
  evt.type = type;

  let deviceId = evt.id;
  if (type === 'lighting4') {
    deviceId = evt.data;
  }

  // Define default topic entity
  let topicEntity = deviceId;

  // Get device config if available
  const deviceConf = getDeviceConfig(deviceId);
  if (deviceConf instanceof Object) {
    if (deviceConf.friendlyName !== undefined) {
      topicEntity = deviceConf.friendlyName;
    }
  }

  const json = JSON.stringify(evt, null, 2);
  mqttClient.publish(topic + '/' + topicEntity, json, {qos: qos, retain: config.mqtt.retain}, (error) => {
    if (error) {
      console.error(error);
    }
  });
  if (debug) {
    console.log('MQTT out:', topic + '/' + deviceId, json.replace(/[\n\r][ ]*/g, ''));
  }
};

// RFXCOM Init
const rfxdebug = (config.rfxcom.debug) ? config.rfxcom.debug : false;
const rfxtrx = new rfxcom.RfxCom(config.rfxcom.usbport, {debug: rfxdebug});

rfxtrx.initialise(function(error) {
  if (error) {
    throw new Error('Unable to initialise the RFXCOM device');
  } else {
    console.log('RFXCOM device initialised');
  }
});

// RFXCOM Transmit
mqttClient.on('message', (topic, message) => {
  let transmitRepetitions;
  const payload = JSON.parse(message);

  if (debug) {
    console.log('MQTT in:', topic, ' ', payload.toString());
  }

  const dn = topic.split('/');
  if (dn[0] != 'rfxcom2mqtt') {
    console.log('Topic Error, should start with rfxcom2mqtt');
    return;
  }
  if (dn[1] != 'command') {
    console.log('Topic Error, should start with rfxcom2mqtt/command');
    return;
  }
  if (!validRfxcomDevice(dn[2])) {
    console.log(dn[2], ' is not a valid device');
    return;
  }
  let deviceType = dn[2];
  let entityName = dn[3];
  let subType;
  let deviceFunction;

  // Used for units and forms part of the device id
  if (dn[4] !== undefined && dn[4].length > 0) {
    entityName = entityName + '/' + dn[4];
  }

  // We will need subType from payload
  if (payload.subType !== undefined) {
    subType = payload.subType;
  }

  if (payload.deviceFunction !== undefined) {
    deviceFunction = payload.deviceFunction;
  }

  if (!validRfxcomDeviceFunction(deviceType, payload.deviceFunction)) {
    console.log(payload.deviceFunction, ' is not a valid device function on ', deviceType);
    return;
  }
  // We may also get a value from the payload to use in the device function
  const value = payload.value;
  let deviceOptions = payload.deviceOptions;

  // Get device config if available
  const deviceConf = config.devices.find((dev) => dev.friendlyName === entityName);
  if (deviceConf instanceof Object) {
    if (deviceConf.id !== undefined) {
      entityName = deviceConf.id;
    }

    if (deviceConf.type !== undefined) {
      if (!validRfxcomDevice(deviceConf.type)) {
        throw new Error(deviceConf.type + ' from config: not a valid device');
      }

      deviceType = deviceConf.type;
    }

    if (deviceConf.options !== undefined) {
      deviceOptions = deviceConf.options;
    }

    if (deviceConf.subType !== undefined) {
      subType = deviceConf.subType;
    }

    if (deviceConf.repetitions !== undefined) {
      transmitRepetitions = deviceConf.repetitions;
    }
  }

  if (subType === undefined) {
    throw new Error('Subtype not defined in payload or config');
  }

  // Instantiate the device class
  let device;
  if (deviceOptions) {
    device = new rfxcom[deviceType](rfxtrx, payload.subType, deviceOptions);
  } else {
    device = new rfxcom[deviceType](rfxtrx, payload.subType);
  }

  const repeat = (transmitRepetitions) ? transmitRepetitions : 1;
  for (let i = 0; i < repeat; i++) {
    // Execute the command with optional value
    if (value) {
      device[deviceFunction](entityName, value);
    } else {
      device[deviceFunction](entityName);
    }

    if (debug) {
      console.log(deviceType, deviceType, entityName, '['+deviceFunction+']['+value+']');
    }
  }
});


if (config.rfxcom.receive) {
  // Subscribe to specific rfxcom events
  config.rfxcom.receive.forEach((protocol) => {
    rfxtrx.on(protocol, (evt) => {
      sendToMQTT(protocol, evt);
    });
  });
}

// RFXCOM Status
rfxtrx.on('status', function(evt) {
  const json = JSON.stringify(evt, function(key, value) {
    if (key === 'subtype' || key === 'seqnbr' || key === 'cmnd') {
      return undefined;
    }
    return value;
  }, 2);

  mqttClient.publish(topicInfo, json, {qos: qos, retain: config.mqtt.retain}, (error) => {
    if (error) {
      console.error(error);
    }
  });
  if (debug) {
    if (debug) {
      console.log('MQTT out:', topicInfo, json.replace(/[\n\r][ ]*/g, ''));
    }
  }
});

// RFXCOM Disconnect
rfxtrx.on('disconnect', function(evt) {
  mqttClient.publish('rfxcom2mqtt/disconnected', 'disconnected', {qos: qos, retain: true}, (error) => {
    if (error) {
      console.error(error);
    }
  });
  console.log('RFXCOM Disconnected');
});

cron.schedule('* * * * *', () => {
  if (config.healthcheck) {
    if (debug) {
      console.log('Healthcheck');
    }
    rfxtrx.getRFXStatus(function(error) {
      if (error) {
        console.log('Healthcheck: RFX Status ERROR');
        process.exit();
      }
    });
  }
});
