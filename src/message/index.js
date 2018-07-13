'use strict'

const protons = require('protons')

const rpcProto = protons(require('./rpc.proto.js'))

exports = module.exports
exports.rpc = rpcProto
