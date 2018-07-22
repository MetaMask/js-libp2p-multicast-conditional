'use strict'

const setImmediate = require('async/setImmediate')
const Multicast = require('./index')

const NOT_STARTED_YET = 'The libp2p node is not started yet'

module.exports = (node) => {
  const multicast = new Multicast(node)

  node._multicast = multicast

  return {
    addFrwdHooks: (topic, hooks) => {
      hooks.forEach((h) => multicast.addFrwdHook(topic, h))
    },

    removeFrwdHooks: (topic, hooks) => {
      hooks.forEach((h) => multicast.removeFrwdHook(topic, h))
    },

    subscribe: (topic, options, handler, callback) => {
      if (typeof options === 'function') {
        callback = handler
        handler = options
        options = {}
      }

      if (!node.isStarted() && !multicast.started) {
        return setImmediate(() => callback(new Error(NOT_STARTED_YET)))
      }

      function subscribe (cb) {
        if (multicast.listenerCount(topic) === 0) {
          multicast.subscribe(topic)
        }

        options.frwdHooks = options.frwdHooks || []
        if (options.frwdHooks.length) {
          options.frwdHook.forEach((h) => multicast.addFrwdHook(topic, h))
        }

        multicast.on(topic, handler)
        setImmediate(cb)
      }

      subscribe(callback)
    },

    unsubscribe: (topic, handler) => {
      if (!node.isStarted() && !multicast.started) {
        throw new Error(NOT_STARTED_YET)
      }

      multicast.removeListener(topic, handler)

      if (multicast.listenerCount(topic) === 0) {
        multicast.unsubscribe(topic)
      }
    },

    publish: (topic, data, hops, callback) => {
      if (!node.isStarted() && !multicast.started) {
        return setImmediate(() => callback(new Error(NOT_STARTED_YET)))
      }

      if (!Buffer.isBuffer(data)) {
        return setImmediate(() => callback(new Error('data must be a Buffer')))
      }

      multicast.publish(topic, data, hops)

      setImmediate(() => callback())
    },

    ls: (callback) => {
      if (!node.isStarted() && !multicast.started) {
        return setImmediate(() => callback(new Error(NOT_STARTED_YET)))
      }

      const subscriptions = Array.from(multicast.subscriptions)

      setImmediate(() => callback(null, subscriptions))
    },

    peers: (topic, callback) => {
      if (!node.isStarted() && !multicast.started) {
        return setImmediate(() => callback(new Error(NOT_STARTED_YET)))
      }

      if (typeof topic === 'function') {
        callback = topic
        topic = null
      }

      const peers = Array.from(multicast.peers.values())
        .filter((peer) => topic ? peer.topics.has(topic) : true)
        .map((peer) => peer.info.id.toB58String())

      setImmediate(() => callback(null, peers))
    },

    setMaxListeners (n) {
      return multicast.setMaxListeners(n)
    }
  }
}
