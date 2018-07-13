'use strict'

const pull = require('pull-stream')
const lp = require('pull-length-prefixed')

const BaseProtocol = require('./base')

/**
 * FloodSub (aka dumbsub is an implementation of pubsub focused on
 * delivering an API for Publish/Subscribe, but with no CastTree Forming
 * (it just floods the network).
 */
class RpcBase extends BaseProtocol {
  /**
   * @param {String} debugName
   * @param {String} multicodec
   * @param {ProtonCodec} rpcCodec
   * @param {Object} libp2p
   * @returns {FloodSub}
   */
  constructor (debugName, multicodec, rpcCodec, libp2p) {
    super(debugName, multicodec, libp2p)
    this.rpcCodec = rpcCodec
  }

  _processIncommingConnection (idB58Str, conn, peer) {
    pull(
      conn,
      lp.decode(),
      pull.map((data) => this.rpcCodec.decode(data)),
      pull.drain(
        (rpc) => this._onRpc(idB58Str, rpc),
        (err) => this._onConnectionEnd(idB58Str, peer, err)
      )
    )
  }

  _processOutgoingConnection (idB58Str, conn, peer) {
    const peerStream = peer.createStream()
    pull(
      peerStream,
      pull.map((data) => this.rpcCodec.encode(data)),
      lp.encode(),
      conn,
      pull.onEnd(() => {
        peer.onStreamEnd()
      })
    )
  }
}

module.exports = RpcBase
