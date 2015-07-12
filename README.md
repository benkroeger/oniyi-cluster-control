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
This package uses a labeled [oniyi-logger](https://www.npmjs.com/package/oniyi-logger) and produces a lot of DEBUG log entries. Since this package wouldn't be used from within a worker (actual application runtime) but in the cluster master instead, the possible performance overhead for logging is considered negligible.

## License

MIT © [Benjamin Kroeger]()
