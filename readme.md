# homebridge-myesmart

Homebridge plugin that communicates with eSMART devices via XMPP.  
The plugin connects to the eSMART XMPP server and exposes nodes as Lightbulb accessories in HomeKit. MQTT is optional and only used when explicitly configured.

## Configuration

```json
{
  "platform": "MyESmartPlatform",
  "name": "My eSMART",
  "jid": "user@domain",
  "password": "secret",
  "room": "room@conference.domain",
  "mqtt": {
    "host": "mqtt://127.0.0.1",
    "id": "esmart-js"
  }
}
```

`mqtt` is optional; when omitted the plugin will use XMPP only.
