
class Bot {
    constructor() {
        this.config = require('./config-bot.json');
        this.cc = this.config.commandCharacter || '.';
        var Client = require('node-rest-client').Client;
        this.restClient = new Client;
        this.W3CWebSocket = require('websocket').w3cwebsocket;
        this.connectionStatus = 0;
        this.heartbeatHandler = null;
        this.lastSequenceNumber = null;
        this.botUserId = null;
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
    
    talk(channel, writtenMessage) {
        this.restClient.post(this.config.uris.base+'/channels/'+channel+'/messages', {
            data: {
                'content': writtenMessage
            },
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bot '+this.config.token
            }
        }, (d,r) => {
            console.log('AFTER TALKING BRO');
            console.log(d);
        });
    }
    
    heartbeat(interval) {
        console.log('.');
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
            if(dd.s) {
                this.lastSequenceNumber = dd.s;
            }
            if(10 === dd.op) {
                if(dd.d.hasOwnProperty('heartbeat_interval')) {
                    // start heartbeating
                    this.heartbeat(parseInt(dd.d.heartbeat_interval));
                    // let's identify
                    this.connectionStatus = 3; // identifying
                    this.send({
                        'token': this.config.token,
                        'properties': {'$os': 'linux', '$browser': 'cli', '$device': 'node'}
                    }, 2, 'IDENTIFY');
                } // else wtf ?
            } else if(0 === dd.op) { // message, yes, but what ?
                this.parseReceivedData(dd);
            }
        }
    }
    
    parseReceivedData(nativeData) {
        if('MESSAGE_CREATE' === nativeData.t) { // it is a message !
            this.parseReceivedMessage(nativeData.d);
        } else if('READY' === nativeData.t) { // ready event (hello server, how are you ?)
            this.botUserId = nativeData.d.user.id; // we may need some other data, let's stick with it for now
        }
    }
    
    parseReceivedMessage(nativeMessage) {
        if(0 === nativeMessage.type) { // 0 means "default", other are kinda special you know
            let guildId = nativeMessage.guild_id;
            let channelId = nativeMessage.channel_id;
            let messageId = nativeMessage.id;
            let senderId = nativeMessage.author.id;
            let senderUsername = nativeMessage.author.username;
            if(!nativeMessage.author.bot) { // this is important in fact
                // first of all, if some user mentionned us, let's reply them
                let ownMarker = '';
                if(this.botUserId) {
                    ownMarker = '<@'+this.botUserId+'>';
                }
                if(this.botUserId && (ownMarker === nativeMessage.content.substr(0, ownMarker.length))) {
                    // mentionned, wtf.
                    this.talk(channelId, '<@'+senderId+'> Let\'s not.');
                } else if(this.cc === nativeMessage.content.substr(0, this.cc.length)) { // do we have some commands ?
                    this.parseCommand(nativeMessage.content.substr(this.cc.length).trim(), channelId, messageId, senderId, senderUsername);
                }
            }
        }
    }
    
    parseCommand(command, channelId, messageId, senderId, senderUsername) {
        let recognized = [
            'help'
        ];
        let found = false;
        for(let c of recognized) {
            if(c === command.substr(0, c.length)) {
                found = true;
                let m = 'c'+c.substr(0, 1).toUpperCase()+c.substr(1);
                this[m](command.substr(c.length).trim(), channelId, messageId, senderId, senderUsername);
            }
        }
        if(!found) {
            this.talk(channelId, 'Unrecognized command.');
            this.cHelp('', channelId, messageId, senderId, senderUsername);
        }
    }
    
    cHelp(args, channelId, messageId, senderId, senderUsername) {
        this.talk(channelId, 'We all need help, you know.');
    }
};

module.exports = Bot;
