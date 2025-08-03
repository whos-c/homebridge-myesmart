const { client, xml } = require('@xmpp/client');
const mqtt = require('mqtt');

let Service, Characteristic, UUIDGen;

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;
  homebridge.registerPlatform('homebridge-myesmart', 'MyESmartPlatform', MyESmartPlatform);
};

class MyESmartPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.accessories = new Map();

    const jid = this.config.jid;
    const password = this.config.password;
    const room = this.config.room;
    if (!jid || !password || !room) {
      this.log.error('Missing XMPP credentials (jid, password, room)');
      return;
    }
    const [local, domain] = jid.split('@');

    this.xmpp = client({
      service: 'xmpp://xmpp.myesmart.net:5222',
      domain,
      username: local,
      password,
      resource: 'homebridge'
    });

    this.xmpp.on('error', (err) => this.log.error('XMPP error', err));
    this.xmpp.on('offline', () => this.log.info('XMPP offline'));
    this.xmpp.on('online', () => {
      this.log.info('XMPP connected');
      const presence = xml('presence', { to: `${room}/${local}` }, xml('x', 'http://jabber.org/protocol/muc'));
      this.xmpp.send(presence);
    });
    this.xmpp.on('stanza', (stanza) => this.handleStanza(stanza));

    this.xmpp.start().catch((e) => this.log.error('XMPP start failed', e));

    if (this.config.mqtt && this.config.mqtt.host) {
      this.log.info('MQTT enabled');
      this.mqtt = mqtt.connect(this.config.mqtt.host, { clientId: this.config.mqtt.id || 'esmart-js' });
      this.mqtt.on('message', (topic, payload) => this.handleMqtt(topic, payload));
      this.mqtt.on('connect', () => {
        this.log.info('MQTT connected');
        this.mqtt.subscribe('esmart/set/node/+');
      });
    }
  }

  configureAccessory(accessory) {
    const id = accessory.context.nodeId;
    this.log.info('Loaded accessory from cache', id);
    this.accessories.set(id, accessory);
  }

  handleStanza(stanza) {
    if (!stanza.is('message')) return;
    const bodyElem = stanza.getChild('body');
    if (!bodyElem) return;
    const text = bodyElem.text();
    if (!text) return;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return;
    }
    if (!parsed.body || !Array.isArray(parsed.body.nodes)) return;
    parsed.body.nodes.forEach((node) => this.updateNode(node));
  }

  updateNode(node) {
    const id = node.id;
    const d = node.data || {};
    let accessory = this.accessories.get(id);
    if (!accessory) {
      const uuid = UUIDGen.generate(String(id));
      accessory = new this.api.platformAccessory(`Node ${id}`, uuid);
      accessory.context.nodeId = id;
      const service = accessory.addService(Service.Lightbulb, `Node ${id}`);
      service.getCharacteristic(Characteristic.On)
        .on('get', (cb) => cb(null, d.onoff === 'on'))
        .on('set', (value, cb) => {
          this.sendOperation(id, { onoff: value ? 'on' : 'off' });
          cb();
        });
      service.getCharacteristic(Characteristic.Brightness)
        .on('get', (cb) => cb(null, parseInt(d.dimming, 10) || 0))
        .on('set', (value, cb) => {
          this.sendOperation(id, { dimming: `${value}%` });
          cb();
        });
      this.api.registerPlatformAccessories('homebridge-myesmart', 'MyESmartPlatform', [accessory]);
      this.accessories.set(id, accessory);
      this.log.info('Added accessory', id);
    } else {
      const service = accessory.getService(Service.Lightbulb);
      if (d.onoff) service.updateCharacteristic(Characteristic.On, d.onoff === 'on');
      if (d.dimming) service.updateCharacteristic(Characteristic.Brightness, parseInt(d.dimming, 10) || 0);
    }
  }

  handleMqtt(topic, payloadBuf) {
    const payload = payloadBuf.toString();
    const m = topic.match(/^esmart\/set\/node\/(\d+)$/);
    if (!m) return;
    const id = parseInt(m[1], 10);
    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch (_) {
      return;
    }
    this.sendOperation(id, parsed);
  }

  sendOperation(id, command) {
    const bodyEntry = { id };
    if (command.dimming) bodyEntry.dimming = command.dimming;
    if (command.onoff) bodyEntry.onoff = command.onoff;
    if (command.position !== undefined) bodyEntry.position = command.position;
    if (command.setpoint !== undefined) bodyEntry.setpoint = command.setpoint;
    if (command.deviceOnOff !== undefined) bodyEntry.deviceOnOff = command.deviceOnOff;

    const operationMsg = {
      headers: {
        method: 'CMD',
        from: this.config.jid,
        to: 'master',
        timestamp: new Date().toISOString(),
        type: 'operation',
        version: '1.19.0',
        size: 0,
      },
      body: [bodyEntry],
    };

    const stanza = xml('message', { to: this.config.room, type: 'groupchat' }, xml('body', {}, JSON.stringify(operationMsg)));
    this.xmpp.send(stanza);
  }
}
