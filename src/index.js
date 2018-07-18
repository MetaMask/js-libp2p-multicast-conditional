'use strict'

const TimeCache = require('time-cache')
const assert = require('assert')

const RpcBaseProtocol = require('./rpcBase')
const utils = require('./utils')
const pb = require('./message')
const Buffer = require('safe-buffer').Buffer

const ensureArray = utils.ensureArray
const setImmediate = require('async/setImmediate')

/**
 * Multicast is a p2p messaging experiment.
 */
class Multicast extends RpcBaseProtocol {
  /**
   * @param {Object} libp2p
   * @returns {Multicast}
   */
  constructor (libp2p) {
    const protonCodec = pb.rpc.RPC
    super('libp2p:multicast', '/multicast/0.0.1', protonCodec, libp2p)

    /**
     * Time based cache for sequence numbers.
     *
     * @type {TimeCache}
     */
    this.cache = new TimeCache()

    /**
     * List of our subscriptions
     * @type {Set<string>}
     */
    this.subscriptions = new Set()

    /**
     * A map of validation functions to run before
     * forwarding messages.
     *
     * The validators are ran per peer for each topic the
     * peer is subscribed with, right before sending out
     * the message. If any of the validators fail, the message
     * is not forwarded to the peer.
     *
     * The validator function has the following signature:
     *
     * @example
     * ```
     * function (peer: PeerInfo, msg: Message): bool {
     * }
     * ```
     *
     * Returning a falsy value fails the validation.
     *
     * @type {Map<string, Set<function>>}
     */
    this._fwrdValidators = new Map()
  }

  addFrwdValidator (topic, func) {
    if (!this._fwrdValidators.has(topic)) {
      this._fwrdValidators.set(topic, new Set())
    }

    const validators = this._fwrdValidators.get(topic)
    validators.add(func)
  }

  _onDial (peerInfo, conn, callback) {
    super._onDial(peerInfo, conn, (err) => {
      if (err) return callback(err)
      const idB58Str = peerInfo.id.toB58String()
      const peer = this.peers.get(idB58Str)
      // Immediately send my own subscriptions to the newly established conn
      peer.sendSubscriptions(this.subscriptions)
      setImmediate(() => callback())
    })
  }

  _onRpc (idB58Str, rpc) {
    if (!rpc) {
      return
    }

    this.log('rpc from', idB58Str)
    const subs = rpc.subscriptions
    const msgs = rpc.msgs

    if (msgs && msgs.length) {
      this._processRpcMessages(utils.normalizeInRpcMessages(rpc.msgs))
    }

    if (subs && subs.length) {
      const peer = this.peers.get(idB58Str)
      if (peer) {
        peer.updateSubscriptions(subs)
      }
    }
  }

  _processRpcMessages (msgs) {
    msgs.forEach((msg) => {
      const seqno = utils.msgId(msg.from, msg.seqno.toString())
      // 1. check if I've seen the message, if yes, ignore
      if (this.cache.has(seqno)) {
        return
      }

      this.cache.put(seqno)

      // 1. emit to self
      this._emitMessages(msg.topicIDs, [msg])

      // 2. don't propagate if we've reached 0
      if (msg.hops === 0) {
        this.log('skipping forwarding message, hop count is 0')
        return
      }

      // 3. decrement remaining hops
      if (msg.hops && msg.hops > 0) {
        msg.hops -= 1
      }

      // 4. forward message
      this._forwardMessages(msg.topicIDs, [msg])
    })
  }

  _emitMessages (topics, messages) {
    topics.forEach((topic) => {
      if (!this.subscriptions.has(topic)) {
        return
      }

      messages.forEach((message) => {
        this.emit(topic, message)
      })
    })
  }

  _forwardMessages (topics, messages) {
    this.peers.forEach((peer) => {
      if (!peer.isWritable || !utils.anyMatch(peer.topics, topics)) {
        return
      }

      let msgs = messages
      for (let topic of peer.topics) {
        if (this._fwrdValidators.has(topic)) {
          const validators = Array.from(this._fwrdValidators.get(topic))
          if (validators) {
            msgs = msgs.filter((msg) => validators.every((validator) => {
              return validator(peer, msg)
            }))
          }
        }
      }

      peer.sendMessages(utils.normalizeOutRpcMessages(msgs))

      this.log('publish msgs on topics', topics, peer.info.id.toB58String())
    })
  }

  /**
   * Unmounts the floodsub protocol and shuts down every connection
   *
   * @param {Function} callback
   * @returns {undefined}
   *
   */
  stop (callback) {
    super.stop((err) => {
      if (err) return callback(err)
      this.subscriptions = new Set()
      callback()
    })
  }

  /**
   * Publish messages to the given topics.
   *
   * @param {Array<string>|string} topics
   * @param {Array<any>|any} messages
   * @param {number} hops
   * @returns {undefined}
   *
   */
  publish (topics, messages, hops) {
    assert(this.started, 'Multicast is not started')

    this.log('publish', topics, messages)

    topics = ensureArray(topics)
    messages = ensureArray(messages)

    const from = this.libp2p.peerInfo.id.toB58String()

    const buildMessage = (msg) => {
      const seqno = utils.randomSeqno()
      this.cache.put(utils.msgId(from, seqno))

      return {
        from: from,
        data: msg,
        hops: hops,
        seqno: new Buffer(seqno),
        topicIDs: topics
      }
    }

    const msgObjects = messages.map(buildMessage)

    // Emit to self if I'm interested
    this._emitMessages(topics, msgObjects)

    // send to all the other peers
    this._forwardMessages(topics, msgObjects)
  }

  /**
   * Subscribe to the given topic(s).
   *
   * @param {Array<string>|string} topics
   * @returns {undefined}
   */
  subscribe (topics) {
    assert(this.started, 'Multicast is not started')

    topics = ensureArray(topics)

    topics.forEach((topic) => this.subscriptions.add(topic))

    this.peers.forEach((peer) => sendSubscriptionsOnceReady(peer))
    // make sure that Multicast is already mounted
    function sendSubscriptionsOnceReady (peer) {
      if (peer && peer.isWritable) {
        return peer.sendSubscriptions(topics)
      }
      const onConnection = () => {
        peer.removeListener('connection', onConnection)
        sendSubscriptionsOnceReady(peer)
      }
      peer.on('connection', onConnection)
      peer.once('close', () => peer.removeListener('connection', onConnection))
    }
  }

  /**
   * Unsubscribe from the given topic(s).
   *
   * @param {Array<string>|string} topics
   * @returns {undefined}
   */
  unsubscribe (topics) {
    // Avoid race conditions, by quietly ignoring unsub when shutdown.
    if (!this.started) {
      return
    }

    topics = ensureArray(topics)

    topics.forEach((topic) => this.subscriptions.delete(topic))

    this.peers.forEach((peer) => checkIfReady(peer))
    // make sure that Multicast is already mounted
    function checkIfReady (peer) {
      if (peer && peer.isWritable) {
        peer.sendUnsubscriptions(topics)
      } else {
        setImmediate(checkIfReady.bind(peer))
      }
    }
  }
}

module.exports = Multicast
