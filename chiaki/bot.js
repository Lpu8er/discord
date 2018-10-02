
class Bot {
    constructor() {
        this.config = require('./config-bot.json');
        var Client = require('node-rest-client').Client;
        this.restClient = new Client;
        this.W3CWebSocket = require('websocket').w3cwebsocket;
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
            console.log(this.gatewayUri);
            this.wsc = new this.W3CWebSocket(this.gatewayUri);
            this.wsc.onopen = this.doStuff;
        }
    }
    
    doStuff(cx) {
        console.log('Connected to gateway.');
    }
};

module.exports = Bot;
