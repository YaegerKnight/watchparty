module.exports = class Room {
  constructor(io, roomId, roomData) {
    this.video = '';
    this.videoTS = 0;
    this.paused = false;
    this.roster = [];
    this.chat = [];
    this.tsMap = {};
    this.nameMap = {};
    this.pictureMap = {};
    this.vBrowser = undefined;

    this.serialize = () => {
      return JSON.stringify({
        video: this.video,
        videoTS: this.videoTS,
        paused: this.paused,
        nameMap: this.nameMap,
        pictureMap: this.pictureMap,
        chat: this.chat,
        vBrowser: this.vBrowser,
      });
    };

    this.deserialize = (roomData) => {
      this.video = roomData.video;
      this.videoTS = roomData.videoTS;
      this.paused = roomData.paused;
      if (roomData.chat) {
        this.chat = roomData.chat;
      }
      if (roomData.nameMap) {
        this.nameMap = roomData.nameMap;
      }
      if (roomData.pictureMap) {
        this.pictureMap = roomData.pictureMap;
      }
      if (roomData.vBrowser) {
        this.vBrowser = roomData.vBrowser;
      }
    };

    this.getHostState = () => {
      return {
        video: this.video,
        videoTS: this.videoTS,
        paused: this.paused,
      };
    };

    this.roomId = roomId;
    if (roomData) {
      this.deserialize(roomData);
    }

    setInterval(() => {
      // console.log(roomId, this.video, this.roster, this.tsMap, this.nameMap);
      io.of(roomId).emit('REC:tsMap', this.tsMap);
    }, 1000);

    io.of(roomId).on('connection', (socket) => {
      // console.log(socket.id);
      const addChatMessage = (chatMsg) => {
        const chatWithTime = {
          ...chatMsg,
          timestamp: new Date().toISOString(),
          videoTS: this.tsMap[socket.id],
        };
        this.chat.push(chatWithTime);
        this.chat = this.chat.splice(-50);
        io.of(roomId).emit('REC:chat', chatWithTime);
      };

      const cmdHost = (data) => {
        console.log(socket.id, data);
        this.video = data;
        this.videoTS = 0;
        this.paused = false;
        this.tsMap = {};
        io.of(roomId).emit('REC:tsMap', this.tsMap);
        io.of(roomId).emit('REC:host', this.getHostState());
        if (data) {
          const chatMsg = { id: socket.id, cmd: 'host', msg: data };
          addChatMessage(chatMsg);
        }
      };

      this.roster.push({ id: socket.id });

      socket.emit('REC:host', this.getHostState());
      socket.emit('REC:nameMap', this.nameMap);
      socket.emit('REC:pictureMap', this.pictureMap);
      socket.emit('REC:tsMap', this.tsMap);
      socket.emit('chatinit', this.chat);
      io.of(roomId).emit('roster', this.roster);

      socket.on('CMD:name', (data) => {
        if (!data) {
          return;
        }
        if (data && data.length > 100) {
          return;
        }
        this.nameMap[socket.id] = data;
        io.of(roomId).emit('REC:nameMap', this.nameMap);
      });
      socket.on('CMD:picture', (data) => {
        if (data && data.length > 10000) {
          return;
        }
        this.pictureMap[socket.id] = data;
        io.of(roomId).emit('REC:pictureMap', this.pictureMap);
      });
      socket.on('CMD:host', (data) => {
        if (data && data.length > 20000) {
          return;
        }
        const sharer = this.roster.find((user) => user.isScreenShare);
        if (sharer) {
          // Can't update the video while someone is screensharing
          return;
        }
        cmdHost(data);
      });
      socket.on('CMD:play', () => {
        socket.broadcast.emit('REC:play', this.video);
        const chatMsg = {
          id: socket.id,
          cmd: 'play',
          msg: this.tsMap[socket.id],
        };
        this.paused = false;
        addChatMessage(chatMsg);
      });
      socket.on('CMD:pause', () => {
        socket.broadcast.emit('REC:pause');
        const chatMsg = {
          id: socket.id,
          cmd: 'pause',
          msg: this.tsMap[socket.id],
        };
        this.paused = true;
        addChatMessage(chatMsg);
      });
      socket.on('CMD:seek', (data) => {
        this.videoTS = data;
        socket.broadcast.emit('REC:seek', data);
        const chatMsg = { id: socket.id, cmd: 'seek', msg: data };
        addChatMessage(chatMsg);
      });
      socket.on('CMD:ts', (data) => {
        if (data > this.videoTS) {
          this.videoTS = data;
        }
        this.tsMap[socket.id] = data;
      });
      socket.on('CMD:chat', (data) => {
        if (data && data.length > 65536) {
          // TODO add some validation on client side too so we don't just drop long messages
          return;
        }
        const chatMsg = { id: socket.id, msg: data };
        addChatMessage(chatMsg);
      });
      socket.on('CMD:joinVideo', (data) => {
        const match = this.roster.find((user) => user.id === socket.id);
        if (match) {
          match.isVideoChat = true;
        }
        io.of(roomId).emit('roster', this.roster);
      });
      socket.on('CMD:leaveVideo', (data) => {
        const match = this.roster.find((user) => user.id === socket.id);
        if (match) {
          match.isVideoChat = false;
        }
        io.of(roomId).emit('roster', this.roster);
      });
      socket.on('CMD:joinScreenShare', (data) => {
        const sharer = this.roster.find((user) => user.isScreenShare);
        if (sharer) {
          return;
        }
        if (data && data.file) {
          cmdHost('fileshare://' + socket.id);
        } else {
          cmdHost('screenshare://' + socket.id);
        }
        const match = this.roster.find((user) => user.id === socket.id);
        if (match) {
          match.isScreenShare = true;
        }
        io.of(roomId).emit('roster', this.roster);
      });
      socket.on('CMD:leaveScreenShare', (data) => {
        // console.log('CMD:leaveScreenShare');
        const match = this.roster.find((user) => user.id === socket.id);
        if (match) {
          match.isScreenShare = false;
        }
        cmdHost('');
        io.of(roomId).emit('roster', this.roster);
      });
      socket.on('CMD:startVBrowser', () => {
        this.vBrowser = {};
        this.vBrowser.bootTime = Number(new Date());
        // TODO generate credentials and boot a VM
        this.vBrowser.user = 'admin';
        this.vBrowser.pass = 'neko';
        this.vBrowser.host = process.env.REACT_APP_VBROWSER_URL;
        this.roster.forEach((user, i) => {
          if (user.id === socket.id) {
            this.roster[i].isController = true;
          } else {
            this.roster[i].isController = false;
          }
        });
        cmdHost(
          'vbrowser://' +
            this.vBrowser.user +
            ':' +
            this.vBrowser.pass +
            '@' +
            this.vBrowser.host
        );
        io.of(roomId).emit('roster', this.roster);
      });
      socket.on('CMD:stopVBrowser', () => {
        this.vBrowser = undefined;
        this.roster.forEach((user, i) => {
          this.roster[i].isController = false;
        });
        // TODO shut down the VM
        cmdHost('');
      });
      socket.on('CMD:changeController', (data) => {
        this.roster.forEach((user, i) => {
          if (user.id === data) {
            this.roster[i].isController = true;
          } else {
            this.roster[i].isController = false;
          }
        });
        io.of(roomId).emit('roster', this.roster);
      });
      socket.on('CMD:askHost', () => {
        socket.emit('REC:host', this.getHostState());
      });
      socket.on('signal', (data) => {
        io.of(roomId)
          .to(data.to)
          .emit('signal', { from: socket.id, msg: data.msg });
      });
      socket.on('signalSS', (data) => {
        io.of(roomId).to(data.to).emit('signalSS', {
          from: socket.id,
          sharer: data.sharer,
          msg: data.msg,
        });
      });

      socket.on('disconnect', () => {
        let index = this.roster.findIndex((user) => user.id === socket.id);
        const removed = this.roster.splice(index, 1)[0];
        io.of(roomId).emit('roster', this.roster);
        if (removed.isScreenShare) {
          // Reset the room state since we lost the screen sharer
          cmdHost('');
        }
        // delete nameMap[socket.id];
        // delete tsMap[socket.id];
      });
    });
  }
};
