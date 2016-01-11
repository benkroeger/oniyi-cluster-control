# Deprecation Notice
This module is no longer maintained - since a lot of the work was experimentally and is now redundant with [strong-cluster-control](https://github.com/strongloop/strong-cluster-control), it became obsolete

> Helper and Wrapper for Node.js cluster API, heavily inspired by [strong-cluster-control](https://github.com/strongloop/strong-cluster-control)

Main difference to strong-cluster-control is the order in which events are emitted. E.g. the `start` event is emitted after the first `resize` (which is triggered by the `start` command) instead of directly on execution of the `start` command.

## Install

```sh
$ npm install --save oniyi-cluster-control
```


## Usage

```js
var oniyiClusterControl = require('oniyi-cluster-control');

oniyiClusterControl.start({
	size: 2,
	env: {
		NODE_ENV: 'development'
	}
});

```

## Events

- start
- stop
- set-size
- resize
- start-worker
- stop-worker
- shutdown
- terminate
- start-restart
- restart
- fork
- error

## API

### status()

### setSize(number)

### shutdownById(number)
*`number` provided will be resolved to worker by `cluster.workers[id]` and forwarded to `shutdown(worker)`* 

### shutdown(worker)

### terminate(id, worker)
*if worker is not defined, tries to resolve id to a running worker*

### restart()

### start(options)

### stop()


## Logging
This package uses a simple labled ("DEBUG [oniyi-cluster-control]") wrapper around `console.log`. To enable debugging, set the `NODE_DEBUG` variable to contain the word "oniyi-cluster-control".  
`NODE_DEBUG=oniyi-cluster-control node app.js`

## License

MIT © [Benjamin Kroeger]()
