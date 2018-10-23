'use strict'

const Pushable = require('pull-pushable')
const setImmediate = require('async/setImmediate')
const EventEmitter = require('events')

const noop = () => {}

/**
 * The known state of a connected peer.
 */
class Peer extends EventEmitter {
  /**
   * @param {PeerInfo} info
   */
  constructor (info) {
    super()

    /**
     * @type {PeerInfo}
     */
    this.info = info
    /**
     * @type {Set}
     */
    this.topics = new Set()
    /**
     * @type {Pushable}
     */
    this.stream = null

    this._references = 0
  }

  /**
   * Is the peer connected currently?
   *
   * @type {boolean}
   */
  get isConnected () {
    return Boolean(this.stream)
  }

  /**
   * Do we have a connection to write on?
   *
   * @type {boolean}
   */
  get isWritable () {
    return Boolean(this.stream)
  }

  /**
   * Send a message to this peer.
   * Throws if there is no `stream` to write to available.
   *
   * @param {Buffer} msg
   * @param {Function} cb
   * @returns {Function}
   */
  write (msg, cb) {
    cb = cb || noop
    if (!this.isWritable) {
      const id = this.info.id.toB58String()
      return cb(new Error('No writable connection to ' + id))
    }

    this.stream.push(msg)
    cb()
  }

  /**
   * Attach the peer to a connection and setup a write stream
   *
   * @param {Connection} conn
   * @returns {undefined}
   */
  createStream () {
    this.stream = new Pushable()
    this.emit('connection')
    return this.stream
  }

  onStreamEnd () {
    this.stream = null
    this.emit('close')
  }

  _sendRawSubscriptions (topics, subscribe) {
    if (topics.size === 0) {
      return
    }

    const subs = []
    topics.forEach((topic) => {
      subs.push({
        subscribe: subscribe,
        topicCID: topic
      })
    })

    this.write({
      subscriptions: subs
    })
  }

  /**
   * Send the given subscriptions to this peer.
   * @param {Set|Array} topics
   * @returns {undefined}
   */
  sendSubscriptions (topics) {
    this._sendRawSubscriptions(topics, true)
  }

  /**
   * Send the given unsubscriptions to this peer.
   * @param {Set|Array} topics
   * @returns {undefined}
   */
  sendUnsubscriptions (topics) {
    this._sendRawSubscriptions(topics, false)
  }

  /**
   * Send messages to this peer.
   *
   * @param {Array<any>} msgs
   * @returns {undefined}
   */
  sendMessages (msgs) {
    this.write({
      msgs: msgs
    })
  }

  /**
   * Bulk process subscription updates.
   *
   * @param {Array} changes
   * @returns {undefined}
   */
  updateSubscriptions (changes) {
    changes.forEach((subopt) => {
      if (subopt.subscribe) {
        this.topics.add(subopt.topicCID)
      } else {
        this.topics.delete(subopt.topicCID)
      }
    })
  }

  /**
   * Closes the open connection to peer
   *
   * @param {Function} callback
   * @returns {undefined}
   */
  close (callback) {
    // Force removal of peer
    this._references = 1

    // End the pushable
    if (this.stream) {
      this.stream.end()
    }

    setImmediate(() => {
      this.stream = null
      this.emit('close')
      callback()
    })
  }
}

module.exports = Peer
