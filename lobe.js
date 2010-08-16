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

Child.prototype.data = function(data) {
    this.monitor.data(this,data);
}

// HTTPStream

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
    if(this.response.socket.writable == false) {
        this.callback.disconnected();
        this.response.end();
        return;
    }
    var self = this;
    setTimeout(function() {self.checklive()},500);
    return true;
}


// Listener
function Listener(args) {
    this.monitor = args.monitor;
    this.process_matcher = (args.name && new RegExp(args.name));
    this.line_matcher = (args.grep && new RegExp(args.grep));
    this.stream = new HTTPStream(args.response,this);
}

Listener.prototype.disconnected = function() {
    this.monitor.listener_disconnected(this);
}

Listener.prototype.data = function(child,data) {
    // TODO match data against discriminators
    if(this.process_matcher === undefined ||  this.process_matcher.test(child.name))
        if(this.line_matcher === undefined ||  this.line_matcher.test(data))
            this.stream.write(data);
}

// Lobe

// global singleton object to track server state
var lobe = {
    children: {},
    listeners: []
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
    for (k in this.children) {
        response.write(this.children[k].name+"\n");
    }
    response.end();
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
    // create a persistent HTTP connection
    query.monitor = this;
    query.response = response;
    query.request = request;
    this.listeners.push(new Listener(query));
}

// Private

lobe.listener_disconnected = function(listener) {
    var i = this.listeners.indexOf(listener);
    if(i >= 0) this.listeners.remove(i);
}

lobe.exited = function(child) {
    p(["exit",child]);
    delete this.children[child.name];
    this.update_parent();
}

lobe.update_parent = function() {
    // this.parent && this.parent.update(child);
}

lobe.data = function(child,data) {
    for(i = 0; i < this.listeners.length; i++) {
        this.listeners[i].data(child,data);
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


// function Probe(name,line) {
//     this.name = (name && new RegExp(line));
//     this.line = (line && new RegExp(line));
// }

// Probe.prototype.match = function(data) {
//     if(this.process_matcher === undefined ||  this.process_matcher.test(child.name))
//         if(this.line_matcher === undefined ||  this.line_matcher.test(data))
//             return(data)
// }

// Super Lobe
// pipe relays

// function Super(lobe,response,args) {
//     this.child = args.lobe;
// }

// Super.prototype.subscribe(name_matcher,line_matcher) {
    
// }




// HTTP Server

http.createServer(function (request, response) {
    parse = url.parse(request.url,true);
    method = parse.pathname.slice(1);
    lobe[method](request,response,parse.query || {});
}).listen(8124);

console.log('Server running at http://127.0.0.1:8124/');