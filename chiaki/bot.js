var MongoClient = require('mongodb').MongoClient, assert = require('assert');
var ObjectID = require('mongodb').ObjectID;
var RestClient = require('node-rest-client').Client;

class Bot {
    constructor() {
        this.config = require('./config-bot.json');
        this.cc = this.config.commandCharacter || '.';
        this.restClient = new RestClient;
        this.W3CWebSocket = require('websocket').w3cwebsocket;
        this.connectionStatus = 0;
        this.heartbeatHandler = null;
        this.lastSequenceNumber = null;
        this.botUserId = null;
        this.emojis = {};
        // Connection URL
        this.mongoUrl = 'mongodb://localhost:27017/'+this.config.dbname;
        this.db = null;
        this.usersDb = null;
        this.usersCache = {};
    }
    
    start() {
        this.guilds = [];
        this.gatewayUri = null;
        this.getGuilds();
        this.getGatewayUri();
        console.log('Connecting...');
        MongoClient.connect(this.mongoUrl, (err, client) => {
            assert.equal(null, err);
            this.db = client.db(this.config.dbname);
            console.log('Connected successfully to server');
            this.usersDb = this.db.collection('users');
            //// this does not works because MongoDB is one of the worst shit i've ever seen
            // primary key does not work
            // ObjectID is unusable and cannot be created excepted with a shitty format
            // cannot declare primary key so will duplicate the things all day long
            // need to redo the primary stuff or implements add-ons, that is unbelievable
        });
    }
    
    stop() {
        this.wsc = null;
        this.restClient = null;
        this.db.close();
        console.log('Disconnected.');
    }
    
    searchUser(userId) {
        let returns = null;
        if(this.usersCache.hasOwnProperty(userId)) {
            returns = this.usersCache[userId];
        } else {
            this.usersDb.find({
                '_id': userId
            }).limit(1).toArray((err, docs) => {
                if(docs && docs.length) {
                    returns = docs[0];
                    this.usersCache[userId] = returns;
                }
            });
        }
        return returns;
    }
    
    createUser(userId) {
        this.restClient.get(this.config.uris.base+'/users/'+userId, {
            headers: {
                'Authorization': 'Bot '+this.config.token
            }
        }, (d,r) => {
            if(d) {
                this.usersCache[userId] = {'_id': new ObjectID(userId), 'name': d.username, 'coins': 0, 'daily': null};
                this.usersDb.insertOne(this.usersCache[userId]);
            }
        });
    }
    
    changeCoins(userId, coins) {
        let ud = this.searchUser(userId);
        if(null !== ud) {
            this.usersCache[userId].coins += coins;
            this.usersDb.updateOne({'_id': userId}, {$inc: {'coins': coins}});
        }
    }
    
    setDaily(userId) {
        let ud = this.searchUser(userId);
        if(null !== ud) {
            this.usersCache[userId].daily += new Date();
            this.usersDb.updateOne({'_id': userId}, {$set: {'daily': this.usersCache[userId].daily}});
        }
    }
    
    getGuilds() {
        this.restClient.get(this.config.uris.base+'/users/@me/guilds', {
            headers: {
                'Authorization': 'Bot '+this.config.token
            }
        }, (d,r) => {
            for(let l of d) {
                this.guilds.push(l.id);
            }
            this.triggerHappy();
        });
    }
    
    getEmojis() {
        for(let g of this.guilds) {
            this.restClient.get(this.config.uris.base+'/guilds/'+g+'/emojis', {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bot '+this.config.token
                }
            }, (d,r) => {
                for(let e of d) {
                    this.emojis[e.name] = '<:'+e.name+':'+e.id+'>';
                }
            });
        }
    }
    
    getEmoji(name) {
        return this.emojis.hasOwnProperty(name)? this.emojis[name]:name;
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
            /*console.log('AFTER TALKING BRO');
            console.log(d);*/
        });
    }
    
    mention(channel, user, writtenMessage) {
        this.talk(channel, '<@'+user+'> '+writtenMessage);
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
        this.getEmojis();
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
                    this.mention(channelId, senderId, 'Let\'s not.');
                } else if(this.cc === nativeMessage.content.substr(0, this.cc.length)) { // do we have some commands ?
                    this.parseCommand(nativeMessage.content.substr(this.cc.length).trim(), channelId, messageId, senderId, senderUsername);
                }
            }
        }
    }
    
    parseCommand(command, channelId, messageId, senderId, senderUsername) {
        let recognized = [
            'help',
            'ferplay',
            'rand',
            'flip',
            'money',
            'daily'
        ];
        let found = false;
        for(let c of recognized) {
            if(c === command.substr(0, c.length)) {
                found = true;
                // as long as a recognized command is received, register the user
                let userData = this.searchUser(senderId);
                if(null === userData) {
                    this.createUser(senderId);
                }
                let m = 'c'+c.substr(0, 1).toUpperCase()+c.substr(1);
                this[m](command.substr(c.length).trim(), channelId, messageId, senderId, senderUsername);
            }
        }
        if(!found) {
            this.talk(channelId, 'Unrecognized command.');
            this.cHelp('', channelId, messageId, senderId, senderUsername);
        }
    }
    
    splitArgs(args) {
        let r = [];
        let x = args.split(/( +)/);
        let l = false;
        let w = '';
        for(let s of x) {
            s = s.trim();
            if(0 < s.length) { // ignore empty stuff
                if('"' === s.substr(0, 1)) { // "keep-alive"
                    l = true;
                    w = s.substr(1);
                } else {
                    if(l && ('"' === s.substr(-1, 1))) { // live and let die
                        w+= ' '+s.slice(0, -1);
                        r.push(w);
                        l = false;
                    } else if(l) {
                        w+= ' '+s;
                    } else {
                        r.push(s);
                    }
                }
            }
        }
        return r;
    }
    
    cHelp(args, channelId, messageId, senderId, senderUsername) {
        let xargs = this.splitArgs(args);
        let xr = [];
        if(1 === xargs.length) {
            if('help' === xargs[0]) {
                xr.push('We all need help, you know.');
                xr.push('`.help` : generic help');
                xr.push('`.help <cmd>` : help about a command / topic');
            } else if('rand' === xargs[0]) {
                xr.push('`.rand` : random number between 0 and 10');
                xr.push('`.rand <nb>` : random number between 0 and <nb>');
                xr.push('`.rand <min> <max>` : random number between <min> and <max>');
            } else if('flip' === xargs[0]) {
                xr.push('`.flip` : flip a coin. Because we do not have the emoji, display moon and sun.');
                xr.push('`.flip <nb>` : Flip <nb> coins cuz why not.');
            } else if('money' === xargs[0]) {
                xr.push('`.money` : display your money.');
            } else if('daily' === xargs[0]) {
                xr.push('`.daily` : Get a daily reward of '+this.config.daily+' coins.');
            }
        } else {
            xr.push('We all need help, you know.');
            xr.push('`.rand` : random number');
            xr.push('`.flip` : flip a coin');
            xr.push('`.money` : display your money');
            xr.push('`.daily` : get your daily reward');
        }
        this.talk(channelId, xr.join("\n"));
    }
    
    cFerplay(args, channelId, messageId, senderId, senderUsername) {
        this.talk(channelId, 'Go seek professional help.');
    }
    
    cFlip(args, channelId, messageId, senderId, senderUsername) {
        let r = null;
        let xargs = this.splitArgs(args);
        let nb = 1;
        if(1 === xargs.length && !isNaN(xargs[0]) && 1 <= (new Number(xargs[0]))) {
            nb = Math.min(25, new Number(xargs[0]));
        }
        let m = '';
        for(let i=0;i<nb;i++) {
            let f = Math.round(Math.random());
            if(0 === f) {
                m+= ':last_quarter_moon_with_face:';
            } else {
                m+= ':sun_with_face:';
            }
        }
        this.mention(channelId, senderId, m);
    }
    
    cRand(args, channelId, messageId, senderId, senderUsername) {
        let r = null;
        let xargs = this.splitArgs(args);
        if(0 === xargs.length) {
            r = Math.round(10 * Math.random());
            this.talk(channelId, this.resultOfRandom(r));
        } else if(1 === xargs.length) {
            if(!isNaN(xargs[0])) {
                r = Math.round((new Number(xargs[0])) * Math.random());
                this.talk(channelId, this.resultOfRandom(r));
            } else {
                this.talk(channelId, 'This is not a number i can understand, just for you know. '+this.getEmoji('puf'));
            }
        } else if(2 === xargs.length) {
            if(!isNaN(xargs[0]) && !isNaN(xargs[1])) {
                let a = new Number(xargs[0]);
                let b = new Number(xargs[1]);
                if(b > a) {
                    r = Math.round(a + (b - a) * Math.random());
                    this.talk(channelId, this.resultOfRandom(r));
                } else {
                    this.talk(channelId, 'TELL A DEVELOPER THAT '+b+' < '+a+' '+this.getEmoji('oktard'));
                }
            } else {
                this.talk(channelId, 'This is not a number i can understand, just for you know. '+this.getEmoji('puf'));
            }
        } else {
            this.cHelp('rand', channelId, messageId, senderId, senderUsername);
        }
    }
    
    resultOfRandom(r) {
        let w = '';
        let n = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
        for(let c of new String(r)) {
            w+=':'+n[new Number(c)]+':';
        }
        return w;
    }
    
    cMoney(args, channelId, messageId, senderId, senderUsername) {
        let ud = this.searchUser(senderId);
        if(null === ud) {
            this.mention(channelId, senderId, 'Please try again later');
        } else {
            this.mention(channelId, senderId, ud.coins);
        }
    }
    
    cDaily(args, channelId, messageId, senderId, senderUsername) {
        let ud = this.searchUser(senderId);
        if(null === ud) {
            this.mention(channelId, senderId, 'Please try again later');
        } else if((null === ud.daily)
                || (ud.daily <= ((new Date()) + 1))) {
            this.setDaily(senderId);
            this.changeCoins(this.config.daily);
            this.cMoney(args, channelId, messageId, senderId, senderUsername);
        } else {
            this.mention(channelId, senderId, 'Already claimed your daily reward ('+ud.daily+')');
        }
    }
};

module.exports = Bot;
