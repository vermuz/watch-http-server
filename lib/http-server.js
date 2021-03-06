var fs = require('fs'),
    util = require('util'),
    union = require('union'),
    sexstatic = require('sexstatic'),
    ws = require('ws'),
    portfinder = require('portfinder'),
    chokidar = require('chokidar');

var HTTPServer = exports.HTTPServer = function (options) {
  options = options || {};

  if (options.root) {
    this.root = options.root;
  }
  else {
    try {
      fs.lstatSync('./public');
      this.root = './public';
    }
    catch (err) {
      this.root = './';
    }
  }

  var hotReloadScript = ' \
    var xhr = new XMLHttpRequest(); \n \
    if (typeof(window.reloadOnChange) == "undefined") \n \
      window.reloadOnChange = true; \n \
                                  \n  \
    xhr.onreadystatechange = function() { \n \
      if (xhr.readyState == 4) \n \
      { \n \
        var resp = JSON.parse(xhr.responseText); \n \
        var changeSocket = new WebSocket("ws://"+location.hostname+":"+resp.port+"/"); \n \
        changeSocket.onopen = function() { console.log("-- change socket opened, observing changes --") } \n \
        changeSocket.onmessage = function(ev) { \n \
           if (ev.data.indexOf("change") != -1) { \n \
             setTimeout(function() { \n \
                if (window.reloadOnChange) { \n \
                  console.log("change detected: reloading --"); \n \
                  window.location.reload(); \n \
                }}, 1000); \n \
           } \n \
          if (ev.data.indexOf("folder") != -1 && document.querySelector("title").innerText.indexOf("Index of") != -1) { \n \
            console.log("folder change, reloading"); \n \
            window.location.reload(); \n \
          } \n \
      } \n \
    }} \n \
    xhr.open("GET", "ws.json", true); \n\
    xhr.send(null); \
  ';

  var mutableExtras = {
    'http-hot-reload.js': {
      'content-type': 'text/javascript',
      'content': hotReloadScript
    },
    'ws.json': {
      'content-type': 'text/json',
      'content': JSON.stringify({
        port: this.wsPort,
        path: this.root,
        additional: "file untouched. the ws server probably isn't running."
      })
    }
  }

  portfinder.basePort = 8086;
  portfinder.getPort(function (err, port) {
    if (err) { console.log("Error, no open ports available."); console.dir(err); return; }

    this.wsPort = port;
    console.log('Websocket Server Listening on Port: '+port);

    this.wss = new ws.Server({port: port});
    this.wss.broadcast = function broadcast(data) {
      for(var i in this.clients) {
        try { this.clients[i].send(data); } catch (ex) { console.log('error sending to client.'); console.dir(ex); }
      }
    };

    //

    mutableExtras['ws.json'].content = JSON.stringify({
      port: this.wsPort,
      path: this.root
    });

    var watcher_ready = false;

    var watcher = chokidar.watch(this.root, {ignored: /[\/\\]\./, persistent: true});

    watcher.on('ready', function() { console.log('Scanned working directory. ready for changes..'); watcher_ready = true; });
    watcher.on('unlinkDir', function(path) {
      if (!watcher_ready) return;
      this.wss.broadcast('folder|'+path);
    }.bind(this));
    watcher.on('addDir', function(path) {
      if (!watcher_ready) return;
      this.wss.broadcast('folder|'+path);
    }.bind(this));
    watcher.on('add', function(path) {
      if (!watcher_ready) return;
      this.wss.broadcast('folder|'+path);
    }.bind(this));
    watcher.on('change', function(filename) {
      if (!watcher_ready) return;
      console.log('change detected! telling clients to reload. ['+filename+']');
      this.wss.broadcast('changed|'+filename);
    }.bind(this));
  }.bind(this));


  if (options.headers) {
    this.headers = options.headers;
  }

  this.cache = options.cache || 3600; // in seconds.
  this.showDir = options.showDir !== 'false';
  this.autoIndex = options.autoIndex !== 'false';

  if (options.ext) {
    this.ext = options.ext === true
      ? 'html'
      : options.ext;
  }

  function addReloadScript(src)
  {
    var index = src.indexOf("</body");
    if (index == -1) return src;
    var out = src.substr(0, index);
    out += '<script type="text/javascript" src="http-hot-reload.js"></script>' + src.substr(index);
    return out;
  }

  var serverOptions = {
    before: (options.before || []).concat([
      function (req, res) {
        if (options.logFn) {
          options.logFn(req, res);
        }

        res.emit('next');
      },
      sexstatic({
        root: this.root,
        cache: this.cache,
        showDir: this.showDir,
        autoIndex: this.autoIndex,
        defaultExt: this.ext,
        modifyFunctions: [
          addReloadScript
        ],
        extras: mutableExtras
      }),
    ]),
    headers: this.headers || {}
  };

  if (options.https) {
    serverOptions.https = options.https;
  }

  this.server = union.createServer(serverOptions);
};

HTTPServer.prototype.listen = function () {
  this.server.listen.apply(this.server, arguments);
};

HTTPServer.prototype.close = function () {
  return this.server.close();
};

exports.createServer = function (options) {
  return new HTTPServer(options);
};
