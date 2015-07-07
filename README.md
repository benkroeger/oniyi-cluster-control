> Helper and Wrapper for Node.js cluster API

> Heavily inspired by [strong-cluster-control](https://github.com/strongloop/strong-cluster-control)

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
- worker-start
- worker-stop
- shutdown
- terminate
- restart
- start-restart
- fork
- error

## API

### status()

### setSize(number)

### shutdownById(number)
*provided will be resolved to worker by `cluster.workers[id]` and forwarded to `shutdown(worker)`* 

### shutdown(worker)

### terminate(id, worker)
*if worker is not defined, tries to resolve id to a running worker*

### restart()

### start(options)

### stop()


## License

MIT © [Benjamin Kroeger]()
