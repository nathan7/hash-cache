'use strict';
module.exports = Cache
var Path = require('path')
  , fs = require('fs')
  , mkdirp = require('mkdirp')
  , through = require('through')
  , Dict = require('dict')

function noop() {}
function unimplemented() { throw new Error('unimplemented') }

function Cache(opts) {
  if (!this || this === global) return new Cache(opts)

  if (typeof opts == 'string') opts = { path: opts }

  this.path = opts.path
  this.paranoid = !!opts.paranoid
  this.__pending = Dict()
}

Cache.prototype._createReadStream = unimplemented
Cache.prototype._createHash = unimplemented

Cache.prototype.createReadStream = function(digest) { var self = this
  var output = through()

  var pending = this.__pending.get(digest)
  if (!pending) {
    pending = through()
      .once('readable', function() { self.__pending.delete(digest) })
    this.__pending.set(digest, pending)
    this.__acquireFs(arguments, pending)
  }

  return pending
    .on('error', function(err) { output.emit('error', err) })
    .pipe(output)
}


Cache.prototype.__store = function(digest) { return Path.join(this.path, 'store', digest) }
Cache.prototype.__tmp = function(digest) { return Path.join(this.path, 'tmp', digest) }

Cache.prototype.__acquireFs = function(args, pending, paranoid) { var self = this
  var digest = args[0]

  var input = fs.createReadStream(this.__store(digest))
    .on('error', function(err) {
      if (err.code !== 'ENOENT') return pending.emit('error', err)
      self.__acquireFresh(args, pending)
    })

  if (!this.paranoid || paranoid === false)
    return input.pipe(pending)

  this.__hash(input, digest, function(err) {
    if (err) return pending.emit(err)
    self.__acquireFs(args, pending, false)
  })
}

Cache.prototype.__hash = function(stream, digest, cb) {
  var hash = this._createHash()
  return stream
    .on('data', function(chunk) { hash.update(chunk) })
    .on('end', function() {
      var actualDigest = Buffer(hash.digest()).toString('hex')
      if (actualDigest === digest) return cb()
      var err = new Error('hashes did not match. expected `' + digest + '`, got `' + actualDigest + '`')
      err.expected = digest
      err.actual = actualDigest
      cb(err)
    })
}

Cache.prototype.__acquireFresh = function(args, pending) { var self = this
  var digest = args[0]
    , store = this.__store(digest)
    , tmp = this.__tmp(digest)

  createInput()

  var input
  function createInput() {
    try { input = self._createReadStream.apply(self, args) }
    catch (e) { return error(e) }
    input.on('error', error)
    maketmp()
  }

  function maketmp() {
    mkdirp(Path.dirname(tmp), function(err) { if (err) error(err); else writeStream() })
  }

  function writeStream() {
    self.__hash(input, digest, compareHash)
      .pipe(fs.createWriteStream(tmp))
      .on('error', error)
  }

  function compareHash(err) {
    if (!err) return makeStore()

    fs.unlink(tmp, noop)
    error(err)
  }

  function makeStore() {
    mkdirp(Path.dirname(store), function(err) { if (err) error(err); else rename() })
  }

  function rename() {
    fs.rename(tmp, store, function(err) { if (err) error(err); else deliver() })
  }

  function deliver() {
    fs.createReadStream(store).pipe(pending)
  }

  function error(err) { return pending.emit('error', err) }
}
