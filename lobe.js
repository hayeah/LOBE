var sys = require('sys');
var http = require('http');
var url = require('url');

function log(str) {
    console.log(str);
}

function p(o) {
    console.log(sys.inspect(o));
}

// http://ejohn.org/blog/javascript-array-remove/
// ORLY?
Array.prototype.remove = function(from, to) {
  var rest = this.slice((to || from) + 1 || this.length);
  this.length = from < 0 ? this.length + from : from;
  return this.push.apply(this, rest);
};

// Child
function Child(args) {
    this.process = require('child_process').exec(args.command);
    this.name = args.name;
    this.monitor = args.monitor;
    this.pid = this.process.pid;
    this.listeners = [];
    
    var self = this;
    this.process.stdout.on("data",function(data) {
        self.data(data);
    });
    this.process.on('exit', function (code) {
        self.exited(code);
    });
}

Child.prototype.exited = function(code) {
    this.code = code;
    this.monitor.exited(this);
}

Child.prototype.subscribe = function(listener) {
    this.listeners.push(listener);
}

Child.prototype.unsubscribe = function(listener) {
    var i = this.listeners.indexOf(listener);
    if(i >= 0) this.listeners.remove(i);
}

Child.prototype.data = function(data) {
    for(i = 0; i < this.listeners.length; i++) {
        var listener = this.listeners[i];
        if(!listener.data_re || listener.data_re.test(data))
            listener.data(data);
    }
}

// HTTPStream (write)

function HTTPStream(response,callback) {
    this.response = response;
    this.callback = callback;
    this.start();
}

HTTPStream.prototype.write = function(data) {
    this.response.write(data);
}

HTTPStream.prototype.start = function() {
    this.response.writeHead(200,{'Content-Type':'text/plain'});
    this.checklive();
}

HTTPStream.prototype.checklive = function() {
    // ghetto way to detect that remote client is disconnected.
    // // "close", "error", "end" events are not fired for response...
    var socket = this.response.socket;
    // one or the other get set the false when connection is broken. But sometimes not both. (weird...)
    if(socket.writable == false || socket.readable == false) {
        this.callback.disconnected();
        this.response.end();
        return;
    }
    var self = this;
    setTimeout(function() {self.checklive()},500);
    return true;
}


// HTTPStream (read)

function HTTPStreamRead(callback,method,host,port,path) {
    this.callback = callback;
    this.client = http.createClient(port, host);
    this.request = this.client.request('GET', path, {'host': host});
    this.request.end();
    this.start();
}

HTTPStreamRead.prototype.start = function() {
    var self = this;
    this.request.on("response",function(response) {
        response.setEncoding("utf8");
        response.on("data", function(data) {
            self.callback.data(data);
        });
        self.response = response;
        self.checklive();
    });
}

HTTPStreamRead.prototype.close = function() {
    // FIXME BROKEN grrrr. don't know how to force close a HTTP client response
    // this.response.close();
}

HTTPStreamRead.prototype.checklive = function() {
    if(this.response.socket.readable == false) {
        this.callback.disconnected();
        return;
    };
    var self = this;
    setTimeout(function() {self.checklive()},1000);
}

function Relay(listener,sublobe,process,data) {
    this.listener = listener;
    
    var query = {};
    if(process) { query.process = process};
    if(data) { query.data = data};
    var path = "/attach?" + require('querystring').stringify(query);
    p([this,"GET",sublobe.host,sublobe.port,path]);
    this.reader = new HTTPStreamRead(this,"GET",sublobe.host,sublobe.port,path);
}

Relay.prototype = {
    disconnected: function () {
        this.listener.relay_disconnected(this);
    },
    data: function(data) {
        this.listener.data(data);
    },
    close: function() {
        this.reader.close();
    }
}

// Listener
function Listener(lobe,response,node,process,data) {
    this.lobe = lobe;
    // matchers
    this.node_re = node && new RegExp(node);
    this.process_re = process && new RegExp(process);
    this.data_re = data && new RegExp(data);
    
    this.stream = new HTTPStream(response,this);

    this.subscriptions = [];

    // local process subscription
    if(!this.node_re || this.node_re.test("local")) {
        for(name in lobe.children) {
            if(!this.process_re || this.process_re.test(name)) {
                var child = lobe.children[name];
                child.subscribe(this);
                this.subscriptions.push(child);
            }
        }
    }

    this.relays = [];
    // subscribe to sublobes
    for(name in lobe.lobes) {
        var child = lobe.lobes[name];
        if(!this.node_re || this.node_re.test(child.name)) {
            p(["new relay"]);
            this.relays.push(new Relay(this,child,process,data));
        }
    }
}

Listener.prototype.disconnected = function() {
    var self = this;
    this.subscriptions.map(function(child) {child.unsubscribe(self);});
    this.relays.map(function(relay) {relay.close()});
    this.lobe.listener_disconnected(this);
}

Listener.prototype.relay_disconnected = function(relay) {
    var i = this.relays.indexOf(relay);
    if(i >= 0) this.relays.remove(i);
}

Listener.prototype.data = function(data) {
    this.stream.write(data);
}

// Lobe

// global singleton object to track server state
var lobe = {
    children: {},
    listeners: [],
    parents: [],
    lobes: {}
};

// Public


/*
  spawn a process, and relay its stdout

  Arguments
  
  name: a name for the process. can't have duplicate names
  command: /bin/sh -c <command>
  */
lobe.spawn = function(request,response,query) {
    // test for duplicate pipe name
    if (this.children[query.name] !== undefined) {
        this.error(response,"duplicate name: "+query.name);
        return;
    }
    var child = new Child({
        monitor: this,
        name: query.name,
        command: query.command
    });
    this.children[query.name] = child;
    this.update_parent();
    this.ok(response,child.name);
};

/*
  list all controlled process

  Arguments
  
  none
  */
lobe.list = function(request,response,query) {
    response.writeHead(200, {'Content-Type': 'text/plain'});
    for(k in this.children) {
        response.write(this.children[k].name+"\n");
    };
    for(k in this.lobes) {
        var lobe = this.lobes[k];
        var names = lobe.names;
        for (j =0; j < names.length; j++) {
            response.write(lobe.name+"/"+names[j]+"\n");
        }
    };
    response.end();
}

/*
  INTERNAL
  subscribe to the state updates of this lobe.
  
  Arguments
  
  none
  */
lobe.parent = function(request,response,query) {
    query.lobe = this;
    query.response = response;
    this.parents.push(new Parent(query));
}

/*
  become the parent of a lobe.
  
  Arguments

  name: give a name for the child
  host: the host:port of the child
  */
lobe.child = function(request,response,query) {
    // test for duplicate pipe name
    if (this.lobes[query.name] !== undefined) {
        this.error(response,"duplicate name: "+query.name);
        return;
    }
    var address = query.addr.split(":");
    query.host = address[0];
    query.port = address[1];
    this.lobes[query.name] = (new ChildLobe(query));
    this.ok(response,query.name);
}

/*
  kill a controlled process

  Arguments
  
  name: string
  */
lobe.kill = function(request,response,query) {
    var child = this.children[query.name];
    if(child === undefined) {
        this.error(response,"child not found: "+query.name)
    } else {
        process.kill(child.pid);
        this.ok(response,child.name);
    }
}

lobe.state = function(request,response,query) {
    this.ok(response,sys.inspect(this));
}

/*
  creates a connection for HTTP streaming of the stdout of all the matched processes

  Arguments
  
  name: string
  */
lobe.attach = function(request,response,query) {
    this.listeners.push(new Listener(this,response,query.node,query.process,query.data));
}

// Private

lobe.lobe_disconnected = function(lobe) {
    p(["child lobe disconnected",lobe]);
    delete this.lobes[lobe.name];
    this.update_parent();
}

lobe.parent_disconnected = function(parent) {
    p(["parent disconnected",parent]);
    var i = this.parents.indexOf(parent);
    if(i >= 0) this.parents.remove(i);
}

lobe.listener_disconnected = function(listener) {
    p(["listener disconnected",listener]);
    var i = this.listeners.indexOf(listener);
    if(i >= 0) this.listeners.remove(i);
}

lobe.exited = function(child) {
    p(["exit",child]);
    delete this.children[child.name];
    this.update_parent();
}

lobe.update_parent = function() {
    for(i = 0; i < this.parents.length; i++) {
        this.parents[i].updated(this);
    }
}

lobe.ok = function(response,result) {
    response.writeHead(200, {'Content-Type': 'text/plain'});
    response.end(result);
}

lobe.error = function(response,reason) {
    response.writeHead(400, {'Content-Type': 'text/plain'});
    response.end(reason);
}


// Parent Lobe

function Parent(args) {
    this.stream = new HTTPStream(args.response,this);
    this.start();
}

Parent.prototype.start = function() {
    this.updated();
}

Parent.prototype.disconnected = function () {
    lobe.parent_disconnected(this);
}

// called when the children lobe changes its internal state
Parent.prototype.updated = function () {
    var names = [];
    for(name in lobe.children)
        names.push(name)
    this.stream.write(sys.inspect(names)+"\n");
}

// Child Lobe

function ChildLobe(args) {
    this.reader = new HTTPStreamRead(this,"GET",args.host,args.port,"/parent");
    this.host = args.host;
    this.port = args.port;
    this.name = args.name;
}

ChildLobe.prototype = {
    disconnected: function() {
        lobe.lobe_disconnected(this);
    },
    
    // update the list of names in the child lobe
    data: function(data) {
        // i am just going to pretend i get one line of input each time...
        this.names = eval(data);
        // TODO propogate upward
    },
}


// HTTP Server
var port = parseInt(process.argv[2] || "8124");
http.createServer(function (request, response) {
    parse = url.parse(request.url,true);
    method = parse.pathname.slice(1);
    lobe[method](request,response,parse.query || {});
}).listen(port);

console.log('Server running at http://127.0.0.1:'+port);