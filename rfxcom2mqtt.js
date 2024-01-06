'use strict';

const mqtt = require('mqtt');
const rfxcom = require('rfxcom');
const config = require('node-config-yaml').load("./config.yml");
const cron = require('node-cron');

const topic = 'rfxcom2mqtt/devices';
const topic_will = 'rfxcom2mqtt/status';
const topic_info = 'rfxcom2mqtt/info';
const topic_command = 'rfxcom2mqtt/command/#';
const topic_connected = 'rfxcom2mqtt/connected';

console.log('RFXCOM2MQTT Starting');

var debug = (config.debug) ? config.debug : false;
if (debug) {
	console.log(config);
}

const eventHandlers = [];
const will = { "topic": topic_will, "payload": "offline", "retain": "true" }
const options = { "will": will }
if (config.mqtt.username) {
	options.username = config.mqtt.username;
	options.password = config.mqtt.password;
}

var port = "1883"
if (config.mqtt.port) {
	port = config.mqtt.port;
}

var qos = 0
if (config.mqtt.qos) {
qos = config.mqtt.qos;
}

const mqttClient = mqtt.connect(config.mqtt.server + ':' + port, options)

const getRfxcomDevices = () => {
	return Object.keys(rfxcom);
}

const validRfxcomDevice = (device) => {
	return (getRfxcomDevices().find((rfxcomDevice) => device === rfxcomDevice) !== undefined);
}

const validRfxcomDeviceFunction = (device, deviceFunction) => {
	if (rfxcom[device] === undefined)
		return false;

	const deviceFunctions = Object.getOwnPropertyNames(rfxcom[device].prototype);
	return (deviceFunctions.find((rfxcomDeviceFunction) => rfxcomDeviceFunction === deviceFunction) !== undefined);
}

const getDeviceConfig = (deviceId) => {
	if (config.devices === undefined)
		return;
	
	return config.devices.find(dev => dev.id === deviceId);
}

mqttClient.on('connect', () => {
	console.log('Connected to MQTT')
	mqttClient.subscribe([topic_command], () => {
		console.log(`Subscribing to topic '${topic_command}'`)
	})
})

// MQTT Connect
mqttClient.on('connect', () => {
	mqttClient.publish(topic_will, 'online', { qos: qos, retain: config.mqtt.retain }, (error) => {
		if (error) {
			console.error(error)
		}
	})
})

const sendToMQTT = function (type, evt) {
	// Add type to event
	evt.type = type;

	var deviceId = evt.id;
	if (type === "lighting4") {
		deviceId = evt.data
	}

	// Define default topic entity
	var topicEntity = deviceId

	// Get device config if available
	var deviceConf = config.devices.find(dev => dev.id === deviceId);
	if (deviceConf instanceof Object) {
		if (deviceConf.friendlyName !== undefined)
			topicEntity = deviceConf.friendlyName;
	}

	var json = JSON.stringify(evt, null, 2)
	mqttClient.publish(topic + "/" + topicEntity, json, { qos: qos, retain: config.mqtt.retain }, (error) => {
		if (error) {
			console.error(error)
		}
	})
	if (debug) {
		console.log('MQTT out:', topic + "/" + deviceId, json.replace(/[\n\r][ ]*/g, ''));
	}
}

// RFXCOM Init
var rfxdebug = (config.rfxcom.debug) ? config.rfxcom.debug : false;
var rfxtrx = new rfxcom.RfxCom(config.rfxcom.usbport, { debug: rfxdebug });

rfxtrx.initialise(function (error) {
	if (error) {
		throw new Error("Unable to initialise the RFXCOM device");
	} else {
		console.log("RFXCOM device initialised");
	}
});

// RFXCOM Transmit
mqttClient.on('message', (topic, payload) => {
	if (debug) {
		console.log('MQTT in:', topic, " ", payload.toString())
	}

	var entityName = "";
	var unitName = "";
	const dn = topic.split("/");
	if (dn[0] != "rfxcom2mqtt") {
		console.log("Topic Error, should start with rfxcom2mqtt");
		return;
	}
	if (dn[1] != "command") {
		console.log("Topic Error, should start with rfxcom2mqtt/command");
		return;
	}
	if (!validRfxcomDevice(dn[2])) {
		console.log(dn[2], " is not a valid device");
		return;
	}
	if (!validRfxcomDeviceFunction(dn[2], dn[3])) {
		console.log(dn[3], " is not a valid device function on ", dn[2]);
		return;
	}

	deviceType = dn[2];
	deviceFunction = dn[3];
	entityName = dn[4];
	
	// Used for units and forms part of the device id
	if (dn.length > 3 && dn[5].length > 0) {
		entityName = entityName + dn[5];
	}

	// We will need subType from payload
	if (payload.subType === undefined)
		throw new Error("subType not found in message/payload");

	// We may also get a value from the payload to use in the device function
	var value = payload.value;

	// Get device config if available
	var deviceConf = config.devices.find(dev => dev.friendlyName === entityName);
	if (deviceConf instanceof Object) {
		if (deviceConf.id !== undefined)
			entityName = deviceConf.id;

		if (deviceConf.type !== undefined) {
			if (!validRfxcomDevice(deviceConf.type))
				throw new Error(deviceConf.type + " not found in config");

			deviceType = deviceConf.type;
		}
	}

	// Instantiate the device class
	var device = new rfxcom[deviceType](rfxtrx, payload.subType);

	const repeat = (config.rfxcom.transmit.repeat) ? config.rfxcom.transmit.repeat : 1
	for (var i = 0; i < repeat; i++) {
		// Execute the command with optional value
		if (value) {
			device[deviceFunction](entityName, value);
		} else {
			device[deviceFunction](entityName);
		}

		if (debug) {
			console.log(deviceType, deviceType, entityName, "["+deviceFunction+"]["+value+"]");
		}
		sleep(100);
	}
})


if (config.rfxcom.receive) {
	// Subscribe to specific rfxcom events
	config.rfxcom.receive.forEach((protocol) => {
		rfxtrx.on(protocol, (evt) => { sendToMQTT(protocol, evt) });
	});
}

// RFXCOM Status
rfxtrx.on("status", function (evt) {
	var json = JSON.stringify(evt, function (key, value) {
		if (key === 'subtype' || key === 'seqnbr' || key === 'cmnd') {
			return undefined;
		}
		return value;
	}, 2);

	mqttClient.publish(topic_info, json, { qos: qos, retain: config.mqtt.retain }, (error) => {
		if (error) {
			console.error(error);
		}
	})
	if (debug) {
		if (debug) {
			console.log('MQTT out:', topic_info, json.replace(/[\n\r][ ]*/g, ''));
		}
	}
});

// RFXCOM Disconnect
rfxtrx.on("disconnect", function (evt) {
	mqttClient.publish('rfxcom2mqtt/disconnected', 'disconnected', { qos: qos, retain: true }, (error) => {
		if (error) {
			console.error(error)
		}
	})
	console.log("RFXCOM Disconnected");
});

function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

cron.schedule('* * * * *', () => {
	if (config.healthcheck) {
		if (debug) {
			console.log("Healthcheck");
		}
		rfxtrx.getRFXStatus(function (error) {
			if (error) {
				console.log("Healthcheck: RFX Status ERROR");
				process.exit();
			}
		});
	}
});
