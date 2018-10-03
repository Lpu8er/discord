
class Bot {
    constructor() {
        this.config = require('./config-bot.json');
        var Client = require('node-rest-client').Client;
        this.restClient = new Client;
        this.W3CWebSocket = require('websocket').w3cwebsocket;
        this.connectionStatus = 0;
        this.heartbeatHandler = null;
        this.lastSequenceNumber = null;
    }
    
    start() {
        this.guilds = [];
        this.gatewayUri = null;
        this.getGuilds();
        this.getGatewayUri();
    }
    
    getGuilds() {
        this.restClient.get(this.config.uris.base+'/users/@me/guilds', {
            headers: {
                'Authorization': 'Bot '+this.config.token
            }
        }, (d,r) => {
            for(let l in d) {
                this.guilds.push(l.id);
            }
            this.triggerHappy();
        });
    }
    
    getGatewayUri() {
        this.restClient.get(this.config.uris.base+'/gateway/bot', {
            headers: {
                'Authorization': 'Bot '+this.config.token
            }
        }, (d,r) => {
            this.gatewayUri = d.url;
            this.triggerHappy();
        });
    }
    
    triggerHappy() {
        if(null !== this.gatewayUri && 0 < this.guilds.length) {
            this.openConnection();
        }
    }
    
    openConnection() {
        this.connectionStatus = 1; // connecting
        this.wsc = new this.W3CWebSocket(this.gatewayUri);
        this.wsc.onopen = (e) => { this.connected(e); };
        this.wsc.onmessage = (e) => { this.read(e); };
        this.wsc.onerror = function(e){console.log('ERROR'); console.log(e);};
    }
    
    send(message, op, e, s) {
        this.wsc.send(JSON.stringify({
            'op': op,
            'd': message,
            's': s || 0,
            't': e
        }));
    }
    
    heartbeat(interval) {
        this.send(this.lastSequenceNumber, 1, 'HEARTBEAT');
        this.heartbeatHandler = setTimeout(() => { this.heartbeat(interval); }, interval);
    }
    
    stopHeartbeat() {
        clearTimeout(this.heartbeatHandler);
    }
    
    connected(e) {
        this.connectionStatus = 2; // connected, not identified
        console.log('Connected to gateway.');
    }
    
    read(e) {
        if('message' === e.type) { // readable
            let dd = JSON.parse(e.data);
            if(10 === dd.op) {
                if(dd.d.hasOwnProperty('heartbeat_interval')) {
                    if(dd.s) {
                        this.lastSequenceNumber = dd.s;
                    }
                    // start heartbeating
                    this.heartbeat(parseInt(dd.d.heartbeat_interval));
                    // let's identify
                    this.connectionStatus = 3; // identifying
                    this.send({
                        'token': this.config.token,
                        'properties': {'$os': 'linux', '$browser': 'cli', '$device': 'node'}
                    }, 2, 'IDENTIFY');
                } // else wtf ?
            }
        }
    }
};

module.exports = Bot;
