# Network System Reactive Framework - Distributed STDOUT Grepping

The big idea is that every process in a network,
by writing to STDOUT, can be thought of as an
event generator, where an event is a line of
output. If we want to react to these events
(logging, monitoring, elastic computing), we
simply need to make the STDOUT more programmable.

LOBE is publish/subscribe broker built on top of
STDOUT. When a process is controlled by LOBE, each
write to STDOUT is published as an event, which is
then relayed to the subscribes by the LOBE
process. This allows dynamic tracing of the
STDOUTs of the set of processes controlled by
LOBE.

Inspired by DTrace, LOBE opens up system level
tracing, which may discover facts not visible by
looking at a single process.

LOBE is a glorified grep.


## Basics

LOBE has a HTTP API. The basic idea is to expose a
pipe by spawning a process with LOBE. Then
multiple clients can subscribe to the exposed pipe
(or pipes, if the subscriber is multiplexing over
multiple processes).

Start a lobe

    > $PORT=5678
    > node lobe.js $PORT
    Server running at http://127.0.0.1:5678



Spawn processes. We'll run a simple counter
script. We must give every process a name.

    > curl 'localhost:5678/spawn?name=counter1&command=ruby%20count.rb'
    counter1
    > curl 'localhost:5678/spawn?name=counter2&command=ruby%20count.rb'
    counter2

We can list the processes controlled by a LOBE,

    > curl 'localhost:5678/list'
    counter1
    counter2
    
If we want to see all the output of all the processes,

    > curl 'localhost:5678/attach'
    pid(12872) 13
    pid(12874) 13
    pid(12872) 14
    pid(12874) 14
    pid(12872) 15
    pid(12874) 15

You'll notice that we get the output from both
processes. If you want to attach only to processes
matched by a name (a regexp),

    > curl 'localhost:5678/attach?process=counter1'
    pid(12872) 76
    pid(12872) 77
    pid(12872) 78
    pid(12872) 79
    pid(12872) 80
    pid(12872) 81

Or if you want to grep for lines matching a pattern,

    > curl 'localhost:5678/attach?data=6'
    pid(12872) 168
    pid(12874) 168
    pid(12872) 169
    pid(12874) 169
    pid(12872) 176
    pid(12874) 176

Or you can do both. To kill a process, do,

    > curl 'localhost:5678/kill?name=counter1'


## Hiearchical Lobes

A LOBE controls local processes only. To access
remote pipes, we can arrange LOBE instances into
parent-child relationship. A parent LOBE, then,
would act as proxy to the child nodes.

We'll first run two instances of LOBEs, on
different machines, perhaps. For now, we'll just
run on localhost,

    > node lobe.js 5000
    > node lobe.js 5001

and we spawn processes in each LOBE,

    > curl 'localhost:5000/spawn?name=counter1&command=ruby%20count.rb'
    counter1
    > curl 'localhost:5001/spawn?name=counter2&command=ruby%20count.rb'
    counter2
    
then we spawn a third LOBE, which acts as the
parent of the previous two,

    > node lobe.js 5002
    > curl 'localhost:5002/child?name=child1&addr=localhost:5000'
    child1
    > curl 'localhost:5002/child?name=child2&addr=localhost:5001'
    child2

and if we list, we'll see all the processes
controlled the child LOBES,

    > curl 'localhost:5002/list'
    child1/counter1
    child2/counter2

if we attach to the parent lobe, we get all the
output from the child lobes,

    > curl 'localhost:5002/attach'
    pid(13086) 223
    pid(13090) 220
    pid(13086) 224
    pid(13090) 221
    pid(13086) 225
    pid(13090) 222
    pid(13086) 226
    pid(13090) 223

the list of names is kept synchronized. So if we kill a process,

    > curl 'localhost:5000/kill?name=counter1'
    > curl 'localhost:5002/list'
    child2/counter2

